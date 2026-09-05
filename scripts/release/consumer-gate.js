#!/usr/bin/env node
'use strict';

// CONSUMER release gate: verifies each surface's proof at its own support
// level and never substitutes one for another.
//   - Codex sync installer (supported): scripts/hooks/install-codex-skills.sh
//     materializes skills/agents into a clean project and records a matching
//     version + content fingerprint. Fully runnable and safe: it only writes
//     inside a throwaway temp project directory.
//   - Claude plugin update/reinstall (supported): `claude plugin
//     marketplace add` + `install --scope project` + `plugin list` in a
//     clean temp project, then uninstalls the project-scope plugin and
//     removes the project-scope marketplace before deleting the temp dir.
//     Only safe to run for real on an ephemeral CI runner (a dev machine's
//     `claude plugin install` writes to the shared global plugin cache) —
//     absent from PATH rather than skipped silently.
//   - Native Codex marketplace (experimental support tier, but a REAL
//     verified proof — make-codex-plugin-distribution-install-safe): runs
//     tests/codex-native-install-smoke.test.js, which installs the EXACT
//     tracked plugins/dhpk/ artifact via the real codex CLI into a sandboxed
//     CODEX_HOME, deletes the source checkout, and verifies the installed
//     cache contains exactly the allowlisted native skills with zero
//     symlinks. Reported UNAVAILABLE (never PASS) when the codex CLI is
//     absent — matching design.md decision 7: missing consumer tooling
//     blocks graduation but never blocks an ordinary release, since native
//     support stays Experimental regardless (task 4.3). Always reported
//     separately from the supported-tier verdict.
//
// Prints the stage as JSON on stdout; exit code mirrors the verdict.
//
// Usage: node scripts/release/consumer-gate.js --version X.Y.Z [--repo-root <path>]

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { VERDICTS, normalizeConsumerEvidence } = require('../lib/release-evidence');
const { fingerprintDir } = require('../lib/codex-native-package');
const { createTraversalBudget, readFileBounded, readDirectoryEntries } = require('../lib/bounded-filesystem');
const { collectCodexProjectionReferenceErrors } = require('../ci/_lib/codex-runtime');
const { redactSensitiveText } = require('../lib/redaction');
const { inspectCodexDiscovery } = require('../lib/codex-discovery-registry');

const DEFAULT_ROOT = path.join(__dirname, '..', '..');
const CODEX_SURFACE_VERDICTS = Object.freeze({ PASS: 'PASS', WARN: 'WARN', BLOCKED: 'BLOCKED' });
const CONSUMER_SURFACES = Object.freeze([
  'claude-core',
  'codex-sync',
  'codex-native',
  'cursor-sync',
  'agent-plugin',
  'cursor-plugin',
]);

function canonicalAllowedRoots(roots) {
  return Array.isArray(roots) ? roots.map((root) => fs.realpathSync(path.resolve(root))) : [];
}

function isContainedPath(candidate, roots) {
  return roots.some((root) => candidate === root || candidate.startsWith(`${root}${path.sep}`));
}

function resolveSurfaceRoot(surfaceRoot, { allowedRoots = [], rejectSymlinkAncestors = false } = {}) {
  const lexical = path.resolve(surfaceRoot);
  const canonical = fs.realpathSync(surfaceRoot);
  if (rejectSymlinkAncestors && lexical !== canonical) {
    throw new Error(`surface root or ancestor is a symlink: ${surfaceRoot}`);
  }
  const roots = canonicalAllowedRoots(allowedRoots);
  if (roots.length > 0 && !isContainedPath(canonical, roots)) {
    throw new Error(`surface root resolves outside approved roots: ${surfaceRoot}`);
  }
  return canonical;
}

function normalizeFingerprintOptions(options = {}) {
  return {
    ...options,
    canonicalRoots: canonicalAllowedRoots(options.allowedRoots),
  };
}

function resolveCanonicalPath(current, { allowedRoots = [], canonicalRoots = null } = {}) {
  const lexical = path.resolve(current);
  const resolved = fs.realpathSync(current);
  if (allowedRoots.length === 0 && lexical !== resolved) {
    throw new Error(`symlinked path is not allowed without an approved root: ${current}`);
  }
  const roots = canonicalRoots || canonicalAllowedRoots(allowedRoots);
  if (roots.length > 0 && !isContainedPath(resolved, roots)) {
    throw new Error(`symlink target is outside approved roots: ${current}`);
  }
  return resolved;
}

function fingerprintPath(target, options = {}) {
  const normalizedOptions = normalizeFingerprintOptions(options);
  const budget = createTraversalBudget(normalizedOptions);
  const hashNode = (current, depth) => {
    const canonical = resolveCanonicalPath(current, normalizedOptions);
    const stat = fs.lstatSync(canonical);
    const nodeDigest = crypto.createHash('sha256');
    if (stat.isDirectory()) {
      const realDirectory = budget.enterDirectory(canonical, depth);
      try {
        nodeDigest.update('dir\0');
        for (const entry of readDirectoryEntries(canonical, { budget, sort: true })) {
          const name = entry.name;
          nodeDigest.update(name);
          nodeDigest.update('\0');
          nodeDigest.update(hashNode(path.join(canonical, name), depth + 1));
          nodeDigest.update('\0');
        }
      } finally {
        budget.leaveDirectory(realDirectory);
      }
      return nodeDigest.digest('hex');
    }
    nodeDigest.update('file\0');
    nodeDigest.update(budget.readFile(canonical, stat));
    return nodeDigest.digest('hex');
  };
  try {
    return hashNode(target, 0);
  } catch (error) {
    if (error && error.code === 'ENOENT') return '';
    throw error;
  }
}

function fingerprintProjectSkill(target, options = {}) {
  const normalizedOptions = normalizeFingerprintOptions(options);
  const canonical = resolveCanonicalPath(target, normalizedOptions);
  return fingerprintDir(canonical, normalizedOptions);
}

function fingerprintOptions(fingerprintFn, allowedRoots) {
  return fingerprintFn === fingerprintPath || fingerprintFn === fingerprintProjectSkill
    ? { allowedRoots }
    : {};
}

function relativeEvidencePath(root, target, label) {
  const relative = path.relative(root, target).split(path.sep).join('/');
  return relative && !relative.startsWith('../') ? relative : `${label}/${path.basename(target)}`;
}

function redactSandboxPath(value) {
  if (!value) return value;
  const tempRoot = path.resolve(os.tmpdir()).split(path.sep).join('/');
  const normalized = String(value).split(path.sep).join('/');
  return normalized.startsWith(`${tempRoot}/`)
    ? `<sandbox>/${normalized.slice(tempRoot.length + 1)}`
    : normalized;
}

function redactEvidence(value, root = DEFAULT_ROOT) {
  if (!value) return value;
  let redacted = String(value);
  const replacements = [
    [path.resolve(root), '<repo>'],
    [path.resolve(os.tmpdir()), '<sandbox>'],
  ].map(([prefix, label]) => [prefix.split(path.sep).join('/'), label]);
  redacted = redacted.split(path.sep).join('/');
  for (const [prefix, label] of replacements) {
    redacted = redacted.split(prefix).join(label);
  }
  return redactSandboxPath(redactSensitiveText(redacted));
}

