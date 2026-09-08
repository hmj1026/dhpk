'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {
  canonicalJson,
  sha256,
  SAFE_ID,
  writeImmutable,
} = require('./receipt-primitives');
const { writePhysicalImmutable } = require('./physical-file');
const { PLAN_REGISTERED } = require('./review-gate');
const { fail } = require('./review-gate-runtime-errors');

const SCHEMA = 'dhpk.review-gate.runtime.v1';
const CONFIG_SCHEMA = 'dhpk.review-gate.runtime-config.v1';
const PLAN_CHECKPOINT_SCHEMA = 'dhpk.review-gate.runtime-plan.v1';
const CONFIG_VERSION = 'v1';
const PHASE_VERSION = 'dhpk.review-gate.phase.v1';
const TRUST_POLICY_VERSION = 'dhpk.review-gate.trust-policy.v1';
const DEFAULT_PHASE = 'OBSERVE';
const ALLOWED_PHASES = Object.freeze(['BASELINE', 'OBSERVE']);
const PRODUCER = 'dhpk-review-gate-runtime';
const ADAPTER = 'dhpk-review-gate-runtime';
const CLAUDE_PRODUCER = 'claude-migration';
const CLAUDE_ADAPTER = 'review-gate-adapter';
const MIGRATION_EVENT = 'MIGRATION_OBSERVATION_RECORDED';
const KEY_RELATIVE_PATH = path.join('.dhpk', 'review-gate', 'v1', 'integrity.key');
const CONFIG_RELATIVE_PATH = path.join('.dhpk', 'review-gate', 'v1', 'config.json');
const STORE_RELATIVE_PATH = path.join('.dhpk', 'review-gate', 'v1');
const PLAN_DIRECTORY = 'plans';
const MAX_STDIN_BYTES = 1024 * 1024;
const MAX_JSON_NODES = 4096;
const MAX_JSON_DEPTH = 32;
const MAX_DIAGNOSTIC_BYTES = 4096;
const MAX_EVIDENCE_BYTES = 1024 * 1024;
const MAX_EVIDENCE_EVENTS = 10000;

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const clone = (value) => {
  if (Array.isArray(value)) return value.map(clone);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, clone(child)]));
};

const assertSafeId = (value, field) => {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) fail(`INVALID_${field.toUpperCase()}`);
};

const repoStatePath = (repoRoot, relativePath) => path.join(path.resolve(repoRoot), relativePath);

