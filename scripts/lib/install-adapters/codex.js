'use strict';

// Codex / Cursor project-local installer (js-projection-journal stage 3).
//
// A one-for-one port of the Python program that scripts/hooks/
// install-codex-skills.sh embedded until js-projection-journal stage 5. Function
// names mirror the Python ones in camelCase and keep its control flow, messages,
// file formats, and exit codes. Python globals are closure state of one installer run.
//
// Differences from the Python, by design (ADR-0036):
// - Node has no openat/dir_fd. Where the Python pinned a directory
//   descriptor, the port re-validates the parent chain for symlinks right
//   before acting, opens leaves with O_NOFOLLOW, and re-checks with lstat; the
//   project install lock keeps other installers out. The remaining
//   check-to-use window is an accepted residual risk.
// - Transaction bookkeeping is one Projection Journal (projection-journal.js)
//   instead of the retired Python Host journal and pending-rollback lists.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const childProcess = require('node:child_process');
const compat = require('./python-compat');
const {
  versionBoundaryMessage: nodeVersionBoundaryMessage,
  TREE_FINGERPRINT_ALGORITHM,
  isBytecodeName,
  fileLeafDigest,
  linkLeafDigest,
  directoryDigest,
} = require('../content-fingerprint');

const {
  ValueError,
  OSError,
  ProviderReceiptTooLarge,
  InstallerExit,
  isExit,
  isOSError,
  isValueError,
  isOSOrValueError,
  rethrowExit,
  errnoIs,
  errorText,
  pyRepr,
  pyJsonDumps,
  pyJsonLoads,
  pySorted,
  isDict,
  isStr,
  lstatOrNull,
  lexists,
  pathExists,
  isLink,
  isDirFollow,
  isFileFollow,
  realpath,
  sha256,
  utcStamp,
  uuidHex,
} = compat;
const { addCursorCacheDriftWarnings } = require('./cursor-plan');

// The installer's own code. These are static requires on purpose: they resolve
// against this file, so a checkout runs the checkout's modules and the
// generated bundle (scripts/lib/installer-bundle.js) can see every one of them.
// None is ever looked up under the artifact being installed (DHPK_PLUGIN_ROOT /
// DHPK_INSTALLER_ROOT), which is data and may be user supplied.
const journalCore = require('../projection-journal');
const publisherModule = require('../project-agent-projection-publisher');
const nativeSharedSkillInstall = require('../native-shared-skill-install');
const cursorConsumerEvidence = require('../cursor-consumer-evidence');
const portableSkillMetadata = require('../portable-skill-metadata');

const O_NOFOLLOW = fs.constants.O_NOFOLLOW || 0;
const O_NONBLOCK = fs.constants.O_NONBLOCK || 0;
const O_DIRECTORY = fs.constants.O_DIRECTORY || 0;

// One row per Host: the shell entry's DHPK_* shape (read by codex-cli.js) and
// the Host-specific names the installer itself needs.
const HOSTS = Object.freeze({
  codex: Object.freeze({
    srcRel: 'codex',
    destRel: '.codex',
    sourceKinds: 'skills,agents',
    installerName: 'install-codex-skills',
    surfaceLabel: 'Codex',
    sharedProjectionHost: 'codex',
    declaredProjectionHostKey: 'codex-sync',
    consumerEvidenceEnvKey: 'DHPK_CODEX_CONSUMER_EVIDENCE',
  }),
  cursor: Object.freeze({
    srcRel: 'cursor',
    destRel: '.cursor',
    sourceKinds: 'skills,agents,rules,commands',
    installerName: 'install-cursor-harness',
    surfaceLabel: 'Cursor',
    sharedProjectionHost: 'cursor',
    declaredProjectionHostKey: 'cursor',
    consumerEvidenceEnvKey: 'DHPK_CURSOR_CONSUMER_EVIDENCE',
  }),
});

const SCHEMA_VERSION = 3;
const BACKUP_DIR = '.dhpk-backups';
const CODEX_NATIVE_PLUGIN_ID = 'dhpk@dhpk';
const DEFAULT_PROVIDER_QUERY_TIMEOUT_SECONDS = 30;
const PROVIDER_QUERY_OUTPUT_LIMIT = 1024 * 1024;
const PROVIDER_RECEIPT_BYTES_LIMIT = 1024 * 1024;
const PROVIDER_RECEIPT_ENTRY_LIMIT = 512;
const PROVIDER_RECEIPT_PATH_LIMIT = 64;
const PROVIDER_RECEIPT_VERSION_LIMIT = 128;
// treeFileDigest is synchronous, so one scratch buffer is never shared across calls in flight.
const TREE_READ_BUFFER = Buffer.allocUnsafe(1024 * 1024);
const ENTRY_LEGACY_MARKER = 'legacy';
const DEPENDENCY_GATED_KINDS = Object.freeze(['commands', 'agents']);
const SKILL_REF_RE = /skills\/([A-Za-z0-9._-]+)\//g;
const HEX64 = /^[0-9a-fA-F]{64}$/;

// Python truthiness: None, False, 0, '', and empty containers are false.
function pyTruthy(value) {
  if (value === null || value === undefined || value === false || value === 0 || value === '') return false;
  if (Array.isArray(value)) return value.length > 0;
  if (value instanceof compat.PyFloat) return value.value !== 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}