function discoverCodexSurface({
  root,
  surfaceRoot,
  label,
  version,
  manifest = null,
  provenance = null,
  expectedFingerprints = null,
  fingerprintFn = fingerprintPath,
  expectedFingerprintFn = fingerprintFn,
  fingerprintFnByKind = {},
  ownershipFingerprintFn = null,
  allowedRoots = [],
}) {
  return ['skills', 'agents'].flatMap((kind) => {
    const kindRoot = path.join(surfaceRoot, kind);
    let kindStat;
    try { kindStat = fs.lstatSync(kindRoot); } catch (error) {
      if (error && error.code === 'ENOENT') return [];
      throw error;
    }
    if (!kindStat.isDirectory() && !kindStat.isSymbolicLink()) {
      throw new Error(`surface root is not a directory: ${kindRoot}`);
    }
    const contentFingerprintFn = fingerprintFnByKind[kind] || fingerprintFn;
    const ownershipFn = ownershipFingerprintFn || contentFingerprintFn;
    const enumerationRoot = resolveSurfaceRoot(kindRoot, {
      allowedRoots,
      rejectSymlinkAncestors: contentFingerprintFn === fingerprintDir,
    });
    const managed = manifest && manifest.managed_entries && manifest.managed_entries[kind];
    return readDirectoryEntries(enumerationRoot, { sort: true }).map((entry) => entry.name).flatMap((id) => {
      const target = path.join(kindRoot, id);
      let stat;
      try { stat = fs.lstatSync(target); } catch (_) { return []; }
      if (!stat.isDirectory() && !stat.isSymbolicLink()) return [];
      let fingerprint = '';
      let ownershipFingerprint = '';
      let expectedFingerprint = null;
      let fingerprintError = null;
      try {
        fingerprint = contentFingerprintFn(target, fingerprintOptions(contentFingerprintFn, allowedRoots));
        if (!fingerprint) {
          const redactedError = redactEvidence(
            redactEvidence('fingerprint validation failed: empty or missing target', root),
            surfaceRoot,
          );
          fingerprintError = redactedError && redactedError.trim()
            ? redactedError
            : 'fingerprint validation failed';
        } else {
          expectedFingerprint = expectedFingerprints
            ? expectedFingerprintFn(target, fingerprintOptions(expectedFingerprintFn, allowedRoots))
            : null;
          ownershipFingerprint = ownershipFn === contentFingerprintFn
            ? fingerprint
            : ownershipFn(target, fingerprintOptions(ownershipFn, allowedRoots));
        }
      } catch (error) {
        const errorText = error && typeof error.message === 'string' && error.message
          ? error.message
          : (typeof error === 'string' && error ? error : 'fingerprint validation failed');
        const redactedError = redactEvidence(redactEvidence(errorText, root), surfaceRoot);
        fingerprintError = redactedError && redactedError.trim()
          ? redactedError
          : 'fingerprint validation failed';
      }
      const receiptEntry = managed && managed[id];
      const owned = manifest
        ? Boolean(receiptEntry && receiptEntry.destination_fingerprint === ownershipFingerprint)
        : Boolean(provenance && provenance.valid && expectedFingerprints && expectedFingerprints[id] === expectedFingerprint);
      const current = manifest
        ? Boolean(manifest.plugin_version === version && manifest.schema_version >= 2)
        : Boolean(provenance && provenance.current && expectedFingerprints && Object.prototype.hasOwnProperty.call(expectedFingerprints, id));
      return [{
        id,
        kind,
        surface: label,
        version,
        fingerprint,
        owned,
        current,
        ...(fingerprintError ? { fingerprintError } : {}),
        ...(provenance ? { provenance: { ...provenance } } : {}),
        sourcePath: relativeEvidencePath(root, target, label),
      }];
    });
  }).sort((left, right) => `${left.kind}:${left.id}`.localeCompare(`${right.kind}:${right.id}`));
}

function evaluateCodexSurfaceMatrix({ project, native, precedence, nativeExperimental = false }) {
  if (!project || !native || project.id !== native.id || (project.kind && native.kind && project.kind !== native.kind)) {
    return { verdict: CODEX_SURFACE_VERDICTS.PASS, reason: 'no duplicate surface' };
  }
  const report = inspectCodexDiscovery({
    project: [{
      ...project,
      kind: project.kind || 'skills',
      surface: project.surface || 'project-local',
    }],
    native: [{
      ...native,
      kind: native.kind || 'skills',
      surface: native.surface || 'native-experimental',
      experimental: native.experimental === true || nativeExperimental === true,
    }],
    precedence: precedence ? [precedence] : [],
  });
  if (report.reasonCode === 'CODEX_PROVIDER_FINGERPRINT_ERROR') {
    return {
      verdict: CODEX_SURFACE_VERDICTS.BLOCKED,
      reason: 'Codex surface fingerprint validation is BLOCKED',
    };
  }
  if (!precedence || project.current !== true || project.owned !== true || native.current !== true || native.owned !== true) {
    return {
      verdict: CODEX_SURFACE_VERDICTS.BLOCKED,
      reason: 'selected project-local surface is stale/unowned or precedence is missing',
    };
  }
  if (report.duplicates.length > 0) {
    return { verdict: CODEX_SURFACE_VERDICTS.PASS, reason: 'identical fingerprints with valid provenance' };
  }
  const conflict = report.conflicts[0];
  if (!conflict) return { verdict: CODEX_SURFACE_VERDICTS.PASS, reason: 'no duplicate surface' };
  if (report.verdict === CODEX_SURFACE_VERDICTS.WARN && precedence === 'project-local' && nativeExperimental) {
    return { verdict: CODEX_SURFACE_VERDICTS.WARN, reason: 'current receipt-owned fallback takes explicit precedence over experimental native surface' };
  }
  if (report.verdict === CODEX_SURFACE_VERDICTS.BLOCKED && /stale|unowned/i.test(conflict.reason)) {
    return {
      verdict: CODEX_SURFACE_VERDICTS.BLOCKED,
      reason: 'selected project-local surface is stale/unowned or precedence is missing',
    };
  }
  return { verdict: CODEX_SURFACE_VERDICTS.BLOCKED, reason: 'duplicate surfaces differ without an approved precedence' };
}

function summarizeCodexDiscovery(discovery) {
  return {
    effective: discovery.effective.map((entry) => ({
      identity: entry.identity,
      name: entry.name,
      kind: entry.kind,
      status: entry.status,
      fingerprint: entry.fingerprint,
      provider: entry.provider ? {
        id: entry.provider.id,
        surface: entry.provider.surface,
        fingerprint: entry.provider.fingerprint,
      } : null,
      providerSurfaces: entry.providers.map((provider) => provider.surface),
    })),
    conflicts: discovery.conflicts.map((entry) => ({
      identity: entry.identity,
      name: entry.name,
      kind: entry.kind,
      reason: entry.reason,
      resolvedBy: entry.resolvedBy || null,
      providerSurfaces: entry.providers.map((provider) => provider.surface),
    })),
    invalidProviders: discovery.invalidProviders.map((entry) => ({ ...entry })),
  };
}

function discoverCodexSurfaces({ root, project, version, nativeRoot = path.join(root, 'plugins', 'dhpk') }) {
  const manifestPath = path.join(project, '.codex', '.dhpk-installed.json');
  let manifest = null;
  if (fs.existsSync(manifestPath)) {
    try { manifest = JSON.parse(readFileBounded(manifestPath).toString('utf8')); } catch (_) { manifest = null; }
  }
  const projectEntries = discoverCodexSurface({
    root,
    surfaceRoot: path.join(project, '.codex'),
    label: 'project-local',
    version,
    manifest,
    allowedRoots: [project, root],
    fingerprintFnByKind: { skills: fingerprintProjectSkill },
    ownershipFingerprintFn: fingerprintPath,
  });
  let nativeVersion = version;
  const nativeManifestPath = path.join(nativeRoot, '.codex-plugin', 'plugin.json');
  if (fs.existsSync(nativeManifestPath)) {
    try { nativeVersion = JSON.parse(readFileBounded(nativeManifestPath).toString('utf8')).version || version; } catch (_) { /* keep target version */ }
  }
  let nativeProvenance = { valid: false, current: false, packageVersion: nativeVersion, sourceVersion: null };
  let nativeFingerprints = {};
  const provenancePath = path.join(nativeRoot, 'provenance.json');
  const fingerprintsPath = path.join(nativeRoot, 'fingerprints.json');
  const inventoryPath = path.join(root, 'manifests', 'distribution-inventory.json');
  let inventory = null;
  try {
    inventory = JSON.parse(readFileBounded(inventoryPath).toString('utf8'));
    nativeFingerprints = JSON.parse(readFileBounded(fingerprintsPath).toString('utf8'));
  } catch (_) {
    inventory = null;
    nativeFingerprints = {};
  }
  if (fs.existsSync(provenancePath)) {
    try {
      const provenance = JSON.parse(readFileBounded(provenancePath).toString('utf8'));
      const validCommit = typeof provenance.sourceCommit === 'string' && /^[a-f0-9]{40}$/i.test(provenance.sourceCommit);
      const validDigest = typeof provenance.inventoryDigest === 'string' && /^[a-f0-9]{64}$/i.test(provenance.inventoryDigest);
      const validVersion = provenance.sourceVersion === nativeVersion && nativeVersion === version;
      const selectedStableIds = Array.isArray(provenance.emittedStableIds)
        ? provenance.emittedStableIds
        : Array.isArray(provenance.selectedStableIds)
          ? provenance.selectedStableIds
          : Array.isArray(provenance.selectedSkillIds)
            ? provenance.selectedSkillIds
            : null;
      const selectedSet = selectedStableIds ? new Set(selectedStableIds) : null;
      const runtimeSupportSet = new Set(Array.isArray(provenance.runtimeSupportStableIds)
        ? provenance.runtimeSupportStableIds
        : []);
      const expectedNativeSkills = inventory && Array.isArray(inventory.skills)
        ? inventory.skills.filter((skill) => (
          (skill.surfaces || []).includes('codex-native')
          && skill.lifecycle !== 'deprecated'
          && (!selectedSet || selectedSet.has(skill.id) || runtimeSupportSet.has(skill.id))
        ))
        : [];
      const expectedNativeIds = expectedNativeSkills.map((skill) => skill.id).sort();
      const expectedNativeNames = expectedNativeSkills.map((skill) => skill.name || skill.id).sort();
      const selectedNativeIds = Array.isArray(provenance.materializedSkillIds)
        ? [...provenance.materializedSkillIds].sort()
        : Array.isArray(provenance.selectedSkillIds) ? [...provenance.selectedSkillIds].sort() : [];
      const selectedNativeNames = Array.isArray(provenance.materializedSkillNames)
        ? [...provenance.materializedSkillNames].sort()
        : Array.isArray(provenance.selectedSkillNames) ? [...provenance.selectedSkillNames].sort() : [];
      const membershipMatches = JSON.stringify(selectedNativeIds) === JSON.stringify(expectedNativeIds)
        && JSON.stringify(selectedNativeNames) === JSON.stringify(expectedNativeNames)
        && JSON.stringify(Object.keys(nativeFingerprints).sort()) === JSON.stringify(expectedNativeNames);
      const expectedInventoryDigest = inventory
        ? crypto.createHash('sha256').update(JSON.stringify(inventory)).digest('hex')
        : null;
      // Pre-profile packages deliberately bind the legacy inventory contract,
      // which excludes profile_policy. Accept that digest while the package
      // carries no selection identity; profile-aware packages use the same
      // source digest and are checked against their selected/emitted IDs above.
      const legacyInventory = inventory ? { ...inventory } : null;
      if (legacyInventory) delete legacyInventory.profile_policy;
      const legacyInventoryDigest = legacyInventory
        ? crypto.createHash('sha256').update(JSON.stringify(legacyInventory)).digest('hex')
        : null;
      const inventoryMatches = Boolean(
        (expectedInventoryDigest && provenance.inventoryDigest === expectedInventoryDigest)
        || (legacyInventoryDigest && provenance.inventoryDigest === legacyInventoryDigest),
      );
      const fingerprintsWellFormed = expectedNativeNames.every((name) => /^[a-f0-9]{64}$/i.test(nativeFingerprints[name] || ''));
      nativeProvenance = {
        valid: Boolean(validCommit && validDigest && validVersion && inventoryMatches && membershipMatches && fingerprintsWellFormed),
        current: Boolean(validVersion && inventoryMatches && membershipMatches),
        packageVersion: nativeVersion,
        sourceVersion: provenance.sourceVersion || null,
        sourceCommit: validCommit ? provenance.sourceCommit : null,
        inventoryDigest: validDigest ? provenance.inventoryDigest : null,
        generatorVersion: provenance.generatorVersion || null,
      };
    } catch (_) { /* retain invalid provenance */ }
  }
  const nativeEntries = discoverCodexSurface({
    root,
    surfaceRoot: nativeRoot,
    label: 'native-experimental',
    version: nativeVersion,
    manifest: null,
    provenance: nativeProvenance,
    expectedFingerprints: nativeFingerprints,
    fingerprintFn: fingerprintDir,
    expectedFingerprintFn: fingerprintDir,
  });
  const nonInvokableSkillNames = inventory && Array.isArray(inventory.skills)
    ? inventory.skills.filter((skill) => skill.invokable === false).map((skill) => skill.name || skill.id).sort()
    : [];
  return { project: projectEntries, native: nativeEntries, manifest, nonInvokableSkillNames };
}