const physicalPath = (root, target, code, { allowMissingFinal = false } = {}) => {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  assertPhysicalDirectory(resolvedRoot, code);
  if (resolvedTarget !== resolvedRoot
    && !resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`)) fail(code);
  const relative = path.relative(resolvedRoot, resolvedTarget);
  const segments = relative ? relative.split(path.sep) : [];
  let current = resolvedRoot;
  for (let index = 0; index < segments.length; index += 1) {
    current = path.join(current, segments[index]);
    let stat;
    try {
      stat = fs.lstatSync(current);
    } catch (error) {
      if (error && error.code === 'ENOENT'
        && allowMissingFinal && index === segments.length - 1) break;
      fail(code);
    }
    if (stat.isSymbolicLink()) fail(code);
    if (index < segments.length - 1 && !stat.isDirectory()) fail(code);
  }
  return resolvedTarget;
};

const assertPhysicalDirectory = (directory, code = 'SETUP_REQUIRED') => {
  try {
    const stat = fs.lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()
      || fs.realpathSync(directory) !== path.resolve(directory)) fail(code);
  } catch (error) {
    if (error instanceof Error && error.name === 'ReviewGateRuntimeError') throw error;
    fail(code);
  }
};

const ensurePrivateDirectory = (root, segments) => {
  let current = path.resolve(root);
  assertPhysicalDirectory(current, 'SETUP_FAILED');
  for (const segment of segments) {
    current = path.join(current, segment);
    let stat;
    try {
      stat = fs.lstatSync(current);
    } catch (error) {
      if (!error || error.code !== 'ENOENT') fail('SETUP_FAILED');
      try {
        fs.mkdirSync(current, { mode: 0o700 });
      } catch (mkdirError) {
        if (!mkdirError || mkdirError.code !== 'EEXIST') fail('SETUP_FAILED');
      }
      try {
        stat = fs.lstatSync(current);
      } catch (_) {
        fail('SETUP_FAILED');
      }
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail('SETUP_FAILED');
    try {
      fs.chmodSync(current, 0o700);
    } catch (_) {
      fail('SETUP_FAILED');
    }
  }
  return current;
};

const assertRegularPrivateFile = (file, code) => {
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o600) fail(code);
    return stat;
  } catch (error) {
    if (error instanceof Error && error.name === 'ReviewGateRuntimeError') throw error;
    fail(code);
  }
};

const writePrivateImmutable = (file, value, code = 'SETUP_FAILED', physicalRoot = null) => {
  try {
    writeImmutable(file, `${canonicalJson(value)}\n`, physicalRoot
      ? { physicalRoot: path.resolve(physicalRoot) } : {});
    fs.chmodSync(file, 0o600);
  } catch (error) {
    if (error && error.code === 'EEXIST') return false;
    fail(code);
  }
  return true;
};

const defaultTrustPolicy = () => ({
  producers: [
    {
      producer: PRODUCER,
      adapter: ADAPTER,
      eventTypes: [PLAN_REGISTERED],
      receiptKinds: [],
      lanes: [
        'code-reviewer',
        'security-reviewer',
        'database-reviewer',
        'migration-reviewer',
        'frontend-reviewer',
        'doc-reviewer',
        'polyfill-reviewer',
      ],
    },
    {
      producer: CLAUDE_PRODUCER,
      adapter: CLAUDE_ADAPTER,
      eventTypes: ['REVIEW_RESULT_RECORDED', MIGRATION_EVENT],
      receiptKinds: ['review', 'migration-observation'],
      lanes: [
        'code-reviewer',
        'security-reviewer',
        'database-reviewer',
        'migration-reviewer',
        'frontend-reviewer',
        'doc-reviewer',
        'polyfill-reviewer',
      ],
    },
  ],
});

const defaultConfig = () => ({
  schema: CONFIG_SCHEMA,
  configVersion: CONFIG_VERSION,
  phaseVersion: PHASE_VERSION,
  phase: DEFAULT_PHASE,
  trustPolicyVersion: TRUST_POLICY_VERSION,
  trustPolicy: defaultTrustPolicy(),
  producer: PRODUCER,
  adapter: ADAPTER,
});

const sameFileIdentity = (left, right) => (
  left && right
    && String(left.dev) === String(right.dev)
    && String(left.ino) === String(right.ino)
);

// Reading a descriptor may update atime on some filesystems, so keep the
// descriptor stability check to fields that identify the file and its data or
// security-relevant metadata.  atime is deliberately excluded.
const sameFileStats = (left, right) => (
  sameFileIdentity(left, right)
    && ['mode', 'nlink', 'uid', 'gid', 'size', 'mtimeMs', 'ctimeMs']
      .every((field) => String(left[field]) === String(right[field]))
);

const assertReadFlags = (code) => {
  const noFollow = fs.constants.O_NOFOLLOW;
  const nonBlock = fs.constants.O_NONBLOCK;
  if (!Number.isSafeInteger(noFollow) || noFollow <= 0
    || !Number.isSafeInteger(nonBlock) || nonBlock <= 0) fail(code);
  return fs.constants.O_RDONLY | noFollow | nonBlock;
};

const assertBoundedReadLimit = (maxBytes, code) => {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) fail(code);
};

const lstatReadableFile = (file, code, privateFile) => {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()
    || (privateFile && (stat.mode & 0o777) !== 0o600)
    || !Number.isSafeInteger(Number(stat.size)) || Number(stat.size) < 0) {
    fail(code);
  }
  return stat;
};

const assertDescriptorReadableFile = (stat, maxBytes, code, privateFile) => {
  if (!stat.isFile() || stat.isSymbolicLink()
    || (privateFile && (stat.mode & 0o777) !== 0o600)
    || !Number.isSafeInteger(Number(stat.size)) || Number(stat.size) < 0
    || Number(stat.size) > maxBytes) {
    fail(code);
  }
};

const readPhysicalBuffer = (file, maxBytes, code, {
  privateFile = false,
  physicalRoot = null,
} = {}) => {
  let descriptor;
  try {
    assertBoundedReadLimit(maxBytes, code);
    const root = physicalRoot ? path.resolve(physicalRoot) : null;

    // Check all path components before opening.  The descriptor flags and the
    // post-open checks below close the check-then-open gap for the final entry;
    // the repeated checks reject an ancestor swap without Linux-only /proc.
    if (root) physicalPath(root, file, code);
    const pathBefore = lstatReadableFile(file, code, privateFile);
    const flags = assertReadFlags(code);
    descriptor = fs.openSync(file, flags);
    const before = fs.fstatSync(descriptor);
    assertDescriptorReadableFile(before, maxBytes, code, privateFile);
    if (!sameFileIdentity(pathBefore, before)) fail(code);

    if (root) physicalPath(root, file, code);
    const pathAfterOpen = lstatReadableFile(file, code, privateFile);
    if (!sameFileIdentity(pathAfterOpen, before)) fail(code);

    const expectedSize = Number(before.size);
    const chunks = [];
    let position = 0;
    while (position < expectedSize) {
      const length = Math.min(64 * 1024, expectedSize - position);
      const chunk = Buffer.alloc(length);
      let count;
      try {
        count = fs.readSync(descriptor, chunk, 0, length, position);
      } catch (_) {
        fail(code);
      }
      if (count !== length) fail(code);
      chunks.push(chunk);
      position += count;
    }

    const after = fs.fstatSync(descriptor);
    assertDescriptorReadableFile(after, maxBytes, code, privateFile);
    if (!sameFileStats(before, after)) fail(code);
    if (root) physicalPath(root, file, code);
    const pathAfterRead = lstatReadableFile(file, code, privateFile);
    if (!sameFileIdentity(pathAfterRead, after)) fail(code);
    return Buffer.concat(chunks, position);
  } catch (error) {
    if (error instanceof Error && error.name === 'ReviewGateRuntimeError') throw error;
    fail(code);
  } finally {
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor); } catch (_) { /* preserve the bounded read error */ }
    }
  }
};

const readBoundedFile = (file, maxBytes, code, options = {}) => (
  readPhysicalBuffer(file, maxBytes, code, { ...options, privateFile: true }).toString('utf8')
);

const readPhysicalFile = (file, maxBytes, code = 'MALFORMED_EVIDENCE', options = {}) => (
  readPhysicalBuffer(file, maxBytes, code, options)
);

const expectedTrustPolicy = () => canonicalJson(defaultTrustPolicy());

const validateConfig = (config) => {
  exactKeys(
    config,
    ['schema', 'configVersion', 'phaseVersion', 'phase', 'trustPolicyVersion', 'trustPolicy', 'producer', 'adapter'],
    [],
    'CONFIG_INVALID',
  );
  if (config.schema !== CONFIG_SCHEMA
    || config.configVersion !== CONFIG_VERSION
    || config.phaseVersion !== PHASE_VERSION
    || !ALLOWED_PHASES.includes(config.phase)
    || config.trustPolicyVersion !== TRUST_POLICY_VERSION
    || config.producer !== PRODUCER
    || config.adapter !== ADAPTER
    || canonicalJson(config.trustPolicy) !== expectedTrustPolicy()) {
    fail('CONFIG_INVALID');
  }
  return config;
};

const validateJsonTree = (value, depth = 0, state = { nodes: 0 }) => {
  state.nodes += 1;
  if (state.nodes > MAX_JSON_NODES || depth > MAX_JSON_DEPTH) fail('BOUNDED_INPUT');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map((child) => validateJsonTree(child, depth + 1, state));
  if (!isRecord(value)) fail('BOUNDED_INPUT');
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [
    key,
    validateJsonTree(child, depth + 1, state),
  ]));
};

const parseJson = (content, code) => {
  let value;
  try {
    value = JSON.parse(content);
  } catch (_) {
    fail(code);
  }
  return validateJsonTree(value);
};

const exactKeys = (value, required, optional = [], code = 'MALFORMED_EVIDENCE') => {
  if (!isRecord(value)) fail(code);
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(code);
  }
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) fail(code);
  }
  return value;
};

const readConfig = (repoRoot) => {
  const root = path.resolve(repoRoot);
  const configPath = repoStatePath(root, CONFIG_RELATIVE_PATH);
  const raw = readBoundedFile(configPath, MAX_STDIN_BYTES, 'SETUP_REQUIRED', {
    physicalRoot: root,
  });
  const config = parseJson(raw, 'CONFIG_INVALID');
  if (raw !== `${canonicalJson(config)}\n`) fail('CONFIG_INVALID');
  return validateConfig(config);
};

const readIntegrityKey = (repoRoot) => {
  const root = path.resolve(repoRoot);
  const keyPath = repoStatePath(root, KEY_RELATIVE_PATH);
  const key = readPhysicalFile(keyPath, 4096, 'SETUP_REQUIRED', {
    privateFile: true,
    physicalRoot: root,
  });
  if (key.length !== 32) fail('CONFIG_INVALID');
  return key;
};

const runtimeState = (repoRoot) => {
  const root = path.resolve(repoRoot);
  assertPhysicalDirectory(root, 'SETUP_REQUIRED');
  const storeRoot = repoStatePath(root, STORE_RELATIVE_PATH);
  physicalPath(root, storeRoot, 'SETUP_REQUIRED');
  assertPhysicalDirectory(storeRoot, 'SETUP_REQUIRED');
  const config = readConfig(root);
  const integrityKey = readIntegrityKey(root);
  return { root, storeRoot, config, integrityKey };
};

const createIntegrityKey = (repoRoot) => {
  const root = path.resolve(repoRoot);
  const stateRoot = ensurePrivateDirectory(root, ['.dhpk', 'review-gate', 'v1']);
  const keyPath = path.join(stateRoot, 'integrity.key');
  const configPath = path.join(stateRoot, 'config.json');
  let configExists = false;
  try {
    fs.lstatSync(configPath);
    configExists = true;
  } catch (error) {
    if (!error || error.code !== 'ENOENT') fail('SETUP_FAILED');
  }
  if (configExists) readConfig(root);

  let initialized = false;
  let keyExists = false;
  try {
    fs.lstatSync(keyPath);
    keyExists = true;
  } catch (error) {
    if (!error || error.code !== 'ENOENT') fail('SETUP_FAILED');
  }

  if (!keyExists) {
    // Keep the final-entry race observable to callers while leaving creation
    // exclusively to the physical immutable writer below.  This read-only
    // probe never creates, truncates, or removes a key.
    const nonBlock = fs.constants.O_NONBLOCK;
    const probeFlags = fs.constants.O_RDONLY
      | (Number.isSafeInteger(nonBlock) && nonBlock !== 0 ? nonBlock : 0);
    let probe;
    try {
      probe = fs.openSync(keyPath, probeFlags);
    } catch (error) {
      if (!error || error.code !== 'ENOENT') fail('SETUP_FAILED');
    } finally {
      if (probe !== undefined) {
        try { fs.closeSync(probe); } catch (_) { fail('SETUP_FAILED'); }
      }
    }
    try {
      writePhysicalImmutable(root, keyPath, crypto.randomBytes(32));
      initialized = true;
    } catch (error) {
      if (!error || error.code !== 'EEXIST') fail('SETUP_FAILED');
      assertRegularPrivateFile(keyPath, 'SETUP_FAILED');
    }
  } else {
    assertRegularPrivateFile(keyPath, 'SETUP_FAILED');
  }

  const configCreated = writePrivateImmutable(configPath, defaultConfig(), 'SETUP_FAILED', root);
  if (!configCreated) readConfig(root);
  ensurePrivateDirectory(stateRoot, [PLAN_DIRECTORY]);
  return initialized;
};

const writeDiagnostic = ({ repoRoot, command, code }) => {
  if (!repoRoot || !code) return;
  const root = path.resolve(repoRoot);
  const stateRoot = repoStatePath(root, STORE_RELATIVE_PATH);
  try {
    assertPhysicalDirectory(stateRoot, 'DIAGNOSTIC_UNAVAILABLE');
    const diagnostics = ensurePrivateDirectory(stateRoot, ['diagnostics']);
    const digest = sha256(canonicalJson({ command, code, timestamp: Date.now() }));
    const diagnostic = {
      schema: 'dhpk.review-gate.runtime-diagnostic.v1',
      command: typeof command === 'string' ? command : 'unknown',
      code: String(code).slice(0, 128),
      recordedAt: new Date().toISOString(),
    };
    const file = path.join(diagnostics, `${digest}.json`);
    const serialized = `${canonicalJson(diagnostic)}\n`;
    if (Buffer.byteLength(serialized, 'utf8') <= MAX_DIAGNOSTIC_BYTES) {
      writeImmutable(file, serialized, { physicalRoot: root });
    }
  } catch (_) {
    // Diagnostics are best effort and must never create opt-in state.
  }
};

module.exports = {
  ADAPTER,
  ALLOWED_PHASES,
  CLAUDE_ADAPTER,
  CLAUDE_PRODUCER,
  CONFIG_RELATIVE_PATH,
  CONFIG_SCHEMA,
  CONFIG_VERSION,
  DEFAULT_PHASE,
  KEY_RELATIVE_PATH,
  MAX_DIAGNOSTIC_BYTES,
  MAX_EVIDENCE_BYTES,
  MAX_EVIDENCE_EVENTS,
  MAX_STDIN_BYTES,
  MIGRATION_EVENT,
  PHASE_VERSION,
  PLAN_CHECKPOINT_SCHEMA,
  PLAN_DIRECTORY,
  PRODUCER,
  SCHEMA,
  STORE_RELATIVE_PATH,
  TRUST_POLICY_VERSION,
  assertPhysicalDirectory,
  assertRegularPrivateFile,
  assertSafeId,
  clone,
  createIntegrityKey,
  defaultConfig,
  defaultTrustPolicy,
  ensurePrivateDirectory,
  exactKeys,
  isRecord,
  parseJson,
  readBoundedFile,
  readPhysicalFile,
  readConfig,
  readIntegrityKey,
  repoStatePath,
  runtimeState,
  physicalPath,
  validateConfig,
  writeDiagnostic,
  writePrivateImmutable,
};