// str(value) for the scalar values a receipt can hold.
function pyStr(value) {
  if (value === null || value === undefined) return 'None';
  if (value === true) return 'True';
  if (value === false) return 'False';
  if (value instanceof compat.PyFloat) return compat.pyJsonDumps(value);
  if (typeof value === 'object') return compat.pyJsonDumps(value).replace(/"/g, "'");
  return String(value);
}

function positiveInt(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  const text = String(raw).trim();
  if (!/^[+-]?\d+$/.test(text)) return null;
  const value = Number.parseInt(text, 10);
  return value > 0 ? value : null;
}

function resolveProviderQueryTimeoutSeconds(env) {
  const seconds = positiveInt(env.DHPK_CODEX_PROBE_TIMEOUT_SECONDS);
  if (seconds !== null) return seconds;
  const ms = positiveInt(env.DHPK_CODEX_PROBE_TIMEOUT_MS);
  if (ms !== null) return Math.max(1, Math.floor(ms / 1000));
  return DEFAULT_PROVIDER_QUERY_TIMEOUT_SECONDS;
}

// shutil.which: the first executable regular file named `name` on PATH.
function which(name, env) {
  for (const directory of String(env.PATH || '').split(path.delimiter)) {
    if (!directory) continue;
    const candidate = path.join(directory, name);
    try {
      const stat = fs.statSync(candidate);
      if (stat.isFile()) {
        fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      }
    } catch (_) {
      // not here
    }
  }
  return null;
}

// Path-based stand-ins for the Python's directory descriptors. A "directory
// handle" is an absolute path whose every component below the root has been
// checked to be a physical directory.
function createInstaller(env, io) {
  const PLUGIN_ROOT = env.DHPK_PLUGIN_ROOT;
  // Data only: a second tree the source symlinks of PLUGIN_ROOT may point into.
  // Nothing is ever loaded or executed from it.
  const INSTALLER_ROOT = env.DHPK_INSTALLER_ROOT || PLUGIN_ROOT;
  const PROJECT_ROOT = env.DHPK_PROJECT_ROOT;
  const HARNESS_KIND = env.DHPK_HARNESS_KIND || 'codex';
  // An unknown kind has no row: Codex wording, and no shared projection.
  const HOST = Object.prototype.hasOwnProperty.call(HOSTS, HARNESS_KIND) ? HOSTS[HARNESS_KIND] : null;
  const SURFACE_LABEL = HOST ? HOST.surfaceLabel : 'Codex';
  const SRC_REL = env.DHPK_SRC_REL || 'codex';
  const DEST_REL = env.DHPK_DEST_REL || '.codex';
  const SOURCE_KINDS = Object.freeze(String(env.DHPK_SOURCE_KINDS || 'skills,agents').split(',').map((kind) => kind.trim()).filter(Boolean));
  const MANAGED_KINDS = Object.freeze([...SOURCE_KINDS, 'supporting_assets']);
  const INSTALLER_NAME = env.DHPK_INSTALLER_NAME || 'install-codex-skills';
  const INSTALLER_SCRIPT = `scripts/hooks/${INSTALLER_NAME}.sh`;
  const CODEX_SRC = path.join(PLUGIN_ROOT, SRC_REL);
  const CODEX_ROOT = path.join(PROJECT_ROOT, DEST_REL);
  const MANIFEST = path.join(CODEX_ROOT, '.dhpk-installed.json');
  let MODE = env.DHPK_MODE || 'symlink';
  const MODE_EXPLICIT = env.DHPK_MODE_EXPLICIT === '1';
  const UPDATE = env.DHPK_UPDATE === '1';
  const MIGRATE = env.DHPK_MIGRATE === '1';
  const UNINSTALL = env.DHPK_UNINSTALL === '1';
  const PLAN = env.DHPK_PLAN === '1';
  const RECOVER = env.DHPK_RECOVER === '1';
  const JSON_OUTPUT = env.DHPK_JSON_OUTPUT === '1';
  const ADOPT_PATHS = String(env.DHPK_ADOPT_PATHS || '').split(/\r?\n/).filter(Boolean);
  const REQUESTED_SKILL_IDS = String(env.DHPK_SKILL_IDS || '').split(/\r?\n/).filter(Boolean);
  let BACKUP_RUN = `${utcStamp()}-${process.pid}`;
  const PROVIDER_QUERY_TIMEOUT_SECONDS = resolveProviderQueryTimeoutSeconds(env);

  // print(): stdout, with the installer name substituted into the tag.
  const print = (text = '', { stderr = false } = {}) => {
    const line = String(text).replace('[install-codex-skills]', `[${INSTALLER_NAME}]`);
    (stderr ? io.stderr : io.stdout)(`${line}\n`);
  };
  const printErr = (text) => print(text, { stderr: true });
  const exit = (code) => {
    throw new InstallerExit(code);
  };

  // Evidence collections persisted in the receipt; paths are relative to the
  // project or the destination root.
  const evidencePaths = {
    created: [],
    updated: [],
    adopted: [],
    migrated: [],
    retired: [],
    collisions: [],
    deferred: [],
    orphaned: [],
  };
  const evidenceOwnership = {};
  const backupRecords = [];

  // Selection is resolved before source discovery and carried into receipts.
  let SELECTION_PROFILE_ID = null;
  let SELECTION_COMPATIBILITY = null;
  let SELECTION_POLICY_VERSION = null;
  let SELECTION_CANONICAL_IDS = null;
  let SELECTION_EMITTED_IDS = null;
  let SELECTION_RUNTIME_IDS = null;
  let SELECTION_FINGERPRINT = null;
  let SELECTION_SURFACE_FINGERPRINT = null;
  const EXCLUDED_SOURCE_ENTRIES = [];

  function recordPath(kind, relative) {
    if (!isStr(relative) || !relative) return;
    if (!evidencePaths[kind]) evidencePaths[kind] = [];
    const bucket = evidencePaths[kind];
    if (!bucket.includes(relative)) bucket.push(relative);
  }

  function recordOwnership(relative, classification) {
    if (isStr(relative) && relative) evidenceOwnership[relative] = classification;
  }

  function isWithin(candidate, root) {
    const resolved = realpath(candidate);
    const base = realpath(root);
    return resolved === base || resolved.startsWith(base + path.sep);
  }

  // ---------------------------------------------------------------------
  // Provider check

  function runBoundedProviderQuery(codex) {
    const result = childProcess.spawnSync(codex, ['plugin', 'list', '--json'], {
      timeout: PROVIDER_QUERY_TIMEOUT_SECONDS * 1000,
      killSignal: 'SIGKILL',
      maxBuffer: PROVIDER_QUERY_OUTPUT_LIMIT,
      detached: true,
      env,
    });
    if (Number.isInteger(result.pid)) {
      try {
        process.kill(-result.pid, 'SIGKILL');
      } catch (_) {
        // the process group already exited
      }
    }
    if (result.error || result.status !== 0) return null;
    if ((result.stdout ? result.stdout.length : 0) + (result.stderr ? result.stderr.length : 0) > PROVIDER_QUERY_OUTPUT_LIMIT) return null;
    const decoder = new TextDecoder('utf-8', { fatal: true });
    return [decoder.decode(result.stdout), decoder.decode(result.stderr)];
  }

  // Best-effort evidence about the native dhpk Codex plugin; an enabled native
  // plugin is a hard preflight blocker handled by the caller.
  function probeCodexNativePlugin() {
    if (UNINSTALL) return { status: 'NOT_APPLICABLE' };
    if (HARNESS_KIND !== 'codex') return { status: 'NOT_APPLICABLE' };
    const codex = which('codex', env);
    if (!codex) return { status: 'UNAVAILABLE' };
    let output;
    try {
      output = runBoundedProviderQuery(codex);
    } catch (_) {
      return { status: 'UNAVAILABLE' };
    }
    if (output === null) return { status: 'UNAVAILABLE' };
    let payload;
    try {
      payload = JSON.parse(output[0]);
    } catch (_) {
      return { status: 'UNAVAILABLE' };
    }
    if (!isDict(payload) || !Array.isArray(payload.installed)) return { status: 'UNAVAILABLE' };
    let disabledMatch = null;
    let malformedMatch = false;
    for (const entry of payload.installed) {
      if (!isDict(entry) || entry.pluginId !== CODEX_NATIVE_PLUGIN_ID) continue;
      if (typeof entry.enabled !== 'boolean') {
        malformedMatch = true;
        continue;
      }
      if (entry.enabled) {
        const result = { status: 'ENABLED', pluginId: CODEX_NATIVE_PLUGIN_ID, enabled: true };
        if (isStr(entry.version) && entry.version) result.version = entry.version;
        return result;
      }
      disabledMatch = entry;
    }
    if (malformedMatch) return { status: 'UNAVAILABLE' };
    if (disabledMatch === null) return { status: 'AVAILABLE' };
    const result = { status: 'DISABLED', pluginId: CODEX_NATIVE_PLUGIN_ID, enabled: false };
    if (isStr(disabledMatch.version) && disabledMatch.version) result.version = disabledMatch.version;
    return result;
  }

  // Bounded, read-only receipt evidence for a provider conflict.
  function inspectReceiptForProviderBlock() {
    const evidence = { status: 'MISSING', pluginVersion: null, brokenSymlinkPaths: [] };
    if (lexists(CODEX_ROOT) && isLink(CODEX_ROOT)) {
      evidence.status = 'UNAVAILABLE';
      return evidence;
    }
    if (!lexists(MANIFEST)) return evidence;
    let receiptStat;
    try {
      receiptStat = fs.lstatSync(MANIFEST);
    } catch (_) {
      evidence.status = 'UNAVAILABLE';
      return evidence;
    }
    if (!receiptStat.isFile()) {
      evidence.status = 'UNAVAILABLE';
      return evidence;
    }
    let receipt;
    try {
      receipt = readBoundedProviderReceipt();
    } catch (error) {
      rethrowExit(error);
      evidence.status = error instanceof ProviderReceiptTooLarge ? 'UNAVAILABLE' : 'MALFORMED';
      return evidence;
    }
    if (!isDict(receipt)) {
      evidence.status = 'MALFORMED';
      return evidence;
    }
    evidence.status = 'FOUND';
    const pluginVersion = receipt.plugin_version;
    if (isStr(pluginVersion) && pluginVersion) evidence.pluginVersion = Array.from(pluginVersion).slice(0, PROVIDER_RECEIPT_VERSION_LIMIT).join('');
    const managed = receipt.managed_entries;
    if (!isDict(managed)) return evidence;
    let scannedEntries = 0;
    let truncated = false;
    for (const kind of MANAGED_KINDS) {
      const entries = managed[kind];
      if (!isDict(entries)) continue;
      for (const name of pySorted(Object.keys(entries))) {
        scannedEntries += 1;
        if (scannedEntries > PROVIDER_RECEIPT_ENTRY_LIMIT) {
          truncated = true;
          break;
        }
        const entry = entries[name];
        if (!isDict(entry) || entry.mode !== 'symlink') continue;
        const relative = entry.destination || entry.source;
        if (!isStr(relative) || relative.length > 4096) continue;
        const recordedSource = entry.source || entry.destination;
        if (!isStr(recordedSource)) continue;
        let destination;
        try {
          destination = safeDestination(relative);
        } catch (error) {
          if (isOSOrValueError(error)) continue;
          throw error;
        }
        if (!isLink(destination) || pathExists(destination)) continue;
        let owned;
        try {
          owned = isOwned(entry, destination);
        } catch (error) {
          rethrowExit(error);
          owned = false;
        }
        if (!owned) continue;
        if (evidence.brokenSymlinkPaths.length >= PROVIDER_RECEIPT_PATH_LIMIT) {
          truncated = true;
          continue;
        }
        evidence.brokenSymlinkPaths.push(relative);
      }
      if (truncated && scannedEntries > PROVIDER_RECEIPT_ENTRY_LIMIT) break;
    }
    evidence.brokenSymlinkPaths = pySorted(evidence.brokenSymlinkPaths);
    if (truncated) evidence.brokenSymlinkPathsTruncated = true;
    return evidence;
  }

  function readBoundedProviderReceipt() {
    const root = openRelativeDirectory('', { create: false });
    const target = path.join(root, path.basename(MANIFEST));
    const descriptor = fs.openSync(target, fs.constants.O_RDONLY | O_NONBLOCK | O_NOFOLLOW);
    try {
      if (!fs.fstatSync(descriptor).isFile()) throw new ValueError('provider diagnostic receipt is not a regular file');
      const chunks = [];
      let total = 0;
      const buffer = Buffer.alloc(65536);
      while (total <= PROVIDER_RECEIPT_BYTES_LIMIT) {
        const count = fs.readSync(descriptor, buffer, 0, Math.min(65536, PROVIDER_RECEIPT_BYTES_LIMIT + 1 - total), null);
        if (count === 0) break;
        chunks.push(Buffer.from(buffer.subarray(0, count)));
        total += count;
      }
      if (total > PROVIDER_RECEIPT_BYTES_LIMIT) throw new ProviderReceiptTooLarge('provider diagnostic receipt exceeds the read limit');
      return pyJsonLoads(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
    } finally {
      fs.closeSync(descriptor);
    }
  }

  // ---------------------------------------------------------------------
  // Source and destination path safety

  // Reject unsafe source links; rollback may retain broken links.
  function validateSourceTree(source, label = 'distribution source', allowedRoots = null, allowBrokenSymlinks = false) {
    const roots = allowedRoots || [PLUGIN_ROOT];
    const contained = (candidate) => roots.some((root) => isWithin(candidate, root));
    if (!lexists(source) || !contained(source)) throw new ValueError(`${label} escapes the plugin root: ${source}`);
    if (!allowBrokenSymlinks && isLink(source) && !pathExists(source)) throw new ValueError(`${label} is a broken symlink: ${source}`);
    if (!isDirFollow(source)) return;
    // os.walk(followlinks=False): descend only into physical directories.
    const visit = (current) => {
      let names;
      try {
        names = fs.readdirSync(current);
      } catch (_) {
        return;
      }
      const directories = [];
      for (const name of names) {
        const child = path.join(current, name);
        const stat = lstatOrNull(child);
        if (!stat) continue;
        if (stat.isSymbolicLink()) {
          if (!contained(child)) throw new ValueError(`${label} symlink escapes the plugin root: ${child}`);
          if (!allowBrokenSymlinks && !pathExists(child)) throw new ValueError(`${label} contains a broken symlink: ${child}`);
        } else if (stat.isDirectory()) directories.push(child);
      }
      for (const directory of directories) visit(directory);
    };
    visit(source);
  }

  function ensureCodexRootSafe() {
    if (lexists(CODEX_ROOT) && isLink(CODEX_ROOT)) throw new ValueError(`project ${DEST_REL} is a symlink; refusing to mutate outside the project`);
  }

  function ensureManifestSafe() {
    ensureCodexRootSafe();
    if (!lexists(MANIFEST)) return;
    if (isLink(MANIFEST)) throw new ValueError(`project ${DEST_REL} receipt is a symlink; refusing to follow it`);
    if (!isFileFollow(MANIFEST)) throw new ValueError(`project ${DEST_REL} receipt is not a regular file; refusing to mutate it`);
  }

  // Reject aliases in the destination parent chain, not just the leaf.
  function hasSymlinkAncestor(candidate) {
    let current = path.resolve(candidate);
    const root = path.resolve(CODEX_ROOT);
    while (current !== root) {
      if (!isWithin(current, root)) return true;
      if (isLink(current)) return true;
      const parent = path.dirname(current);
      if (parent === current) return true;
      current = parent;
    }
    return false;
  }

  // os.path.normpath for a POSIX relative path.
  function normpath(relative) {
    const parts = [];
    for (const part of relative.split('/')) {
      if (part === '' || part === '.') continue;
      if (part === '..' && parts.length && parts[parts.length - 1] !== '..') parts.pop();
      else parts.push(part);
    }
    const joined = parts.join('/');
    return joined || '.';
  }

  function safeDestination(relative) {
    if (!isStr(relative) || !relative || relative.includes('\x00') || relative.includes('\\')) throw new ValueError('receipt destination is not a valid relative path');
    const normalized = normpath(relative);
    if (path.isAbsolute(relative) || (relative.length > 1 && relative[1] === ':') || normalized !== relative || normalized === '.' || normalized === '..' || normalized.startsWith('../')) {
      throw new ValueError(`receipt destination escapes project ${DEST_REL}: ${relative}`);
    }
    ensureCodexRootSafe();
    const destination = path.join(CODEX_ROOT, ...relative.split('/'));
    const rootReal = realpath(CODEX_ROOT);
    const parent = path.dirname(destination);
    if (hasSymlinkAncestor(parent)) throw new ValueError(`receipt destination has a symlinked parent: ${relative}`);
    if (!isWithin(parent, rootReal)) throw new ValueError(`receipt destination parent escapes project ${DEST_REL}: ${relative}`);
    if (lexists(destination) && !isLink(destination) && !isWithin(destination, rootReal)) throw new ValueError(`receipt destination escapes project ${DEST_REL}: ${relative}`);
    return destination;
  }

  // Require every directory-handle leaf to be exactly one path component.
  function validateFdName(name) {
    if (!isStr(name) || !name || name === '.' || name === '..' || name.includes('\x00') || name.includes('/')) {
      throw new ValueError(`file descriptor entry name is not a single component: ${pyRepr(name)}`);
    }
    return name;
  }

  // Walks a destination-root descendant one component at a time, refusing
  // symlinked components; creates missing ones with mode 0700 when asked.
  function openRelativeDirectory(relative, { create = false } = {}) {
    const components = relative.split('/').filter(Boolean).map(validateFdName);
    let current = CODEX_ROOT;
    const rootStat = lstatOrNull(current);
    if (!rootStat) {
      if (!create) throw Object.assign(new Error(`ENOENT: no such file or directory, open '${current}'`), { code: 'ENOENT', errno: -2, path: current });
      fs.mkdirSync(current, { mode: 0o700 });
    } else if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
      throw Object.assign(new Error(`ENOTDIR: not a directory, open '${current}'`), { code: rootStat.isSymbolicLink() ? 'ELOOP' : 'ENOTDIR', errno: rootStat.isSymbolicLink() ? -62 : -20, path: current });
    }
    for (const component of components) {
      const next = path.join(current, component);
      const stat = lstatOrNull(next);
      if (!stat) {
        if (!create) throw Object.assign(new Error(`ENOENT: no such file or directory, open '${component}'`), { code: 'ENOENT', errno: -2, path: component });
        fs.mkdirSync(next, { mode: 0o700 });
      } else if (stat.isSymbolicLink()) {
        throw new ValueError(`symlinked managed directory ${DEST_REL}/${relative}; replace it with a physical directory before retrying`);
      } else if (!stat.isDirectory()) {
        throw Object.assign(new Error(`ENOTDIR: not a directory, open '${component}'`), { code: 'ENOTDIR', errno: -20, path: component });
      }
      current = next;
    }
    return current;
  }

  function fdEntryExists(directory, name) {
    validateFdName(name);
    return lstatOrNull(path.join(directory, name)) !== null;
  }

  function fsyncPath(target, directory = false) {
    let descriptor;
    try {
      descriptor = fs.openSync(target, fs.constants.O_RDONLY | (directory ? O_DIRECTORY : 0) | O_NOFOLLOW);
    } catch (error) {
      if (errnoIs(error, 'ENOENT')) return;
      throw error;
    }
    try {
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
  }

  // Flush a tree beneath a parent without following user links.
  function fsyncFdEntry(parent, name) {
    validateFdName(name);
    const target = path.join(parent, name);
    const stat = lstatOrNull(target);
    if (!stat || stat.isSymbolicLink()) return;
    if (stat.isDirectory()) {
      for (const child of fs.readdirSync(target).sort()) fsyncFdEntry(target, child);
      fsyncPath(target, true);
    } else {
      fsyncPath(target);
    }
  }

  function removeFdEntry(directory, name) {
    validateFdName(name);
    if (!fdEntryExists(directory, name)) return;
    const target = path.join(directory, name);
    const stat = fs.lstatSync(target);
    if (stat.isDirectory()) {
      const tombstone = `.dhpk-remove-${uuidHex()}`;
      fs.renameSync(target, path.join(directory, tombstone));
      const tombstonePath = path.join(directory, tombstone);
      for (const child of fs.readdirSync(tombstonePath).sort()) removeFdEntry(tombstonePath, child);
      fs.rmdirSync(tombstonePath);
    } else {
      fs.unlinkSync(target);
    }
  }

  // Copy a tree without following any link in it.
  function copyFdEntry(sourceDirectory, sourceName, destinationDirectory, destinationName) {
    validateFdName(sourceName);
    validateFdName(destinationName);
    const source = path.join(sourceDirectory, sourceName);
    const destination = path.join(destinationDirectory, destinationName);
    const sourceStat = fs.lstatSync(source);
    if (sourceStat.isSymbolicLink()) {
      fs.symlinkSync(fs.readlinkSync(source), destination);
      return;
    }
    if (sourceStat.isDirectory()) {
      fs.mkdirSync(destination, { mode: sourceStat.mode & 0o7777 });
      try {
        if (isLink(destination)) throw new ValueError(`copy destination became a symlink: ${destinationName}`);
        for (const child of fs.readdirSync(source).sort()) copyFdEntry(source, child, destination, child);
        fs.chmodSync(destination, sourceStat.mode & 0o7777);
        fsyncPath(destination, true);
      } catch (error) {
        try {
          removeFdEntry(destinationDirectory, destinationName);
        } catch (cleanupError) {
          if (!isOSError(cleanupError)) throw cleanupError;
        }
        throw error;
      }
      return;
    }
    if (!sourceStat.isFile()) throw new ValueError(`unsupported rollback entry type: ${sourceName}`);
    const input = fs.openSync(source, fs.constants.O_RDONLY | O_NOFOLLOW);
    try {
      const output = fs.openSync(destination, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | O_NOFOLLOW, sourceStat.mode & 0o7777);
      let closed = false;
      try {
        const buffer = Buffer.alloc(1024 * 1024);
        while (true) {
          const count = fs.readSync(input, buffer, 0, buffer.length, null);
          if (count === 0) break;
          let offset = 0;
          while (offset < count) offset += fs.writeSync(output, buffer, offset, count - offset);
        }
        fs.fchmodSync(output, sourceStat.mode & 0o7777);
        fs.fsyncSync(output);
      } catch (error) {
        fs.closeSync(output);
        closed = true;
        try {
          fs.unlinkSync(destination);
        } catch (cleanupError) {
          if (!isOSError(cleanupError)) throw cleanupError;
        }
        throw error;
      } finally {
        if (!closed) fs.closeSync(output);
      }
    } finally {
      fs.closeSync(input);
    }
  }

  // ---------------------------------------------------------------------
  // Tree fingerprints (tree-merkle-v1)

  function treeFileDigest(target) {
    const digest = crypto.createHash('sha256').update('file\0');
    const descriptor = fs.openSync(target, fs.constants.O_RDONLY | O_NOFOLLOW);
    try {
      while (true) {
        const count = fs.readSync(descriptor, TREE_READ_BUFFER, 0, TREE_READ_BUFFER.length, null);
        if (count === 0) break;
        digest.update(TREE_READ_BUFFER.subarray(0, count));
      }
    } finally {
      fs.closeSync(descriptor);
    }
    return digest.digest('hex');
  }

  // The tree-merkle-v1 leaf and directory recipes live in content-fingerprint.
  function treeDirectoryDigest(children) {
    return directoryDigest(Object.keys(children), (name) => children[name]);
  }

  function treeRefuseLink(relative) {
    throw new ValueError(`cannot fingerprint symlink '${relative}'`);
  }

  function treeRefuseSpecial(relative) {
    throw new ValueError(`cannot fingerprint special entry '${relative}'`);
  }

  // Digest one entry beneath a checked parent, or null for an empty directory.
  function treeNodeFd(parent, name, relative, recordLinks, skipBytecode, isRoot) {
    const target = path.join(parent, name);
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink()) {
      if (!recordLinks) treeRefuseLink(relative);
      return linkLeafDigest(fs.readlinkSync(target));
    }
    if (stat.isFile()) return treeFileDigest(target);
    if (!stat.isDirectory()) treeRefuseSpecial(relative);
    return treeChildrenFd(target, relative, recordLinks, skipBytecode, isRoot);
  }

  function treeChildrenFd(directory, relative, recordLinks, skipBytecode, isRoot) {
    const children = {};
    for (const name of fs.readdirSync(directory)) {
      if (skipBytecode && isBytecodeName(name)) continue;
      const childRelative = relative ? `${relative}/${name}` : name;
      const digest = treeNodeFd(directory, name, childRelative, recordLinks, skipBytecode, false);
      if (digest !== null) children[name] = digest;
    }
    if (Object.keys(children).length === 0 && !isRoot) return null;
    return treeDirectoryDigest(children);
  }

  // Fingerprint one entry beneath a parent; an empty directory is a root.
  function treeFingerprintFdEntry(parent, name, { recordLinks = false, skipBytecode = true } = {}) {
    return treeNodeFd(parent, name, name, recordLinks, skipBytecode, true);
  }

  function treeFingerprintFdDirectory(directory, { recordLinks = false, skipBytecode = true } = {}) {
    return treeChildrenFd(directory, '', recordLinks, skipBytecode, true);
  }

  function treeNodePath(target, relative, symlinks, skipBytecode, isRoot, ancestors = []) {
    let current = target;
    if (isLink(current)) {
      if (symlinks === 'record') return linkLeafDigest(fs.readlinkSync(current));
      if (symlinks !== 'follow') treeRefuseLink(relative);
      current = realpath(current);
      if (!pathExists(current)) {
        if (isRoot) return null;
        throw new ValueError(`cannot fingerprint dangling symlink '${relative}'`);
      }
    }
    if (isFileFollow(current)) {
      return fileLeafDigest(fs.readFileSync(current));
    }
    if (!isDirFollow(current)) treeRefuseSpecial(relative);
    const realDirectory = realpath(current);
    if (ancestors.includes(realDirectory)) throw new ValueError(`cannot fingerprint symlink cycle at '${relative}'`);
    const nextAncestors = [...ancestors, realDirectory];
    const children = {};
    for (const name of fs.readdirSync(current)) {
      if (skipBytecode && isBytecodeName(name)) continue;
      const childRelative = relative ? `${relative}/${name}` : name;
      const digest = treeNodePath(path.join(current, name), childRelative, symlinks, skipBytecode, false, nextAncestors);
      if (digest !== null) children[name] = digest;
    }
    if (Object.keys(children).length === 0 && !isRoot) return null;
    return treeDirectoryDigest(children);
  }

  // Fingerprint a file or directory by path; symlinks: refuse, record or follow.
  function treeFingerprintPath(target, { symlinks = 'refuse', skipBytecode = true } = {}) {
    if (!['refuse', 'record', 'follow'].includes(symlinks)) throw new ValueError(`unknown symlink policy: ${symlinks}`);
    return treeNodePath(target, '', symlinks, skipBytecode, true) || '';
  }

  function versionBoundaryMessage(field, ...observed) {
    return observed.length === 0 ? nodeVersionBoundaryMessage(field) : nodeVersionBoundaryMessage(field, observed[0]);
  }

  // tree-merkle-v1 for a record that names it; anything else fails closed.
  function recordFingerprintAlgorithm(record) {
    if (!isDict(record) || !Object.prototype.hasOwnProperty.call(record, 'fingerprint_algorithm')) throw new ValueError(versionBoundaryMessage('fingerprint_algorithm'));
    const value = record.fingerprint_algorithm;
    if (value !== TREE_FINGERPRINT_ALGORITHM) throw new ValueError(versionBoundaryMessage('fingerprint_algorithm', value));
    return TREE_FINGERPRINT_ALGORITHM;
  }

  function safeInventoryRelative(relative, label) {
    if (!isStr(relative) || !relative || relative.includes('\x00') || relative.includes('\\')) throw new ValueError(`${label} is not a valid relative path`);
    const normalized = normpath(relative);
    if (path.isAbsolute(relative) || (relative.length > 1 && relative[1] === ':') || normalized !== relative || normalized === '.' || normalized === '..' || normalized.startsWith('../')) {
      throw new ValueError(`${label} escapes the plugin root: ${relative}`);
    }
    return normalized;
  }


  // ---------------------------------------------------------------------
  // Inventory, profiles, and selection

  function inventoryPath() {
    return path.join(PLUGIN_ROOT, 'manifests', 'distribution-inventory.json');
  }

  // json.load(): a parse failure surfaces as ValueError text.
  function loadJsonFile(file) {
    return pyJsonLoads(fs.readFileSync(file, 'utf8'));
  }

  // Current public skill names with stable identity metadata; a missing or
  // malformed inventory is an empty map, validated before materialization.
  function inventorySkillMetadata() {
    const file = inventoryPath();
    if (!isFileFollow(file)) return {};
    let inventory;
    try {
      inventory = loadJsonFile(file);
    } catch (error) {
      rethrowExit(error);
      return {};
    }
    const result = {};
    const skills = isDict(inventory) ? inventory.skills : null;
    for (const skill of Array.isArray(skills) ? skills : []) {
      if (!isDict(skill)) continue;
      const name = skill.name;
      if (!isStr(name) || !name) continue;
      const strings = (values) => (Array.isArray(values) ? values : []).filter((value) => isStr(value));
      result[name] = {
        id: skill.id === undefined ? null : skill.id,
        name,
        path: skill.path === undefined ? null : skill.path,
        legacy_names: (Array.isArray(skill.legacy_names) ? skill.legacy_names : []).filter((legacy) => isStr(legacy) && legacy),
        lifecycle: skill.lifecycle === undefined ? null : skill.lifecycle,
        tier: skill.tier === undefined ? null : skill.tier,
        invokable: skill.invokable === undefined ? null : skill.invokable,
        profiles: strings(skill.profiles),
        surfaces: strings(skill.surfaces),
      };
    }
    return result;
  }

  function readInventoryDocument() {
    const file = inventoryPath();
    if (!isFileFollow(file)) return null;
    let inventory;
    try {
      inventory = loadJsonFile(file);
    } catch (error) {
      rethrowExit(error);
      throw new ValueError(`cannot read distribution inventory for capability selection: ${errorText(error)}`);
    }
    if (!isDict(inventory)) throw new ValueError('distribution inventory must be an object for capability selection');
    return inventory;
  }

  function readInstallProfiles() {
    const file = path.join(PLUGIN_ROOT, 'manifests', 'install-profiles.json');
    if (!isFileFollow(file)) return [null, null];
    let document;
    try {
      document = loadJsonFile(file);
    } catch (error) {
      rethrowExit(error);
      throw new ValueError(`cannot read install profiles for capability selection: ${errorText(error)}`);
    }
    const table = isDict(document) ? document.profiles : null;
    if (!isDict(table)) throw new ValueError('install profiles must declare a profiles object');
    return [document, table];
  }

  // Block writes when a receipt belongs to a retired or unknown collection.
  function receiptProfileUpdateBlock(receipt) {
    if (!isDict(receipt) || Object.keys(receipt).length === 0 || PLAN || UNINSTALL) return null;
    const profileId = receipt.profileId;
    if (!isStr(profileId) || !profileId) return null;
    if (profileId === 'common') return null;
    const [profilesDocument] = readInstallProfiles();
    const historical = isDict(profilesDocument) ? profilesDocument.legacy_profiles : null;
    const retiredProfile = isDict(historical) && Object.prototype.hasOwnProperty.call(historical, profileId);
    if (retiredProfile && isRetiredOrphanOnlyReceipt(receipt)) return null;
    return {
      schema_version: SCHEMA_VERSION,
      state: 'blocked',
      reasonCode: retiredProfile ? 'LEGACY_PROFILE_UPDATE_UNSUPPORTED' : 'UNSUPPORTED_RECEIPT_PROFILE',
      receipt_state: retiredProfile ? 'legacy_profile' : 'unsupported_profile',
      receipt_profile_id: profileId,
      next_action: 'run this installer with --uninstall, then perform a fresh install without --profile',
    };
  }

  // The `--json` report of a run. A Cursor plan also carries the marketplace
  // hash-cache drift warnings the Python shell entry used to add afterwards.
  function printJsonReport(report) {
    const printed = HARNESS_KIND === 'cursor' && PLAN && JSON_OUTPUT ? addCursorCacheDriftWarnings(report, env) : report;
    print(pyJsonDumps(printed, { indent: 2, sortKeys: true }));
  }

  function printReceiptProfileUpdateBlock(blocked) {
    if (JSON_OUTPUT) printJsonReport(blocked);
    else {
      print('[install-codex-skills] BLOCKED: this receipt belongs to a retired or unsupported collection');
      print(`[install-codex-skills] ACTION REQUIRED: ${blocked.next_action}`);
    }
  }

  function selectionDigest(value) {
    return sha256(Buffer.from(pyJsonDumps(value, { ensureAscii: false, sortKeys: true, separators: [',', ':'] }), 'utf8'));
  }

  // Expose a historical receipt's own selection while reading it for uninstall.
  function assignReceiptSelection(receipt) {
    if (!isDict(receipt)) return false;
    const profileId = receipt.profileId;
    if (!isStr(profileId) || !profileId) return false;
    const stringList = (key) => {
      const values = receipt[key];
      return Array.isArray(values) && values.every((value) => isStr(value) && value) ? values.slice() : null;
    };
    SELECTION_PROFILE_ID = profileId;
    SELECTION_COMPATIBILITY = isStr(receipt.compatibilityMode) ? receipt.compatibilityMode : null;
    SELECTION_POLICY_VERSION = isStr(receipt.selectionPolicyVersion) ? receipt.selectionPolicyVersion : null;
    SELECTION_CANONICAL_IDS = stringList('selectedStableIds');
    SELECTION_EMITTED_IDS = stringList('emittedStableIds');
    SELECTION_RUNTIME_IDS = stringList('runtimeSupportStableIds');
    SELECTION_FINGERPRINT = isStr(receipt.selectionFingerprint) ? receipt.selectionFingerprint : null;
    SELECTION_SURFACE_FINGERPRINT = isStr(receipt.surfaceSelectionFingerprint) ? receipt.surfaceSelectionFingerprint : null;
    return true;
  }

  // Resolve the common collection and additive overlays before mutation.
  function resolveInstallerSelection(receipt, metadata) {
    if (UNINSTALL && isDict(receipt) && receipt.profileId !== 'common') {
      // Uninstall acts only on receipt-owned destinations.
      assignReceiptSelection(receipt);
      return;
    }
    const inventory = readInventoryDocument();
    const [profilesDocument, profiles] = readInstallProfiles();
    if (inventory === null || profiles === null) {
      if (REQUESTED_SKILL_IDS.length) throw new ValueError('skill selection requires distribution inventory and install profiles');
      return;
    }
    const policy = isDict(inventory.profile_policy) ? inventory.profile_policy : {};
    if (Object.keys(policy).length === 0 && REQUESTED_SKILL_IDS.length === 0) return;
    const policyVersion = policy.version || profilesDocument.selectionPolicyVersion || 'dhpk.capability-bundle-selection.v1';
    const byId = {};
    for (const value of Object.values(metadata)) {
      if (isDict(value) && isStr(value.id) && value.id) byId[value.id] = value;
    }
    const retired = {};
    for (const row of Array.isArray(inventory.retired_skills) ? inventory.retired_skills : []) {
      if (isDict(row) && isStr(row.id)) retired[row.id] = row;
    }
    const has = (table, key) => Object.prototype.hasOwnProperty.call(table, key);
    const profileId = 'common';
    const profilePolicy = isDict(policy.profiles) ? policy.profiles : {};
    if (!isDict(profilePolicy[profileId])) throw new ValueError('distribution inventory must declare the common profile policy');
    const profile = profiles[profileId];
    if (!isDict(profile)) throw new ValueError('install profiles must declare the common collection');
    const declared = profile.skillIds;
    if (!Array.isArray(declared) || declared.length === 0) throw new ValueError('the common collection must declare skillIds');
    const selected = declared.slice();
    const required = policy.required_core_ids;
    if (!Array.isArray(required) || required.length === 0 || required.some((stableId) => !selected.includes(stableId))) {
      throw new ValueError('the common collection must retain every required core stable ID');
    }
    if (new Set(selected).size !== selected.length) throw new ValueError('the common collection declares duplicate stable IDs');
    const overlays = REQUESTED_SKILL_IDS.slice();
    if (new Set(overlays).size !== overlays.length) throw new ValueError('skill overlay contains duplicate stable IDs');
    const surfaceName = HARNESS_KIND === 'cursor' ? 'cursor-sync' : 'codex-native';
    const allowed = new Set(Object.keys(byId).filter((key) => (byId[key].surfaces || []).includes(surfaceName)));
    const runtimeMapping = inventory.internal_runtime_skills;
    if (!isDict(runtimeMapping)) throw new ValueError('internal_runtime_skills must be an object for runtime support selection');
    const runtimeIds = Array.isArray(runtimeMapping[surfaceName]) ? runtimeMapping[surfaceName].slice() : [];
    if (HARNESS_KIND === 'codex' && !has(runtimeMapping, surfaceName)) throw new ValueError(`internal_runtime_skills must declare '${surfaceName}' runtime support`);
    if (new Set(runtimeIds).size !== runtimeIds.length) throw new ValueError(`internal_runtime_skills.${surfaceName} declares duplicate stable IDs`);
    for (const stableId of runtimeIds) {
      if (!isStr(stableId) || !stableId) throw new ValueError(`internal_runtime_skills.${surfaceName} contains an invalid stable ID`);
      if (has(retired, stableId) || !has(byId, stableId) || byId[stableId].lifecycle === 'deprecated') throw new ValueError(`internal runtime stable ID '${stableId}' is unavailable`);
      if (!allowed.has(stableId)) throw new ValueError(`internal runtime stable ID '${stableId}' is not available on surface '${surfaceName}'`);
    }
    for (const stableId of selected) {
      if (has(retired, stableId)) throw new ValueError(`stable ID '${stableId}' is retired`);
      if (!has(byId, stableId)) throw new ValueError(`unknown stable ID '${stableId}'`);
      if (byId[stableId].lifecycle === 'deprecated') throw new ValueError(`stable ID '${stableId}' is deprecated`);
      if (byId[stableId].invokable === false) throw new ValueError(`stable ID '${stableId}' is internal runtime support and cannot be selected`);
    }
    for (const stableId of overlays) {
      if (has(retired, stableId)) throw new ValueError(`stable ID '${stableId}' is retired`);
      if (!has(byId, stableId)) throw new ValueError(`unknown stable ID '${stableId}'`);
      if (byId[stableId].lifecycle === 'deprecated') throw new ValueError(`stable ID '${stableId}' is deprecated`);
      if (byId[stableId].invokable === false) throw new ValueError(`stable ID '${stableId}' is internal runtime support and cannot be selected`);
      if (!allowed.has(stableId)) throw new ValueError(`stable ID '${stableId}' is not available on surface '${surfaceName}'`);
      const excludes = new Set(Object.keys(isDict(profile.excludes) ? profile.excludes : {}));
      if (excludes.has(stableId) || (byId[stableId].profiles || []).some((value) => excludes.has(value))) {
        throw new ValueError(`stable ID '${stableId}' is excluded by the common collection`);
      }
      selected.push(stableId);
    }
    const canonical = [];
    for (const stableId of selected) if (!canonical.includes(stableId)) canonical.push(stableId);
    const emitted = canonical.filter((stableId) => allowed.has(stableId));
    const identity = {
      schema: policyVersion,
      profileId,
      selectedStableIds: canonical,
      compatibilityMode: has(profile, 'compatibilityMode') ? profile.compatibilityMode : 'profile',
      selectionPolicyVersion: policyVersion,
      sourceFingerprint: selectionDigest({ profileId, skillIds: overlays }),
      profileFingerprint: selectionDigest(profile),
      inventoryFingerprint: selectionDigest({
        skills: Object.values(metadata),
        retired_skills: inventory.retired_skills || [],
      }),
    };
    const selectionFingerprint = selectionDigest(identity);
    const surfaceFingerprint = selectionDigest({
      selectionFingerprint,
      surface: surfaceName,
      emittedStableIds: emitted,
      runtimeSupportStableIds: runtimeIds,
      transform: { id: 'identity', version: '1' },
    });
    SELECTION_PROFILE_ID = profileId;
    SELECTION_COMPATIBILITY = identity.compatibilityMode;
    SELECTION_POLICY_VERSION = policyVersion;
    SELECTION_CANONICAL_IDS = canonical;
    SELECTION_EMITTED_IDS = emitted;
    SELECTION_RUNTIME_IDS = runtimeIds;
    SELECTION_FINGERPRINT = selectionFingerprint;
    SELECTION_SURFACE_FINGERPRINT = surfaceFingerprint;
  }

  function skipNativeSkillKind(kind) {
    return sharedProjectionRelocatable() && kind === 'skills';
  }

  function nativeRuntimeSkillIds() {
    return new Set(SELECTION_RUNTIME_IDS || []);
  }

  function sharedProjectionHost() {
    return HOST ? HOST.sharedProjectionHost : null;
  }

  function declaredProjectionHostKey() {
    return HOST ? HOST.declaredProjectionHostKey : null;
  }

  function consumerEvidenceEnvKey() {
    return HOST ? HOST.consumerEvidenceEnvKey : null;
  }

  function readProfileProjectionSets() {
    const file = path.join(PLUGIN_ROOT, 'manifests', 'profile-projection-sets.json');
    if (!isFileFollow(file)) return null;
    let document;
    try {
      document = loadJsonFile(file);
    } catch (error) {
      rethrowExit(error);
      throw new ValueError(`cannot read profile projection sets: ${errorText(error)}`);
    }
    if (!isDict(document)) throw new ValueError('profile-projection-sets.json must be an object');
    return document;
  }

  function sharedProjectionAvailable() {
    if (!sharedProjectionHost()) return false;
    if (readProfileProjectionSets() === null) return false;
    return isDirFollow(path.join(PLUGIN_ROOT, 'skills'));
  }

  function relocatableProjectOverlapsSource() {
    return isWithin(PROJECT_ROOT, PLUGIN_ROOT) || isWithin(PLUGIN_ROOT, PROJECT_ROOT);
  }

  function sharedProjectionRelocatable() {
    return sharedProjectionAvailable() && !relocatableProjectOverlapsSource();
  }

  function noteSharedProjectionSkip(action) {
    print(`[install-codex-skills] note: Shared Project Projection ${action} skipped: project root overlaps the canonical source checkout`);
  }

  function declaredSkillIds() {
    const hostKey = declaredProjectionHostKey();
    if (!hostKey) throw new ValueError('declared projection selection requires a cursor or codex-sync Host');
    const document = readProfileProjectionSets();
    if (document === null) throw new ValueError('native-link install requires manifests/profile-projection-sets.json');
    const profiles = document.profiles;
    if (!isDict(profiles)) throw new ValueError('profile-projection-sets.json must declare profiles');
    const profileId = SELECTION_PROFILE_ID || 'common';
    const hostSets = profiles[profileId];
    if (!isDict(hostSets)) throw new ValueError(`profile '${profileId}' is not declared in profile-projection-sets.json`);
    const declared = hostSets[hostKey];
    if (!Array.isArray(declared) || declared.length === 0 || declared.some((item) => !isStr(item) || !item)) {
      throw new ValueError(`profile '${profileId}' has no declared ${hostKey} projection set`);
    }
    if (new Set(declared).size !== declared.length) throw new ValueError(`profile '${profileId}' declares duplicate ${hostKey} projection ids`);
    const selected = declared.slice();
    for (const stableId of REQUESTED_SKILL_IDS) if (!selected.includes(stableId)) selected.push(stableId);
    return selected;
  }

  function applyDeclaredProjectionSelection() {
    const selected = declaredSkillIds();
    if (SELECTION_PROFILE_ID === null) SELECTION_PROFILE_ID = 'common';
    if (SELECTION_CANONICAL_IDS === null) SELECTION_CANONICAL_IDS = selected.slice();
    SELECTION_EMITTED_IDS = selected.slice();
    return selected;
  }


  // ---------------------------------------------------------------------
  // Receipt shape helpers

  // Read the receipt through a checked destination root and a no-follow leaf.
  function readManifestDocument() {
    const root = openRelativeDirectory('', { create: false });
    const target = path.join(root, path.basename(MANIFEST));
    const descriptor = fs.openSync(target, fs.constants.O_RDONLY | O_NONBLOCK | O_NOFOLLOW);
    try {
      if (!fs.fstatSync(descriptor).isFile()) throw new ValueError(`project ${DEST_REL} receipt is not a regular file`);
      return pyJsonLoads(fs.readFileSync(descriptor, 'utf8'));
    } finally {
      fs.closeSync(descriptor);
    }
  }

  function receiptDestination(kind, name, old) {
    const expected = kind === 'supporting_assets' ? name : `${kind}/${name}`;
    if (!isDict(old)) throw new ValueError(`receipt entry ${kind}/${name} is malformed`);
    const relative = old.destination || old.source;
    if (relative !== expected || ![undefined, null, expected].includes(old.source)) throw new ValueError(`receipt entry ${kind}/${name} has an unexpected destination`);
    return safeDestination(expected);
  }

  // Prove absence without following links or suppressing filesystem errors.
  function receiptPathMissing(relative) {
    safeDestination(relative);
    const index = relative.lastIndexOf('/');
    const parentRelative = index < 0 ? '' : relative.slice(0, index);
    const name = relative.slice(index + 1);
    let parent;
    try {
      parent = openRelativeDirectory(parentRelative);
    } catch (error) {
      if (errnoIs(error, 'ENOENT')) return true;
      throw error;
    }
    return !fdEntryExists(parent, name);
  }

  function receiptRecordMatchesRelative(record, relative) {
    if (!isDict(record)) return false;
    const { source, destination } = record;
    return [undefined, null, relative].includes(source) && [undefined, null, relative].includes(destination) && (source === relative || destination === relative);
  }

  // A receipt projection containing only safely recorded orphans.
  function isOrphanOnlyProjection(entries, orphaned) {
    if (!isDict(entries) || !isDict(orphaned) || Object.keys(orphaned).length === 0) return false;
    if (MANAGED_KINDS.some((kind) => !isDict(entries[kind]))) return false;
    if (Object.entries(entries).some(([kind, values]) => !MANAGED_KINDS.includes(kind) && pyTruthy(values))) return false;
    for (const [relative, record] of Object.entries(orphaned)) {
      if (!isStr(relative) || !receiptRecordMatchesRelative(record, relative)) return false;
      try {
        safeDestination(relative);
        receiptPathMissing(relative);
      } catch (error) {
        if (isOSOrValueError(error)) return false;
        throw error;
      }
    }
    for (const kind of MANAGED_KINDS) {
      for (const [name, entry] of Object.entries(entries[kind])) {
        if (!isStr(name) || !name || !isDict(entry) || entry.orphaned !== true) return false;
        const relative = kind === 'supporting_assets' ? name : `${kind}/${name}`;
        if (!receiptRecordMatchesRelative(entry, relative)) return false;
        try {
          receiptDestination(kind, name, entry);
        } catch (error) {
          if (isOSOrValueError(error)) return false;
          throw error;
        }
        if (!Object.prototype.hasOwnProperty.call(orphaned, relative)) return false;
      }
    }
    return true;
  }

  // Only complete partial receipts for known retired profiles.
  function isRetiredOrphanOnlyReceipt(receipt) {
    if (!isDict(receipt) || receipt.schema_version !== SCHEMA_VERSION || receipt.state !== 'partial' || !['copy', 'symlink'].includes(receipt.mode)) return false;
    const profileId = receipt.profileId;
    if (!isStr(profileId) || !profileId) return false;
    if (Object.prototype.hasOwnProperty.call(receipt, 'legacy_pending') && receipt.legacy_pending !== false) return false;
    if (Object.prototype.hasOwnProperty.call(receipt, 'transaction_id') || Object.prototype.hasOwnProperty.call(receipt, 'transaction_final')) {
      const transactionId = receipt.transaction_id;
      if (!isStr(transactionId) || !transactionId.trim() || receipt.transaction_final !== true) return false;
    }
    if (!receiptHasRetiredProfile(receipt)) return false;
    return isOrphanOnlyProjection(receipt.managed_entries, receipt.orphaned_entries);
  }

  function receiptHasRetiredProfile(receipt) {
    if (!isDict(receipt)) return false;
    const profileId = receipt.profileId;
    if (!isStr(profileId) || !profileId) return false;
    let profilesDocument;
    try {
      [profilesDocument] = readInstallProfiles();
    } catch (error) {
      if (isValueError(error)) return false;
      throw error;
    }
    const historical = isDict(profilesDocument) ? profilesDocument.legacy_profiles : null;
    return isDict(historical) && Object.prototype.hasOwnProperty.call(historical, profileId);
  }

  // ---------------------------------------------------------------------
  // Sources and fingerprints

  function inventorySupportingSources() {
    const file = inventoryPath();
    let assets = null;
    if (isFileFollow(file)) {
      try {
        const document = loadJsonFile(file);
        assets = isDict(document) ? document.supporting_assets : undefined;
        if (!isDict(document)) throw new ValueError(`'${Array.isArray(document) ? 'list' : typeof document}' object has no attribute 'get'`);
      } catch (error) {
        rethrowExit(error);
        throw new ValueError(`cannot read distribution inventory: ${errorText(error)}`);
      }
    }
    if (!Array.isArray(assets) || assets.length === 0) {
      const fallback = path.join(CODEX_SRC, 'config.toml.example');
      return isFileFollow(fallback) ? { 'config.toml.example': [fallback, 'config.toml.example'] } : {};
    }
    const result = {};
    for (const asset of assets) {
      if (!isDict(asset)) throw new ValueError('distribution inventory supporting asset is malformed');
      const sourceRel = safeInventoryRelative(asset.source, 'supporting asset source');
      const destination = safeInventoryRelative(asset.destination, 'supporting asset destination');
      if (Object.prototype.hasOwnProperty.call(result, destination)) throw new ValueError(`duplicate supporting asset destination: ${destination}`);
      if (HARNESS_KIND === 'cursor' && destination !== 'dhpk' && !destination.startsWith('dhpk/')) continue;
      let source = path.join(PLUGIN_ROOT, ...sourceRel.split('/'));
      if (HARNESS_KIND === 'cursor') {
        const projected = path.join(PLUGIN_ROOT, SRC_REL, ...destination.split('/'));
        if (isFileFollow(projected) && isWithin(projected, PLUGIN_ROOT)) source = projected;
      }
      if (!isWithin(source, PLUGIN_ROOT) || !lexists(source)) throw new ValueError(`supporting asset source is missing or escapes the plugin root: ${sourceRel}`);
      result[destination] = [source, destination];
    }
    return result;
  }

  function stableIdOf(metadata, name) {
    const record = Object.prototype.hasOwnProperty.call(metadata, name) ? metadata[name] : undefined;
    return isDict(record) ? (record.id === undefined ? null : record.id) : null;
  }

  function sourceFingerprint() {
    const digest = crypto.createHash('sha256');
    const update = (text) => digest.update(Buffer.from(text, 'utf8'));
    const metadata = inventorySkillMetadata();
    const available = new Set([...(SELECTION_EMITTED_IDS || []), ...(SELECTION_RUNTIME_IDS || [])]);
    const runtimeIds = nativeRuntimeSkillIds();
    for (const rootName of SOURCE_KINDS) {
      if (skipNativeSkillKind(rootName) && runtimeIds.size === 0) continue;
      const root = path.join(CODEX_SRC, rootName);
      if (!isDirFollow(root)) continue;
      for (const name of pySorted(fs.readdirSync(root))) {
        if (isBytecodeName(name)) continue;
        if (rootName === 'skills' && skipNativeSkillKind(rootName)) {
          if (!runtimeIds.has(stableIdOf(metadata, name))) continue;
        } else if (rootName === 'skills' && SELECTION_EMITTED_IDS !== null) {
          if (!available.has(stableIdOf(metadata, name))) continue;
        }
        const child = path.join(root, name);
        if (unmetSkillDependencyIds(rootName, child, metadata).length) continue;
        validateSourceTree(child, `${rootName} source`, [PLUGIN_ROOT, INSTALLER_ROOT]);
        update(`${rootName}/${name}`);
        update('\0');
        update(fingerprintSource(child));
        update('\0');
      }
    }
    const supporting = inventorySupportingSources();
    for (const relative of pySorted(Object.keys(supporting))) {
      const [source, destination] = supporting[relative];
      validateSourceTree(source, 'supporting asset source');
      update(destination);
      update('\0');
      update(fingerprintSource(source));
      update('\0');
    }
    if (sharedProjectionRelocatable()) {
      const byId = {};
      for (const value of Object.values(metadata)) if (isDict(value) && isStr(value.id) && value.id) byId[value.id] = value;
      for (const stableId of pySorted(SELECTION_EMITTED_IDS || [])) {
        const record = byId[stableId];
        if (!isDict(record)) continue;
        let skillPath = record.path;
        if (!isStr(skillPath) || !skillPath) {
          const name = record.name;
          if (!isStr(name) || !name) continue;
          skillPath = `skills/${name}`;
        }
        const source = path.join(PLUGIN_ROOT, ...skillPath.split('/'));
        if (!isWithin(source, PLUGIN_ROOT) || !lexists(source)) continue;
        update(`shared-skill:${stableId}`);
        update('\0');
        update(fingerprintSource(source));
        update('\0');
      }
    }
    return digest.digest('hex');
  }

  function readPluginVersion() {
    try {
      const document = loadJsonFile(path.join(PLUGIN_ROOT, '.claude-plugin', 'plugin.json'));
      if (!isDict(document)) return 'unknown';
      return Object.prototype.hasOwnProperty.call(document, 'version') ? document.version : 'unknown';
    } catch (error) {
      rethrowExit(error);
      return 'unknown';
    }
  }

  // Inventory-owned retirement rows keyed by every stable identity. Evidence
  // only: they annotate reconciliation reports, never materializable sources.
  function inventoryRetirementMetadata(activeMetadata = null) {
    const file = inventoryPath();
    if (!isFileFollow(file)) return {};
    let inventory;
    try {
      inventory = loadJsonFile(file);
    } catch (error) {
      rethrowExit(error);
      throw new ValueError(`cannot read distribution inventory for retirement metadata: ${errorText(error)}`);
    }
    if (!isDict(inventory) || !Object.prototype.hasOwnProperty.call(inventory, 'retired_skills')) return {};
    const rows = inventory.retired_skills;
    if (!Array.isArray(rows)) throw new ValueError('distribution inventory retired_skills must be an array');
    const active = isDict(activeMetadata) ? activeMetadata : {};
    const activeIds = new Set(Object.values(active).filter((record) => isDict(record) && isStr(record.id)).map((record) => record.id));
    const activeNames = new Set(Object.values(active).filter((record) => isDict(record) && isStr(record.name)).map((record) => record.name));
    const rawAgentRoster = inventory.agent_roster;
    const identifier = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
    if (rawAgentRoster !== undefined && rawAgentRoster !== null && (
      !Array.isArray(rawAgentRoster)
      || rawAgentRoster.some((agentId) => !isStr(agentId) || !identifier.test(agentId))
      || new Set(rawAgentRoster).size !== rawAgentRoster.length)) {
      throw new ValueError('distribution inventory agent_roster is malformed');
    }
    const agentRoster = new Set(rawAgentRoster || []);
    const rowFields = ['id', 'name', 'canonicalPath', 'priorSurfaces', 'retiredIn', 'reasonCode', 'replacements', 'rollback'];
    const publicName = /^(?:dhpk-)?[a-z0-9]+(?:-[a-z0-9]+)*$/;
    const semver = /^\d+\.\d+\.\d+$/;
    const reasonCode = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
    const allowedSurfaces = new Set(['claude-core', 'claude-module', 'codex-sync', 'codex-native', 'agent-plugin', 'cursor-plugin', 'cursor-sync', 'agy-plugin']);
    const seenIds = new Set();
    const seenNames = new Set();
    const declaredRetiredIds = new Set(rows.filter((row) => isDict(row) && isStr(row.id)).map((row) => row.id));
    const result = {};
    const retiredById = {};
    rows.forEach((row, index) => {
      const prefix = `retired_skills[${index}]`;
      if (!isDict(row)) throw new ValueError(`${prefix} must be an object`);
      const unknown = pySorted(Object.keys(row).filter((key) => !rowFields.includes(key)));
      if (unknown.length) throw new ValueError(`${prefix} contains unknown fields: ${unknown.join(', ')}`);
      const missing = pySorted(rowFields.filter((key) => !Object.prototype.hasOwnProperty.call(row, key)));
      if (missing.length) throw new ValueError(`${prefix} is missing required fields: ${missing.join(', ')}`);
      const stableId = row.id;
      const name = row.name;
      const canonical = row.canonicalPath;
      if (!isStr(stableId) || !identifier.test(stableId)) throw new ValueError(`${prefix}.id is not a safe identifier`);
      if (seenIds.has(stableId) || activeIds.has(stableId)) throw new ValueError(`${prefix}.id overlaps an existing identity: ${stableId}`);
      seenIds.add(stableId);
      if (!isStr(name) || Array.from(name).length > 63 || !publicName.test(name)) throw new ValueError(`${prefix}.name is not a valid public skill name`);
      if (seenNames.has(name) || activeNames.has(name)) throw new ValueError(`${prefix}.name overlaps an existing identity: ${name}`);
      seenNames.add(name);
      if (canonical !== `skills/${name}`) throw new ValueError(`${prefix}.canonicalPath must match skills/${name}`);
      const surfaces = row.priorSurfaces;
      if (!Array.isArray(surfaces) || surfaces.length === 0 || surfaces.some((surface) => !isStr(surface) || !allowedSurfaces.has(surface)) || new Set(surfaces).size !== surfaces.length) {
        throw new ValueError(`${prefix}.priorSurfaces contains an unsupported or duplicate surface`);
      }
      const retiredIn = row.retiredIn;
      if (!isStr(retiredIn) || !semver.test(retiredIn)) throw new ValueError(`${prefix}.retiredIn is malformed`);
      const reason = row.reasonCode;
      if (!isStr(reason) || !reasonCode.test(reason)) throw new ValueError(`${prefix}.reasonCode is malformed`);
      const rawReplacements = row.replacements;
      if (!Array.isArray(rawReplacements) || rawReplacements.length === 0) throw new ValueError(`${prefix}.replacements must be a non-empty array`);
      const replacements = [];
      rawReplacements.forEach((replacement, replacementIndex) => {
        const replacementPrefix = `${prefix}.replacements[${replacementIndex}]`;
        if (!isDict(replacement)) throw new ValueError(`${replacementPrefix} must be an object`);
        const kind = replacement.kind;
        if (!['skill', 'agent', 'model-default', 'external-skill', 'operator-action'].includes(kind)) throw new ValueError(`${replacementPrefix}.kind is unsupported`);
        const allowedFields = kind === 'model-default' ? ['kind'] : ['kind', 'id', 'mode'];
        const unknownFields = pySorted(Object.keys(replacement).filter((key) => !allowedFields.includes(key)));
        if (unknownFields.length) throw new ValueError(`${replacementPrefix} contains unknown fields: ${unknownFields.join(', ')}`);
        if (kind === 'model-default') {
          if (Object.keys(replacement).length !== 1) throw new ValueError(`${replacementPrefix} model-default must not contain id or mode`);
          replacements.push({ kind });
          return;
        }
        const replacementId = replacement.id;
        if (!isStr(replacementId) || !identifier.test(replacementId)) throw new ValueError(`${replacementPrefix}.id is not a safe identifier`);
        if (kind === 'skill' && !activeIds.has(replacementId) && !declaredRetiredIds.has(replacementId)) throw new ValueError(`${replacementPrefix}.id is not an active or retired skill: ${replacementId}`);
        if (kind === 'agent' && !agentRoster.has(replacementId)) throw new ValueError(`${replacementPrefix}.id is not an inventory-owned active agent: ${replacementId}`);
        const normalized = { kind, id: replacementId };
        if (Object.prototype.hasOwnProperty.call(replacement, 'mode')) {
          const mode = replacement.mode;
          if (!isStr(mode) || !identifier.test(mode)) throw new ValueError(`${replacementPrefix}.mode is not a safe identifier`);
          normalized.mode = mode;
        }
        replacements.push(normalized);
      });
      const rollback = row.rollback;
      if (!isDict(rollback) || Object.keys(rollback).length !== 1 || !Object.prototype.hasOwnProperty.call(rollback, 'release') || !isStr(rollback.release) || !semver.test(rollback.release)) {
        throw new ValueError(`${prefix}.rollback is malformed`);
      }
      const identity = { id: stableId, name, canonicalPath: canonical };
      const evidence = {
        id: stableId,
        name,
        canonicalPath: canonical,
        canonical_identity: { ...identity },
        retiredIn,
        reasonCode: reason,
        replacements,
        rollback: { release: rollback.release },
      };
      retiredById[stableId] = evidence;
      for (const key of [stableId, name, canonical, canonical.split('/').pop()]) result[key] = evidence;
    });
    const maxDepth = 64;
    const validateSuccessorChain = (row, ancestors, depth, expanded) => {
      for (const replacement of row.replacements) {
        if (replacement.kind !== 'skill' || activeIds.has(replacement.id)) continue;
        const successorId = replacement.id;
        const successor = retiredById[successorId];
        if (successor === undefined) throw new ValueError(`dangling retirement successor: ${successorId}`);
        if (ancestors.has(successorId)) throw new ValueError(`retirement successor cycle at ${successorId}`);
        if (depth >= maxDepth) throw new ValueError(`retirement successor depth exceeds limit ${maxDepth} at ${successorId}`);
        const key = `${successorId}\0${depth}`;
        if (expanded.has(key)) continue;
        validateSuccessorChain(successor, new Set([...ancestors, successorId]), depth + 1, expanded);
        expanded.add(key);
      }
    };
    for (const [stableId, row] of Object.entries(retiredById)) validateSuccessorChain(row, new Set([stableId]), 0, new Set());
    return result;
  }

  // Resolve a receipt entry to its ledger row without trusting its name.
  function retirementForEntry(retirements, kind, name, old, relative) {
    if (kind !== 'skills' || !isDict(retirements)) return null;
    const candidates = [name, relative];
    if (isDict(old)) candidates.push(old.id, old.name, old.source, old.destination);
    for (const candidate of candidates) {
      if (isStr(candidate) && Object.prototype.hasOwnProperty.call(retirements, candidate)) return retirements[candidate];
    }
    return null;
  }

  // Each ledger row once, in deterministic path order.
  function uniqueRetirementRows(retirements) {
    const seen = new Set();
    const rows = [];
    for (const row of Object.values(retirements || {})) {
      if (!isDict(row)) continue;
      const key = row.canonicalPath || row.id || row.name;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(row);
    }
    return rows.map((row, index) => [String(row.canonicalPath || row.name || ''), index, row])
      .sort((left, right) => compat.pyStringCompare(left[0], right[0]) || left[1] - right[1])
      .map(([, , row]) => row);
  }

  // Fail closed when skill sources lack schema-v3 identity fields.
  function validateSkillMetadata(sources, metadata) {
    const skillNames = pySorted(Object.keys(sources.skills || {}));
    if (skillNames.length === 0) return;
    const incomplete = skillNames.filter((name) => {
      const record = isDict(metadata) ? metadata[name] : null;
      return !isDict(record) || !isStr(record.id) || !record.id.trim() || record.name !== name;
    });
    if (incomplete.length) {
      throw new ValueError(`distribution inventory skill metadata is missing or incomplete for ${SURFACE_LABEL} skill sources: ${incomplete.join(', ')} (schema-v3 receipts require id and name)`);
    }
  }

  // Returns [receipt, malformed]. With allowUnmarked (uninstall only), a
  // readable receipt without the tree-merkle-v1 marker is returned as-is.
  function readReceipt(allowUnmarked = false) {
    ensureManifestSafe();
    if (!lexists(MANIFEST)) return [{}, false];
    let receipt;
    try {
      receipt = readManifestDocument();
    } catch (error) {
      rethrowExit(error);
      return [{}, true];
    }
    try {
      recordFingerprintAlgorithm(receipt);
    } catch (error) {
      if (!isValueError(error) || !(allowUnmarked && isDict(receipt))) throw error;
      return [receipt, false];
    }
    return [receipt, !isDict(receipt.managed_entries)];
  }

  function receiptHasTreeMarker(receipt) {
    return !(isDict(receipt) && Object.keys(receipt).length > 0 && receipt.fingerprint_algorithm !== TREE_FINGERPRINT_ALGORITHM);
  }

  function entryMap(receipt) {
    const managedRaw = isDict(receipt) ? receipt.managed_entries : null;
    const managed = isDict(managedRaw) ? managedRaw : {};
    const result = {};
    for (const kind of SOURCE_KINDS) result[kind] = { ...(isDict(managed[kind]) ? managed[kind] : {}) };
    result.supporting_assets = { ...(isDict(managed.supporting_assets) ? managed.supporting_assets : {}) };
    return result;
  }

  // Classify receipt/projection state before any destination mutation.
  function classifyReceipt(receipt, malformed, sources, metadata, pluginVersion, fingerprint) {
    if (!malformed && (!pyTruthy(receipt) || isRetiredOrphanOnlyReceipt(receipt))) {
      return { state: 'new', requires_migration: false, requires_structural_migration: false, reasons: [], legacy_names: [], retired_names: [] };
    }
    const reasons = [];
    const legacyNames = [];
    const retiredNames = [];
    let requiresMigration = Boolean(malformed);
    if (malformed) reasons.push('receipt is missing valid managed_entries or contains invalid JSON');
    const schema = isDict(receipt) ? receipt.schema_version : undefined;
    if (schema !== SCHEMA_VERSION) {
      requiresMigration = true;
      reasons.push(`receipt schema ${schema !== undefined && schema !== null ? pyStr(schema) : '<missing>'} requires schema-${SCHEMA_VERSION} migration`);
    }
    const legacyToPublic = {};
    for (const [publicName, skill] of Object.entries(metadata || {})) {
      for (const legacyName of skill.legacy_names || []) legacyToPublic[legacyName] = publicName;
    }
    const managed = entryMap(receipt);
    const canonicalNames = new Set(Object.keys(sources.skills || {}));
    for (const [key, entry] of Object.entries(managed.skills)) {
      const relative = isDict(entry) ? (entry.source || entry.destination) : '';
      const basename = isStr(relative) ? relative.split('/').pop() : '';
      if (canonicalNames.has(key) && ['', key].includes(basename)) continue;
      const has = (name) => Object.prototype.hasOwnProperty.call(legacyToPublic, name);
      if (has(key) || has(basename)) {
        legacyNames.push(key);
        requiresMigration = true;
        reasons.push(`legacy ${SURFACE_LABEL} skill name ${key} shadows canonical ${legacyToPublic[key] || legacyToPublic[basename]}`);
      } else {
        retiredNames.push(key);
      }
    }
    if (isDict(receipt) && pyTruthy(receipt.legacy_pending)) {
      requiresMigration = true;
      reasons.push('receipt has a pending legacy migration');
    }
    let requiresStructuralMigration = requiresMigration;
    if (isDict(receipt) && receipt.plugin_version !== pluginVersion) {
      requiresMigration = true;
      reasons.push('receipt plugin version differs from source');
    }
    if (isDict(receipt) && receipt.source_fingerprint !== fingerprint) {
      requiresMigration = true;
      reasons.push(`receipt source fingerprint differs from the current ${SURFACE_LABEL} source`);
    }
    if (isDict(receipt) && receipt.profileId !== undefined && receipt.profileId !== null) {
      if (receipt.profileId !== SELECTION_PROFILE_ID) {
        requiresMigration = true;
        requiresStructuralMigration = true;
        reasons.push('receipt capability profile differs from the requested profile');
      }
      if (receipt.selectionFingerprint !== SELECTION_FINGERPRINT) {
        requiresMigration = true;
        requiresStructuralMigration = true;
        reasons.push('receipt capability selection fingerprint differs from the current selection');
      }
    } else if (isDict(receipt) && Object.keys(receipt).length > 0 && SELECTION_PROFILE_ID) {
      requiresMigration = true;
      requiresStructuralMigration = true;
      reasons.push('receipt has no current collection selection metadata');
    }
    return {
      state: reasons.length ? 'stale' : 'current',
      requires_migration: requiresMigration,
      requires_structural_migration: requiresStructuralMigration,
      reasons,
      legacy_names: pySorted(new Set(legacyNames)),
      retired_names: pySorted(new Set(retiredNames)),
    };
  }

  // Inventory id, public name, and path basename mapped to a stable skill id.
  function inventorySkillTokenMap(metadata) {
    const tokens = {};
    for (const [name, record] of Object.entries(metadata || {})) {
      if (!isDict(record)) continue;
      const stableId = record.id;
      if (!isStr(stableId) || !stableId) continue;
      tokens[stableId] = stableId;
      if (isStr(name) && name) tokens[name] = stableId;
      const skillPath = record.path;
      if (isStr(skillPath) && skillPath) tokens[path.posix.basename(skillPath.replace(/\/+$/, ''))] = stableId;
    }
    return tokens;
  }

  // UTF-8 text from a projected file or directory tree.
  function sourceTexts(source) {
    const texts = [];
    let real = source;
    try {
      if (isLink(source)) real = realpath(source);
    } catch (error) {
      if (isOSError(error)) return texts;
      throw error;
    }
    const read = (file) => {
      try {
        texts.push(fs.readFileSync(file).toString('utf8').replace(/�/g, ''));
      } catch (error) {
        if (!isOSError(error)) throw error;
      }
    };
    if (isFileFollow(real)) {
      read(real);
      return texts;
    }
    if (!isDirFollow(real)) return texts;
    const walk = (directory) => {
      let names;
      try {
        names = fs.readdirSync(directory);
      } catch (_) {
        return;
      }
      const directories = [];
      for (const name of names) {
        const full = path.join(directory, name);
        const stat = lstatOrNull(full);
        if (stat && stat.isDirectory()) {
          if (!isBytecodeName(name)) directories.push(full);
        } else if (stat && stat.isSymbolicLink() && isDirFollow(full)) {
          // os.walk lists a directory symlink as a directory and does not descend.
        } else {
          if (isBytecodeName(name)) continue;
          if (isFileFollow(full)) read(full);
        }
      }
      for (const child of directories) walk(child);
    };
    walk(real);
    return texts;
  }

  // Inventory skill ids referenced by a command/agent but not selected.
  function unmetSkillDependencyIds(kind, source, metadata, availableIds = null, tokenMap = null) {
    if (!DEPENDENCY_GATED_KINDS.includes(kind) || SELECTION_EMITTED_IDS === null) return [];
    const available = availableIds || new Set([...(SELECTION_EMITTED_IDS || []), ...(SELECTION_RUNTIME_IDS || [])]);
    const tokens = tokenMap || inventorySkillTokenMap(metadata);
    const missing = new Set();
    for (const text of sourceTexts(source)) {
      for (const match of text.matchAll(SKILL_REF_RE)) {
        const stableId = Object.prototype.hasOwnProperty.call(tokens, match[1]) ? tokens[match[1]] : null;
        if (stableId && !available.has(stableId)) missing.add(stableId);
      }
    }
    return pySorted(missing);
  }

  function recordUnmetSkillExclusion(kind, name, missing) {
    EXCLUDED_SOURCE_ENTRIES.push({ kind, name, reason: 'unmet-skill-dependency', missing: missing.slice() });
  }

  function currentSources() {
    EXCLUDED_SOURCE_ENTRIES.length = 0;
    const result = {};
    for (const kind of MANAGED_KINDS) result[kind] = {};
    const metadata = inventorySkillMetadata();
    const available = new Set([...(SELECTION_EMITTED_IDS || []), ...(SELECTION_RUNTIME_IDS || [])]);
    const tokens = inventorySkillTokenMap(metadata);
    const runtimeIds = nativeRuntimeSkillIds();
    for (const kind of SOURCE_KINDS) {
      if (skipNativeSkillKind(kind) && runtimeIds.size === 0) continue;
      const root = path.join(CODEX_SRC, kind);
      if (!isDirFollow(root)) continue;
      for (const name of pySorted(fs.readdirSync(root))) {
        if (isBytecodeName(name)) continue;
        if (kind === 'skills' && skipNativeSkillKind(kind)) {
          if (!runtimeIds.has(stableIdOf(metadata, name))) continue;
        } else if (kind === 'skills' && SELECTION_EMITTED_IDS !== null) {
          if (!available.has(stableIdOf(metadata, name))) continue;
        }
        const source = path.join(root, name);
        if (!lexists(source)) continue;
        const missing = unmetSkillDependencyIds(kind, source, metadata, available, tokens);
        if (missing.length) {
          recordUnmetSkillExclusion(kind, name, missing);
          continue;
        }
        result[kind][name] = [source, `${kind}/${name}`];
      }
    }
    Object.assign(result.supporting_assets, inventorySupportingSources());
    return result;
  }

  function targetFor(relative) {
    return safeDestination(relative);
  }

  // The runtime-safe materialization mode for one managed entry.
  function effectiveMaterializationMode(relative) {
    const topLevel = relative.split('/', 1)[0];
    if (topLevel === 'skills') return 'copy';
    if (HARNESS_KIND === 'codex' && topLevel === 'agents') return 'copy';
    return MODE;
  }

  function makeEntry(source, relative, destination, metadata = null) {
    const sourceFp = fingerprintSource(source);
    const mode = effectiveMaterializationMode(relative);
    const destinationFp = mode === 'symlink' ? followedDestinationFingerprint(destination) : fingerprintDestination(destination);
    const entry = {
      destination: relative,
      source: relative,
      mode,
      source_fingerprint: sourceFp,
      destination_fingerprint: destinationFp,
      // `fingerprint` is the ownership fingerprint in schema v3.
      fingerprint: destinationFp,
      ownership_marker: `${mode}:${relative}`,
    };
    if (isDict(metadata)) {
      if (pyTruthy(metadata.id)) entry.id = metadata.id;
      if (pyTruthy(metadata.name)) entry.name = metadata.name;
    }
    if (relative.startsWith('skills/')) entry.metadata_projection = 'portable-skill-metadata.v1';
    if (mode === 'symlink') entry.destination_target = fs.readlinkSync(destination);
    return entry;
  }

  // True when a destination tree contains any symlink (copy-mode ownership
  // must not follow a link to prove content equality).
  function containsSymlink(target) {
    if (isLink(target)) return true;
    if (!isDirFollow(target)) return false;
    try {
      for (const child of fs.readdirSync(target, { withFileTypes: true })) {
        if (child.isSymbolicLink()) return true;
        if (child.isDirectory() && containsSymlink(path.join(target, child.name))) return true;
      }
    } catch (error) {
      if (isOSError(error)) return true;
      throw error;
    }
    return false;
  }

  // Legacy adoption must match the mode the new receipt will claim.
  function matchesEffectiveMaterialization(relative, destination) {
    if (effectiveMaterializationMode(relative) === 'symlink') return isLink(destination);
    return !isLink(destination) && (isFileFollow(destination) || isDirFollow(destination)) && !containsSymlink(destination);
  }

  function isOwned(entry, destination) {
    if (!isDict(entry) || pyTruthy(entry.orphaned) || !lexists(destination)) return false;
    const mode = entry.mode;
    const relative = entry.source || entry.destination;
    if (!pyTruthy(mode) || !pyTruthy(relative) || entry.ownership_marker !== `${mode}:${relative}`) return false;
    if (!isStr(relative)) return false;
    const normalized = normpath(relative);
    if (path.isAbsolute(relative) || normalized !== relative || normalized === '..' || normalized.startsWith('../')) return false;
    if (mode === 'symlink') {
      const recordedTarget = entry.destination_target;
      return isLink(destination) && isStr(recordedTarget) && fs.readlinkSync(destination) === recordedTarget;
    }
    if (containsSymlink(destination)) return false;
    const recorded = entry.destination_fingerprint || entry.fingerprint;
    if (!isStr(recorded) || !recorded) return false;
    // Ownership always uses complete integrity, so an ignored bytecode edit
    // cannot pass as an owned, unchanged target.
    return fingerprintDestination(destination) === recorded;
  }

  // The receipt fingerprint that guards copy-mode deletion.
  function recordedCopyFingerprint(entry) {
    if (!isDict(entry) || entry.mode === 'symlink') return null;
    const value = entry.destination_fingerprint || entry.fingerprint;
    return isStr(value) && value.length === 64 ? value : null;
  }

  function exactSourceMatch(source, destination, relative, oldEntry = null) {
    if (!lexists(destination)) return false;
    if (isLink(destination)) return realpath(destination) === realpath(source);
    if (relative.startsWith('skills/') && isDict(oldEntry) && oldEntry.metadata_projection === 'portable-skill-metadata.v1') {
      const sourceFp = oldEntry.source_fingerprint;
      const destinationFp = oldEntry.destination_fingerprint || oldEntry.fingerprint;
      return sourceFp === fingerprintSource(source) && destinationFp === fingerprintDestination(destination);
    }
    return fingerprintSource(source) === fingerprintDestination(destination);
  }

  // An installer source: distributable view, links followed.
  function fingerprintSource(target) {
    return treeFingerprintPath(target, { symlinks: 'follow', skipBytecode: true });
  }

  // One entry beneath a checked parent: destination view, links recorded.
  function fingerprintFdEntry(parent, name, includeIgnored = true) {
    return treeFingerprintFdEntry(parent, name, { recordLinks: true, skipBytecode: !includeIgnored });
  }

  // A destination path; '' when it does not exist.
  function fingerprintDestination(destination, includeIgnored = true) {
    try {
      return safeDestinationFingerprint(destination, includeIgnored);
    } catch (error) {
      if (errnoIs(error, 'ENOENT') || errnoIs(error, 'ENOTDIR')) return '';
      throw error;
    }
  }

  // What a symlink-mode destination resolves to (complete view).
  function followedDestinationFingerprint(destination) {
    return treeFingerprintPath(destination, { symlinks: 'follow', skipBytecode: false });
  }

  // Hash a destination through checked, no-follow parents.
  function safeDestinationFingerprint(destination, includeIgnored = true) {
    const destinationAbs = path.resolve(destination);
    const rootAbs = path.resolve(CODEX_ROOT);
    if (destinationAbs !== rootAbs && !destinationAbs.startsWith(rootAbs + path.sep)) throw new ValueError(`destination fingerprint escapes project ${DEST_REL}: ${destination}`);
    const relative = path.relative(rootAbs, destinationAbs).split(path.sep).join('/') || '.';
    if (relative === '.') {
      const root = openRelativeDirectory('', { create: false });
      return treeFingerprintFdDirectory(root, { recordLinks: true, skipBytecode: !includeIgnored });
    }
    const index = relative.lastIndexOf('/');
    const parent = openRelativeDirectory(index < 0 ? '' : relative.slice(0, index), { create: false });
    try {
      return fingerprintFdEntry(parent, relative.slice(index + 1), includeIgnored);
    } catch (error) {
      if (errnoIs(error, 'ENOENT')) return '';
      throw error;
    }
  }

  // ---------------------------------------------------------------------
  // Materialization helpers

  // Physical SKILL.md files in a staged portable skill tree.
  function portableSkillMarkdownPaths(directory) {
    const result = [];
    const walk = (current) => {
      const names = fs.readdirSync(current);
      const directories = [];
      for (const name of names) {
        const full = path.join(current, name);
        const stat = lstatOrNull(full);
        if (stat && stat.isDirectory() && !isBytecodeName(name)) directories.push(name);
      }
      if (names.includes('SKILL.md')) {
        const candidate = path.join(current, 'SKILL.md');
        if (!isLink(candidate) && isFileFollow(candidate)) result.push(candidate);
      }
      for (const name of pySorted(directories)) walk(path.join(current, name));
    };
    walk(directory);
    return pySorted(result);
  }

  // Serialize metadata in staged skill frontmatter without editing the source.
  function transformPortableSkillMetadata(directory, relative) {
    if (!relative.startsWith('skills/')) return;
    const serialize = portableSkillMetadata.serializePortableSkillMetadata;
    for (const markdownPath of portableSkillMarkdownPaths(directory)) {
      const result = serialize(fs.readFileSync(markdownPath).toString('utf8'));
      if (!result || result.ok !== true || !isStr(result.output)) {
        const detail = result && Array.isArray(result.errors) ? result.errors.join('\n').trim() : '';
        throw new ValueError(detail || `portable metadata transform failed for ${path.relative(directory, markdownPath)}`);
      }
      fs.writeFileSync(markdownPath, Buffer.from(result.output, 'utf8'));
    }
  }

  // shutil.copytree(symlinks=False, ignore=bytecode) followed by copystat:
  // links are dereferenced, modes are kept.
  function copyTreeFollow(source, destination) {
    const stat = fs.statSync(source);
    fs.mkdirSync(destination, { mode: 0o777 });
    for (const name of fs.readdirSync(source)) {
      if (isBytecodeName(name)) continue;
      const from = path.join(source, name);
      const to = path.join(destination, name);
      if (isDirFollow(from)) copyTreeFollow(from, to);
      else copyFileFollow(from, to);
    }
    fs.chmodSync(destination, stat.mode & 0o7777);
  }

  // shutil.copy2: content and mode of what `source` resolves to.
  function copyFileFollow(source, destination) {
    fs.copyFileSync(source, destination);
    fs.chmodSync(destination, fs.statSync(source).mode & 0o7777);
  }

  // Copy one physical source entry and apply only the portable metadata transform.
  function copySourceIntoStage(source, stagedName, stageDirectory, relative = null) {
    validateFdName(stagedName);
    const staged = path.join(stageDirectory, stagedName);
    if (isDirFollow(source)) {
      copyTreeFollow(source, staged);
      transformPortableSkillMetadata(staged, relative || '');
    } else {
      copyFileFollow(source, staged);
    }
  }

  // Verify the staged entry through its checked stage directory and source.
  function verifyStagedMaterialization(source, relative, stageDirectory, stagedName, expectedSource, expectedDestination = null) {
    validateFdName(stagedName);
    const staged = path.join(stageDirectory, stagedName);
    if (effectiveMaterializationMode(relative) === 'symlink') {
      const stat = lstatOrNull(staged);
      if (!stat || !stat.isSymbolicLink()) return false;
      if (fs.readlinkSync(staged) !== source) return false;
      return fingerprintSource(source) === expectedSource;
    }
    try {
      const expected = expectedDestination === null ? expectedSource : expectedDestination;
      return fingerprintFdEntry(stageDirectory, stagedName, false) === expected;
    } catch (error) {
      if (errnoIs(error, 'ENOENT')) return false;
      throw error;
    }
  }


  // ---------------------------------------------------------------------
  // Shared projection: read-side classification

  let PROVIDER_CHECK = { status: 'NOT_APPLICABLE' };

  function classifyHostBindings() {
    const host = sharedProjectionHost() || 'cursor';
    const label = SURFACE_LABEL;
    const fallback = { bindingShape: 'native-link', reason: `${label} discovery consumer probe classifier is unavailable` };
    const evidenceKey = consumerEvidenceEnvKey();
    const evidence = evidenceKey ? env[evidenceKey] : null;
    let payload;
    try {
      payload = cursorConsumerEvidence.classifyHostBinding(host, { consumerEvidencePath: evidence || null });
    } catch (error) {
      rethrowExit(error);
      return { bindingShape: 'native-link', reason: `${label} discovery consumer probe classifier failed` };
    }
    // The Python read the classifier's JSON output; round-trip it the same way.
    try {
      payload = JSON.parse(JSON.stringify(payload));
    } catch (_) {
      return fallback;
    }
    const shape = isDict(payload) ? payload.bindingShape : null;
    const reason = isDict(payload) ? payload.reason : null;
    if (!['direct', 'native-link'].includes(shape) || !isStr(reason) || !reason) return fallback;
    return { bindingShape: shape, reason };
  }

  function declaredSkillPublicNames() {
    const metadata = inventorySkillMetadata();
    const byId = {};
    for (const [name, record] of Object.entries(metadata)) {
      if (!isDict(record)) continue;
      const stableId = record.id;
      if (!isStr(stableId) || !stableId) continue;
      byId[stableId] = isStr(record.name) && record.name ? record.name : name;
    }
    const names = [];
    const seen = new Set();
    for (const stableId of SELECTION_EMITTED_IDS || []) {
      const publicName = byId[stableId];
      if (isStr(publicName) && publicName && !seen.has(publicName)) {
        seen.add(publicName);
        names.push(publicName);
      }
    }
    return names;
  }

  function pluginSkillSourcePath(name) {
    const record = inventorySkillMetadata()[name] || {};
    let relative = record.path;
    if (!isStr(relative) || !relative) relative = `skills/${name}`;
    return path.join(PLUGIN_ROOT, ...relative.split('/'));
  }

  // The run's receipt entry for a native skill: the live entry map once the
  // reconciliation started, otherwise the receipt read at startup.
  let RUN_ENTRIES = null;
  let RUN_RECEIPT = null;
  let RUN_ORPHANED = null;

  function nativeSkillReceiptEntry(name) {
    const skills = isDict(RUN_ENTRIES) ? RUN_ENTRIES.skills : null;
    if (isDict(skills) && Object.prototype.hasOwnProperty.call(skills, name)) return skills[name];
    if (isDict(RUN_RECEIPT)) {
      const managed = RUN_RECEIPT.managed_entries;
      if (isDict(managed) && isDict(managed.skills)) return Object.prototype.hasOwnProperty.call(managed.skills, name) ? managed.skills[name] : null;
    }
    return null;
  }

  // Leftover native declared-skill destinations, classified before Host Bindings.
  function classifyLegacyNativeDeclaredSkills() {
    if (!sharedProjectionRelocatable()) return [];
    const runtimeIds = nativeRuntimeSkillIds();
    const metadata = inventorySkillMetadata();
    const rows = [];
    for (const name of declaredSkillPublicNames()) {
      const record = metadata[name];
      const stableId = isDict(record) ? (record.id === undefined ? null : record.id) : null;
      if (runtimeIds.has(stableId)) continue;
      const destRel = `skills/${name}`;
      let destination;
      try {
        destination = safeDestination(destRel);
      } catch (error) {
        if (isValueError(error)) continue;
        throw error;
      }
      if (!lexists(destination)) continue;
      const expected = `../../.agents/skills/${name}`;
      if (isLink(destination) && fs.readlinkSync(destination) === expected) continue;
      const source = pluginSkillSourcePath(name);
      const sourceFp = lexists(source) ? fingerprintSource(source) : '';
      const destFp = safeDestinationFingerprint(destination);
      const old = nativeSkillReceiptEntry(name);
      let handling;
      let reason;
      let action;
      if (isDict(old) && isOwned(old, destination)) {
        handling = 'migrate';
        reason = 'unchanged-receipt-owned-native-copy';
        action = '--update';
      } else if (isDict(old)) {
        handling = 'keep-modified';
        reason = 'receipt-owned-native-copy-diverged';
        action = `--adopt=${destRel}@${destFp}@${sourceFp}`;
      } else {
        handling = 'unowned';
        reason = 'native-skill-destination-not-in-receipt';
        action = 'preserve';
      }
      rows.push({ path: destRel, kind: 'skills', name, stableId, handling, reason, action, source_fingerprint: sourceFp, destination_fingerprint: destFp });
    }
    return rows;
  }

  function selectedSharedProjectionIds(adopted = null) {
    const adoptedPaths = adopted || {};
    const skip = new Set();
    for (const item of classifyLegacyNativeDeclaredSkills()) {
      if (!['keep-modified', 'unowned'].includes(item.handling)) continue;
      if (Object.prototype.hasOwnProperty.call(adoptedPaths, item.path)) continue;
      if (isStr(item.stableId) && item.stableId) skip.add(item.stableId);
    }
    return (SELECTION_EMITTED_IDS || []).filter((stableId) => !skip.has(stableId));
  }

  function receiptOwnedNativeDeclaredDestsBlockSharedProjection() {
    if (UPDATE || UNINSTALL) return false;
    let skills = {};
    if (isDict(RUN_RECEIPT)) {
      const managed = RUN_RECEIPT.managed_entries;
      if (isDict(managed) && isDict(managed.skills)) skills = managed.skills;
    }
    if (Object.keys(skills).length === 0) return false;
    const runtimeIds = nativeRuntimeSkillIds();
    const metadata = inventorySkillMetadata();
    const blocking = new Set(declaredSkillPublicNames());
    for (const [name, old] of Object.entries(skills)) {
      if (!blocking.has(name)) continue;
      const record = metadata[name];
      const stableId = isDict(record) ? (record.id === undefined ? null : record.id) : null;
      if (runtimeIds.has(stableId)) continue;
      let destination;
      try {
        destination = receiptDestination('skills', name, old);
      } catch (error) {
        if (isValueError(error)) continue;
        throw error;
      }
      if (!lexists(destination)) continue;
      const expected = `../../.agents/skills/${name}`;
      if (isLink(destination) && fs.readlinkSync(destination) === expected) continue;
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------------
  // Plan

  function sortByPath(items) {
    return items.map((item, index) => [item, index])
      .sort((left, right) => compat.pyStringCompare(String(left[0].path === undefined ? '' : left[0].path), String(right[0].path === undefined ? '' : right[0].path)) || left[1] - right[1])
      .map(([item]) => item);
  }

  function recordedDestinationFp(old) {
    return isDict(old) ? (old.destination_fingerprint || (Object.prototype.hasOwnProperty.call(old, 'fingerprint') ? old.fingerprint : '')) : '';
  }

  // A relative-path-only reconciliation report; writes nothing.
  function buildPlan(receipt, classification, sources, metadata, pluginVersion, fingerprint, retirements = null) {
    const entries = entryMap(receipt);
    const classificationReasons = (classification.reasons || []).filter((reason) => isStr(reason));
    const collisions = [];
    const missing = [];
    const updates = [];
    const retired = [];
    for (const kind of MANAGED_KINDS) {
      for (const [name, [source, relative]] of Object.entries(sources[kind])) {
        let destination;
        try {
          destination = targetFor(relative);
        } catch (error) {
          if (!isValueError(error)) throw error;
          collisions.push({ path: relative, kind, name, ownership: 'unsafe-path', error: errorText(error), action: 'repair-source-inventory' });
          continue;
        }
        const old = Object.prototype.hasOwnProperty.call(entries[kind], name) ? entries[kind][name] : null;
        const sourceFp = fingerprintSource(source);
        if (!lexists(destination)) {
          missing.push({ path: relative, kind, name, source_fingerprint: sourceFp });
          continue;
        }
        const destinationFp = safeDestinationFingerprint(destination);
        if (!isOwned(old, destination)) {
          const ownership = isDict(old) && pyTruthy(old.orphaned) ? 'orphaned' : 'unowned-collision';
          collisions.push({ path: relative, kind, name, ownership, source_fingerprint: sourceFp, destination_fingerprint: destinationFp, action: `--adopt=${relative}@${destinationFp}@${sourceFp}` });
          continue;
        }
        if (old.mode !== effectiveMaterializationMode(relative) || !exactSourceMatch(source, destination, relative, old)) {
          updates.push({ path: relative, kind, name, ownership: 'dhpk-managed', source_fingerprint: sourceFp, destination_fingerprint: destinationFp, action: '--update' });
        }
      }
    }
    const withRetirement = (item, retirement) => {
      if (retirement) {
        item.retirement = { ...retirement };
        item.canonical_identity = { ...(retirement.canonical_identity || {}) };
      }
      return item;
    };
    for (const kind of MANAGED_KINDS) {
      for (const [name, old] of Object.entries(entries[kind])) {
        if (Object.prototype.hasOwnProperty.call(sources[kind], name)) continue;
        const relative = isDict(old) ? (old.destination || old.source) : `${kind}/${name}`;
        const retirement = retirementForEntry(retirements, kind, name, old, relative);
        try {
          safeDestination(relative);
        } catch (error) {
          if (!isValueError(error)) throw error;
          const item = {
            path: `<unsafe-receipt-path:${kind}/${name}>`,
            kind,
            name,
            ownership: 'unsafe-receipt-path',
            source: isDict(old) ? (old.source === undefined ? null : old.source) : relative,
            destination: relative,
            source_fingerprint: isDict(old) ? (Object.prototype.hasOwnProperty.call(old, 'source_fingerprint') ? old.source_fingerprint : '') : '',
            destination_fingerprint: recordedDestinationFp(old),
            error: errorText(error),
            action: 'repair-receipt',
          };
          withRetirement(item, retirement);
          item.fingerprints = { source: item.source_fingerprint, destination: item.destination_fingerprint, recorded_destination: item.destination_fingerprint, observed_destination: '' };
          retired.push(item);
          continue;
        }
        const destination = targetFor(relative);
        const sourceFingerprintValue = isDict(old) ? (Object.prototype.hasOwnProperty.call(old, 'source_fingerprint') ? old.source_fingerprint : '') : '';
        const recordedDestination = recordedDestinationFp(old);
        let destinationFingerprint = recordedDestination;
        let observedDestination = '';
        let ownership = 'missing';
        let reason = 'retired-destination-missing';
        if (lexists(destination)) {
          observedDestination = safeDestinationFingerprint(destination);
          destinationFingerprint = observedDestination;
          if (isOwned(old, destination)) {
            ownership = 'receipt-entry';
            reason = 'unchanged-receipt-owned';
          } else if (isDict(old) && pyTruthy(old.orphaned)) {
            ownership = 'orphaned';
            reason = 'already-orphaned';
          } else if (isDict(old) && old.mode === 'symlink') {
            ownership = 'orphaned';
            reason = 'retargeted-or-unsafe';
          } else {
            ownership = 'orphaned';
            reason = 'modified-or-unowned';
          }
        }
        const item = {
          path: relative,
          kind,
          name,
          ownership,
          source: isDict(old) ? (old.source === undefined ? null : old.source) : relative,
          destination: relative,
          source_fingerprint: sourceFingerprintValue,
          destination_fingerprint: destinationFingerprint,
          recorded_destination_fingerprint: recordedDestination,
          observed_destination_fingerprint: observedDestination,
          reason,
          action: ownership === 'receipt-entry' ? 'prune' : 'preserve-orphan',
        };
        item.fingerprints = { source: sourceFingerprintValue, destination: destinationFingerprint, recorded_destination: recordedDestination, observed_destination: observedDestination };
        withRetirement(item, retirement);
        retired.push(item);
      }
    }
    const legacyNativeSkills = classifyLegacyNativeDeclaredSkills();
    const collisionPaths = new Set(collisions.map((item) => item.path));
    for (const item of legacyNativeSkills) {
      if (item.handling !== 'keep-modified' || collisionPaths.has(item.path)) continue;
      collisions.push({
        path: item.path,
        kind: item.kind,
        name: item.name,
        ownership: 'modified-legacy-native',
        source_fingerprint: item.source_fingerprint === undefined ? '' : item.source_fingerprint,
        destination_fingerprint: item.destination_fingerprint === undefined ? '' : item.destination_fingerprint,
        action: item.action,
        handling: 'keep-modified',
      });
      collisionPaths.add(item.path);
    }
    // A ledger row can outlive its receipt entry: report a surviving former
    // canonical destination as an unowned collision, never delete it by name.
    const receiptRetiredPaths = new Set();
    for (const item of retired) {
      const retirement = isDict(item) ? item.retirement : null;
      if (isDict(retirement) && isStr(retirement.canonicalPath)) receiptRetiredPaths.add(retirement.canonicalPath);
    }
    for (const retirement of uniqueRetirementRows(retirements)) {
      const relative = retirement.canonicalPath;
      if (!isStr(relative) || receiptRetiredPaths.has(relative)) continue;
      let destination;
      try {
        destination = targetFor(relative);
      } catch (error) {
        if (!isValueError(error)) throw error;
        retired.push({
          path: relative,
          kind: 'skills',
          name: retirement.name === undefined ? null : retirement.name,
          ownership: 'unsafe-retirement-path',
          source: relative,
          destination: relative,
          source_fingerprint: '',
          destination_fingerprint: '',
          fingerprints: { source: '', destination: '', recorded_destination: '', observed_destination: '' },
          error: errorText(error),
          action: 'repair-retirement-ledger',
          retirement: { ...retirement },
          canonical_identity: { ...(retirement.canonical_identity || {}) },
        });
        continue;
      }
      if (!lexists(destination)) continue;
      const destinationFingerprint = safeDestinationFingerprint(destination);
      retired.push({
        path: relative,
        kind: 'skills',
        name: retirement.name === undefined ? null : retirement.name,
        ownership: 'unowned-collision',
        source: relative,
        destination: relative,
        source_fingerprint: '',
        destination_fingerprint: destinationFingerprint,
        fingerprints: { source: '', destination: destinationFingerprint, recorded_destination: '', observed_destination: destinationFingerprint },
        reason: 'retired-destination-unowned',
        action: 'preserve-orphan',
        retirement: { ...retirement },
        canonical_identity: { ...(retirement.canonical_identity || {}) },
      });
    }
    const reconciliation = isDict(receipt) ? receipt.reconciliation : {};
    let reconciliationState = isDict(reconciliation) ? reconciliation.state : null;
    if (!['current', 'partial', 'stale'].includes(reconciliationState)) reconciliationState = isDict(receipt) ? receipt.state : null;
    if (!['current', 'partial', 'stale'].includes(reconciliationState)) reconciliationState = classification.state;
    if (reconciliationState === undefined) reconciliationState = null;
    let state;
    if (collisions.length) state = 'requires_adoption';
    else if (pyTruthy(classification.requires_migration) || classification.state === 'stale' || ['partial', 'stale'].includes(reconciliationState) || missing.length || updates.length || retired.length) state = 'stale';
    else state = 'current';
    let nextAction = null;
    if (collisions.length) nextAction = 'review collision evidence, then re-run with --update --adopt=<reported-relative-path>@<destination-fingerprint>@<source-fingerprint>';
    else if (pyTruthy(classification.requires_migration)) nextAction = 're-run with --migrate --update';
    else if (state !== 'current') nextAction = 're-run with --update (and --migrate when the receipt is legacy)';
    const get = (key) => (isDict(receipt) && Object.prototype.hasOwnProperty.call(receipt, key) ? receipt[key] : null);
    const report = {
      schema_version: SCHEMA_VERSION,
      plugin_version: pluginVersion,
      profileId: SELECTION_PROFILE_ID,
      selectedStableIds: (SELECTION_CANONICAL_IDS || []).slice(),
      emittedStableIds: (SELECTION_EMITTED_IDS || []).slice(),
      runtimeSupportStableIds: (SELECTION_RUNTIME_IDS || []).slice(),
      receipt_profile_id: get('profileId'),
      receipt_selected_stable_ids: get('selectedStableIds'),
      compatibilityMode: SELECTION_COMPATIBILITY,
      selectionPolicyVersion: SELECTION_POLICY_VERSION,
      selectionFingerprint: SELECTION_FINGERPRINT,
      surfaceSelectionFingerprint: SELECTION_SURFACE_FINGERPRINT,
      providerCheck: { ...PROVIDER_CHECK },
      receipt_state: reconciliationState,
      reconciliation_state: reconciliationState,
      state,
      receipt_plugin_version: get('plugin_version'),
      receipt_source_fingerprint: get('source_fingerprint'),
      source_fingerprint: fingerprint,
      reasons: classificationReasons,
      collisions: sortByPath(collisions),
      missing: sortByPath(missing),
      updates: sortByPath(updates),
      retired: sortByPath(retired),
      released: (classification.released || []).slice(),
      legacyNativeSkills: sortByPath(legacyNativeSkills),
      excluded: EXCLUDED_SOURCE_ENTRIES.map((item, index) => [{ ...item }, index])
        .sort((left, right) => compat.pyStringCompare(String(left[0].kind || ''), String(right[0].kind || '')) || compat.pyStringCompare(String(left[0].name || ''), String(right[0].name || '')) || left[1] - right[1])
        .map(([item]) => item),
      next_action: nextAction,
    };
    if (sharedProjectionHost()) {
      const hostBinding = classifyHostBindings();
      if (HARNESS_KIND === 'cursor') {
        report.cursorBindingShape = hostBinding.bindingShape;
        report.cursorBindingReason = hostBinding.reason;
      } else {
        report.codexBindingShape = hostBinding.bindingShape;
        report.codexBindingReason = hostBinding.reason;
      }
    }
    return report;
  }

  function printPlan(report) {
    if (JSON_OUTPUT) printJsonReport(report);
    else {
      print(`[install-codex-skills] plan: state=${report.state} receipt_state=${pyStr(report.receipt_state)}`);
      for (const item of report.excluded || []) {
        print(`[install-codex-skills] excluded: ${pyStr(item.kind)}/${pyStr(item.name)} reason=${pyStr(item.reason)} missing=${(item.missing || []).join(',')}`);
      }
      for (const collision of report.collisions) {
        print(`[install-codex-skills] collision: ${collision.path} ownership=${collision.ownership} action=${collision.action}`);
      }
      for (const item of report.released || []) {
        print(`[install-codex-skills] released: ${pyStr(item.path)} (an update releases it from the receipt; its files stay in place)`);
      }
      for (const item of report.legacyNativeSkills || []) {
        print(`[install-codex-skills] legacy-native-skill: ${pyStr(item.path)} handling=${pyStr(item.handling)} action=${pyStr(item.action)}`);
      }
      if (report.next_action) print(`[install-codex-skills] ACTION REQUIRED: ${report.next_action}`);
    }
    exit(report.state === 'current' ? 0 : 1);
  }

  function validateAdoptions(plan) {
    const rawRequests = pySorted(new Set(ADOPT_PATHS));
    if (rawRequests.length === 0) return {};
    if (!UPDATE) throw new ValueError('--adopt requires --update');
    const byPath = {};
    for (const item of plan.collisions || []) byPath[item.path] = item;
    const requested = {};
    for (const raw of rawRequests) {
      // str.rsplit('@', 2)
      const parts = raw.split('@');
      const split = parts.length > 3 ? [parts.slice(0, parts.length - 2).join('@'), ...parts.slice(-2)] : parts;
      if (split.length !== 3) throw new ValueError('--adopt requires path@destination-fingerprint@source-fingerprint from a fresh plan');
      const [relative, expected, expectedSource] = split;
      for (const [label, value] of [['destination', expected], ['source', expectedSource]]) {
        if (!HEX64.test(value)) throw new ValueError(`adoption ${label} fingerprint is invalid: ${relative}`);
      }
      const destination = targetFor(relative);
      const item = byPath[relative];
      if (item === undefined) throw new ValueError(`adoption path was not reported as a collision: ${relative}`);
      if (isLink(destination) || containsSymlink(destination)) throw new ValueError(`adoption target contains a symlink: ${relative}`);
      const current = safeDestinationFingerprint(destination);
      if (expected !== item.destination_fingerprint || expectedSource !== item.source_fingerprint || current !== expected) {
        throw new ValueError(`adoption preflight changed: ${relative}; run a fresh plan`);
      }
      requested[relative] = expectedSource;
    }
    return requested;
  }


  // ---------------------------------------------------------------------
  // Python Host journals (.<host>/.dhpk-transaction-<run>.json). This release
  // does not write or recover them: a committed or rolled-back journal is
  // validated history; an active or rollback_incomplete one was left by a
  // dhpk 0.72/0.73 installer and fails closed (issue #1321).

  const SHARED_PROJECTION_PHASES = Object.freeze(['requested', 'held', 'committing']);
  const HOST_JOURNAL_NAME = /^\.dhpk-transaction-(\d{8}T\d{6}Z-\d+)\.json$/;

  function readRelativeJson(parent, name) {
    const descriptor = fs.openSync(path.join(parent, name), fs.constants.O_RDONLY | O_NONBLOCK | O_NOFOLLOW);
    try {
      if (!fs.fstatSync(descriptor).isFile()) throw new ValueError(`transaction journal ${name} is not a regular file`);
      return JSON.parse(fs.readFileSync(descriptor, 'utf8'));
    } finally {
      fs.closeSync(descriptor);
    }
  }

  // Validate a journal's path and transaction binding, so a damaged record is
  // never skipped as history.
  function classifyJournalEnvelope(journal, journalName, run) {
    if (!isDict(journal) || journal.relative !== journalName || journal.run !== run || !Number.isInteger(journal.pid)
      || journal.pid <= 0 || journal.started !== true || !isStr(journal.plugin_version)) {
      throw new ValueError(`transaction journal ${run} identity is malformed; manual recovery required`);
    }
    const present = journal.receipt_snapshot_present;
    const snapshot = journal.receipt_snapshot;
    if (typeof present !== 'boolean' || (present && !isDict(snapshot)) || (!present && snapshot !== null && snapshot !== undefined)) {
      throw new ValueError(`transaction journal ${run} receipt snapshot is malformed; manual recovery required`);
    }
    if (Object.prototype.hasOwnProperty.call(journal, 'receipt_archive') && journal.receipt_archive !== `${BACKUP_DIR}/${run}/receipt.json`) {
      throw new ValueError(`transaction journal ${run} receipt archive is not transaction-bound; manual recovery required`);
    }
    if (['prunes', 'mutations', 'adoptions'].some((key) => Object.prototype.hasOwnProperty.call(journal, key) && !Array.isArray(journal[key]))) {
      throw new ValueError(`transaction journal ${run} rollback lists are malformed; manual recovery required`);
    }
    const shared = journal.shared_projection;
    if (shared !== undefined && shared !== null && (!isDict(shared) || shared.transaction !== run
      || !SHARED_PROJECTION_PHASES.includes(shared.phase) || !isStr(shared.host)
      || !['receipt', 'archive'].includes(Object.prototype.hasOwnProperty.call(shared, 'finalize') ? shared.finalize : 'receipt'))) {
      throw new ValueError(`transaction journal ${run} shared projection record is malformed; manual recovery required`);
    }
    const phase = journal.phase;
    if (!['active', 'committed', 'rolled_back', 'rollback_incomplete'].includes(phase)) {
      throw new ValueError(`transaction journal ${run} has unsupported phase ${pyRepr(phase)}; manual recovery required`);
    }
    const source = journal.source_fingerprint;
    // Older receipt releases wrote an empty source; accept only a complete,
    // fully identifiable transaction of that shape.
    const oldRelease = phase === 'committed' && source === ''
      && journal.fingerprint_algorithm === TREE_FINGERPRINT_ALGORITHM
      && present && !receiptHasTreeMarker(snapshot)
      && journal.receipt_archive === `${BACKUP_DIR}/${run}/receipt.json`
      && ['prunes', 'mutations', 'adoptions'].every((key) => Array.isArray(journal[key]) && journal[key].length === 0);
    if (!oldRelease && (!isStr(source) || !HEX64.test(source))) {
      throw new ValueError(`transaction journal ${run} source fingerprint is malformed; manual recovery required`);
    }
    if (phase === 'active' || Object.prototype.hasOwnProperty.call(journal, 'fingerprint_algorithm')) recordFingerprintAlgorithm(journal);
    // Checked last so a damaged or unknown-algorithm record keeps its own, more specific message.
    if (phase === 'active' || phase === 'rollback_incomplete') {
      throw new ValueError(`transaction journal ${run} was left ${phase} by a dhpk 0.72/0.73 installer; this release no longer recovers it. Run this installer's --recover (or \`dhpk-install --recover\`) with dhpk ${journalCore.LEGACY_JOURNAL_RECOVERY_RELEASE}, the last release line that recovers it, then retry`);
    }
    return phase;
  }

  function hostJournalNames() {
    if (!lexists(CODEX_ROOT) || isLink(CODEX_ROOT)) return null;
    let root;
    try {
      root = openRelativeDirectory('', { create: false });
    } catch (error) {
      if (errnoIs(error, 'ENOENT')) return null;
      throw error;
    }
    return [root, pySorted(fs.readdirSync(root))];
  }

  // Read-only gate: every readable journal must name tree-merkle-v1. Runs
  // before the lock and before any recovery, so a journal this installer
  // cannot interpret changes nothing.
  function checkTransactionJournalMarkers() {
    const listing = hostJournalNames();
    if (!listing) return;
    const [root, names] = listing;
    for (const journalName of names) {
      const match = HOST_JOURNAL_NAME.exec(journalName);
      if (!match) continue;
      let journal;
      try {
        journal = readRelativeJson(root, journalName);
      } catch (error) {
        if (isOSError(error) || error instanceof SyntaxError) throw new ValueError(`transaction journal ${journalName} is unreadable: ${errorText(error)}`);
        throw error;
      }
      classifyJournalEnvelope(journal, journalName, match[1]);
    }
  }

  // Inspect journals without mutating state; plans fail closed.
  function inspectStaleTransactionsForPlan() {
    const listing = hostJournalNames();
    const blocked = [];
    if (listing) {
      const [root, names] = listing;
      for (const journalName of names) {
        const match = HOST_JOURNAL_NAME.exec(journalName);
        if (!match) continue;
        let journal;
        try {
          journal = readRelativeJson(root, journalName);
        } catch (error) {
          if (isOSOrValueError(error) || error instanceof SyntaxError) {
            blocked.push(`${journalName}: unreadable (${errorText(error)})`);
            continue;
          }
          throw error;
        }
        let phase;
        try {
          phase = classifyJournalEnvelope(journal, journalName, match[1]);
        } catch (error) {
          if (!isValueError(error)) throw error;
          blocked.push(`${journalName}: ${errorText(error)}`);
          continue;
        }
        if (!['committed', 'rolled_back'].includes(phase)) blocked.push(`${journalName}: unsupported phase ${pyRepr(phase)}`);
      }
    }
    return blocked.concat(projectionJournalBlockers());
  }

  // Filled in by the transaction section (one Projection Journal per project).
  let projectionJournalBlockers = () => [];
  let acquireInstallLock = () => {
    throw new Error('install lock is not ported yet');
  };
  let recoverStaleTransactions = () => {
    throw new Error('transaction recovery is not ported yet');
  };
  let releaseInstallLock = () => {};


  // ---------------------------------------------------------------------
  // Receipt content

  function buildEvidence(pluginVersion, fingerprint, entries, counts, state) {
    const destinations = {};
    const ownership = { ...evidenceOwnership };
    for (const kind of MANAGED_KINDS) {
      for (const entry of Object.values(entries[kind] || {})) {
        if (!isDict(entry)) continue;
        const relative = entry.destination || entry.source;
        if (!isStr(relative) || !relative) continue;
        destinations[relative] = {
          source: entry.source === undefined ? null : entry.source,
          destination: relative,
          source_fingerprint: Object.prototype.hasOwnProperty.call(entry, 'source_fingerprint') ? entry.source_fingerprint : '',
          destination_fingerprint: entry.destination_fingerprint || (Object.prototype.hasOwnProperty.call(entry, 'fingerprint') ? entry.fingerprint : ''),
        };
        if (!Object.prototype.hasOwnProperty.call(ownership, relative)) ownership[relative] = pyTruthy(entry.orphaned) ? 'orphaned' : 'dhpk-managed';
      }
    }
    const paths = { source_root: SRC_REL, destination_root: DEST_REL, receipt: `${DEST_REL}/.dhpk-installed.json` };
    for (const [kind, values] of Object.entries(evidencePaths)) paths[kind] = pySorted(new Set(values));
    const evidence = {
      schema_version: SCHEMA_VERSION,
      plugin_version: pluginVersion,
      state,
      complete: state === 'current',
      paths,
      ownership,
      fingerprints: { source: fingerprint, destinations },
      backups: backupRecords.slice(),
    };
    if (SELECTION_PROFILE_ID) evidence.selection = selectionFields();
    return evidence;
  }

  function selectionFields() {
    return {
      profileId: SELECTION_PROFILE_ID,
      selectedStableIds: (SELECTION_CANONICAL_IDS || []).slice(),
      emittedStableIds: (SELECTION_EMITTED_IDS || []).slice(),
      runtimeSupportStableIds: (SELECTION_RUNTIME_IDS || []).slice(),
      compatibilityMode: SELECTION_COMPATIBILITY,
      selectionPolicyVersion: SELECTION_POLICY_VERSION,
      selectionFingerprint: SELECTION_FINGERPRINT,
      surfaceSelectionFingerprint: SELECTION_SURFACE_FINGERPRINT,
    };
  }

  // The receipt document save_receipt wrote; `transactionId` is the run.
  function receiptDocument(pluginVersion, fingerprint, entries, orphaned, counts, { legacyPending = false, state = null, transactionId = null, transactionFinal = true } = {}) {
    let effectiveState = state;
    if (effectiveState === null) {
      if (legacyPending) effectiveState = 'stale';
      else if (pyTruthy(counts.skipped_collision) || pyTruthy(counts.orphaned)) effectiveState = 'partial';
      else effectiveState = 'current';
    }
    const durableCounts = { ...counts };
    durableCounts.collided = Object.prototype.hasOwnProperty.call(durableCounts, 'skipped_collision') ? durableCounts.skipped_collision : 0;
    durableCounts.retired = Object.prototype.hasOwnProperty.call(durableCounts, 'retired') ? durableCounts.retired : (durableCounts.pruned || 0);
    durableCounts.backed_up = Object.prototype.hasOwnProperty.call(durableCounts, 'backed_up') ? durableCounts.backed_up : backupRecords.length;
    durableCounts.state = effectiveState;
    durableCounts.status = effectiveState;
    durableCounts.complete = effectiveState === 'current';
    durableCounts.evidence = buildEvidence(pluginVersion, fingerprint, entries, durableCounts, effectiveState);
    const receipt = {
      schema_version: SCHEMA_VERSION,
      plugin_version: pluginVersion,
      fingerprint_algorithm: TREE_FINGERPRINT_ALGORITHM,
      source_fingerprint: fingerprint,
      mode: MODE,
      installed_at: `${new Date().toISOString().slice(0, 19)}Z`,
      managed_entries: entries,
      orphaned_entries: orphaned,
      reconciliation: durableCounts,
      state: effectiveState,
    };
    if (SELECTION_PROFILE_ID) Object.assign(receipt, selectionFields());
    if (transactionId !== null) {
      receipt.transaction_id = transactionId;
      receipt.transaction_final = transactionFinal;
    }
    if (legacyPending) receipt.legacy_pending = true;
    return receipt;
  }

  function receiptText(receipt) {
    return `${pyJsonDumps(receipt, { indent: 2, sortKeys: true })}\n`;
  }

  // A symlink-mode entry proven by its recorded link, rewritten without the
  // legacy marker; null when the link cannot be proven.
  function proveSymlinkEntry(entry) {
    if (entry.mode !== 'symlink' || pyTruthy(entry.orphaned)) return null;
    let current;
    try {
      const destination = safeDestination(entry.destination || entry.source);
      if (!isOwned(entry, destination)) return null;
      current = followedDestinationFingerprint(destination);
    } catch (error) {
      rethrowExit(error);
      if (isOSOrValueError(error) || error instanceof TypeError) return null;
      throw error;
    }
    const proven = { ...entry, destination_fingerprint: current, fingerprint: current };
    delete proven.fingerprint_algorithm;
    return proven;
  }

  // Split off entries whose ownership the receipt can no longer prove
  // (Released Entries). Neither the input receipt nor any file changes.
  function releaseUnprovableEntries(receipt) {
    const managed = isDict(receipt) ? receipt.managed_entries : null;
    if (!isDict(managed)) return [receipt, []];
    const released = [];
    let rewritten = false;
    const view = {};
    for (const [kind, values] of Object.entries(managed)) {
      if (!isDict(values)) {
        view[kind] = values;
        continue;
      }
      const kept = {};
      for (const [name, entry] of Object.entries(values)) {
        if (!(isDict(entry) && entry.fingerprint_algorithm === ENTRY_LEGACY_MARKER)) {
          kept[name] = entry;
          continue;
        }
        const proven = proveSymlinkEntry(entry);
        if (proven !== null) {
          kept[name] = proven;
          rewritten = true;
          continue;
        }
        released.push({ path: entry.destination || entry.source || `${kind}/${name}`, kind, name });
      }
      view[kind] = kept;
    }
    const [parked, parkedChanged] = releaseParkedLegacyRecords(receipt.orphaned_entries, released);
    if (!released.length && !rewritten && !parkedChanged) return [receipt, []];
    const rebuilt = { ...receipt, managed_entries: view };
    if (parkedChanged) rebuilt.orphaned_entries = parked;
    return [rebuilt, released.map((item, index) => [item, index]).sort((left, right) => compat.pyStringCompare(left[0].path, right[0].path) || left[1] - right[1]).map(([item]) => item)];
  }

  function releaseParkedLegacyRecords(orphanedEntries, released) {
    if (!isDict(orphanedEntries)) return [orphanedEntries, false];
    const releasedPaths = new Set(released.map((item) => item.path));
    const kept = {};
    for (const [relative, record] of Object.entries(orphanedEntries)) {
      if (releasedPaths.has(relative)) continue;
      if (isDict(record) && record.fingerprint_algorithm === ENTRY_LEGACY_MARKER) {
        released.push({ path: relative, kind: 'orphaned_entries', name: relative });
        continue;
      }
      kept[relative] = record;
    }
    return [kept, Object.keys(kept).length !== Object.keys(orphanedEntries).length];
  }

  function printSummary(counts, collisions, orphaned) {
    const keys = ['created', 'updated', 'adopted', 'migrated', 'preserved', 'skipped_collision', 'collided', 'pruned', 'retired', 'backed_up', 'orphaned'];
    print(`[install-codex-skills] reconciliation: ${keys.map((key) => `${key}=${counts[key]}`).join(', ')}`);
    for (const relative of pySorted(collisions)) print(`[install-codex-skills] collision preserved: ${relative}`);
    for (const relative of pySorted(orphaned)) print(`[install-codex-skills] orphaned preserved: ${relative}`);
    for (const item of EXCLUDED_SOURCE_ENTRIES) {
      print(`[install-codex-skills] excluded: ${pyStr(item.kind)}/${pyStr(item.name)} reason=${pyStr(item.reason)} missing=${(item.missing || []).join(',')}`);
    }
  }

  // Filled in by the reconciliation section.
  let releaseUnmarkedReceiptForUninstall = () => {
    throw new Error('uninstall of an unmarked receipt is not ported yet');
  };
  let reconcile = () => {
    throw new Error('reconciliation is not ported yet');
  };


  // ---------------------------------------------------------------------
  // One Projection Journal per project (ADR-0036, tasks 3.4-3.5)
  //
  // Native Projection effects and Shared Project Projection effects are
  // records in .agents/.dhpk-projection-journal.json; reaching `published` is
  // the single commit point. One project lock serializes every Host.

  const AGENTS_ROOT = path.join(PROJECT_ROOT, '.agents');
  const JOURNAL_PATH = path.join(AGENTS_ROOT, '.dhpk-projection-journal.json');
  const LOCK_PATH = path.join(AGENTS_ROOT, '.dhpk-install.lock');
  const JOURNAL_SCHEMA = 'dhpk.projection-journal.v1';
  const NATIVE_STAGE = `.dhpk-stage-${BACKUP_RUN}`;
  const NATIVE_TOMBSTONES = `.dhpk-tombstones-${BACKUP_RUN}`;
  let TX = null;
  let LOCK_HELD = false;
  let AGENTS_CREATED = false;

  function participant() {
    return publisherModule.projectionJournalParticipant(PROJECT_ROOT);
  }

  function ensureAgentsRoot() {
    const stat = lstatOrNull(AGENTS_ROOT);
    if (stat) {
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new ValueError('project .agents is not a physical directory; refusing to take the install lock');
      return;
    }
    fs.mkdirSync(AGENTS_ROOT);
    AGENTS_CREATED = true;
  }

  function pidIsAlive(pid) {
    if (!Number.isInteger(pid) || pid <= 0) return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return errnoIs(error, 'EPERM');
    }
  }

  function readLock() {
    try {
      const owner = JSON.parse(fs.readFileSync(LOCK_PATH, 'utf8'));
      return isDict(owner) ? owner : {};
    } catch (error) {
      if (errnoIs(error, 'ENOENT')) return null;
      return {};
    }
  }

  function describeLock(owner) {
    const host = isStr(owner.host) ? owner.host : 'unknown';
    const pid = Number.isInteger(owner.pid) ? owner.pid : 'unknown';
    const start = isStr(owner.start) ? owner.start : 'unknown';
    return `.agents/.dhpk-install.lock (held by the ${host} installer, pid ${pid}, since ${start})`;
  }

  // Raw lock text: null when absent, '' when unreadable (never ours mid-creation:
  // the lock is created complete, by linking a finished temp file).
  function readLockRaw() {
    try {
      return fs.readFileSync(LOCK_PATH, 'utf8');
    } catch (error) {
      if (errnoIs(error, 'ENOENT')) return null;
      return '';
    }
  }

  function parseLockOwner(raw) {
    try {
      const owner = JSON.parse(raw);
      return isDict(owner) && Number.isInteger(owner.pid) ? owner : null;
    } catch (_) {
      return null;
    }
  }

  // Removes the lock judged stale (its text was `judgedRaw`) without a window
  // in which a fresh lock could be deleted: move it aside, verify what moved,
  // and put a different (fresh) lock back. Returns when the judged lock is gone.
  function removeJudgedLock(judgedRaw) {
    const stale = `${LOCK_PATH}.stale-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
    try {
      fs.renameSync(LOCK_PATH, stale);
    } catch (error) {
      if (errnoIs(error, 'ENOENT')) return;
      throw error;
    }
    let moved = null;
    try {
      moved = fs.readFileSync(stale, 'utf8');
    } catch (_) {
      moved = null;
    }
    if (moved === judgedRaw) {
      fs.unlinkSync(stale);
      return;
    }
    // A different lock was swapped in after the check: it is live. Restore it.
    try {
      fs.linkSync(stale, LOCK_PATH);
    } catch (error) {
      if (errnoIs(error, 'EEXIST')) throw new ValueError(`install lock .agents/.dhpk-install.lock changed during removal and a new lock now exists; the lock that was moved aside is kept at ${stale}, the current one is ${LOCK_PATH}; inspect both before rerunning`);
      throw error;
    }
    fs.unlinkSync(stale);
    const owner = parseLockOwner(moved || '');
    throw new ValueError(`another installer is already reconciling this project: ${owner ? describeLock(owner) : '.agents/.dhpk-install.lock (unreadable)'}`);
  }

  // The project install lock: created complete (temp file linked into place),
  // never stolen; a lock whose pid is gone is removed only by an explicit
  // --recover, or when it provably belongs to the journal being recovered.
  acquireInstallLock = () => {
    ensureCodexRootSafe();
    ensureAgentsRoot();
    // `agentsCreated`: whoever takes this lock over also removes an empty .agents.
    const record = () => `${JSON.stringify({ pid: process.pid, host: HARNESS_KIND, start: new Date().toISOString(), agentsCreated: AGENTS_CREATED })}\n`;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const temp = `${LOCK_PATH}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
      let linked = false;
      try {
        const descriptor = fs.openSync(temp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | O_NOFOLLOW, 0o600);
        try {
          fs.writeSync(descriptor, record());
          fs.fsyncSync(descriptor);
        } finally {
          fs.closeSync(descriptor);
        }
        try {
          fs.linkSync(temp, LOCK_PATH);
          linked = true;
        } catch (error) {
          if (!errnoIs(error, 'EEXIST')) throw error;
        }
      } finally {
        try {
          fs.unlinkSync(temp);
        } catch (_) {
          // never created, or already gone
        }
      }
      if (linked) {
        LOCK_HELD = true;
        return;
      }
      const raw = readLockRaw();
      if (raw === null) continue;
      const owner = parseLockOwner(raw);
      if (owner === null) {
        if (!RECOVER || attempt > 0) throw new ValueError('unreadable install lock .agents/.dhpk-install.lock (empty or not valid JSON); rerun with --recover to remove it');
        print('[install-codex-skills] removing unreadable install lock .agents/.dhpk-install.lock');
        removeJudgedLock(raw);
        continue;
      }
      if (pidIsAlive(owner.pid)) throw new ValueError(`another installer is already reconciling this project: ${describeLock(owner)}`);
      // A dead holder's lock is taken over only when it provably belongs to
      // the interrupted transaction this run is about to recover (REQ-5),
      // or on an explicit --recover; never silently otherwise.
      let journalPid = null;
      try {
        const document = JSON.parse(fs.readFileSync(JOURNAL_PATH, 'utf8'));
        journalPid = isDict(document) && Number.isInteger(document.pid) ? document.pid : null;
      } catch (_) {
        journalPid = null;
      }
      const ownedByJournal = owner.pid === journalPid;
      if ((!RECOVER && !ownedByJournal) || attempt > 0) {
        throw new ValueError(`stale install lock ${describeLock(owner)}: that process is no longer running; rerun this installer with --recover to remove it`);
      }
      print(ownedByJournal
        ? `[install-codex-skills] taking over the install lock of interrupted transaction ${describeLock(owner)}`
        : `[install-codex-skills] removing stale install lock ${describeLock(owner)}`);
      removeJudgedLock(raw);
      if (owner.agentsCreated === true) AGENTS_CREATED = true;
    }
    throw new ValueError(`cannot take the install lock ${LOCK_PATH}`);
  };

  releaseInstallLock = () => {
    if (LOCK_HELD) {
      const owner = readLock();
      if (owner && owner.pid === process.pid) fs.rmSync(LOCK_PATH, { force: true });
      LOCK_HELD = false;
    }
    if (AGENTS_CREATED) {
      try {
        if (fs.readdirSync(AGENTS_ROOT).length === 0) fs.rmdirSync(AGENTS_ROOT);
      } catch (_) {
        // .agents is in use or already gone
      }
      AGENTS_CREATED = false;
    }
  };

  // The scope of a recorded journal: its own native header plus the
  // publication it carries, if any.
  function journalScope(document) {
    const native = isDict(document.native) ? document.native : {};
    const destRoot = path.join(PROJECT_ROOT, isStr(native.destRel) ? native.destRel : DEST_REL);
    const transient = new Set();
    for (const key of ['stage', 'tombstones', 'backups']) {
      if (isStr(native[key]) && /^\.dhpk-(stage|tombstones)-\d{8}T\d{6}Z-\d+$|^\.dhpk-backups\/\d{8}T\d{6}Z-\d+$/.test(native[key])) transient.add(path.join(destRoot, ...native[key].split('/')));
    }
    let projectionScope = null;
    if (document.projection !== undefined) projectionScope = participant().validateHeader(document.projection);
    return {
      transient: { has: (absolute) => transient.has(absolute) || Boolean(projectionScope && projectionScope.transient.has(absolute)) },
      isOwned: (absolute) => (absolute !== destRoot && absolute.startsWith(destRoot + path.sep)) || Boolean(projectionScope && projectionScope.isOwned(absolute)),
    };
  }

  function readProjectionJournal() {
    const stat = lstatOrNull(JOURNAL_PATH);
    if (!stat) return null;
    if (stat.isSymbolicLink() || !stat.isFile()) throw new ValueError('Projection Journal .agents/.dhpk-projection-journal.json is not a regular file; manual recovery required');
    let document;
    try {
      document = JSON.parse(fs.readFileSync(JOURNAL_PATH, 'utf8'));
    } catch (error) {
      throw new ValueError(`Projection Journal .agents/.dhpk-projection-journal.json is unreadable: ${errorText(error)}`);
    }
    if (!isDict(document) || document.schema !== JOURNAL_SCHEMA) {
      throw new ValueError(`Projection Journal .agents/.dhpk-projection-journal.json has an unsupported schema (${isDict(document) ? pyStr(document.schema) : 'none'}); run the installer release that wrote it with --recover`);
    }
    return document;
  }

  function remainingPaths(document) {
    const paths = new Set();
    for (const record of document.effects || []) {
      if (record.state === 'undone' || !isDict(record.inverse)) continue;
      const args = record.inverse.args || {};
      for (const value of [...(Array.isArray(args.paths) ? args.paths : []), args.from, args.to, args.path]) if (isStr(value)) paths.add(value);
    }
    return pySorted(paths).join(', ') || 'none recorded';
  }

  projectionJournalBlockers = () => {
    let document;
    try {
      document = readProjectionJournal();
    } catch (error) {
      if (!isValueError(error)) throw error;
      return [`.agents/.dhpk-projection-journal.json: ${errorText(error)}`];
    }
    if (!document) return [];
    return [`.agents/.dhpk-projection-journal.json: interrupted ${pyStr(document.host)} transaction ${pyStr(document.run)} requires recovery`];
  };

  // Finish or undo the project's Projection Journal by its commit point. A
  // rollback that cannot complete keeps blocking ordinary runs (REQ-6).
  function recoverProjectionJournal() {
    const document = readProjectionJournal();
    if (!document) return;
    if (document.phase === 'rolling-back' && pyTruthy(document.rollbackIncomplete) && !RECOVER) {
      throw new ValueError(`transaction ${pyStr(document.run)} did not finish rolling back; paths recorded in its journal: ${remainingPaths(document)}; backups: ${DEST_REL}/${BACKUP_DIR}/${pyStr(document.run)}; fix the cause, then rerun this installer with --recover`);
    }
    journalCore.validateJournalRecords(document, { projectRoot: PROJECT_ROOT, scope: journalScope(document) });
    const options = {
      projectRoot: PROJECT_ROOT,
      journalPath: JOURNAL_PATH,
      onRolledBack: () => {
        if (document.projection !== undefined) participant().onRolledBack();
      },
    };
    const finishes = document.phase === 'published';
    try {
      journalCore.recoverJournal(document, options);
    } catch (error) {
      if (journalCore.isSimulatedCrash(error)) throw error;
      markRollbackIncomplete(document, error);
      throw new ValueError(`interrupted transaction ${pyStr(document.run)} requires manual recovery: ${errorText(error)}`);
    }
    // Hosts share one journal, so this run may have settled another Host's
    // transaction. Say so; a same-Host recovery stays as quiet as before.
    if (isStr(document.host) && document.host !== HARNESS_KIND) {
      const installer = (Object.prototype.hasOwnProperty.call(HOSTS, document.host) && HOSTS[document.host].installerName) || `the ${document.host} installer`;
      print(`[install-codex-skills] recovered interrupted ${document.host} transaction ${pyStr(document.run)}: ${finishes ? `finished; its changes are in place` : `rolled back; re-run ${installer} to apply it`}`);
    }
  }

  function markRollbackIncomplete(document, error) {
    if (!lexists(JOURNAL_PATH) || document.phase === 'published') return;
    try {
      const current = JSON.parse(fs.readFileSync(JOURNAL_PATH, 'utf8'));
      current.rollbackIncomplete = true;
      current.rollback_errors = [errorText(error)];
      new journalCore.ProjectionJournal({ projectRoot: PROJECT_ROOT, journalPath: JOURNAL_PATH, journal: current }).flush();
    } catch (_) {
      // the journal stays as it was; recovery reports it again
    }
  }

  // A publisher transaction journal no Host journal owns: --recover hands it
  // to the publisher, which finishes a v3 journal and blocks a held or older
  // one (UNSAFE_TRANSACTION), so "recovery complete" is never reported over it.
  function recoverPublisherJournal() {
    if (!RECOVER || !lexists(path.join(AGENTS_ROOT, '.dhpk-installed.transaction.json'))) return;
    try {
      publisherModule.recoverAgentsSkillsProjection({ projectRoot: PROJECT_ROOT });
    } catch (error) {
      throw new ValueError(`shared projection transaction recovery failed: ${errorText(error)}`);
    }
  }

  recoverStaleTransactions = () => {
    checkTransactionJournalMarkers();
    recoverPublisherJournal();
    recoverProjectionJournal();
  };

  function beginTransaction() {
    TX = journalCore.ProjectionJournal.begin({
      projectRoot: PROJECT_ROOT,
      journalPath: JOURNAL_PATH,
      afterStep: io.afterStep || null,
      onRolledBack: () => {
        if (TX && isDict(TX.journal.projection)) participant().onRolledBack();
      },
      journal: {
        schema: JOURNAL_SCHEMA,
        host: HARNESS_KIND,
        run: BACKUP_RUN,
        pid: process.pid,
        phase: 'publishing',
        native: { destRel: DEST_REL, stage: NATIVE_STAGE, tombstones: NATIVE_TOMBSTONES, backups: null },
      },
    });
  }

  function txRelative(absolute) {
    return journalCore.effectRelative(PROJECT_ROOT, absolute);
  }

  // open_relative_directory(create=True) inside the transaction: missing
  // components are recorded, then created with mode 0700.
  function txDirectory(relative) {
    const target = relative ? path.join(CODEX_ROOT, ...relative.split('/')) : CODEX_ROOT;
    if (TX && !lexists(target)) journalCore.recordParents(TX, path.join(target, '.x'), PROJECT_ROOT, 0o700);
    return openRelativeDirectory(relative, { create: true });
  }

  function txTransientDirectory(name) {
    const target = path.join(CODEX_ROOT, name);
    if (!lexists(target)) {
      txDirectory('');
      journalCore.recordTransientDirectory(TX, target);
    }
    return target;
  }

  function backupRunDirectory() {
    const relative = `${BACKUP_DIR}/${BACKUP_RUN}`;
    const target = path.join(CODEX_ROOT, BACKUP_DIR, BACKUP_RUN);
    if (!lexists(target)) {
      txDirectory(BACKUP_DIR);
      TX.journal.native.backups = relative;
      // Kept after the commit as receipt evidence; removed by a rollback.
      journalCore.recordTransientDirectory(TX, target);
      fs.chmodSync(target, 0o700 & ~process.umask());
    }
    return target;
  }

  // Detach an entry into the run's tombstones; it is deleted only after the
  // commit point, so a rollback can put it back.
  function detachEntry(parent, name) {
    const tombstones = txTransientDirectory(NATIVE_TOMBSTONES);
    const target = path.join(tombstones, uuidHex());
    journalCore.recordRename(TX, path.join(parent, name), target);
    return target;
  }

  // Remove one receipt-relative entry (detach now, delete after commit).
  function removeRelativePath(relative, expectedFingerprint = null) {
    safeDestination(relative);
    const index = relative.lastIndexOf('/');
    const parent = openRelativeDirectory(index < 0 ? '' : relative.slice(0, index));
    const name = relative.slice(index + 1);
    if (!fdEntryExists(parent, name)) return;
    if (expectedFingerprint !== null && fingerprintFdEntry(parent, name) !== expectedFingerprint) throw new ValueError(`destination changed before removal: ${relative}`);
    const detached = detachEntry(parent, name);
    if (expectedFingerprint !== null && fingerprintFdEntry(path.dirname(detached), path.basename(detached)) !== expectedFingerprint) {
      journalCore.recordRename(TX, detached, path.join(parent, name));
      throw new ValueError(`destination changed during removal: ${relative}`);
    }
  }

  // Copy a proven managed target into the run's rollback-addressable backups.
  function backupDestination(relative, destination, reason) {
    safeDestination(relative);
    const index = relative.lastIndexOf('/');
    const sourceParent = openRelativeDirectory(index < 0 ? '' : relative.slice(0, index));
    const name = relative.slice(index + 1);
    if (!fdEntryExists(sourceParent, name)) return null;
    backupRunDirectory();
    const backupRelative = `${BACKUP_DIR}/${BACKUP_RUN}/${relative}`;
    const backupIndex = backupRelative.lastIndexOf('/');
    const backupParent = openRelativeDirectory(backupRelative.slice(0, backupIndex), { create: true });
    const backupName = backupRelative.slice(backupIndex + 1);
    if (fdEntryExists(backupParent, backupName)) throw new ValueError(`rollback backup already exists: ${relative}`);
    copyFdEntry(sourceParent, name, backupParent, backupName);
    fsyncFdEntry(backupParent, backupName);
    const originalFingerprint = fingerprintFdEntry(sourceParent, name);
    const publicBackup = `${DEST_REL}/${backupRelative}`;
    backupRecords.push({ path: publicBackup, original: relative, reason, fingerprint: originalFingerprint });
    recordPath('backed_up', relative);
    return publicBackup;
  }

  // Build the new projection in the run's stage, verify it, and publish it
  // with one recorded rename; an existing destination is detached first.
  function installDescriptorSafe(source, destination, replaceExisting = true) {
    const relative = path.relative(CODEX_ROOT, destination).split(path.sep).join('/');
    safeDestination(relative);
    validateSourceTree(source, 'install source', [PLUGIN_ROOT, INSTALLER_ROOT]);
    const sourceFp = fingerprintSource(source);
    const index = relative.lastIndexOf('/');
    const parentRelative = index < 0 ? '' : relative.slice(0, index);
    const name = relative.slice(index + 1);
    const stageRoot = txTransientDirectory(NATIVE_STAGE);
    const stage = path.join(stageRoot, uuidHex());
    fs.mkdirSync(stage, { mode: 0o700 });
    if (effectiveMaterializationMode(relative) === 'symlink') fs.symlinkSync(source, path.join(stage, name), isDirFollow(source) ? 'dir' : 'file');
    else copySourceIntoStage(source, name, stage, relative);
    fsyncFdEntry(stage, name);
    if (fingerprintSource(source) !== sourceFp) throw new ValueError(`install source changed during materialization: ${relative}; run a fresh update`);
    const expectedProjection = fingerprintFdEntry(stage, name, false);
    if (!verifyStagedMaterialization(source, relative, stage, name, sourceFp, expectedProjection)) throw new ValueError(`install materialization changed: ${relative}; run a fresh update`);
    const parent = txDirectory(parentRelative);
    if (fdEntryExists(parent, name)) {
      if (!replaceExisting) throw new ValueError(`install destination already exists: ${relative}`);
      detachEntry(parent, name);
    }
    journalCore.recordRename(TX, path.join(stage, name), path.join(parent, name));
    let publishedMatches = false;
    try {
      publishedMatches = verifyStagedMaterialization(source, relative, parent, name, sourceFp, expectedProjection);
    } catch (error) {
      if (!isOSOrValueError(error)) throw error;
    }
    let sourceMatches = false;
    try {
      sourceMatches = fingerprintSource(source) === sourceFp;
    } catch (error) {
      if (!isOSOrValueError(error)) throw error;
    }
    if (!publishedMatches || !sourceMatches) throw new ValueError(`install ${publishedMatches ? 'source' : 'published materialization'} changed: ${relative}; run a fresh update`);
  }

  function install(source, destination) {
    installDescriptorSafe(source, destination, true);
  }

  function installAtomic(source, destination) {
    installDescriptorSafe(source, destination, false);
  }

  // Publish one adoption: back up and quarantine the original, stage and
  // publish the replacement; the quarantine is deleted after the commit.
  function adoptMaterialized(source, destination, relative, expectedSource, expectedDestination) {
    const index = relative.lastIndexOf('/');
    const parentRelative = index < 0 ? '' : relative.slice(0, index);
    const name = relative.slice(index + 1);
    const parent = openRelativeDirectory(parentRelative);
    backupRunDirectory();
    const backupRelative = `${BACKUP_DIR}/${BACKUP_RUN}/${relative}`;
    const backupIndex = backupRelative.lastIndexOf('/');
    const backupParent = openRelativeDirectory(backupRelative.slice(0, backupIndex), { create: true });
    const backupName = backupRelative.slice(backupIndex + 1);
    if (!fdEntryExists(parent, name)) throw new ValueError(`adoption target disappeared: ${relative}; run a fresh plan`);
    if (fdEntryExists(backupParent, backupName)) throw new ValueError(`adoption backup already exists: ${relative}; retry with a fresh plan`);
    copyFdEntry(parent, name, backupParent, backupName);
    const actual = fingerprintFdEntry(backupParent, backupName);
    if (actual !== expectedDestination) {
      removeFdEntry(backupParent, backupName);
      throw new ValueError(`adoption preflight changed: ${relative}; run a fresh plan`);
    }
    fsyncFdEntry(backupParent, backupName);
    const publicBackup = `${DEST_REL}/${backupRelative}`;
    backupRecords.push({ path: publicBackup, original: relative, reason: 'explicit-adoption', fingerprint: actual });
    recordPath('backed_up', relative);
    const quarantine = detachEntry(parent, name);
    if (fingerprintFdEntry(path.dirname(quarantine), path.basename(quarantine)) !== expectedDestination) throw new ValueError(`adoption preflight changed: ${relative}; run a fresh plan`);
    if (fingerprintSource(source) !== expectedSource) throw new ValueError(`adoption source changed: ${relative}; run a fresh plan`);
    const stageRoot = txTransientDirectory(NATIVE_STAGE);
    const stage = path.join(stageRoot, uuidHex());
    fs.mkdirSync(stage, { mode: 0o700 });
    if (effectiveMaterializationMode(relative) === 'symlink') fs.symlinkSync(source, path.join(stage, name), isDirFollow(source) ? 'dir' : 'file');
    else copySourceIntoStage(source, name, stage, relative);
    fsyncFdEntry(stage, name);
    const expectedProjection = fingerprintFdEntry(stage, name, false);
    if (!verifyStagedMaterialization(source, relative, stage, name, expectedSource, expectedProjection)) throw new ValueError(`adoption materialization changed: ${relative}; run a fresh plan`);
    if (fingerprintSource(source) !== expectedSource) throw new ValueError(`adoption source changed: ${relative}; run a fresh plan`);
    if (fdEntryExists(parent, name)) throw new ValueError(`adoption target reappeared: ${relative}; run a fresh plan`);
    journalCore.recordRename(TX, path.join(stage, name), path.join(parent, name));
    let publishedMatches = false;
    try {
      publishedMatches = verifyStagedMaterialization(source, relative, parent, name, expectedSource, expectedProjection);
    } catch (error) {
      if (!isOSOrValueError(error)) throw error;
    }
    let sourceMatches = false;
    try {
      sourceMatches = fingerprintSource(source) === expectedSource;
    } catch (error) {
      if (!isOSOrValueError(error)) throw error;
    }
    if (!publishedMatches || !sourceMatches) throw new ValueError(`adoption ${publishedMatches ? 'source' : 'published materialization'} changed: ${relative}; run a fresh plan`);
    return publicBackup;
  }

  // Quarantine the receipt into the run's backups (kept as evidence).
  function archiveReceiptForUninstall(expectedFingerprint = null) {
    ensureManifestSafe();
    const root = openRelativeDirectory('', { create: false });
    const receiptName = path.basename(MANIFEST);
    if (!fdEntryExists(root, receiptName)) return null;
    backupRunDirectory();
    const backupRelative = `${BACKUP_DIR}/${BACKUP_RUN}/receipt.json`;
    if (lexists(path.join(CODEX_ROOT, ...backupRelative.split('/')))) throw new ValueError('uninstall receipt backup already exists; retry with a fresh transaction');
    if (expectedFingerprint !== null && fingerprintFdEntry(root, receiptName) !== expectedFingerprint) throw new ValueError('uninstall receipt changed before quarantine');
    journalCore.recordRename(TX, MANIFEST, path.join(CODEX_ROOT, ...backupRelative.split('/')));
    const publicBackup = `${DEST_REL}/${backupRelative}`;
    backupRecords.push({ path: publicBackup, original: `${DEST_REL}/.dhpk-installed.json`, reason: 'uninstall-receipt' });
    return publicBackup;
  }

  // Write the receipt as a recorded effect; the previous one is detached first.
  function saveReceipt(pluginVersion, fingerprint, entries, orphaned, counts, { legacyPending = false, state = null } = {}) {
    ensureManifestSafe();
    const receipt = receiptDocument(pluginVersion, fingerprint, entries, orphaned, counts, { legacyPending, state, transactionId: BACKUP_RUN, transactionFinal: true });
    const text = receiptText(receipt);
    const root = txDirectory('');
    if (fdEntryExists(root, path.basename(MANIFEST))) detachEntry(root, path.basename(MANIFEST));
    const relative = txRelative(MANIFEST);
    const digest = sha256(Buffer.from(text, 'utf8'));
    TX.effect('write-file', { path: relative, digest }, { kind: 'remove', args: { paths: [relative], mode: 'file', digest } }, () => {
      const descriptor = fs.openSync(MANIFEST, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | O_NOFOLLOW, 0o600);
      try {
        fs.writeSync(descriptor, text);
        fs.fsyncSync(descriptor);
      } finally {
        fs.closeSync(descriptor);
      }
    });
    return receipt;
  }

  // The single commit point, then the cleanup that follows it.
  function commitTransaction() {
    const cleanups = [];
    const native = [NATIVE_STAGE, NATIVE_TOMBSTONES].map((name) => path.join(CODEX_ROOT, name)).filter((target) => lexists(target)).map(txRelative);
    if (native.length) cleanups.push({ kind: 'remove', args: { paths: native, mode: 'tree' } });
    const projection = TX.journal.projection;
    if (isDict(projection) && Array.isArray(projection.cleanups)) cleanups.push(...projection.cleanups);
    TX.publish(cleanups);
    TX.finish();
    TX = null;
  }

  // Receipt publication plus commit; a failure before the commit rolls back.
  function saveReceiptAndCommit(pluginVersion, fingerprint, entries, orphaned, counts, options = {}) {
    try {
      const receipt = saveReceipt(pluginVersion, fingerprint, entries, orphaned, counts, options);
      commitTransaction();
      return receipt;
    } catch (error) {
      if (journalCore.isSimulatedCrash(error)) throw error;
      if (TX && !TX.committed) rollbackPending();
      throw error;
    }
  }

  function rollbackPending() {
    if (!TX || TX.committed) return [];
    const errors = [];
    try {
      TX.rollBack();
    } catch (error) {
      if (journalCore.isSimulatedCrash(error)) throw error;
      errors.push(errorText(error));
      markRollbackIncomplete(TX.journal, error);
    }
    TX = null;
    if (errors.length) printErr(`[install-codex-skills] ERROR: rollback incomplete: ${errors.join('; ')}`);
    return errors;
  }

  // Roll back the open transaction, report, then exit 2.
  function failOpenTransaction(error) {
    rollbackPending();
    printErr(`[install-codex-skills] ERROR: ${error instanceof Error ? errorText(error) : String(error)}`);
    exit(2);
  }

  // ---------------------------------------------------------------------
  // Shared projection writes (in-process; recorded into the same journal)

  function sharedFailure(error, fallback) {
    const detail = error && error.message ? `FAIL [install-native-shared-skills]: ${error.message}` : '';
    return new ValueError(detail || fallback);
  }

  function installSharedProjection(selected = null) {
    const host = sharedProjectionHost();
    if (!host) throw new ValueError('shared projection install requires a cursor or codex Host');
    const ids = selected === null ? (SELECTION_EMITTED_IDS || []).slice() : selected.slice();
    if (ids.length === 0) throw new ValueError(`${SURFACE_LABEL} native-link install has an empty declared skill set`);
    const evidenceKey = consumerEvidenceEnvKey();
    try {
      nativeSharedSkillInstall.installNativeSharedSkills({
        sourceRoot: PLUGIN_ROOT,
        projectRoot: PROJECT_ROOT,
        host,
        selectedStableIds: ids,
        declaredSelection: true,
        update: UPDATE,
        consumerEvidencePath: (evidenceKey && env[evidenceKey]) || null,
        env,
        journal: TX,
      });
    } catch (error) {
      if (journalCore.isSimulatedCrash(error) || isExit(error)) throw error;
      throw sharedFailure(error, `${SURFACE_LABEL} shared projection install failed`);
    }
  }

  function maybeInstallSharedProjection(adopted = null) {
    if (UNINSTALL || !sharedProjectionAvailable()) return;
    if (relocatableProjectOverlapsSource()) {
      noteSharedProjectionSkip('install');
      return;
    }
    if (receiptOwnedNativeDeclaredDestsBlockSharedProjection()) return;
    const selected = selectedSharedProjectionIds(adopted);
    if (selected.length === 0) return;
    installSharedProjection(selected);
  }

  function unlinkNativeLinks() {
    const host = sharedProjectionHost();
    if (!host) return;
    ensureCodexRootSafe();
    const receiptPath = path.join(PROJECT_ROOT, '.agents', '.dhpk-installed.json');
    if (!isFileFollow(receiptPath)) return;
    let projection;
    try {
      projection = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    } catch (_) {
      return;
    }
    const bindingPaths = isDict(projection) && isDict(projection.bindingPaths) ? projection.bindingPaths : {};
    const bindings = bindingPaths[host] || [];
    if (!Array.isArray(bindings)) return;
    const skillName = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
    const destPrefix = `${DEST_REL}/skills/`;
    for (const entry of bindings) {
      if (!isDict(entry)) continue;
      const relative = entry.path;
      const target = entry.target;
      if (!isStr(relative) || !isStr(target)) continue;
      const name = relative.split('/').pop();
      if (relative !== `${destPrefix}${name}` || !skillName.test(name)) continue;
      const expectedTarget = `../../.agents/skills/${name}`;
      if (target !== expectedTarget) continue;
      const destRel = `skills/${name}`;
      try {
        const destination = safeDestination(destRel);
        if (!isLink(destination) || fs.readlinkSync(destination) !== expectedTarget) continue;
        removeRelativePath(destRel);
      } catch (error) {
        if (!isOSOrValueError(error)) throw error;
      }
    }
  }

  function uninstallSharedProjection() {
    if (relocatableProjectOverlapsSource() && sharedProjectionAvailable()) {
      noteSharedProjectionSkip('uninstall');
      unlinkNativeLinks();
      return;
    }
    if (!sharedProjectionAvailable()) {
      unlinkNativeLinks();
      return;
    }
    const host = sharedProjectionHost();
    if (!host) return;
    let result;
    try {
      result = nativeSharedSkillInstall.uninstallNativeSharedSkills({ sourceRoot: PLUGIN_ROOT, projectRoot: PROJECT_ROOT, host, journal: TX });
    } catch (error) {
      if (journalCore.isSimulatedCrash(error) || isExit(error)) throw error;
      throw sharedFailure(error, `${SURFACE_LABEL} shared projection uninstall failed`);
    }
    if (result && result.ok === false) {
      const detail = result.error && result.error.message ? result.error.message : (result.state || 'uninstall blocked');
      throw new ValueError(`FAIL [install-native-shared-skills]: ${detail}`);
    }
  }

  // Remove adopted leftover native copies so Host Bindings can replace them.
  function handoverAdoptedLegacyNativeSkills(adopted, counts) {
    if (!pyTruthy(adopted)) return;
    for (const item of classifyLegacyNativeDeclaredSkills()) {
      if (item.handling !== 'keep-modified' || !Object.prototype.hasOwnProperty.call(adopted, item.path)) continue;
      const relative = item.path;
      const destination = targetFor(relative);
      if (safeDestinationFingerprint(destination) !== item.destination_fingerprint || item.source_fingerprint !== adopted[relative]) {
        throw new ValueError(`adoption preflight changed: ${relative}; run a fresh plan`);
      }
      const backup = backupDestination(relative, destination, 'adopt-legacy-native');
      if (backup) counts.backed_up += 1;
      removeRelativePath(relative, item.destination_fingerprint);
      if (isDict(RUN_ENTRIES.skills)) delete RUN_ENTRIES.skills[item.name];
      delete RUN_ORPHANED[relative];
      counts.adopted += 1;
      recordPath('adopted', relative);
      recordOwnership(relative, 'dhpk-managed');
    }
  }


  // ---------------------------------------------------------------------
  // Reconciliation (lines 5285-5781 of the Python)

  // Uninstall over a receipt this installer cannot interpret: release every
  // entry, quarantine the receipt, touch no destination, exit 0.
  releaseUnmarkedReceiptForUninstall = (receipt) => {
    const released = [];
    const managed = receipt.managed_entries;
    for (const [kind, values] of Object.entries(isDict(managed) ? managed : {})) {
      for (const [name, entry] of Object.entries(isDict(values) ? values : {})) {
        const fallback = `${kind}/${name}`;
        released.push(isDict(entry) ? (entry.destination || entry.source || fallback) : fallback);
      }
    }
    const orphanedRecords = receipt.orphaned_entries;
    if (isDict(orphanedRecords)) released.push(...Object.keys(orphanedRecords));
    try {
      const root = openRelativeDirectory('', { create: false });
      const receiptFingerprint = fingerprintFdEntry(root, path.basename(MANIFEST));
      if (pyJsonDumps(pyJsonLoads(fs.readFileSync(MANIFEST, 'utf8')), { sortKeys: true }) !== pyJsonDumps(receipt, { sortKeys: true })) {
        throw new ValueError('uninstall receipt changed before transaction');
      }
      beginTransaction();
      archiveReceiptForUninstall(receiptFingerprint);
      commitTransaction();
    } catch (error) {
      if (!isOSOrValueError(error)) throw error;
      failOpenTransaction(`uninstall receipt quarantine failed: ${errorText(error)}`);
    }
    for (const relative of pySorted(new Set(released))) print(`[install-codex-skills] released: ${relative} (removed from the receipt; its files stay in place)`);
    print('[install-codex-skills] receipt removed; no destination file was deleted');
    exit(0);
  };

  // Adopt receipt-owned legacy skill destinations under their public names;
  // every unproven shape is kept as an orphan or conflict.
  function migrateLegacySkillNames(run) {
    const { entries, orphaned, counts, collisions, sources, skillMetadata: metadata } = run;
    const legacyToPublic = {};
    const ambiguous = new Set();
    for (const [publicName, skill] of Object.entries(metadata)) {
      for (const legacyName of skill.legacy_names || []) {
        if (legacyName === publicName) continue;
        const prior = legacyToPublic[legacyName];
        if (prior && prior !== publicName) ambiguous.add(legacyName);
        else legacyToPublic[legacyName] = publicName;
      }
    }
    const receiptMatches = (legacyName) => {
      const relative = `skills/${legacyName}`;
      return Object.entries(entries.skills).filter(([key, value]) => key === legacyName || (isDict(value) && (value.destination === relative || value.source === relative)));
    };
    const conflict = (key, old, relative, reason) => {
      const preserved = isDict(old) ? { ...old } : { destination: relative, source: relative };
      preserved.orphaned = true;
      entries.skills[key] = preserved;
      orphaned[relative] = { ...preserved, reason };
      if (!collisions.includes(relative)) collisions.push(relative);
      counts.skipped_collision += 1;
      counts.preserved += 1;
      counts.orphaned += 1;
      recordPath('collisions', relative);
      recordPath('orphaned', relative);
      recordOwnership(relative, 'unowned-collision');
      print(`[install-codex-skills] legacy conflict preserved: ${relative} (${reason})`);
    };
    for (const legacyName of pySorted(Object.keys(legacyToPublic))) {
      const publicName = legacyToPublic[legacyName];
      const relative = `skills/${legacyName}`;
      const matches = receiptMatches(legacyName);
      if (matches.length === 0) {
        let legacyDestination = null;
        try {
          legacyDestination = targetFor(relative);
        } catch (error) {
          if (!isValueError(error)) throw error;
        }
        if (legacyDestination !== null && lexists(legacyDestination)) {
          if (!collisions.includes(relative)) collisions.push(relative);
          counts.skipped_collision += 1;
          counts.preserved += 1;
          recordPath('collisions', relative);
          recordOwnership(relative, 'unowned-collision');
          print(`[install-codex-skills] legacy conflict preserved: ${relative} (destination is unowned or has no receipt ownership)`);
        }
        continue;
      }
      if (ambiguous.has(legacyName) || matches.length !== 1) {
        for (const [key, old] of matches) conflict(key, old, relative, 'ambiguous legacy inventory mapping');
        continue;
      }
      const [key, old] = matches[0];
      try {
        const oldDestination = receiptDestination('skills', key, old);
        const newRelative = `skills/${publicName}`;
        const newDestination = targetFor(newRelative);
        const source = Object.prototype.hasOwnProperty.call(sources.skills, publicName) ? sources.skills[publicName][0] : null;
        if (source === null || !lexists(source)) {
          conflict(key, old, relative, 'current public skill source is missing');
          continue;
        }
        if (!lexists(oldDestination)) {
          conflict(key, old, relative, 'legacy destination is missing');
          continue;
        }
        if (!isOwned(old, oldDestination)) {
          conflict(key, old, relative, 'legacy destination is edited, unowned, or retargeted');
          continue;
        }
        const currentEntry = entries.skills[publicName];
        if (lexists(newDestination)) {
          if (!(isDict(currentEntry) && isOwned(currentEntry, newDestination))) {
            conflict(key, old, relative, `current public destination already exists: ${newRelative}`);
            continue;
          }
          if (backupDestination(relative, oldDestination, 'legacy-migration')) counts.backed_up += 1;
          removeRelativePath(relative, recordedCopyFingerprint(old));
        } else {
          if (backupDestination(relative, oldDestination, 'legacy-migration')) counts.backed_up += 1;
          // Publish the new destination first; only then remove the legacy path.
          installAtomic(source, newDestination);
          removeRelativePath(relative, recordedCopyFingerprint(old));
        }
        if (key !== publicName) delete entries.skills[key];
        entries.skills[publicName] = makeEntry(source, newRelative, newDestination, metadata[publicName]);
        clearOrphaned(run, relative, newRelative);
        counts.migrated += 1;
        recordPath('migrated', relative);
        recordPath('migrated', newRelative);
        recordOwnership(newRelative, 'dhpk-managed');
      } catch (error) {
        if (!isValueError(error)) throw error;
        conflict(key, old, relative, errorText(error));
      }
    }
  }

  function clearOrphaned(run, ...relatives) {
    for (const relative of relatives) if (isStr(relative) && relative) delete run.orphaned[relative];
  }

  function entryRelative(kind, name, old) {
    const relative = isDict(old) ? (old.destination || old.source) : `${kind}/${name}`;
    return relative || `${kind}/${name}`;
  }

  // Protect a failure that the Python turned into fail_open_transaction.
  function guarded(action, message = null) {
    try {
      return action();
    } catch (error) {
      rethrowExit(error);
      if (journalCore.isSimulatedCrash(error)) throw error;
      if (message === null && !isValueError(error)) throw error;
      failOpenTransaction(message === null ? error : `${message}: ${errorText(error)}`);
    }
    return undefined;
  }

  function uninstallRun(run) {
    const { entries, orphaned, counts, collisions, receipt, pluginVersion, fingerprint, legacyPending } = run;
    guarded(() => {
      ensureCodexRootSafe();
      if (sharedProjectionHost()) uninstallSharedProjection();
    });
    if (!MANAGED_KINDS.some((kind) => Object.keys(entries[kind]).length) && Object.keys(orphaned).length === 0) {
      guarded(() => {
        archiveReceiptForUninstall();
        commitTransaction();
      }, 'uninstall receipt quarantine failed');
      print('[install-codex-skills] no managed receipt entries to uninstall');
      exit(0);
    }
    const remaining = Object.fromEntries(MANAGED_KINDS.map((kind) => [kind, {}]));
    const managedRelatives = new Set();
    guarded(() => {
      for (const kind of MANAGED_KINDS) {
        for (const [name, old] of Object.entries(entries[kind])) {
          const relative = entryRelative(kind, name, old);
          managedRelatives.add(relative);
          let destination;
          let missing;
          try {
            destination = receiptDestination(kind, name, old);
            missing = receiptPathMissing(relative);
          } catch (error) {
            if (!isOSOrValueError(error)) throw error;
            remaining[kind][name] = isDict(old) ? { ...old, orphaned: true } : { destination: relative, orphaned: true };
            orphaned[relative] = { ...remaining[kind][name], reason: 'unsafe-receipt-path' };
            counts.orphaned += 1;
            print(`[install-codex-skills] orphaned preserved: ${relative} (${errorText(error)})`);
            continue;
          }
          if (missing) {
            clearOrphaned(run, relative);
            counts.retired += 1;
            recordPath('retired', relative);
            recordOwnership(relative, 'missing');
            continue;
          }
          if (isOwned(old, destination)) {
            if (backupDestination(relative, destination, 'uninstall')) counts.backed_up += 1;
            removeRelativePath(relative, recordedCopyFingerprint(old));
            clearOrphaned(run, relative);
            counts.pruned += 1;
            counts.retired += 1;
            recordPath('retired', relative);
            recordOwnership(relative, 'dhpk-managed');
          } else {
            remaining[kind][name] = { ...old, orphaned: true };
            orphaned[relative] = { ...old, reason: 'modified-before-uninstall' };
            counts.orphaned += 1;
            recordPath('orphaned', relative);
            recordOwnership(relative, 'orphaned');
          }
        }
      }
      for (const [relative, old] of Object.entries({ ...orphaned })) {
        if (managedRelatives.has(relative)) continue;
        if (!isDict(old) || (old.destination || old.source) !== relative || ![undefined, null, relative].includes(old.source)) continue;
        let missing;
        try {
          missing = receiptPathMissing(relative);
        } catch (error) {
          if (!isOSOrValueError(error)) throw error;
          print(`[install-codex-skills] orphaned preserved: ${relative} (${errorText(error)})`);
          continue;
        }
        if (missing) {
          clearOrphaned(run, relative);
          counts.retired += 1;
          recordPath('retired', relative);
          recordOwnership(relative, 'missing');
        }
      }
      if (Object.keys(orphaned).length === 0 && !Object.values(remaining).some((values) => Object.keys(values).length)) {
        archiveReceiptForUninstall();
        commitTransaction();
      } else {
        const verifiedRetiredResidue = receiptHasRetiredProfile(receipt) && isOrphanOnlyProjection(remaining, orphaned);
        saveReceiptAndCommit(pluginVersion, fingerprint, remaining, orphaned, counts, {
          legacyPending: verifiedRetiredResidue ? false : legacyPending,
          state: verifiedRetiredResidue ? 'partial' : null,
        });
      }
    }, 'uninstall failed; removed entries restored where possible');
    printSummary(counts, collisions, pySorted(Object.keys(orphaned)));
    exit(0);
  }

  // `always`: the Python appended to collisions without a membership check.
  function orphanCollision(run, relative, entry, ownership, { preserved = true, message = null, always = false } = {}) {
    const { orphaned, counts, collisions } = run;
    orphaned[relative] = entry;
    counts.orphaned += 1;
    if (preserved) counts.preserved += 1;
    counts.skipped_collision += 1;
    if (always || !collisions.includes(relative)) collisions.push(relative);
    recordPath('collisions', relative);
    recordPath('orphaned', relative);
    recordOwnership(relative, ownership);
    if (message) print(message);
  }

  // Reconcile entries removed from the source (explicit --update only).
  function pruneRemovedSources(run) {
    const { entries, orphaned, counts, collisions, sources, skillRetirements } = run;
    for (const kind of MANAGED_KINDS) {
      if (ADOPT_PATHS.length && !skipNativeSkillKind(kind)) continue;
      for (const name of Object.keys(entries[kind])) {
        if (Object.prototype.hasOwnProperty.call(sources[kind], name)) continue;
        const old = entries[kind][name];
        const relative = entryRelative(kind, name, old);
        const retirement = retirementForEntry(skillRetirements, kind, name, old, relative);
        let destination;
        try {
          destination = receiptDestination(kind, name, old);
        } catch (error) {
          if (!isValueError(error)) throw error;
          entries[kind][name] = isDict(old) ? { ...old, orphaned: true } : { destination: relative, orphaned: true };
          const orphanedEntry = { ...entries[kind][name], reason: 'unsafe-receipt-path' };
          if (retirement) orphanedEntry.retirement = { ...retirement };
          orphanCollision(run, relative, orphanedEntry, 'unsafe-receipt-path', { message: `[install-codex-skills] orphaned preserved: ${relative} (${errorText(error)})` });
          continue;
        }
        if (!lexists(destination)) {
          if (retirement) {
            entries[kind][name] = { ...old, orphaned: true };
            const orphanedEntry = { ...old, reason: 'retired-destination-missing', retirement: { ...retirement } };
            orphanCollision(run, relative, orphanedEntry, 'missing');
          } else {
            delete entries[kind][name];
            clearOrphaned(run, relative);
          }
        } else if (isOwned(old, destination)) {
          if (backupDestination(relative, destination, 'retired-entry')) counts.backed_up += 1;
          removeRelativePath(relative, recordedCopyFingerprint(old));
          delete entries[kind][name];
          counts.pruned += 1;
          counts.retired += 1;
          recordPath('retired', relative);
          recordOwnership(relative, 'dhpk-managed');
        } else {
          entries[kind][name] = { ...old, orphaned: true };
          let keepModifiedLegacy = skipNativeSkillKind(kind) && declaredSkillPublicNames().includes(name);
          const orphanedEntry = { ...old, reason: keepModifiedLegacy ? 'keep-modified-legacy-native' : 'modified-removed-source' };
          if (retirement) {
            orphanedEntry.reason = 'retired-entry-modified-or-retargeted';
            orphanedEntry.retirement = { ...retirement };
            keepModifiedLegacy = false;
          }
          orphaned[relative] = orphanedEntry;
          counts.orphaned += 1;
          counts.preserved += 1;
          recordPath('orphaned', relative);
          if (keepModifiedLegacy) recordOwnership(relative, 'keep-modified');
          else {
            counts.skipped_collision += 1;
            if (!collisions.includes(relative)) collisions.push(relative);
            recordPath('collisions', relative);
            recordOwnership(relative, retirement ? 'retired-orphaned' : 'orphaned');
          }
        }
      }
    }
  }

  // Preserve retired destinations present on disk without a receipt entry:
  // the ledger is guidance, never a deletion authority.
  function preserveUnownedRetirements(run) {
    const { entries, skillRetirements } = run;
    const represented = new Set();
    for (const kind of MANAGED_KINDS) {
      for (const [name, old] of Object.entries(entries[kind])) {
        const relative = isDict(old) ? (old.destination || old.source) : '';
        const retirement = retirementForEntry(skillRetirements, kind, name, old, relative);
        if (retirement) represented.add(retirement.canonicalPath);
      }
    }
    for (const retirement of uniqueRetirementRows(skillRetirements)) {
      const relative = retirement.canonicalPath;
      if (!isStr(relative) || represented.has(relative)) continue;
      let destination;
      try {
        destination = targetFor(relative);
      } catch (error) {
        if (!isValueError(error)) throw error;
        const entry = { destination: relative, source: relative, reason: 'unsafe-retirement-path', retirement: { ...retirement }, orphaned: true };
        orphanCollision(run, relative, entry, 'unsafe-retirement-path', { always: true, message: `[install-codex-skills] orphaned preserved: ${relative} (${errorText(error)})` });
        continue;
      }
      if (!lexists(destination)) continue;
      const entry = {
        destination: relative,
        source: relative,
        reason: 'retired-destination-unowned',
        destination_fingerprint: safeDestinationFingerprint(destination),
        retirement: { ...retirement },
        orphaned: true,
      };
      orphanCollision(run, relative, entry, 'unowned-collision', { always: true });
    }
  }

  // The per-source install loop (lines 5596-5747 of the Python).
  function installSources(run) {
    const { entries, counts, collisions, sources, skillMetadata, plan, adoptPaths, legacyPending } = run;
    const metadataFor = (kind, name) => (kind === 'skills' ? skillMetadata[name] || null : null);
    for (const kind of MANAGED_KINDS) {
      for (const [name, [source, relative]] of Object.entries(sources[kind])) {
        const destination = guarded(() => targetFor(relative));
        const old = Object.prototype.hasOwnProperty.call(entries[kind], name) ? entries[kind][name] : null;
        if (ADOPT_PATHS.length && !Object.prototype.hasOwnProperty.call(adoptPaths, relative)) {
          // An explicit adoption authorizes only the reported paths.
          if (!lexists(destination) || !isOwned(old, destination) || old.mode !== effectiveMaterializationMode(relative) || !exactSourceMatch(source, destination, relative, old)) {
            recordPath('deferred', relative);
            if (!collisions.includes(relative)) {
              collisions.push(relative);
              counts.skipped_collision += 1;
              counts.preserved += 1;
              recordPath('collisions', relative);
              recordOwnership(relative, 'deferred-adoption');
            }
          }
          continue;
        }
        if (lexists(destination)) {
          const owned = isOwned(old, destination);
          if (legacyPending && MIGRATE && matchesEffectiveMaterialization(relative, destination) && exactSourceMatch(source, destination, relative, old)) {
            entries[kind][name] = makeEntry(source, relative, destination, metadataFor(kind, name));
            counts.preserved += 1;
            clearOrphaned(run, relative);
            recordPath('migrated', relative);
            recordOwnership(relative, 'dhpk-managed');
            continue;
          }
          if (!owned) {
            if (Object.prototype.hasOwnProperty.call(adoptPaths, relative)) {
              const expected = (plan.collisions || []).find((item) => item.path === relative).destination_fingerprint;
              const expectedSource = adoptPaths[relative];
              if (safeDestinationFingerprint(destination) !== expected || fingerprintSource(source) !== expectedSource) {
                failOpenTransaction(`adoption preflight changed: ${relative}; run a fresh plan`);
              }
              counts.backed_up += 1;
              try {
                adoptMaterialized(source, destination, relative, expectedSource, expected);
              } catch (error) {
                rethrowExit(error);
                if (journalCore.isSimulatedCrash(error)) throw error;
                if (!isOSOrValueError(error)) throw error;
                failOpenTransaction(`adoption rolled back: ${errorText(error)}`);
              }
              entries[kind][name] = makeEntry(source, relative, destination, metadataFor(kind, name));
              clearOrphaned(run, relative);
              counts.adopted += 1;
              recordPath('adopted', relative);
              recordOwnership(relative, 'dhpk-managed');
              continue;
            }
            collisions.push(relative);
            counts.skipped_collision += 1;
            counts.preserved += 1;
            recordPath('collisions', relative);
            recordOwnership(relative, 'unowned-collision');
            continue;
          }
          if (pyTruthy(old.orphaned)) {
            collisions.push(relative);
            counts.skipped_collision += 1;
            counts.preserved += 1;
            recordPath('collisions', relative);
            recordOwnership(relative, 'orphaned');
            continue;
          }
          if (old.mode === effectiveMaterializationMode(relative) && exactSourceMatch(source, destination, relative, old)) {
            entries[kind][name] = makeEntry(source, relative, destination, metadataFor(kind, name));
            clearOrphaned(run, relative);
            recordOwnership(relative, 'dhpk-managed');
            continue;
          }
          if (backupDestination(relative, destination, 'updated-entry')) counts.backed_up += 1;
          else throw new OSError(`cannot create rollback backup for managed destination: ${relative}`);
          install(source, destination);
          entries[kind][name] = makeEntry(source, relative, destination, metadataFor(kind, name));
          clearOrphaned(run, relative);
          counts.updated += 1;
          recordPath('updated', relative);
          recordOwnership(relative, 'dhpk-managed');
        } else {
          install(source, destination);
          entries[kind][name] = makeEntry(source, relative, destination, metadataFor(kind, name));
          clearOrphaned(run, relative);
          counts.created += 1;
          recordPath('created', relative);
          recordOwnership(relative, 'dhpk-managed');
        }
      }
    }
  }

  reconcile = (run) => {
    const { classification, receipt, pluginVersion, fingerprint, legacy, releasedEntries, orphaned, counts, collisions, adoptPaths } = run;
    if (classification.requires_structural_migration && !MIGRATE && UNINSTALL === false) {
      printErr('[install-codex-skills] state=stale_receipt: explicit migration is required before changing this projection');
      for (const reason of classification.reasons || []) printErr(`[install-codex-skills] stale evidence: ${reason}`);
      printErr(`[install-codex-skills] ACTION REQUIRED: bash ${INSTALLER_SCRIPT} ${MODE === 'copy' ? '--copy ' : ''}--migrate --update --force`);
      exit(2);
    }
    const priorReconciliation = isDict(receipt) ? receipt.reconciliation : {};
    const hasPendingConflicts = Object.keys(orphaned).length > 0 || Boolean(isDict(priorReconciliation) && pyTruthy(priorReconciliation.skipped_collision));
    if (!UPDATE && !MIGRATE && !UNINSTALL && !legacy && !releasedEntries.length && !hasPendingConflicts && receipt.plugin_version === pluginVersion && receipt.source_fingerprint === fingerprint) {
      try {
        maybeInstallSharedProjection(adoptPaths);
      } catch (error) {
        if (!isValueError(error)) throw error;
        printErr(`[install-codex-skills] ERROR: ${errorText(error)}`);
        exit(2);
      }
      print(`[install-codex-skills] already up-to-date for dhpk v${pluginVersion}`);
      exit(0);
    }
    try {
      beginTransaction();
    } catch (error) {
      if (!isOSOrValueError(error)) throw error;
      printErr(`[install-codex-skills] ERROR: cannot start transaction journal: ${errorText(error)}`);
      exit(2);
    }
    if (UNINSTALL) uninstallRun(run);
    try {
      ensureCodexRootSafe();
    } catch (error) {
      if (!isValueError(error)) throw error;
      rollbackPending();
      printErr(`[install-codex-skills] ERROR: ${errorText(error)}`);
      exit(2);
    }
    try {
      for (const kind of pySorted(new Set([...SOURCE_KINDS, 'skills', 'agents']))) txDirectory(kind);
    } catch (error) {
      if (!isOSOrValueError(error)) throw error;
      rollbackPending();
      printErr(`[install-codex-skills] ERROR: ${errorText(error)}`);
      exit(2);
    }
    // Public-name migration runs before the update prune: an old receipt key
    // stays protected when the inventory cannot prove ownership.
    if ((UPDATE || MIGRATE) && !ADOPT_PATHS.length) migrateLegacySkillNames(run);
    if (UPDATE) pruneRemovedSources(run);
    if (UPDATE && !ADOPT_PATHS.length) preserveUnownedRetirements(run);
    if (sharedProjectionAvailable() && !UNINSTALL) {
      guarded(() => {
        handoverAdoptedLegacyNativeSkills(adoptPaths, counts);
        maybeInstallSharedProjection(adoptPaths);
      });
    }
    try {
      installSources(run);
    } catch (error) {
      rethrowExit(error);
      if (journalCore.isSimulatedCrash(error)) throw error;
      // The Python's excepthook rolled the transaction back, then crashed.
      rollbackPending();
      throw error;
    }
    let { legacyPending } = run;
    if (legacyPending && MIGRATE && collisions.length === 0) legacyPending = false;
    const reconciliationState = legacyPending ? 'stale' : ((collisions.length || Object.keys(orphaned).length || evidencePaths.deferred.length) ? 'partial' : 'current');
    guarded(() => saveReceiptAndCommit(pluginVersion, fingerprint, run.entries, orphaned, counts, { legacyPending, state: reconciliationState }),
      'reconciliation receipt update failed; retired entries restored where possible');
    counts.collided = counts.skipped_collision || 0;
    counts.backed_up = counts.backed_up || 0;
    printSummary(counts, collisions, pySorted(Object.keys(orphaned)));
    print(`[install-codex-skills] synced dhpk v${pluginVersion} ${SRC_REL}/ → project-local ${DEST_REL}/ (mode=${MODE})`);
    if (UPDATE && collisions.length && !ADOPT_PATHS.length) {
      printErr('[install-codex-skills] ACTION REQUIRED: review collision evidence, then re-run with --update --adopt=<reported-relative-path>@<destination-fingerprint>@<source-fingerprint>');
      exit(1);
    }
  };

  // ---------------------------------------------------------------------
  // Entry point: lines 5114-5781 of the Python, in order.

  function main() {
    PROVIDER_CHECK = probeCodexNativePlugin();
    if (PROVIDER_CHECK.status === 'ENABLED') {
      const receiptCheck = inspectReceiptForProviderBlock();
      const blockedReport = {
        schema_version: SCHEMA_VERSION,
        state: 'blocked',
        reasonCode: 'CODEX_NATIVE_PLUGIN_ENABLED',
        providerCheck: PROVIDER_CHECK,
        receiptCheck,
        receipt_state: 'blocked',
        next_action: `disable ${SURFACE_LABEL} plugin dhpk@dhpk, then re-run project-local sync`,
      };
      if (JSON_OUTPUT) printJsonReport(blockedReport);
      else {
        print(`[install-codex-skills] BLOCKED: native ${SURFACE_LABEL} plugin dhpk@dhpk is enabled`);
        print(`[install-codex-skills] ACTION REQUIRED: ${blockedReport.next_action}`);
      }
      exit(2);
    }
    if (PROVIDER_CHECK.status === 'UNAVAILABLE') {
      printErr(`[install-codex-skills] note: ${SURFACE_LABEL} provider check UNAVAILABLE; project-local sync will continue without native-plugin activation evidence.`);
    }

    // A historical receipt can be rejected before the lock or any recovery;
    // it is checked again after the lock is held.
    if (!PLAN && !UNINSTALL) {
      let earlyProfileBlock;
      try {
        ensureCodexRootSafe();
        const [earlyReceipt] = readReceipt();
        checkTransactionJournalMarkers();
        earlyProfileBlock = receiptProfileUpdateBlock(earlyReceipt);
      } catch (error) {
        if (!isOSOrValueError(error)) throw error;
        printErr(`[install-codex-skills] ERROR: ${errorText(error)}`);
        exit(2);
      }
      if (earlyProfileBlock) {
        printReceiptProfileUpdateBlock(earlyProfileBlock);
        exit(2);
      }
    } else if (UNINSTALL) {
      // A receipt naming an unknown fingerprint algorithm blocks before the
      // lock file is created or any recovery runs.
      try {
        ensureCodexRootSafe();
        readReceipt(true);
        checkTransactionJournalMarkers();
      } catch (error) {
        if (!isOSOrValueError(error)) throw error;
        printErr(`[install-codex-skills] ERROR: ${errorText(error)}`);
        exit(2);
      }
    }

    try {
      ensureCodexRootSafe();
      if (PLAN) {
        const planBlockers = inspectStaleTransactionsForPlan();
        if (planBlockers.length) {
          const blockedReport = {
            schema_version: SCHEMA_VERSION,
            state: 'blocked',
            receipt_state: 'blocked',
            next_action: 'resolve the blocking recovery items listed above, then re-run the plan',
            blocking_recovery: planBlockers,
          };
          if (JSON_OUTPUT) printJsonReport(blockedReport);
          else {
            print(`[install-codex-skills] BLOCKED: ${planBlockers.join('; ')}`);
            print(`[install-codex-skills] ACTION REQUIRED: ${blockedReport.next_action}`);
          }
          exit(2);
        }
      } else {
        acquireInstallLock();
        recoverStaleTransactions();
      }
    } catch (error) {
      if (!isOSOrValueError(error)) throw error;
      printErr(`[install-codex-skills] ERROR: transaction recovery failed: ${errorText(error)}`);
      exit(2);
    }
    if (RECOVER) {
      print('[install-codex-skills] recovery complete; no interrupted or incomplete transaction remains');
      exit(0);
    }

    const pluginVersion = readPluginVersion();
    let originalReceipt;
    let legacy;
    try {
      [originalReceipt, legacy] = readReceipt(UNINSTALL);
    } catch (error) {
      if (!isValueError(error)) throw error;
      printErr(`[install-codex-skills] ERROR: ${errorText(error)}`);
      exit(2);
    }
    if (UNINSTALL && !receiptHasTreeMarker(originalReceipt)) releaseUnmarkedReceiptForUninstall(originalReceipt, pluginVersion);
    const [receipt, releasedEntries] = releaseUnprovableEntries(originalReceipt);
    RUN_RECEIPT = receipt;
    let blockedProfileUpdate;
    try {
      blockedProfileUpdate = receiptProfileUpdateBlock(receipt);
    } catch (error) {
      if (!isValueError(error)) throw error;
      printErr(`[install-codex-skills] ERROR: ${errorText(error)}`);
      exit(2);
    }
    if (blockedProfileUpdate) {
      printReceiptProfileUpdateBlock(blockedProfileUpdate);
      exit(2);
    }
    let skillMetadata;
    let sources;
    let skillRetirements;
    try {
      skillMetadata = inventorySkillMetadata();
      resolveInstallerSelection(receipt, skillMetadata);
      if (sharedProjectionAvailable() && !UNINSTALL) applyDeclaredProjectionSelection();
      sources = currentSources();
      skillRetirements = inventoryRetirementMetadata(skillMetadata);
      validateSkillMetadata(sources, skillMetadata);
    } catch (error) {
      if (!isValueError(error)) throw error;
      printErr(`[install-codex-skills] ERROR: ${errorText(error)}`);
      exit(2);
    }
    const fingerprint = sourceFingerprint();

    if (ADOPT_PATHS.length) {
      const recordedMode = isDict(receipt) ? receipt.mode : null;
      if (!['symlink', 'copy'].includes(recordedMode)) {
        printErr('[install-codex-skills] ERROR: --adopt requires a schema-v3 receipt with a recorded projection mode');
        exit(2);
      }
      if (MODE_EXPLICIT && MODE !== recordedMode) {
        printErr(`[install-codex-skills] ERROR: --adopt mode mismatch: receipt uses ${recordedMode}, requested ${MODE}; omit --copy or use the recorded mode`);
        exit(2);
      }
      // A path-scoped adoption must not switch the projection mode of
      // unrelated managed entries.
      if (!MODE_EXPLICIT) MODE = recordedMode;
    }

    const classification = classifyReceipt(receipt, legacy, sources, skillMetadata, pluginVersion, fingerprint);
    if (releasedEntries.length) {
      classification.requires_migration = true;
      classification.released = releasedEntries;
      classification.reasons = [...(classification.reasons || []),
        `receipt entries without a provable tree-merkle-v1 value are released: ${releasedEntries.map((item) => item.path).join(', ')}`];
    }
    const run = {
      receipt,
      originalReceipt,
      legacy,
      classification,
      sources,
      skillMetadata,
      skillRetirements,
      pluginVersion,
      fingerprint,
      releasedEntries,
      legacyPending: Boolean(legacy || classification.requires_structural_migration || (isDict(receipt) && pyTruthy(receipt.legacy_pending))),
      entries: entryMap(receipt),
      orphaned: isDict(receipt) && isDict(receipt.orphaned_entries) ? { ...receipt.orphaned_entries } : {},
      counts: Object.fromEntries(['created', 'updated', 'adopted', 'migrated', 'preserved', 'skipped_collision', 'collided', 'pruned', 'retired', 'backed_up', 'orphaned'].map((key) => [key, 0])),
      collisions: [],
    };
    RUN_ENTRIES = run.entries;
    RUN_ORPHANED = run.orphaned;

    const plan = buildPlan(receipt, classification, sources, skillMetadata, pluginVersion, fingerprint, skillRetirements);
    if (PLAN) {
      if (isDict(receipt) && isStr(receipt.profileId) && receipt.profileId !== 'common' && !isRetiredOrphanOnlyReceipt(receipt)) {
        plan.next_action = 'run this installer with --uninstall, then perform a fresh install without --profile';
      }
      printPlan(plan);
    }
    for (const item of releasedEntries) print(`[install-codex-skills] released: ${item.path} (removed from the receipt; its files stay in place)`);
    let adoptPaths;
    try {
      adoptPaths = validateAdoptions(plan);
    } catch (error) {
      if (!isValueError(error)) throw error;
      printErr(`[install-codex-skills] ERROR: ${errorText(error)}`);
      exit(2);
    }
    run.plan = plan;
    run.adoptPaths = adoptPaths;
    reconcile(run);
  }


  // Releases the install lock; the Python did this in an atexit handler.
  function close() {
    releaseInstallLock();
  }

  // The Python's excepthook: an unexpected exception still rolls the open
  // transaction back before the run fails.
  function run() {
    try {
      main();
    } catch (error) {
      if (!isExit(error) && !journalCore.isSimulatedCrash(error) && TX && !TX.committed) rollbackPending();
      throw error;
    }
  }

  return { main: run, close };
}

module.exports = { createInstaller, HOSTS, SCHEMA_VERSION, TREE_FINGERPRINT_ALGORITHM };