function parseArgs(argv) {
  const args = { root: DEFAULT_ROOT };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--version') args.version = argv[++i];
    else if (arg === '--repo-root') args.root = argv[++i];
    else if (arg === '--surface') {
      const value = argv[++i];
      if (!value || value.startsWith('--')) {
        console.error('consumer-gate: a value is required for --surface');
        process.exit(2);
      }
      args.surface = value;
    }
    else {
      console.error(`consumer-gate: unknown argument '${arg}'`);
      process.exit(2);
    }
  }
  if (!args.version) {
    console.error('usage: consumer-gate.js --version X.Y.Z [--repo-root <path>] [--surface <surface>]');
    process.exit(2);
  }
  if (args.surface && !CONSUMER_SURFACES.includes(args.surface)) {
    console.error(`consumer-gate: unknown surface '${args.surface}'`);
    process.exit(2);
  }
  args.root = path.resolve(args.root);
  return args;
}

function mkTempProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-consumer-gate-'));
  fs.mkdirSync(path.join(dir, '.git'));
  return dir;
}

function validateCodexAgentMaterialization(project, manifest) {
  const errors = [];
  const codexRoot = path.resolve(project, '.codex');
  const agentsRoot = path.join(codexRoot, 'agents');
  const managedAgents = manifest && manifest.managed_entries && manifest.managed_entries.agents;
  if (!managedAgents || typeof managedAgents !== 'object' || Array.isArray(managedAgents)) {
    return ['Codex receipt is missing managed agent entries'];
  }

  let discovered;
  try {
    discovered = readDirectoryEntries(agentsRoot, { sort: true });
  } catch (error) {
    return [`Codex agent directory is unreadable: ${error.message}`];
  }
  for (const entry of discovered) {
    if (!entry.name.endsWith('.toml')) continue;
    const target = path.join(agentsRoot, entry.name);
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink()) errors.push(`Codex agent '${entry.name}' must be a physical file, not a symlink`);
    else if (!stat.isFile()) errors.push(`Codex agent '${entry.name}' must be a physical regular file`);
  }

  for (const [name, entry] of Object.entries(managedAgents)) {
    if (!entry || typeof entry !== 'object') {
      errors.push(`Codex agent receipt entry '${name}' is invalid`);
      continue;
    }
    const relative = entry.destination || `agents/${name}`;
    const normalized = typeof relative === 'string' ? path.posix.normalize(relative) : '';
    if (!normalized || normalized !== relative || !normalized.startsWith('agents/')) {
      errors.push(`Codex agent receipt entry '${name}' has an unsafe destination`);
      continue;
    }
    if (entry.mode !== 'copy') errors.push(`Codex agent '${name}' receipt mode must be copy`);
    const destination = path.resolve(codexRoot, ...normalized.split('/'));
    if (destination === agentsRoot || !destination.startsWith(`${agentsRoot}${path.sep}`)) {
      errors.push(`Codex agent receipt entry '${name}' resolves outside the agent directory`);
      continue;
    }
    let stat;
    try { stat = fs.lstatSync(destination); } catch (_) {
      errors.push(`Codex agent '${name}' is missing from the installed projection`);
      continue;
    }
    if (stat.isSymbolicLink()) errors.push(`Codex agent '${name}' must be physical; installed destination is a symlink`);
    else if (!stat.isFile()) errors.push(`Codex agent '${name}' installed destination is not a regular file`);
  }
  return errors;
}

function runCodexNamedRoleProbe(project, {
  env = process.env,
  roles = ['explorer', 'deep-reasoner', 'code-reviewer', 'doc-reviewer'],
  timeoutMs = 120000,
} = {}) {
  if (!Array.isArray(roles) || roles.length === 0 || roles.some((role) => !/^[a-z][a-z0-9-]*$/.test(role))) {
    return {
      status: 'BLOCKED',
      cliVersion: null,
      diagnostic: 'Codex named-role runtime probe received an invalid role identifier',
      roles: Array.isArray(roles) ? roles : [],
    };
  }
  for (const role of roles) {
    const rolePath = path.join(project, '.codex', 'agents', `${role}.toml`);
    let stat;
    try { stat = fs.lstatSync(rolePath); } catch (_) {
      return { status: 'FAIL', cliVersion: null, diagnostic: `Codex named-role runtime probe is missing ${role}.toml`, roles };
    }
    if (stat.isSymbolicLink() || !stat.isFile()) {
      return { status: 'FAIL', cliVersion: null, diagnostic: `Codex named-role runtime probe requires physical ${role}.toml`, roles };
    }
  }
  const version = spawnSync('codex', ['--version'], {
    cwd: project,
    encoding: 'utf8',
    env,
    timeout: 10000,
  });
  if (version.error && version.error.code === 'ENOENT') {
    return {
      status: 'NOT_RUN',
      cliVersion: null,
      diagnostic: 'codex CLI not found on PATH; named-role runtime dispatch was not run',
      roles,
    };
  }
  if (version.error || version.status !== 0) {
    const detail = version.error ? version.error.message : (version.stderr || version.stdout || '').trim();
    return {
      status: 'BLOCKED',
      cliVersion: null,
      diagnostic: redactSensitiveText(`codex --version failed: ${detail}`).slice(-4000),
      roles,
    };
  }

  const cliVersion = (version.stdout || version.stderr || '').trim();
  const sourceCodexHome = path.resolve(env.CODEX_HOME || path.join(os.homedir(), '.codex'));
  const sourceAuth = path.join(sourceCodexHome, 'auth.json');
  let sourceAuthStat;
  try { sourceAuthStat = fs.statSync(sourceAuth); } catch (_) {
    return {
      status: 'BLOCKED',
      cliVersion,
      diagnostic: 'Codex named-role runtime probe requires source CODEX_HOME/auth.json',
      roles,
    };
  }
  if (!sourceAuthStat.isFile()) {
    return {
      status: 'BLOCKED',
      cliVersion,
      diagnostic: 'Codex named-role runtime probe requires source CODEX_HOME/auth.json to be a regular file',
      roles,
    };
  }

  const disposableCodexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-codex-home-'));
  fs.chmodSync(disposableCodexHome, 0o700);
  try {
    fs.symlinkSync(sourceAuth, path.join(disposableCodexHome, 'auth.json'));
    const configPath = path.join(disposableCodexHome, 'config.toml');
    fs.writeFileSync(configPath, `[projects.${JSON.stringify(project)}]\ntrust_level = "trusted"\n`);
    fs.chmodSync(configPath, 0o600);
    const taskNameAssignments = roles
      .map((role) => `${role}:task_name="dhpk_probe_${role.replace(/-/g, '_')}"`)
      .join(', ');
    const args = [
      'exec',
      '--strict-config',
      '--json',
      '--sandbox',
      'read-only',
      '--skip-git-repo-check',
    ];
    args.push([
      'This is a read-only consumer runtime probe.',
      `Sequentially call collaboration.spawn_agent once for each of these exact agent_type values: ${roles.join(', ')}.`,
      `For every call use fork_turns="none", use these exact valid task_name assignments (${taskNameAssignments}), and give the child a standalone one-sentence task that begins with DHPK_ROLE_PROBE:<role> and asks it to reply with its exact role name.`,
      'Wait for every child to finish. Do not edit files.',
      'Only when every named role was accepted and completed, print exactly CODEX_DHPK_NAMED_ROLES=PASS.',
      'If any role cannot be started or completed, print CODEX_DHPK_NAMED_ROLES=FAIL followed by the exact error.',
    ].join(' '));

    const probe = spawnSync('codex', args, {
      cwd: project,
      encoding: 'utf8',
      env: { ...env, CODEX_HOME: disposableCodexHome },
      timeout: timeoutMs,
      maxBuffer: 4 * 1024 * 1024,
    });
    const stdout = probe.stdout || '';
    const stderr = probe.stderr || '';
    const combined = `${stdout}\n${stderr}`.trim();
    const diagnostic = redactSensitiveText(combined).slice(-4000);
    if (probe.error && probe.error.code === 'ETIMEDOUT') {
      return { status: 'BLOCKED', cliVersion, diagnostic: `Codex named-role runtime probe timed out after ${timeoutMs}ms`, roles };
    }
    if (probe.error) {
      return {
        status: 'BLOCKED',
        cliVersion,
        diagnostic: redactSensitiveText(`Codex named-role runtime probe could not execute: ${probe.error.message}`).slice(-4000),
        roles,
      };
    }
    if (probe.status === null) {
      return { status: 'BLOCKED', cliVersion, diagnostic: `Codex named-role runtime probe ended by signal ${probe.signal || 'unknown'}`, roles };
    }
    const events = stdout.split(/\r?\n/).flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch (_) {
        return [];
      }
    });
    const agentMessages = events
      .filter((event) => event && event.item && event.item.type === 'agent_message' && typeof event.item.text === 'string')
      .map((event) => event.item.text);
    // The live CLI never emits `collab_agent_spawn_end` or a `spawn_agent`
    // `collab_tool_call` on stdout (verified against real codex-cli 0.151.0
    // runs). The only surface that proves a named role was actually spawned
    // and completed is the rollout JSONL persisted per-thread under this
    // disposable CODEX_HOME's `sessions/` directory.
    const walkRolloutFiles = (dir) => {
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return []; }
      let out = [];
      for (const entry of entries) {
        const entryPath = path.join(dir, entry.name);
        if (entry.isDirectory()) out = out.concat(walkRolloutFiles(entryPath));
        else if (entry.isFile() && /^rollout-.*\.jsonl$/.test(entry.name)) out.push(entryPath);
      }
      return out;
    };
    const rolloutFiles = walkRolloutFiles(path.join(disposableCodexHome, 'sessions'));
    const rolloutMetas = [];
    for (const file of rolloutFiles) {
      let content;
      try { content = fs.readFileSync(file, 'utf8'); } catch (_) { continue; }
      const firstLine = content.split('\n').find((line) => line.trim());
      if (!firstLine) continue;
      let parsed;
      try { parsed = JSON.parse(firstLine); } catch (_) { continue; }
      if (parsed && parsed.type === 'session_meta' && parsed.payload) {
        rolloutMetas.push({ file, payload: parsed.payload });
      }
    }
    const rolloutParents = rolloutMetas.filter((meta) => meta.payload.thread_source !== 'subagent');
    const rolloutParentIds = new Set(rolloutParents.map((meta) => meta.payload.id));
    const rolloutChildren = rolloutMetas.filter((meta) => meta.payload.thread_source === 'subagent');
    const childHasTaskComplete = (file) => {
      let content;
      try { content = fs.readFileSync(file, 'utf8'); } catch (_) { return false; }
      return content.split('\n').some((line) => {
        try {
          const parsed = JSON.parse(line);
          return Boolean(parsed && parsed.type === 'event_msg' && parsed.payload && parsed.payload.type === 'task_complete');
        } catch (_) {
          return false;
        }
      });
    };
    const roleQualifyingChildren = new Map(roles.map((role) => [role, []]));
    for (const child of rolloutChildren) {
      const role = child.payload.agent_role;
      if (!roleQualifyingChildren.has(role)) continue;
      if (!rolloutParentIds.has(child.payload.parent_thread_id)) continue;
      if (child.payload.agent_path !== `/root/dhpk_probe_${role.replace(/-/g, '_')}`) continue;
      roleQualifyingChildren.get(role).push(child);
    }
    const missingSpawnRoles = roles.filter((role) => roleQualifyingChildren.get(role).length === 0);
    const ambiguousSpawnRoles = roles.filter((role) => roleQualifyingChildren.get(role).length > 1);
    const childIdToRoles = new Map();
    for (const role of roles) {
      const matches = roleQualifyingChildren.get(role);
      if (matches.length !== 1) continue;
      const childId = matches[0].payload.id;
      if (!childIdToRoles.has(childId)) childIdToRoles.set(childId, []);
      childIdToRoles.get(childId).push(role);
    }
    const duplicateTargetRoles = [...childIdToRoles.values()].filter((roleList) => roleList.length > 1).flat();
    const incompleteRoles = roles.filter((role) => {
      const matches = roleQualifyingChildren.get(role);
      if (matches.length !== 1) return false;
      if (duplicateTargetRoles.includes(role)) return true;
      return !childHasTaskComplete(matches[0].file);
    });
    const genericDispatchFailure = /Symbolic link loop|os error 40|CODEX_DHPK_NAMED_ROLES=FAIL/i.test(combined);
    const registryUnavailable = !genericDispatchFailure && (
      /unknown agent_type|agent type is currently not available/i.test(combined)
      || agentMessages.some((message) => /spawn_agent\s+(?:does not|doesn't)\s+support\s+(?:an?\s+)?agent_type\s+parameter/i.test(message))
    );
    const dispatchFailure = genericDispatchFailure || registryUnavailable;
    const passed = probe.status === 0
      && agentMessages.some((message) => /CODEX_DHPK_NAMED_ROLES=PASS/.test(message))
      && missingSpawnRoles.length === 0
      && ambiguousSpawnRoles.length === 0
      && duplicateTargetRoles.length === 0
      && incompleteRoles.length === 0
      && !dispatchFailure;
    const evidenceFailure = [
      missingSpawnRoles.length > 0 ? `missing completed spawn evidence for: ${missingSpawnRoles.join(', ')}` : null,
      ambiguousSpawnRoles.length > 0 ? `ambiguous completed spawn evidence for: ${ambiguousSpawnRoles.join(', ')}` : null,
      duplicateTargetRoles.length > 0 ? `spawn evidence reused receiver targets for: ${duplicateTargetRoles.join(', ')}` : null,
      incompleteRoles.length > 0 ? `missing completed task-completion evidence for: ${incompleteRoles.join(', ')}` : null,
    ].filter(Boolean).join('; ');
    const runtimeEvidence = {
      registryPreconditions: {
        disposableCodexHome: true,
        authReference: 'symlink',
        projectTrust: 'trusted',
        userConfigIgnored: false,
      },
      roles: roles.map((role) => {
        const matches = roleQualifyingChildren.get(role);
        const uniqueMatch = matches.length === 1 ? matches[0] : null;
        return {
          id: role,
          agentTypeAccepted: matches.length === 1,
          threadId: uniqueMatch ? uniqueMatch.payload.id : null,
          childCompleted: uniqueMatch ? childHasTaskComplete(uniqueMatch.file) : false,
        };
      }),
    };
    return {
      status: passed ? 'PASS' : 'FAIL',
      cliVersion,
      diagnostic: redactSensitiveText([diagnostic || `codex exec exited ${probe.status} without a named-role result marker`, evidenceFailure]
        .filter(Boolean).join('\n')).slice(-4000),
      roles,
      runtimeEvidence,
      ...(registryUnavailable ? { reasonCode: 'CUSTOM_AGENT_REGISTRY_UNAVAILABLE' } : {}),
    };
  } finally {
    fs.rmSync(disposableCodexHome, { recursive: true, force: true });
  }
}

function verifyCodexSync(root, version) {
  const commands = [];
  const project = mkTempProject();
  try {
    const installer = path.join(root, 'scripts', 'hooks', 'install-codex-skills.sh');
    const res = spawnSync('bash', [installer, '--force'], { cwd: project, encoding: 'utf8', env: { ...process.env, CLAUDE_PLUGIN_ROOT: root } });
    commands.push({ cmd: `bash ${path.relative(root, installer).split(path.sep).join('/')} --force (in clean project)`, exitCode: res.status });
    if (res.status !== 0) {
      return { verdict: VERDICTS.FAIL, commands, reasons: [`install-codex-skills.sh exited ${res.status}: ${redactEvidence((res.stderr || '').trim(), root)}`] };
    }
    const manifestPath = path.join(project, '.codex', '.dhpk-installed.json');
    if (!fs.existsSync(manifestPath)) {
      return { verdict: VERDICTS.FAIL, commands, reasons: ['no .codex/.dhpk-installed.json manifest after install'] };
    }
    const manifest = JSON.parse(readFileBounded(manifestPath).toString('utf8'));
    const hasPhysicalEntries = (directory) => {
      let stat;
      try { stat = fs.lstatSync(directory); } catch (_) { return false; }
      return stat.isDirectory() && readDirectoryEntries(directory, { sort: false }).length > 0;
    };
    const skillsPresent = hasPhysicalEntries(path.join(project, '.codex', 'skills'));
    const agentsPresent = hasPhysicalEntries(path.join(project, '.codex', 'agents'));
    const supportingAssets = manifest.managed_entries && manifest.managed_entries.supporting_assets;
    const promptDefensePresent = fs.existsSync(path.join(project, '.codex', 'dhpk', 'agent-traps', '_common', 'prompt-defense.md'));
    if (!skillsPresent || !agentsPresent || !supportingAssets || Object.keys(supportingAssets).length === 0 || !promptDefensePresent) {
      return {
        verdict: VERDICTS.FAIL,
        commands,
        reasons: ['expected skills, agents, and receipt-managed Codex supporting assets to materialize under .codex/ after install'],
      };
    }
    if (manifest.plugin_version !== version) {
      return { verdict: VERDICTS.FAIL, commands, reasons: [`installed manifest version '${manifest.plugin_version}' does not match target '${version}'`] };
    }
    if (manifest.schema_version < 3 || !manifest.managed_entries || !manifest.managed_entries.skills || !manifest.managed_entries.agents || !manifest.managed_entries.supporting_assets) {
      return { verdict: VERDICTS.FAIL, commands, reasons: ['installed manifest is missing schema-v3 managed_entries ownership data'] };
    }
    const agentMaterializationErrors = validateCodexAgentMaterialization(project, manifest);
    commands.push({ cmd: 'validate physical Codex agent materialization', exitCode: agentMaterializationErrors.length === 0 ? 0 : 1 });
    if (agentMaterializationErrors.length > 0) {
      return {
        verdict: VERDICTS.FAIL,
        commands,
        reasons: agentMaterializationErrors.map((error) => `codex-sync: ${redactEvidence(error, root)}`),
      };
    }
    let expectedSyncNames = [];
    try {
      const inventory = JSON.parse(readFileBounded(path.join(root, 'manifests', 'distribution-inventory.json')).toString('utf8'));
      expectedSyncNames = (inventory.skills || [])
        .filter((skill) => (skill.surfaces || []).includes('codex-sync') && skill.lifecycle !== 'deprecated')
        .map((skill) => skill.name || skill.id)
        .sort();
    } catch (_) {
      return { verdict: VERDICTS.FAIL, commands, reasons: ['distribution inventory is unavailable for public-name Codex sync verification'] };
    }
    const installedSkillNames = Object.keys(manifest.managed_entries.skills).sort();
    if (JSON.stringify(installedSkillNames) !== JSON.stringify(expectedSyncNames)) {
      return {
        verdict: VERDICTS.FAIL,
        commands,
        reasons: [`Codex sync installed skill names drifted: expected public names [${expectedSyncNames.join(', ')}], got [${installedSkillNames.join(', ')}]`],
      };
    }
    for (const name of expectedSyncNames) {
      const entry = manifest.managed_entries.skills[name];
      if (!entry || entry.name !== name || typeof entry.id !== 'string' || !entry.fingerprint) {
        return { verdict: VERDICTS.FAIL, commands, reasons: [`Codex sync receipt entry '${name}' is missing stable id, public name, or fingerprint`] };
      }
    }
    const projectionErrors = collectCodexProjectionReferenceErrors(project, root);
    commands.push({ cmd: 'validate clean Codex supporting-asset reference closure', exitCode: projectionErrors.length === 0 ? 0 : 1 });
    if (projectionErrors.length > 0) {
      return {
        verdict: VERDICTS.FAIL,
        commands,
        reasons: projectionErrors.map((error) => `codex-sync: ${redactEvidence(error, root)}`),
      };
    }
    let surfaces;
    try {
      surfaces = discoverCodexSurfaces({ root, project, version });
    } catch (error) {
      return {
        verdict: VERDICTS.FAIL,
        commands,
        reasons: [`Codex surface discovery rejected an unsafe root: ${redactEvidence(error.message, root)}`],
      };
    }
    const capabilityEntries = (entries) => entries.filter((entry) => (
      entry.kind !== 'skills' || !surfaces.nonInvokableSkillNames.includes(entry.id)
    ));
    const discovery = inspectCodexDiscovery({
      project: capabilityEntries(surfaces.project),
      native: capabilityEntries(surfaces.native).map((entry) => ({ ...entry, experimental: true })),
      precedence: ['project-local'],
    });
    const duplicateEvidence = [];
    for (const finding of [...discovery.duplicates, ...discovery.conflicts]) {
      const projectEntry = surfaces.project.find((entry) => (
        entry.kind === finding.kind && entry.id === finding.name
      ));
      const nativeEntry = surfaces.native.find((entry) => (
        entry.kind === finding.kind && entry.id === finding.name
      ));
      if (!projectEntry || !nativeEntry) continue;
      const matrix = evaluateCodexSurfaceMatrix({
        project: projectEntry,
        native: nativeEntry,
        precedence: 'project-local',
        nativeExperimental: true,
      });
      duplicateEvidence.push({
        id: projectEntry.id,
        kind: projectEntry.kind,
        project: projectEntry,
        native: nativeEntry,
        precedence: 'project-local',
        verdict: matrix.verdict,
        reason: matrix.reason,
      });
    }
    const surfaceVerdict = discovery.verdict;
    const discoverySummary = summarizeCodexDiscovery(discovery);
    if (surfaceVerdict === CODEX_SURFACE_VERDICTS.BLOCKED) {
      return {
        verdict: VERDICTS.FAIL,
        commands,
        reasons: [discovery.reasonCode === 'CODEX_PROVIDER_FINGERPRINT_ERROR'
          ? 'Codex surface fingerprint validation is BLOCKED'
          : 'Codex duplicate-surface validation is BLOCKED'],
        surfaceVerdict,
        duplicateEvidence,
        surfaces: {
          project: surfaces.project,
          native: surfaces.native,
          effective: discoverySummary.effective,
          conflicts: discoverySummary.conflicts,
          invalidProviders: discoverySummary.invalidProviders,
          receipt: {
            schema_version: manifest.schema_version,
            plugin_version: manifest.plugin_version,
            source_fingerprint: manifest.source_fingerprint,
            mode: manifest.mode,
            reconciliation: manifest.reconciliation || null,
          },
        },
      };
    }
    const reasons = surfaceVerdict === CODEX_SURFACE_VERDICTS.WARN
      ? ['Codex duplicate-surface validation is WARN: project-local receipt-owned fallback takes precedence over experimental native content']
      : [];
    const runtimeProbe = runCodexNamedRoleProbe(project);
    commands.push({
      cmd: 'codex exec with project-local auto-discovery for explorer, deep-reasoner, code-reviewer, and doc-reviewer',
      exitCode: runtimeProbe.status === 'PASS' ? 0 : (runtimeProbe.status === 'NOT_RUN' ? null : 1),
      codexCliVersion: runtimeProbe.cliVersion,
    });
    const surfacesEvidence = {
      project: surfaces.project,
      native: surfaces.native,
      effective: discoverySummary.effective,
      conflicts: discoverySummary.conflicts,
      invalidProviders: discoverySummary.invalidProviders,
      receipt: {
        schema_version: manifest.schema_version,
        plugin_version: manifest.plugin_version,
        source_fingerprint: manifest.source_fingerprint,
        mode: manifest.mode,
        reconciliation: manifest.reconciliation || null,
      },
    };
    if (runtimeProbe.status !== 'PASS') {
      const verdict = runtimeProbe.status === 'NOT_RUN'
        ? VERDICTS.PENDING
        : (runtimeProbe.status === 'BLOCKED' ? VERDICTS.BLOCKED : VERDICTS.FAIL);
      return {
        verdict,
        status: runtimeProbe.status,
        commands,
        reasons: [`Codex named-role runtime probe ${runtimeProbe.status}: ${redactEvidence(runtimeProbe.diagnostic, root)}`],
        diagnostics: [redactEvidence(runtimeProbe.diagnostic, root)],
        checkedClaims: ['physical-agent-materialization', 'named-role-runtime-dispatch'],
        ...(runtimeProbe.runtimeEvidence ? { runtimeEvidence: runtimeProbe.runtimeEvidence } : {}),
        ...(runtimeProbe.reasonCode ? { reasonCode: runtimeProbe.reasonCode } : {}),
        surfaceVerdict,
        duplicateEvidence,
        surfaces: surfacesEvidence,
      };
    }
    return {
      verdict: VERDICTS.PASS,
      status: 'PASS',
      commands,
      reasons,
      diagnostics: [`Codex named-role runtime dispatch passed with ${runtimeProbe.cliVersion}`],
      checkedClaims: ['physical-agent-materialization', 'named-role-runtime-dispatch'],
      ...(runtimeProbe.runtimeEvidence ? { runtimeEvidence: runtimeProbe.runtimeEvidence } : {}),
      ...(runtimeProbe.reasonCode ? { reasonCode: runtimeProbe.reasonCode } : {}),
      surfaceVerdict,
      duplicateEvidence,
      surfaces: surfacesEvidence,
    };
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
  }
}

function verifyCursorSync(root, version) {
  const commands = [];
  const validator = path.join(root, 'scripts', 'ci', 'validate-cursor-sync.js');
  const validation = spawnSync(process.execPath, [validator], { cwd: root, encoding: 'utf8' });
  commands.push({ cmd: 'node scripts/ci/validate-cursor-sync.js', exitCode: validation.status });
  if (validation.status !== 0) {
    return {
      verdict: VERDICTS.FAIL,
      status: 'FAIL',
      commands,
      reasons: [`checked-in Cursor sync projection validation failed: ${redactEvidence((validation.stdout || validation.stderr || '').trim(), root)}`],
    };
  }

  const project = mkTempProject();
  try {
    const installer = path.join(root, 'scripts', 'hooks', 'install-cursor-harness.sh');
    const install = spawnSync('bash', [installer, '--copy', '--force'], {
      cwd: project,
      encoding: 'utf8',
      env: {
        ...process.env,
        CLAUDE_PLUGIN_ROOT: root,
        DHPK_HARNESS_KIND: 'cursor',
        DHPK_SRC_REL: 'cursor',
        DHPK_DEST_REL: '.cursor',
        DHPK_SOURCE_KINDS: 'skills,agents,rules,commands',
        DHPK_INSTALLER_NAME: 'install-cursor-harness',
      },
    });
    commands.push({ cmd: 'bash scripts/hooks/install-cursor-harness.sh --copy --force (in clean project)', exitCode: install.status });
    if (install.status !== 0) {
      return {
        verdict: VERDICTS.FAIL,
        status: 'FAIL',
        commands,
        reasons: [`install-cursor-harness.sh exited ${install.status}: ${redactEvidence((install.stderr || install.stdout || '').trim(), root)}`],
      };
    }

    const receiptPath = path.join(project, '.cursor', '.dhpk-installed.json');
    let receipt;
    try {
      receipt = JSON.parse(readFileBounded(receiptPath).toString('utf8'));
    } catch (error) {
      return {
        verdict: VERDICTS.FAIL,
        status: 'FAIL',
        commands,
        reasons: [`Cursor sync receipt is unreadable: ${error.message}`],
      };
    }
    const managedEntries = receipt.managed_entries;
    const requiredKinds = ['skills', 'agents', 'rules', 'commands', 'supporting_assets'];
    const missingKinds = requiredKinds.filter((kind) => !managedEntries || !managedEntries[kind] || Object.keys(managedEntries[kind]).length === 0);
    const unsafeEntries = [];
    const isSafeRelative = (value) => typeof value === 'string'
      && value.length > 0
      && !path.isAbsolute(value)
      && !value.includes('\\')
      && path.posix.normalize(value) === value
      && value !== '.'
      && value !== '..'
      && !value.startsWith('../');
    for (const kind of requiredKinds) {
      for (const [name, entry] of Object.entries((managedEntries && managedEntries[kind]) || {})) {
        if (!entry || !isSafeRelative(entry.source) || !isSafeRelative(entry.destination)
          || !/^[a-f0-9]{64}$/i.test(entry.source_fingerprint || '')
          || !/^[a-f0-9]{64}$/i.test(entry.destination_fingerprint || '')) {
          unsafeEntries.push(`${kind}/${name}`);
        }
      }
    }
    if (receipt.schema_version !== 3 || receipt.state !== 'current' || receipt.plugin_version !== version
      || !/^[a-f0-9]{64}$/i.test(receipt.source_fingerprint || '') || missingKinds.length > 0 || unsafeEntries.length > 0) {
      return {
        verdict: VERDICTS.FAIL,
        status: 'FAIL',
        commands,
        reasons: [`Cursor sync receipt failed schema/version/ownership checks${missingKinds.length > 0 ? `; missing managed entries: ${missingKinds.join(', ')}` : ''}${unsafeEntries.length > 0 ? `; unsafe or incomplete entries: ${unsafeEntries.slice(0, 10).join(', ')}` : ''}`],
      };
    }

    // The installer proves isolated project-local synchronization only.  No
    // Cursor client/GUI loader is invoked here, so this row must remain
    // NOT_RUN rather than being promoted to consumer-runtime PASS.
    return {
      verdict: VERDICTS.PENDING,
      status: 'NOT_RUN',
      commands,
      artifacts: [{
        receipt: '<sandbox>/.cursor/.dhpk-installed.json',
        schemaVersion: receipt.schema_version,
        pluginVersion: receipt.plugin_version,
        sourceFingerprint: receipt.source_fingerprint,
        managedCounts: Object.fromEntries(requiredKinds.map((kind) => [kind, Object.keys(managedEntries[kind]).length])),
      }],
      reasons: ['isolated Cursor project-local sync receipt verified; Cursor client runtime/loader was not invoked'],
    };
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
  }
}

function claudeAvailable() {
  return spawnSync('claude', ['--version'], { encoding: 'utf8' }).status === 0;
}

function claudeCliVersion() {
  const result = spawnSync('claude', ['--version'], { encoding: 'utf8' });
  if (result.status !== 0) return null;
  return ((result.stdout || result.stderr || '').trim().split(/\r?\n/)[0] || 'unknown').trim();
}

function teardownClaudeProjectRegistry(project, commands, warnings, root) {
  const uninstall = spawnSync(
    'claude',
    ['plugin', 'uninstall', 'dhpk@dhpk', '--scope', 'project', '-y'],
    { cwd: project, encoding: 'utf8' },
  );
  commands.push({ cmd: 'claude plugin uninstall dhpk@dhpk --scope project', exitCode: uninstall.status });
  if (uninstall.status !== 0) {
    const detail = redactEvidence((uninstall.stderr || '').trim(), root);
    warnings.push(`plugin uninstall exited ${uninstall.status}${detail ? `: ${detail}` : ''}`);
  }
  const remove = spawnSync(
    'claude',
    ['plugin', 'marketplace', 'remove', 'dhpk', '--scope', 'project'],
    { cwd: project, encoding: 'utf8' },
  );
  commands.push({ cmd: 'claude plugin marketplace remove dhpk --scope project', exitCode: remove.status });
  if (remove.status !== 0) {
    const detail = redactEvidence((remove.stderr || '').trim(), root);
    warnings.push(`marketplace remove exited ${remove.status}${detail ? `: ${detail}` : ''}`);
  }
}

function verifyClaudeReinstall(root, version) {
  const strictCommand = 'claude plugin validate <manifest> --strict';
  if (!claudeAvailable()) {
    return {
      verdict: VERDICTS.UNAVAILABLE,
      commands: [{ cmd: strictCommand, exitCode: null, status: 'NOT RUN' }],
      officialValidation: {
        verdict: 'NOT RUN',
        command: strictCommand,
        exitCode: null,
        reason: 'claude CLI not found on PATH',
      },
      reasons: ["claude CLI not found on PATH — official strict validation is NOT RUN; Claude update/reinstall proof requires a clean CI runner or a fresh session"],
    };
  }
  const commands = [];
  const cliVersion = claudeCliVersion() || 'unknown';
  // Validate the consumer-shaped staged package. The source checkout carries a
  // development-only root CLAUDE.md; Claude warns that this file is not loaded
  // from a plugin, so leaving it in the stage would fail strict validation.
  const validationStage = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-claude-validation-'));
  let strictEvidence;
  try {
    for (const relative of ['.claude-plugin', 'skills', 'agents', 'commands', 'modules']) {
      const source = path.join(root, relative);
      if (fs.existsSync(source)) {
        fs.cpSync(source, path.join(validationStage, relative), { recursive: true, dereference: true });
      }
    }
    const stagedManifest = path.join(validationStage, '.claude-plugin', 'plugin.json');
    const strict = spawnSync('claude', ['plugin', 'validate', stagedManifest, '--strict'], { cwd: validationStage, encoding: 'utf8' });
    strictEvidence = {
      cmd: strictCommand,
      manifest: '<staged>/.claude-plugin/plugin.json',
      exitCode: strict.status,
      claudeVersion: cliVersion,
    };
    commands.push(strictEvidence);
    if (strict.status !== 0) {
      const output = redactEvidence(`${strict.stdout || ''}\n${strict.stderr || ''}`.trim(), root);
      return {
        verdict: VERDICTS.FAIL,
        commands,
        officialValidation: {
          verdict: 'FAIL',
          ...strictEvidence,
        },
        reasons: [`official Claude strict validation failed (exit ${strict.status})${output ? `: ${output}` : ''}`],
      };
    }
  } finally {
    fs.rmSync(validationStage, { recursive: true, force: true });
  }
  const officialValidation = { verdict: 'PASS', ...strictEvidence };
  const warnings = [];
  const project = mkTempProject();
  try {
    const add = spawnSync('claude', ['plugin', 'marketplace', 'add', root, '--scope', 'project'], { cwd: project, encoding: 'utf8' });
    commands.push({ cmd: 'claude plugin marketplace add <root> --scope project', exitCode: add.status });
    if (add.status !== 0) {
      return { verdict: VERDICTS.FAIL, commands, officialValidation, reasons: [`marketplace add exited ${add.status}: ${redactEvidence((add.stderr || '').trim(), root)}`], warnings };
    }

    const install = spawnSync('claude', ['plugin', 'install', 'dhpk@dhpk', '--scope', 'project'], { cwd: project, encoding: 'utf8' });
    commands.push({ cmd: 'claude plugin install dhpk@dhpk --scope project', exitCode: install.status });
    if (install.status !== 0) {
      return { verdict: VERDICTS.FAIL, commands, officialValidation, reasons: [`plugin install exited ${install.status}: ${redactEvidence((install.stderr || '').trim(), root)}`], warnings };
    }

    const list = spawnSync('claude', ['plugin', 'list', '--json'], { cwd: project, encoding: 'utf8' });
    commands.push({ cmd: 'claude plugin list --json', exitCode: list.status });
    if (list.status !== 0) {
      return { verdict: VERDICTS.FAIL, commands, officialValidation, reasons: [`plugin list exited ${list.status}`], warnings };
    }
    const installedEntries = JSON.parse(list.stdout || '[]');
    const matchingEntries = installedEntries.filter((p) => p.id === 'dhpk@dhpk');
    const installed = matchingEntries.find((p) => {
      if (p.scope !== 'project') return false;
      // `claude plugin list --json` can include a stale user-scoped copy before
      // the project-scoped install. When available, bind the row to this
      // isolated project as an additional identity check.
      return !p.projectPath || path.resolve(p.projectPath) === path.resolve(project);
    }) || (matchingEntries.length === 1 && matchingEntries[0].scope === undefined ? matchingEntries[0] : null);
    if (!installed) {
      return { verdict: VERDICTS.FAIL, commands, officialValidation, reasons: ["'dhpk@dhpk' not present in 'claude plugin list --json' after install"], warnings };
    }
    if (installed.version !== version) {
      return { verdict: VERDICTS.FAIL, commands, officialValidation, reasons: [`installed plugin reports version '${installed.version}', expected '${version}'`], warnings };
    }
    return {
      verdict: VERDICTS.PASS,
      commands,
      officialValidation,
      reasons: [],
      warnings,
    };
  } finally {
    try {
      teardownClaudeProjectRegistry(project, commands, warnings, root);
    } catch (error) {
      warnings.push(`registry teardown threw: ${error.message}`);
    }
    fs.rmSync(project, { recursive: true, force: true });
  }
}

function codexCliVersion() {
  const res = spawnSync('codex', ['--version'], { encoding: 'utf8' });
  return res.status === 0 ? res.stdout.trim() : null;
}

// Native Codex marketplace consumer proof (task 3.4/4.1-4.3): installs the
// EXACT tracked plugins/dhpk/ artifact via the real codex CLI, deletes the
// source checkout, and verifies the installed cache. Reported UNAVAILABLE —
// never PASS — when the codex CLI is absent; a missing/failed native probe
// never fails or blocks the supported-tier (codex-sync/Claude) verdict below,
// and native support stays Experimental regardless of this result (design.md
// decision 7). Records the CLI version and installed cache path (task 3.3),
// without secrets — both come from the smoke test's own stdout, never from
// environment/config values.
function verifyCodexNative(root) {
  const cliVersion = codexCliVersion();
  if (!cliVersion) {
    return { verdict: VERDICTS.UNAVAILABLE, commands: [], reasons: ['codex CLI not found on PATH — native Codex marketplace consumer proof requires a live codex binary; native support remains Experimental regardless'] };
  }
  const smokeTest = path.join(root, 'tests', 'codex-native-install-smoke.test.js');
  const res = spawnSync('node', [smokeTest], { encoding: 'utf8' });
  const commands = [{ cmd: `node ${path.relative(root, smokeTest)}`, exitCode: res.status, codexCliVersion: cliVersion }];
  const installedRootMatch = /CODEX_NATIVE_INSTALLED_ROOT=(.+)/.exec(res.stdout || '');
  if (installedRootMatch) commands[0].installedCachePath = redactSandboxPath(installedRootMatch[1].trim());
  if (res.status !== 0) {
    return { verdict: VERDICTS.FAIL, commands, reasons: [`codex-native-install-smoke exited ${res.status}: ${redactEvidence((res.stdout + res.stderr).trim().slice(-800), root)}`] };
  }
  return { verdict: VERDICTS.PASS, commands, reasons: [] };
}

function verifyProjectedConsumer(root, platform, version) {
  const agentPlugin = platform === 'agent-plugin' || platform === 'codex';
  const packageRoot = path.join(root, 'plugins', agentPlugin ? 'dhpk-agent' : 'dhpk-cursor');
  const probe = path.join(root, 'scripts', 'release', 'consumer-platform-probe.js');
  const probePlatform = agentPlugin ? 'agent-plugin' : 'cursor';
  const probeArgs = [probe, '--platform', probePlatform, '--package-root', packageRoot, '--inventory', path.join(root, 'manifests', 'distribution-inventory.json'), '--version', version];
  if ((agentPlugin || platform === 'cursor') && (process.env.CI === '1' || process.env.CI === 'true' || process.env.DHPK_HARNESS_ALLOW_REAL_CONSUMER_PROBE === '1')) {
    probeArgs.push('--execute');
  }
  const res = spawnSync('node', probeArgs, {
    cwd: root,
    encoding: 'utf8',
  });
  let payload;
  try { payload = JSON.parse(res.stdout || '{}'); } catch (_) {
    payload = { status: 'FAIL', reason: `consumer probe emitted invalid JSON (exit ${res.status})` };
  }
  const surface = agentPlugin ? 'agent-plugin' : 'cursor-plugin';
  const childFailure = res.status !== 0 || payload.normalizationError;
  const expectedFailureStatus = ['FAIL', 'BLOCKED'].includes(payload.status);
  const forcedChildFailure = childFailure && !expectedFailureStatus;
  const effectiveStatus = forcedChildFailure ? 'FAIL' : (payload.status || 'FAIL');
  const effectiveReason = payload.normalizationError
    ? `consumer probe normalization failed: ${payload.normalizationError}`
    : (forcedChildFailure
      ? `consumer probe exited ${res.status} with producer status ${payload.status || 'missing'}`
      : payload.reason);
  const surfaceResults = Array.isArray(payload.surfaceResults) && payload.surfaceResults.length > 0
    ? payload.surfaceResults.map((entry) => ({
      ...entry,
      surface,
      status: forcedChildFailure ? 'FAIL' : entry.status,
      ...(childFailure && effectiveReason ? { reasons: [...(entry.reasons || []), effectiveReason] } : {}),
    }))
    : [{
      surface,
      status: effectiveStatus,
      commands: payload.commands || [],
      environment: process.env.CI ? 'ci' : 'local',
      artifacts: payload.artifacts || [],
      diagnostics: payload.diagnostics || payload.diagnostic || [],
      reasons: payload.failureReasons || (effectiveReason ? [effectiveReason] : []),
      checkedClaims: ['package-manifest', 'consumer-route'],
    }];
  const normalized = normalizeConsumerEvidence({
    stage: 'CONSUMER',
    producer: 'consumer-platform-probe',
    adapter: { id: 'consumer-platform-probe', version: '1.0.0' },
    surfaceResults,
  });
  return {
    status: effectiveStatus,
    commands: Array.isArray(payload.commands) && payload.commands.length > 0
      ? payload.commands.map((cmd) => ({ cmd: redactEvidence(typeof cmd === 'string' ? cmd : cmd.cmd || `node scripts/release/consumer-platform-probe.js --platform ${platform}`, root), exitCode: typeof cmd === 'string' ? res.status : (cmd.exitCode === undefined ? res.status : cmd.exitCode) }))
      : [{ cmd: `node scripts/release/consumer-platform-probe.js --platform ${platform}`, exitCode: res.status }],
    reason: effectiveReason ? redactEvidence(effectiveReason, root) : null,
    diagnostics: payload.diagnostics || payload.diagnostic || [],
    artifacts: payload.artifacts || [],
    surfaceResults: normalized.surfaceResults,
  };
}

function normalizeGateSurface(surface, producer, adapter, result, environment) {
  const surfaceResults = result.surfaceResults || [{
    surface,
    status: result.status || result.verdict,
    commands: result.commands || [],
    environment,
    artifacts: result.artifacts || [],
    diagnostics: result.diagnostics || result.diagnostic || [],
    reasons: result.failureReasons || result.reasons || [],
    checkedClaims: result.checkedClaims || [],
  }];
  const normalized = normalizeConsumerEvidence({
    stage: 'CONSUMER',
    producer,
    adapter,
    surfaceResults,
  });
  return normalized.surfaceResults.map((entry) => ({
    ...entry,
    ...(result.runtimeEvidence ? { runtimeEvidence: result.runtimeEvidence } : {}),
    ...(result.reasonCode ? { reasonCode: result.reasonCode } : {}),
    ...(result.surfaceVerdict ? { legacySurfaceStatus: result.surfaceVerdict } : {}),
    ...(result.warnings && result.warnings.length > 0 ? { warnings: result.warnings } : {}),
  }));
}

function runGate(args) {
  const selected = args.surface || null;
  const selectedOrAll = (surface) => selected === null || selected === surface;
  const codex = selectedOrAll('codex-sync') ? verifyCodexSync(args.root, args.version) : null;
  const claude = selectedOrAll('claude-core') ? verifyClaudeReinstall(args.root, args.version) : null;
  const native = selectedOrAll('codex-native') ? verifyCodexNative(args.root) : null;
  const cursorSync = selectedOrAll('cursor-sync') ? verifyCursorSync(args.root, args.version) : null;
  const projectedCodex = selectedOrAll('agent-plugin')
    ? verifyProjectedConsumer(args.root, 'agent-plugin', args.version)
    : null;
  const projectedCursor = selectedOrAll('cursor-plugin')
    ? verifyProjectedConsumer(args.root, 'cursor', args.version)
    : null;

  const environment = process.env.CI ? 'ci' : 'local';
  const surfaceResults = [
    ...(codex ? normalizeGateSurface('codex-sync', 'consumer-gate', { id: 'codex-sync-installer', version: '1.0.0' }, codex, environment) : []),
    ...(claude ? normalizeGateSurface('claude', 'consumer-gate', { id: 'claude-plugin-cli', version: claude.cliVersion || 'unknown' }, claude, environment) : []),
    ...(native ? normalizeGateSurface('codex-native', 'consumer-gate', { id: 'codex-native-install-smoke', version: '1.0.0' }, native, environment) : []),
    ...(cursorSync ? normalizeGateSurface('cursor-sync', 'consumer-gate', { id: 'cursor-sync-installer', version: '1.0.0' }, cursorSync, environment) : []),
    ...(projectedCodex ? projectedCodex.surfaceResults : []),
    ...(projectedCursor ? projectedCursor.surfaceResults : []),
  ];

  const commands = [
    ...(codex ? codex.commands : []),
    ...(claude ? claude.commands : []),
    ...(native ? native.commands : []),
    ...(cursorSync ? cursorSync.commands : []),
    ...(projectedCodex ? projectedCodex.commands : []),
    ...(projectedCursor ? projectedCursor.commands : []),
  ];
  const failureReasons = [
    ...(codex ? codex.reasons.map((r) => `codex-sync: ${r}`) : []),
    ...(claude ? claude.reasons.map((r) => `claude-reinstall: ${r}`) : []),
    ...(native ? native.reasons.map((r) => `native-codex-marketplace: ${r}`) : []),
    ...(cursorSync && ['FAIL', 'BLOCKED'].includes(cursorSync.status)
      ? [`cursor-sync: ${cursorSync.reasons && cursorSync.reasons[0] ? cursorSync.reasons[0] : cursorSync.status.toLowerCase()}`]
      : []),
    ...(projectedCodex && ['FAIL', 'BLOCKED'].includes(projectedCodex.status)
      ? [`agent-plugin-consumer: ${projectedCodex.reason || projectedCodex.status.toLowerCase()}`]
      : []),
    ...(projectedCursor && ['FAIL', 'BLOCKED'].includes(projectedCursor.status)
      ? [`cursor-plugin-consumer: ${projectedCursor.reason || projectedCursor.status.toLowerCase()}`]
      : []),
  ];

  let verdict;
  if (selected) {
    const row = surfaceResults[0];
    const pendingStatuses = new Set(['NOT_RUN', 'NOT_CONFIGURED', 'SKIP_INCOMPATIBLE']);
    verdict = row && pendingStatuses.has(row.status) ? VERDICTS.PENDING : (row && row.status ? row.status : VERDICTS.FAIL);
  } else if (codex.verdict === VERDICTS.FAIL || claude.verdict === VERDICTS.FAIL || cursorSync.status === 'FAIL' || projectedCodex.status === 'FAIL' || projectedCursor.status === 'FAIL') verdict = VERDICTS.FAIL;
  else if (codex.verdict === VERDICTS.BLOCKED || cursorSync.status === 'BLOCKED' || projectedCodex.status === 'BLOCKED' || projectedCursor.status === 'BLOCKED') verdict = VERDICTS.BLOCKED;
  else if (claude.verdict === VERDICTS.UNAVAILABLE) verdict = VERDICTS.UNAVAILABLE;
  else if (codex.verdict === VERDICTS.PENDING || cursorSync.status === 'NOT_RUN') verdict = VERDICTS.PENDING;
  else verdict = VERDICTS.PASS;

  const stage = {
    verdict,
    commands,
    environment,
    artifacts: selected
      ? []
      : [
      `claude-official-strict: ${claude.officialValidation ? claude.officialValidation.verdict : 'NOT RUN'}${claude.officialValidation && claude.officialValidation.reason ? ` (${claude.officialValidation.reason})` : ''}`,
      `native-codex-marketplace: ${native.verdict} (experimental support tier; consumer proof does not itself graduate the support tier)`,
      `cursor-sync: ${cursorSync.status}${cursorSync.reasons && cursorSync.reasons.length > 0 ? ` (${cursorSync.reasons[0]})` : ''}`,
      `agent-plugin-consumer: ${projectedCodex.status}${projectedCodex.reason ? ` (${projectedCodex.reason})` : ''}`,
      `cursor-plugin-consumer: ${projectedCursor.status}${projectedCursor.reason ? ` (${projectedCursor.reason})` : ''}`,
      ...(codex.surfaceVerdict ? [`codex-surface: ${codex.surfaceVerdict}`] : []),
      ...(Array.isArray(claude.warnings) && claude.warnings.length > 0
        ? [`claude-registry-teardown: WARN (${claude.warnings.join('; ')})`]
        : (claude.commands || []).some((c) => /plugin uninstall/.test(c.cmd))
          ? ['claude-registry-teardown: PASS']
          : []),
    ],
    failureReasons,
    ...(codex && codex.surfaces ? { codexSurfaces: { ...codex.surfaces, duplicates: codex.duplicateEvidence || [] } } : {}),
    stage: 'CONSUMER',
    producer: 'consumer-gate',
    adapter: { id: 'consumer-gate', version: '1.0.0' },
    surfaceResults,
    ...(codex && codex.surfaceVerdict ? { legacySurfaceStatus: codex.surfaceVerdict } : {}),
    ...(codex && codex.surfaceVerdict === 'WARN' ? { warnings: ['Codex duplicate-surface matrix returned WARN; compatibility status is not a canonical evidence verdict'] } : {}),
  };

  return stage;
}

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  const stage = runGate(args);
  const output = `${JSON.stringify(stage, null, 2)}\n`;
  const exitCode = [VERDICTS.FAIL, VERDICTS.BLOCKED].includes(stage.verdict) ? 1 : 0;
  process.stdout.write(output, () => process.exit(exitCode));
}

module.exports = {
  CODEX_SURFACE_VERDICTS,
  discoverCodexSurface,
  discoverCodexSurfaces,
  evaluateCodexSurfaceMatrix,
  fingerprintDir,
  fingerprintPath,
  fingerprintProjectSkill,
  redactEvidence,
  runCodexNamedRoleProbe,
  validateCodexAgentMaterialization,
  verifyCodexSync,
  verifyCursorSync,
  verifyProjectedConsumer,
  normalizeGateSurface,
  runGate,
};
