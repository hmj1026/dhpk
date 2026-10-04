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
const { loadMarketplaceHostPublication } = require('../lib/marketplace-host-publication');
const { validateAgentPluginPackage } = require('../lib/agent-plugin-package');

const DEFAULT_ROOT = path.join(__dirname, '..', '..');
const CODEX_SURFACE_VERDICTS = Object.freeze({ PASS: 'PASS', WARN: 'WARN', BLOCKED: 'BLOCKED' });
const CLAUDE_CLI_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?(?:\s+\([^()\r\n]+\))?$/;
const CONSUMER_SURFACES = Object.freeze([
  'claude-core',
  'codex-sync',
  'codex-native',
  'cursor-sync',
  'agent-plugin',
  'cursor-plugin',
]);
const CONSUMER_REQUIREMENTS_SCHEMA = 'dhpk.consumer-requirements.v1';
const CONSUMER_SURFACE_HOSTS = Object.freeze({
  'claude-core': 'claude',
  'codex-sync': 'codex',
  'codex-native': 'codex',
  'cursor-sync': 'cursor',
  'agent-plugin': 'cursor',
  'cursor-plugin': 'cursor',
});
const CONSUMER_HOST_CONFIG_MARKERS = Object.freeze({
  claude: Object.freeze(['.claude-plugin/plugin.json']),
  codex: Object.freeze(['.codex/config.toml']),
  cursor: Object.freeze([
    '.cursor/.dhpk-installed.json',
    'plugins/dhpk-agent/plugin.json',
    '.cursor-plugin/plugin.json',
    '.cursor/plugins/local/dhpk-agent/plugin.json',
    '.cursor/plugins/local/dhpk-cursor/.cursor-plugin/plugin.json',
  ]),
});
const CONSUMER_REQUIREMENT_TRIGGERS = new Set([
  'new-host',
  'loader-change',
  'role-registration-change',
  'tool-mapping-change',
  'activation-defect',
  'explicit-native',
]);
const MAX_REQUIREMENTS_BYTES = 64 * 1024;
const MAX_REQUIREMENT_CHECKS = 64;
const REQUIREMENT_TEXT_CONTROL = /[\u0000-\u001f\u007f]/;

function requirementText(value, label, maximum) {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maximum
    || REQUIREMENT_TEXT_CONTROL.test(value)) {
    throw new Error(`requirements ${label} must be a bounded, non-empty single-line string`);
  }
  return value.trim();
}

function readRequirementsFileBounded(filePath) {
  const initialStat = fs.lstatSync(filePath);
  if (!initialStat.isFile() || initialStat.isSymbolicLink()) {
    throw new Error('requirements input must be a regular file');
  }

  const flags = fs.constants.O_RDONLY
    | (fs.constants.O_NONBLOCK || 0)
    | (fs.constants.O_NOFOLLOW || 0);
  const descriptor = fs.openSync(filePath, flags);
  try {
    const openedStat = fs.fstatSync(descriptor);
    if (!openedStat.isFile()) throw new Error('requirements input must be a regular file');
    if (openedStat.size > MAX_REQUIREMENTS_BYTES) throw new Error('requirements file exceeds the configured byte limit');
    if (initialStat.dev !== openedStat.dev || initialStat.ino !== openedStat.ino) {
      throw new Error('requirements file changed before it could be read');
    }

    const buffer = Buffer.alloc(openedStat.size);
    let offset = 0;
    while (offset < buffer.length) {
      const count = fs.readSync(descriptor, buffer, offset, Math.min(16 * 1024, buffer.length - offset), offset);
      if (count === 0) throw new Error('requirements file changed while it was read');
      offset += count;
    }
    const extra = Buffer.alloc(1);
    if (fs.readSync(descriptor, extra, 0, 1, offset) !== 0) {
      throw new Error('requirements file exceeds the configured byte limit');
    }

    const finalStat = fs.fstatSync(descriptor);
    if (openedStat.dev !== finalStat.dev || openedStat.ino !== finalStat.ino
      || openedStat.size !== finalStat.size
      || openedStat.mtimeMs !== finalStat.mtimeMs
      || openedStat.ctimeMs !== finalStat.ctimeMs) {
      throw new Error('requirements file changed while it was read');
    }
    return buffer;
  } finally {
    fs.closeSync(descriptor);
  }
}

function hasConfiguredHostMarker(root, marker) {
  let current = path.resolve(root);
  const parts = marker.split('/');
  for (let index = 0; index < parts.length; index += 1) {
    current = path.join(current, parts[index]);
    let stat;
    try {
      stat = fs.lstatSync(current);
    } catch (_) {
      return false;
    }
    if (stat.isSymbolicLink()) return false;
    if (index < parts.length - 1 ? !stat.isDirectory() : !stat.isFile()) return false;
  }
  return true;
}

function configuredHostMarkers(root, surface) {
  return CONSUMER_HOST_CONFIG_MARKERS[CONSUMER_SURFACE_HOSTS[surface]]
    .filter((marker) => hasConfiguredHostMarker(root, marker));
}

function configuredConsumerSurfaces(root) {
  return CONSUMER_SURFACES.filter((surface) => configuredHostMarkers(root, surface).length > 0);
}

function parseRequirementsFile(filePath) {
  let source;
  try {
    source = readRequirementsFileBounded(filePath).toString('utf8');
  } catch (_) {
    throw new Error('requirements file could not be read within the configured bounds');
  }
  let requirements;
  try {
    requirements = JSON.parse(source);
  } catch (_) {
    throw new Error('requirements file is not valid JSON');
  }
  if (!requirements || typeof requirements !== 'object' || Array.isArray(requirements)
    || Object.keys(requirements).some((key) => !['schema', 'selectedSurfaces', 'checks'].includes(key))) {
    throw new Error('requirements must be an object with only schema, selectedSurfaces, and checks');
  }
  if (requirements.schema !== CONSUMER_REQUIREMENTS_SCHEMA) {
    throw new Error(`requirements schema must be '${CONSUMER_REQUIREMENTS_SCHEMA}'`);
  }
  if (!Array.isArray(requirements.checks) || requirements.checks.length === 0
    || requirements.checks.length > MAX_REQUIREMENT_CHECKS) {
    throw new Error(`requirements checks must contain 1-${MAX_REQUIREMENT_CHECKS} entries`);
  }
  let selectedSurfaces = null;
  if (requirements.selectedSurfaces !== undefined) {
    if (!Array.isArray(requirements.selectedSurfaces) || requirements.selectedSurfaces.length === 0
      || requirements.selectedSurfaces.length > CONSUMER_SURFACES.length) {
      throw new Error('requirements selectedSurfaces must be a non-empty bounded array');
    }
    if (requirements.selectedSurfaces.some((surface) => !CONSUMER_SURFACES.includes(surface))
      || new Set(requirements.selectedSurfaces).size !== requirements.selectedSurfaces.length) {
      throw new Error('requirements selectedSurfaces contains an unknown or duplicate surface');
    }
    selectedSurfaces = requirements.selectedSurfaces.slice();
  }
  const seen = new Set();
  const checks = requirements.checks.map((check) => {
    const allowedFields = ['id', 'surface', 'host', 'capability', 'trigger', 'reason', 'question', 'evidenceKind', 'authorization'];
    if (!check || typeof check !== 'object' || Array.isArray(check)
      || Object.keys(check).some((key) => !allowedFields.includes(key))) {
      throw new Error('requirements check contains an unknown field or is not an object');
    }
    if (typeof check.id !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(check.id) || seen.has(check.id)) {
      throw new Error('requirements check id is invalid or duplicated');
    }
    seen.add(check.id);
    if (!CONSUMER_SURFACES.includes(check.surface)) throw new Error(`requirements check '${check.id}' has an unknown surface`);
    if (check.host !== CONSUMER_SURFACE_HOSTS[check.surface]) {
      throw new Error(`requirements check '${check.id}' host does not match its surface`);
    }
    if (!CONSUMER_REQUIREMENT_TRIGGERS.has(check.trigger)) throw new Error(`requirements check '${check.id}' has an unknown trigger`);
    if (!['contract', 'native'].includes(check.evidenceKind)) {
      throw new Error(`requirements check '${check.id}' evidenceKind must be contract or native`);
    }
    if (!check.authorization || typeof check.authorization !== 'object' || Array.isArray(check.authorization)
      || Object.keys(check.authorization).some((key) => key !== 'authorized')
      || typeof check.authorization.authorized !== 'boolean') {
      throw new Error(`requirements check '${check.id}' authorization.authorized must be a boolean`);
    }
    const capability = requirementText(check.capability, `check '${check.id}' capability`, 80);
    if (!/^[a-z][a-z0-9-]{0,79}$/.test(capability)) {
      throw new Error(`requirements check '${check.id}' capability must be a bounded identifier`);
    }
    return {
      id: check.id,
      surface: check.surface,
      host: check.host,
      capability,
      trigger: check.trigger,
      reason: requirementText(check.reason, `check '${check.id}' reason`, 240),
      question: requirementText(check.question, `check '${check.id}' question`, 240),
      evidenceKind: check.evidenceKind,
      authorization: { authorized: check.authorization.authorized },
    };
  });
  if (selectedSurfaces === null) selectedSurfaces = [...new Set(checks.map((check) => check.surface))];
  return { schema: CONSUMER_REQUIREMENTS_SCHEMA, selectedSurfaces, checks };
}

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
      const hasMarketplacePublication = Object.prototype.hasOwnProperty.call(provenance, 'marketplacePublication');
      let marketplacePublicationMatches = true;
      let expectedNativeSkills;
      if (hasMarketplacePublication) {
        let hostPublication = null;
        try {
          hostPublication = loadMarketplaceHostPublication({ root, inventory, hostSurface: 'codex-native' });
        } catch (_) { /* claimed marketplace provenance must fail closed */ }
        if (hostPublication) {
          expectedNativeSkills = [...hostPublication.publicEntries, ...hostPublication.hostOnly];
          const expectedPublicEntryIds = hostPublication.publicEntries.map((skill) => skill.id).sort();
          const expectedHostOnlyIds = hostPublication.hostOnly.map((skill) => skill.id).sort();
          const claimedPublication = provenance.marketplacePublication;
          marketplacePublicationMatches = Boolean(
            claimedPublication
            && claimedPublication.selectionDigest === hostPublication.selectionDigest
            && JSON.stringify(claimedPublication.publicEntryIds) === JSON.stringify(expectedPublicEntryIds)
            && JSON.stringify(claimedPublication.hostOnlyIds) === JSON.stringify(expectedHostOnlyIds)
          );
        } else {
          expectedNativeSkills = [];
          marketplacePublicationMatches = false;
        }
      } else {
        expectedNativeSkills = inventory && Array.isArray(inventory.skills)
          ? inventory.skills.filter((skill) => (
            (skill.surfaces || []).includes('codex-native')
            && skill.lifecycle !== 'deprecated'
            && (!selectedSet || selectedSet.has(skill.id) || runtimeSupportSet.has(skill.id))
          ))
          : [];
      }
      const expectedNativeIds = expectedNativeSkills.map((skill) => skill.id).sort();
      const expectedNativeNames = expectedNativeSkills.map((skill) => skill.name || skill.id).sort();
      const selectedNativeIds = Array.isArray(provenance.materializedSkillIds)
        ? [...provenance.materializedSkillIds].sort()
        : Array.isArray(provenance.selectedSkillIds) ? [...provenance.selectedSkillIds].sort() : [];
      const selectedNativeNames = Array.isArray(provenance.materializedSkillNames)
        ? [...provenance.materializedSkillNames].sort()
        : Array.isArray(provenance.selectedSkillNames) ? [...provenance.selectedSkillNames].sort() : [];
      const membershipMatches = marketplacePublicationMatches
        && JSON.stringify(selectedNativeIds) === JSON.stringify(expectedNativeIds)
        && JSON.stringify(selectedNativeNames) === JSON.stringify(expectedNativeNames)
        && JSON.stringify(Object.keys(nativeFingerprints).sort()) === JSON.stringify(expectedNativeNames);
      const expectedInventoryDigest = inventory
        ? crypto.createHash('sha256').update(JSON.stringify(inventory)).digest('hex')
        : null;
      // Pre-profile packages deliberately bind the legacy inventory contract,
      // which excludes profile policy, standalone dependencies, and the
      // compiler-owned project-agent projection. Accept that digest while the
      // package carries no selection identity; profile-aware packages use the
      // same source digest and are checked against their selected/emitted IDs
      // above.
      const legacyInventory = inventory ? { ...inventory } : null;
      if (legacyInventory) {
        delete legacyInventory.profile_policy;
        delete legacyInventory.standalone_dependencies;
        delete legacyInventory.project_agent_projection;
      }
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
  return {
    project: applyCodexHostBindingOwnership(project, projectEntries),
    native: nativeEntries,
    manifest,
    nonInvokableSkillNames,
  };
}

function applyCodexHostBindingOwnership(project, entries) {
  const projectionPath = path.join(project, '.agents', '.dhpk-installed.json');
  let projection;
  try {
    projection = JSON.parse(readFileBounded(projectionPath).toString('utf8'));
  } catch {
    return entries;
  }
  const host = projection && projection.hostBindings && projection.hostBindings.codex;
  const bindings = host && Array.isArray(host.bindings) ? host.bindings : [];
  const expectedByName = new Map();
  const skillName = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  for (const binding of bindings) {
    if (!binding || binding.shape !== 'native-link' || typeof binding.path !== 'string' || typeof binding.target !== 'string') {
      continue;
    }
    const name = binding.path.split('/').pop();
    const expectedPath = `.codex/skills/${name}`;
    const expectedTarget = `../../.agents/skills/${name}`;
    if (binding.path !== expectedPath || binding.target !== expectedTarget || !skillName.test(name)) continue;
    expectedByName.set(name, expectedTarget);
  }
  if (expectedByName.size === 0) return entries;
  return entries.map((entry) => {
    if (!entry || entry.kind !== 'skills' || entry.owned === true) return entry;
    const expectedTarget = expectedByName.get(entry.id);
    if (!expectedTarget) return entry;
    const dest = path.join(project, '.codex', 'skills', entry.id);
    try {
      if (!fs.lstatSync(dest).isSymbolicLink() || fs.readlinkSync(dest) !== expectedTarget) return entry;
    } catch {
      return entry;
    }
    return { ...entry, owned: true };
  });
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
    else if (arg === '--requirements') {
      const value = argv[++i];
      if (!value || value.startsWith('--') || args.requirementsFile) {
        console.error('consumer-gate: --requirements requires one JSON file path');
        process.exit(2);
      }
      args.requirementsFile = value;
    }
    else {
      console.error(`consumer-gate: unknown argument '${arg}'`);
      process.exit(2);
    }
  }
  if (!args.version) {
    console.error('usage: consumer-gate.js --version X.Y.Z [--repo-root <path>] [--surface <surface>] [--requirements <json-file>]');
    process.exit(2);
  }
  if (args.surface && !CONSUMER_SURFACES.includes(args.surface)) {
    console.error(`consumer-gate: unknown surface '${args.surface}'`);
    process.exit(2);
  }
  if (args.requirementsFile) {
    try {
      args.requirements = parseRequirementsFile(args.requirementsFile);
    } catch (error) {
      console.error(`consumer-gate: invalid --requirements: ${error.message}`);
      process.exit(2);
    }
    if (args.surface && (args.requirements.selectedSurfaces.length !== 1
      || args.requirements.selectedSurfaces[0] !== args.surface)) {
      console.error('consumer-gate: --surface conflicts with the --requirements selected surface scope');
      process.exit(2);
    }
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

function receiptBoundedFileFingerprint(target, boundary) {
  if (hasSymlinkedAncestor(target, boundary)) return '';
  let stat;
  try { stat = fs.lstatSync(target); } catch (_) { return ''; }
  if (stat.isSymbolicLink() || !stat.isFile() || !insideRealRoot(target, boundary)) return '';
  try {
    readFileBounded(target);
    return fingerprintPath(target, { allowedRoots: [boundary] });
  } catch (_) {
    return '';
  }
}

function receiptBoundedResourceFingerprint(target, boundary, expectedSource, sourceBoundary, mode) {
  if (mode === 'copy') return receiptBoundedFileFingerprint(target, boundary);
  if (mode !== 'symlink' || hasSymlinkedAncestor(path.dirname(target), boundary)
    || !insideRealRoot(path.dirname(target), boundary)) return '';
  let targetStat;
  let realTarget;
  let realSource;
  try {
    targetStat = fs.lstatSync(target);
    if (!targetStat.isSymbolicLink()) return '';
    realTarget = fs.realpathSync(target);
    realSource = fs.realpathSync(expectedSource);
  } catch (_) {
    return '';
  }
  if (realTarget !== realSource || !insideRealRoot(realSource, sourceBoundary)) return '';
  try {
    readFileBounded(realTarget);
    return fingerprintPath(realTarget, { allowedRoots: [sourceBoundary] });
  } catch (_) {
    return '';
  }
}

function observeCodexRoleMaterialization(project, root, receipt, role) {
  const relativeRole = `agents/${role}.toml`;
  const sourceRole = path.join(root, 'codex', 'agents', `${role}.toml`);
  const installedRole = path.join(project, '.codex', ...relativeRole.split('/'));
  const roleEntry = receipt && receipt.managed_entries && receipt.managed_entries.agents
    ? receipt.managed_entries.agents[`${role}.toml`]
    : null;
  const sourceFingerprint = receiptBoundedFileFingerprint(sourceRole, root);
  const destinationFingerprint = receiptBoundedFileFingerprint(installedRole, project);
  const roleEvidence = {
    path: relativeRole,
    ...(sourceFingerprint ? { sourceFingerprint } : {}),
    ...(destinationFingerprint ? {
      fingerprint: destinationFingerprint,
      destinationFingerprint,
    } : {}),
  };
  const resources = [];
  let reason = 'Codex role and its receipt-owned resources match the canonical projection';
  let passed = Boolean(roleEntry
    && roleEntry.destination === relativeRole
    && roleEntry.source === relativeRole
    && roleEntry.mode === 'copy'
    && sourceFingerprint
    && destinationFingerprint
    && /^[a-f0-9]{64}$/.test(roleEntry.source_fingerprint || '')
    && /^[a-f0-9]{64}$/.test(roleEntry.destination_fingerprint || '')
    && sourceFingerprint === roleEntry.source_fingerprint
    && destinationFingerprint === roleEntry.destination_fingerprint
    && sourceFingerprint === destinationFingerprint);
  let roleText = '';
  try {
    roleText = readFileBounded(installedRole).toString('utf8');
  } catch (_) {
    passed = false;
  }
  if (!roleEntry || !sourceFingerprint || !destinationFingerprint) {
    reason = 'Codex role is missing, unsafe, or not receipt-owned';
  } else if (!passed) {
    reason = 'Codex role does not match its canonical source and receipt fingerprints';
  }

  const references = [...new Set(roleText.match(/\.codex\/dhpk\/[A-Za-z0-9._/<>{}-]+\.md/g) || [])]
    .filter((reference) => !reference.includes('<') && !reference.includes('>'));
  let inventory = null;
  try {
    inventory = JSON.parse(readFileBounded(path.join(root, 'manifests', 'distribution-inventory.json')).toString('utf8'));
  } catch (_) {
    passed = false;
    reason = 'Codex role resource inventory could not be read safely';
  }
  const assetSources = new Map((inventory && Array.isArray(inventory.supporting_assets) ? inventory.supporting_assets : [])
    .filter((asset) => asset && typeof asset.source === 'string' && typeof asset.destination === 'string')
    .map((asset) => [asset.destination, asset.source]));
  const supportingAssets = receipt && receipt.managed_entries && receipt.managed_entries.supporting_assets;
  for (const reference of references) {
    const resourceRelative = reference.slice('.codex/'.length);
    const resourceKey = resourceRelative;
    const relativeSource = assetSources.get(resourceKey);
    const entry = supportingAssets && supportingAssets[resourceKey];
    const safeSource = typeof relativeSource === 'string'
      && !path.posix.isAbsolute(relativeSource)
      && !relativeSource.split('/').includes('..')
      && !relativeSource.includes('\\');
    const sourcePath = safeSource ? path.join(root, ...relativeSource.split('/')) : '';
    const destinationPath = path.join(project, '.codex', ...resourceRelative.split('/'));
    const resourceSourceFingerprint = safeSource ? receiptBoundedFileFingerprint(sourcePath, root) : '';
    const resourceDestinationFingerprint = safeSource
      ? receiptBoundedResourceFingerprint(destinationPath, project, sourcePath, root, entry && entry.mode)
      : '';
    const valid = Boolean(entry
      && entry.destination === resourceRelative
      && entry.source === resourceRelative
      && ['copy', 'symlink'].includes(entry.mode)
      && resourceSourceFingerprint
      && resourceDestinationFingerprint
      && /^[a-f0-9]{64}$/.test(entry.source_fingerprint || '')
      && /^[a-f0-9]{64}$/.test(entry.destination_fingerprint || '')
      && resourceSourceFingerprint === entry.source_fingerprint
      && resourceDestinationFingerprint === entry.destination_fingerprint
      && resourceSourceFingerprint === resourceDestinationFingerprint);
    resources.push({
      path: reference,
      ...(resourceSourceFingerprint ? { sourceFingerprint: resourceSourceFingerprint } : {}),
      ...(resourceDestinationFingerprint ? {
        fingerprint: resourceDestinationFingerprint,
        destinationFingerprint: resourceDestinationFingerprint,
      } : {}),
    });
    if (!valid) {
      passed = false;
      reason = 'Codex role references a missing, unsafe, or mismatched receipt-owned resource';
    }
  }
  return {
    status: passed ? 'PASS' : 'FAIL',
    adapterRoute: 'codex-role-materialization',
    reason,
    role: roleEvidence,
    resources,
  };
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
  // A parallel release probe runs with a private HOME/CODEX_HOME. When a
  // named-role runtime needs credentials, the coordinator supplies an
  // explicit read-only host source; never infer it from the private HOME.
  const sourceCodexHome = path.resolve(
    env.DHPK_CONSUMER_PROBE_HOST_CODEX_HOME
      || env.CODEX_HOME
      || path.join(os.homedir(), '.codex'),
  );
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

function verifyCodexSync(root, version, options = {}) {
  const commands = [];
  const project = mkTempProject();
  try {
    const installer = path.join(root, 'scripts', 'hooks', 'install-codex-skills.sh');
    const res = spawnSync('bash', [installer, '--force'], {
      cwd: project,
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_PLUGIN_ROOT: root, DHPK_CODEX_CONSUMER_EVIDENCE: '' },
    });
    commands.push({ cmd: `bash ${path.relative(root, installer).split(path.sep).join('/')} --force (in clean project)`, exitCode: res.status });
    if (res.status !== 0) {
      return { verdict: VERDICTS.FAIL, commands, reasons: [`install-codex-skills.sh exited ${res.status}: ${redactEvidence((res.stderr || '').trim(), root)}`] };
    }
    const manifestPath = path.join(project, '.codex', '.dhpk-installed.json');
    if (!fs.existsSync(manifestPath)) {
      return { verdict: VERDICTS.FAIL, commands, reasons: ['no .codex/.dhpk-installed.json manifest after install'] };
    }
    const manifest = JSON.parse(readFileBounded(manifestPath).toString('utf8'));
    const runtimeNames = inventoryRuntimeSkillNames(root, 'codex-native');
    const runtimeNameSet = new Set(runtimeNames);
    const leftoverSkills = Object.keys((manifest.managed_entries && manifest.managed_entries.skills) || {})
      .filter((name) => !runtimeNameSet.has(name));
    const leftoverDirs = leftoverCodexNativeSkillDirectories(project, { ignore: runtimeNames });
    const leftoverCopies = leftoverSkills.concat(leftoverDirs.ok ? leftoverDirs.leftovers : []);
    const hasPhysicalEntries = (directory) => {
      let stat;
      try { stat = fs.lstatSync(directory); } catch (_) { return false; }
      return stat.isDirectory() && readDirectoryEntries(directory, { sort: false }).length > 0;
    };
    const agentsPresent = hasPhysicalEntries(path.join(project, '.codex', 'agents'));
    const supportingAssets = manifest.managed_entries && manifest.managed_entries.supporting_assets;
    const promptDefensePresent = fs.existsSync(path.join(project, '.codex', 'dhpk', 'agent-traps', '_common', 'prompt-defense.md'));
    if (!agentsPresent || !supportingAssets || Object.keys(supportingAssets).length === 0 || !promptDefensePresent) {
      return {
        verdict: VERDICTS.FAIL,
        commands,
        reasons: ['expected agents and receipt-managed Codex supporting assets to materialize under .codex/ after install'],
      };
    }
    if (manifest.plugin_version !== version) {
      return { verdict: VERDICTS.FAIL, commands, reasons: [`installed manifest version '${manifest.plugin_version}' does not match target '${version}'`] };
    }
    if (manifest.schema_version < 3 || !manifest.managed_entries || !manifest.managed_entries.agents || !manifest.managed_entries.supporting_assets) {
      return { verdict: VERDICTS.FAIL, commands, reasons: ['installed manifest is missing schema-v3 managed_entries ownership data'] };
    }
    if (leftoverCopies.length > 0 || !leftoverDirs.ok) {
      return {
        verdict: VERDICTS.FAIL,
        commands,
        reasons: [`Codex sync leftover native skill copies: ${leftoverCopies.slice(0, 10).join(', ') || leftoverDirs.reason}`],
      };
    }
    const nativeLinks = verifyCodexNativeLinkProjection(project, { ignore: runtimeNames });
    if (!nativeLinks.ok) {
      return {
        verdict: VERDICTS.FAIL,
        commands,
        reasons: [`codex-sync: ${redactEvidence(nativeLinks.reason, root)}`],
      };
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
    const targetedRequirementEvidence = {};
    const roleContracts = new Map();
    for (const check of options.roleChecks || []) {
      if (!roleContracts.has(check.role)) {
        roleContracts.set(check.role, observeCodexRoleMaterialization(project, root, manifest, check.role));
      }
      const contractEvidence = roleContracts.get(check.role);
      if (contractEvidence.status !== 'PASS') {
        targetedRequirementEvidence[check.checkKey] = {
          status: check.evidenceKind === 'contract' ? 'FAIL' : 'BLOCKED',
          observedStatus: contractEvidence.status,
          outcomeReason: contractEvidence.reason,
          ...(check.evidenceKind === 'contract' ? { contractEvidence } : {}),
        };
        continue;
      }
      if (check.evidenceKind === 'contract') {
        targetedRequirementEvidence[check.checkKey] = {
          status: 'PASS',
          observedStatus: 'PASS',
          outcomeReason: contractEvidence.reason,
          contractEvidence,
        };
        continue;
      }
      if (!check.authorized) {
        targetedRequirementEvidence[check.checkKey] = {
          status: 'BLOCKED',
          observedStatus: 'NOT_RUN',
          outcomeReason: 'native Codex role execution is not authorized',
        };
        continue;
      }
      const native = runCodexNamedRoleProbe(project, { roles: [check.role], env: process.env });
      const nativeProof = native.status === 'PASS' && native.runtimeEvidence
        && Array.isArray(native.runtimeEvidence.roles)
        && native.runtimeEvidence.roles.length === 1
        ? {
          executionOrigin: 'native',
          adapterRoute: 'codex-named-role',
          roles: native.runtimeEvidence.roles,
          registryPreconditions: native.runtimeEvidence.registryPreconditions,
          ...(native.cliVersion && native.cliVersion.trim().length <= 200
            ? { cliVersion: native.cliVersion.trim() }
            : {}),
        }
        : null;
      const status = native.status === 'PASS'
        ? (nativeProof ? 'PASS' : 'BLOCKED')
        : native.status === 'FAIL' ? 'FAIL' : 'BLOCKED';
      commands.push({
        cmd: `codex exec (authorized named-role ${check.role})`,
        exitCode: native.status === 'PASS' ? 0 : native.status === 'FAIL' ? 1 : null,
      });
      targetedRequirementEvidence[check.checkKey] = {
        status,
        observedStatus: native.status,
        outcomeReason: native.diagnostic || (nativeProof ? 'authorized Codex named role completed' : 'Codex role proof was incomplete'),
        ...(nativeProof ? { nativeProof } : {}),
      };
    }
    return {
      verdict: VERDICTS.PASS,
      status: 'NOT_RUN',
      commands,
      reasons,
      diagnostics: ['Codex installation and project-local materialization checks passed; named-role runtime was not invoked'],
      checkedClaims: ['physical-agent-materialization', 'codex-installation-contract'],
      installationEvidence: {
        status: 'PASS',
        reason: 'Codex installer receipt, ownership, physical agents, resource closure, and surface validation passed',
      },
      runtimeEvidence: {
        status: 'NOT_RUN',
        reason: 'Codex named-role runtime evidence is recorded only on its covered requirement',
      },
      targetedRequirementEvidence,
      surfaceVerdict,
      duplicateEvidence,
      surfaces: surfacesEvidence,
    };
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
  }
}

function leftoverNativeSkillDirectories(project, destRel, label, { required = true, ignore = [] } = {}) {
  const skillsRoot = path.join(project, destRel, 'skills');
  try {
    const rootStat = fs.lstatSync(skillsRoot);
    if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
      return { ok: false, reason: `${label} skills root is a symlink or not a directory`, leftovers: [] };
    }
  } catch (error) {
    if (!required && error && error.code === 'ENOENT') return { ok: true, leftovers: [] };
    return { ok: false, reason: `${label} skills root is missing (${redactEvidence(error.message, project)})`, leftovers: [] };
  }
  const ignored = new Set(Array.isArray(ignore) ? ignore : []);
  const leftovers = [];
  for (const name of fs.readdirSync(skillsRoot).sort()) {
    if (ignored.has(name)) continue;
    const entry = path.join(skillsRoot, name);
    try {
      const entryStat = fs.lstatSync(entry);
      if (entryStat.isDirectory() && !entryStat.isSymbolicLink()) leftovers.push(name);
    } catch {
      continue;
    }
  }
  return { ok: true, leftovers };
}

function leftoverCursorNativeSkillDirectories(project, options = {}) {
  return leftoverNativeSkillDirectories(project, '.cursor', 'Cursor', options);
}

function leftoverCodexNativeSkillDirectories(project, options = {}) {
  return leftoverNativeSkillDirectories(project, '.codex', 'Codex', options);
}

function inventoryRuntimeSkillNames(root, surface) {
  try {
    const inventory = JSON.parse(readFileBounded(path.join(root, 'manifests', 'distribution-inventory.json')).toString('utf8'));
    const ids = new Set(
      inventory && inventory.internal_runtime_skills && Array.isArray(inventory.internal_runtime_skills[surface])
        ? inventory.internal_runtime_skills[surface]
        : [],
    );
    return (Array.isArray(inventory && inventory.skills) ? inventory.skills : [])
      .filter((skill) => skill && ids.has(skill.id) && typeof skill.name === 'string' && skill.name)
      .map((skill) => skill.name);
  } catch {
    return [];
  }
}

function cursorHostProjectionPreconditions(project) {
  for (const relative of ['.agents', path.join('.agents', 'skills'), path.join('.cursor', 'skills')]) {
    if (hasSymlinkedAncestor(path.join(project, relative), project)) {
      return { ok: false, reason: `Cursor native-link ancestor is a symlink: ${relative}` };
    }
  }
  const projectionPath = path.join(project, '.agents', '.dhpk-installed.json');
  let projection;
  try {
    projection = JSON.parse(readFileBounded(projectionPath).toString('utf8'));
  } catch (error) {
    return { ok: false, reason: `Cursor shared projection receipt is unreadable: ${redactEvidence(error.message, project)}` };
  }
  const cursorHost = projection && projection.hostBindings && projection.hostBindings.cursor;
  if (!cursorHost || (cursorHost.bindingShape !== 'native-link' && cursorHost.bindingShape !== 'direct')) {
    return { ok: false, reason: 'Cursor shared projection is missing native-link Host Bindings' };
  }
  const leftoverDirs = leftoverCursorNativeSkillDirectories(project, {
    required: cursorHost.bindingShape !== 'direct',
  });
  if (!leftoverDirs.ok) return leftoverDirs;
  if (leftoverDirs.leftovers.length > 0) {
    return { ok: false, reason: `leftover native skill copies: ${leftoverDirs.leftovers.slice(0, 10).join(', ')}` };
  }
  return { ok: true, projection, cursorHost };
}

function verifyCursorDirectProjection(project, cursorHost) {
  const bindings = Array.isArray(cursorHost.bindings) ? cursorHost.bindings : [];
  if (bindings.length === 0) {
    return { ok: false, reason: 'Cursor shared projection has no direct skill bindings' };
  }
  const skillName = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  for (const binding of bindings) {
    if (!binding || binding.shape !== 'direct' || typeof binding.name !== 'string' || binding.path || binding.target) {
      return { ok: false, reason: 'Cursor direct binding is malformed' };
    }
    if (!skillName.test(binding.name)) {
      return { ok: false, reason: `Cursor direct binding is unsafe: ${binding.name}` };
    }
    const destination = path.join(project, '.cursor', 'skills', binding.name);
    try {
      fs.lstatSync(destination);
      return { ok: false, reason: `Cursor direct binding leftover native skill entry: ${binding.name}` };
    } catch (error) {
      if (!error || error.code !== 'ENOENT') {
        return { ok: false, reason: `Cursor direct binding cannot be verified: ${binding.name} (${redactEvidence(error.message, project)})` };
      }
    }
    const shared = path.join(project, '.agents', 'skills', binding.name);
    try {
      if (hasSymlinkedAncestor(shared, project)) {
        return { ok: false, reason: `Cursor native-link ancestor is a symlink: ${binding.name}` };
      }
      if (!insideRealRoot(shared, project)) {
        return { ok: false, reason: `Cursor shared skill is missing: ${binding.name}` };
      }
      const sharedStat = fs.lstatSync(shared);
      const skillStat = fs.lstatSync(path.join(shared, 'SKILL.md'));
      if (sharedStat.isSymbolicLink() || !sharedStat.isDirectory()
        || skillStat.isSymbolicLink() || !skillStat.isFile()) {
        return { ok: false, reason: `Cursor shared skill is missing: ${binding.name}` };
      }
    } catch (error) {
      return { ok: false, reason: `Cursor shared skill is missing: ${binding.name} (${redactEvidence(error.message, project)})` };
    }
  }
  return { ok: true, bindings, bindingShape: 'direct' };
}

function verifyCursorNativeLinkProjection(project) {
  const preconditions = cursorHostProjectionPreconditions(project);
  if (!preconditions.ok) return preconditions;
  if (preconditions.cursorHost.bindingShape === 'direct') {
    return verifyCursorDirectProjection(project, preconditions.cursorHost);
  }
  const cursorHost = preconditions.cursorHost;
  const bindings = Array.isArray(cursorHost.bindings) ? cursorHost.bindings : [];
  if (bindings.length === 0) {
    return { ok: false, reason: 'Cursor shared projection has no native-link skill bindings' };
  }
  const skillName = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  for (const binding of bindings) {
    if (!binding || binding.shape !== 'native-link' || typeof binding.path !== 'string' || typeof binding.target !== 'string') {
      return { ok: false, reason: 'Cursor native-link binding is malformed' };
    }
    const name = binding.path.split('/').pop();
    const expectedPath = `.cursor/skills/${name}`;
    const expectedTarget = `../../.agents/skills/${name}`;
    if (binding.path !== expectedPath || binding.target !== expectedTarget || !skillName.test(name)) {
      return { ok: false, reason: `Cursor native-link binding is unsafe: ${binding.path}` };
    }
    const destination = path.join(project, binding.path);
    const shared = path.join(project, '.agents', 'skills', name);
    try {
      if (!fs.lstatSync(destination).isSymbolicLink() || fs.readlinkSync(destination) !== expectedTarget) {
        return { ok: false, reason: `Cursor native-link is missing or retargeted: ${binding.path}` };
      }
      if (hasSymlinkedAncestor(path.dirname(destination), project) || hasSymlinkedAncestor(shared, project)) {
        return { ok: false, reason: `Cursor native-link ancestor is a symlink: ${binding.path}` };
      }
      if (!insideRealRoot(destination, project) || !insideRealRoot(shared, project)
        || fs.realpathSync(destination) !== fs.realpathSync(shared)) {
        return { ok: false, reason: `Cursor native-link is missing or retargeted: ${binding.path}` };
      }
      const sharedStat = fs.lstatSync(shared);
      const skillStat = fs.lstatSync(path.join(shared, 'SKILL.md'));
      if (sharedStat.isSymbolicLink() || !sharedStat.isDirectory()
        || skillStat.isSymbolicLink() || !skillStat.isFile()) {
        return { ok: false, reason: `Cursor shared skill is missing: ${name}` };
      }
    } catch (error) {
      return { ok: false, reason: `Cursor native-link cannot be verified: ${binding.path} (${redactEvidence(error.message, project)})` };
    }
  }
  return { ok: true, bindings, bindingShape: 'native-link' };
}

function codexHostProjectionPreconditions(project, options = {}) {
  for (const relative of ['.agents', path.join('.agents', 'skills'), path.join('.codex', 'skills')]) {
    if (hasSymlinkedAncestor(path.join(project, relative), project)) {
      return { ok: false, reason: `Codex native-link ancestor is a symlink: ${relative}` };
    }
  }
  const projectionPath = path.join(project, '.agents', '.dhpk-installed.json');
  let projection;
  try {
    projection = JSON.parse(readFileBounded(projectionPath).toString('utf8'));
  } catch (error) {
    return { ok: false, reason: `Codex shared projection receipt is unreadable: ${redactEvidence(error.message, project)}` };
  }
  const codexHost = projection && projection.hostBindings && projection.hostBindings.codex;
  if (!codexHost || (codexHost.bindingShape !== 'native-link' && codexHost.bindingShape !== 'direct')) {
    return { ok: false, reason: 'Codex shared projection is missing native-link Host Bindings' };
  }
  const leftoverDirs = leftoverCodexNativeSkillDirectories(project, {
    required: codexHost.bindingShape !== 'direct',
    ignore: options.ignore || [],
  });
  if (!leftoverDirs.ok) return leftoverDirs;
  if (leftoverDirs.leftovers.length > 0) {
    return { ok: false, reason: `leftover native skill copies: ${leftoverDirs.leftovers.slice(0, 10).join(', ')}` };
  }
  return { ok: true, projection, codexHost };
}

function verifyCodexDirectProjection(project, codexHost) {
  const bindings = Array.isArray(codexHost.bindings) ? codexHost.bindings : [];
  if (bindings.length === 0) {
    return { ok: false, reason: 'Codex shared projection has no direct skill bindings' };
  }
  const skillName = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  for (const binding of bindings) {
    if (!binding || binding.shape !== 'direct' || typeof binding.name !== 'string' || binding.path || binding.target) {
      return { ok: false, reason: 'Codex direct binding is malformed' };
    }
    if (!skillName.test(binding.name)) {
      return { ok: false, reason: `Codex direct binding is unsafe: ${binding.name}` };
    }
    const destination = path.join(project, '.codex', 'skills', binding.name);
    try {
      fs.lstatSync(destination);
      return { ok: false, reason: `Codex direct binding leftover native skill entry: ${binding.name}` };
    } catch (error) {
      if (!error || error.code !== 'ENOENT') {
        return { ok: false, reason: `Codex direct binding cannot be verified: ${binding.name} (${redactEvidence(error.message, project)})` };
      }
    }
    const shared = path.join(project, '.agents', 'skills', binding.name);
    try {
      if (hasSymlinkedAncestor(shared, project)) {
        return { ok: false, reason: `Codex native-link ancestor is a symlink: ${binding.name}` };
      }
      if (!insideRealRoot(shared, project)) {
        return { ok: false, reason: `Codex shared skill is missing: ${binding.name}` };
      }
      const sharedStat = fs.lstatSync(shared);
      const skillStat = fs.lstatSync(path.join(shared, 'SKILL.md'));
      if (sharedStat.isSymbolicLink() || !sharedStat.isDirectory()
        || skillStat.isSymbolicLink() || !skillStat.isFile()) {
        return { ok: false, reason: `Codex shared skill is missing: ${binding.name}` };
      }
    } catch (error) {
      return { ok: false, reason: `Codex shared skill is missing: ${binding.name} (${redactEvidence(error.message, project)})` };
    }
  }
  return { ok: true, bindings, bindingShape: 'direct' };
}

function verifyCodexNativeLinkProjection(project, options = {}) {
  const preconditions = codexHostProjectionPreconditions(project, options);
  if (!preconditions.ok) return preconditions;
  if (preconditions.codexHost.bindingShape === 'direct') {
    return verifyCodexDirectProjection(project, preconditions.codexHost);
  }
  const codexHost = preconditions.codexHost;
  const bindings = Array.isArray(codexHost.bindings) ? codexHost.bindings : [];
  if (bindings.length === 0) {
    return { ok: false, reason: 'Codex shared projection has no native-link skill bindings' };
  }
  const skillName = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  for (const binding of bindings) {
    if (!binding || binding.shape !== 'native-link' || typeof binding.path !== 'string' || typeof binding.target !== 'string') {
      return { ok: false, reason: 'Codex native-link binding is malformed' };
    }
    const name = binding.path.split('/').pop();
    const expectedPath = `.codex/skills/${name}`;
    const expectedTarget = `../../.agents/skills/${name}`;
    if (binding.path !== expectedPath || binding.target !== expectedTarget || !skillName.test(name)) {
      return { ok: false, reason: `Codex native-link binding is unsafe: ${binding.path}` };
    }
    const destination = path.join(project, binding.path);
    const shared = path.join(project, '.agents', 'skills', name);
    try {
      if (!fs.lstatSync(destination).isSymbolicLink() || fs.readlinkSync(destination) !== expectedTarget) {
        return { ok: false, reason: `Codex native-link is missing or retargeted: ${binding.path}` };
      }
      if (hasSymlinkedAncestor(path.dirname(destination), project) || hasSymlinkedAncestor(shared, project)) {
        return { ok: false, reason: `Codex native-link ancestor is a symlink: ${binding.path}` };
      }
      if (!insideRealRoot(destination, project) || !insideRealRoot(shared, project)
        || fs.realpathSync(destination) !== fs.realpathSync(shared)) {
        return { ok: false, reason: `Codex native-link is missing or retargeted: ${binding.path}` };
      }
      const sharedStat = fs.lstatSync(shared);
      const skillStat = fs.lstatSync(path.join(shared, 'SKILL.md'));
      if (sharedStat.isSymbolicLink() || !sharedStat.isDirectory()
        || skillStat.isSymbolicLink() || !skillStat.isFile()) {
        return { ok: false, reason: `Codex shared skill is missing: ${name}` };
      }
    } catch (error) {
      return { ok: false, reason: `Codex native-link cannot be verified: ${binding.path} (${redactEvidence(error.message, project)})` };
    }
  }
  return { ok: true, bindings, bindingShape: 'native-link' };
}

function hasSymlinkedAncestor(candidate, boundary) {
  let current = path.resolve(candidate);
  const stop = path.resolve(boundary);
  while (true) {
    try {
      if (fs.lstatSync(current).isSymbolicLink()) return current;
    } catch {
      return null;
    }
    if (current === stop) return null;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function insideRealRoot(candidate, root) {
  try {
    const relative = path.relative(fs.realpathSync(root), fs.realpathSync(candidate));
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
  } catch {
    return false;
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
        DHPK_CURSOR_CONSUMER_EVIDENCE: '',
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
        reasons: [`Cursor sync receipt is unreadable: ${redactEvidence(error.message, project)}`],
      };
    }
    const managedEntries = receipt.managed_entries;
    const nativeKinds = ['agents', 'rules', 'commands', 'supporting_assets'];
    const leftoverSkills = Object.keys((managedEntries && managedEntries.skills) || {});
    const leftoverDirs = leftoverCursorNativeSkillDirectories(project);
    const leftoverCopies = leftoverSkills.concat(leftoverDirs.ok ? leftoverDirs.leftovers : []);
    const missingKinds = nativeKinds.filter((kind) => !managedEntries || !managedEntries[kind] || Object.keys(managedEntries[kind]).length === 0);
    const unsafeEntries = [];
    const isSafeRelative = (value) => typeof value === 'string'
      && value.length > 0
      && !path.isAbsolute(value)
      && !value.includes('\\')
      && path.posix.normalize(value) === value
      && value !== '.'
      && value !== '..'
      && !value.startsWith('../');
    for (const kind of nativeKinds) {
      for (const [name, entry] of Object.entries((managedEntries && managedEntries[kind]) || {})) {
        if (!entry || !isSafeRelative(entry.source) || !isSafeRelative(entry.destination)
          || !/^[a-f0-9]{64}$/i.test(entry.source_fingerprint || '')
          || !/^[a-f0-9]{64}$/i.test(entry.destination_fingerprint || '')) {
          unsafeEntries.push(`${kind}/${name}`);
        }
      }
    }
    if (receipt.schema_version !== 3 || receipt.state !== 'current' || receipt.plugin_version !== version
      || !/^[a-f0-9]{64}$/i.test(receipt.source_fingerprint || '') || missingKinds.length > 0 || unsafeEntries.length > 0
      || leftoverCopies.length > 0 || !leftoverDirs.ok) {
      return {
        verdict: VERDICTS.FAIL,
        status: 'FAIL',
        commands,
        reasons: [`Cursor sync receipt failed schema/version/ownership checks${missingKinds.length > 0 ? `; missing managed entries: ${missingKinds.join(', ')}` : ''}${unsafeEntries.length > 0 ? `; unsafe or incomplete entries: ${unsafeEntries.slice(0, 10).join(', ')}` : ''}${leftoverCopies.length > 0 ? `; leftover native skill copies: ${leftoverCopies.slice(0, 10).join(', ')}` : ''}${leftoverDirs.ok ? '' : `; ${leftoverDirs.reason}`}`],
      };
    }

    const nativeLinks = verifyCursorNativeLinkProjection(project);
    if (!nativeLinks.ok) {
      return {
        verdict: VERDICTS.FAIL,
        status: 'FAIL',
        commands,
        reasons: [nativeLinks.reason],
      };
    }

    // The installer proves isolated project-local synchronization only.  No
    // Cursor client/GUI loader is invoked here, so this row must remain
    // NOT_RUN rather than being promoted to consumer-runtime PASS.
    return {
      verdict: VERDICTS.PENDING,
      status: 'NOT_RUN',
      installationEvidence: {
        status: 'PASS',
        reason: 'Cursor sync validator, schema-v3 receipt, managed resource set, ownership, and native-link checks passed',
      },
      runtimeEvidence: {
        status: 'NOT_RUN',
        reason: 'Cursor client runtime/loader was not invoked',
      },
      commands,
      artifacts: [{
        receipt: '<sandbox>/.cursor/.dhpk-installed.json',
        schemaVersion: receipt.schema_version,
        pluginVersion: receipt.plugin_version,
        sourceFingerprint: receipt.source_fingerprint,
        managedCounts: Object.fromEntries(nativeKinds.map((kind) => [kind, Object.keys(managedEntries[kind]).length])),
      }, {
        receipt: '<sandbox>/.agents/.dhpk-installed.json',
        bindingShape: nativeLinks.bindingShape || 'native-link',
        nativeLinkBindings: nativeLinks.bindings.length,
      }],
      reasons: ['isolated Cursor project-local sync receipt verified; Cursor client runtime/loader was not invoked'],
    };
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
  }
}

function claudeCliVersion() {
  const result = spawnSync('claude', ['--version'], { encoding: 'utf8' });
  const output = [result.stdout, result.stderr]
    .filter((value) => typeof value === 'string')
    .flatMap((value) => value.split(/\r?\n/))
    .map((value) => value.trim())
    .find(Boolean) || null;
  if (result.error && result.error.code === 'ENOENT') {
    return {
      cmd: 'claude --version',
      status: 'UNAVAILABLE',
      exitCode: null,
      version: null,
      diagnostic: 'claude CLI not found on PATH',
    };
  }
  if (result.error) {
    return {
      cmd: 'claude --version',
      status: 'FAIL',
      exitCode: result.status,
      version: null,
      diagnostic: `claude --version failed: ${result.error.message}`,
    };
  }
  if (result.status !== 0) {
    return {
      cmd: 'claude --version',
      status: 'FAIL',
      exitCode: result.status,
      version: null,
      diagnostic: `claude --version exited ${result.status}`,
    };
  }
  if (!output || !CLAUDE_CLI_VERSION_PATTERN.test(output)) {
    return {
      cmd: 'claude --version',
      status: 'FAIL',
      exitCode: result.status,
      version: null,
      diagnostic: 'claude --version returned malformed version output',
    };
  }
  return { cmd: 'claude --version', status: 'PASS', exitCode: result.status, version: output };
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
  const versionDiscovery = claudeCliVersion();
  const versionCommand = {
    cmd: 'claude --version',
    status: versionDiscovery.status,
    exitCode: versionDiscovery.exitCode,
    ...(versionDiscovery.version === null ? { version: null } : { claudeVersion: versionDiscovery.version }),
    ...(versionDiscovery.diagnostic ? { diagnostic: versionDiscovery.diagnostic } : {}),
  };
  const finish = (result) => ({
    ...result,
    ...(result.verdict === VERDICTS.PASS
      ? {
          installationEvidence: {
            status: VERDICTS.PASS,
            reason: 'official strict validation and project-scoped installed-cache validation passed',
          },
        }
      : {}),
    cliVersion: versionDiscovery.version,
    versionDiscovery,
  });
  if (versionDiscovery.status !== 'PASS') {
    const unavailable = versionDiscovery.status === 'UNAVAILABLE';
    const reason = unavailable
      ? `${versionDiscovery.diagnostic} — official strict validation is NOT RUN; Claude update/reinstall proof requires a clean CI runner or a fresh session`
      : `${versionDiscovery.diagnostic} — official strict validation is NOT RUN`;
    return finish({
      verdict: unavailable ? VERDICTS.UNAVAILABLE : VERDICTS.FAIL,
      commands: [versionCommand, { cmd: strictCommand, exitCode: null, status: 'NOT RUN' }],
      officialValidation: {
        verdict: 'NOT RUN',
        command: strictCommand,
        exitCode: null,
        reason,
      },
      reasons: [reason],
    });
  }
  const commands = [versionCommand];
  const cliVersion = versionDiscovery.version;
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
      return finish({
        verdict: VERDICTS.FAIL,
        commands,
        officialValidation: {
          verdict: 'FAIL',
          ...strictEvidence,
        },
        reasons: [`official Claude strict validation failed (exit ${strict.status})${output ? `: ${output}` : ''}`],
      });
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
      return finish({ verdict: VERDICTS.FAIL, commands, officialValidation, reasons: [`marketplace add exited ${add.status}: ${redactEvidence((add.stderr || '').trim(), root)}`], warnings });
    }

    const install = spawnSync('claude', ['plugin', 'install', 'dhpk@dhpk', '--scope', 'project'], { cwd: project, encoding: 'utf8' });
    commands.push({ cmd: 'claude plugin install dhpk@dhpk --scope project', exitCode: install.status });
    if (install.status !== 0) {
      return finish({ verdict: VERDICTS.FAIL, commands, officialValidation, reasons: [`plugin install exited ${install.status}: ${redactEvidence((install.stderr || '').trim(), root)}`], warnings });
    }

    const list = spawnSync('claude', ['plugin', 'list', '--json'], { cwd: project, encoding: 'utf8' });
    commands.push({ cmd: 'claude plugin list --json', exitCode: list.status });
    if (list.status !== 0) {
      return finish({ verdict: VERDICTS.FAIL, commands, officialValidation, reasons: [`plugin list exited ${list.status}`], warnings });
    }
    const installedEntries = JSON.parse(list.stdout || '[]');
    const matchingEntries = installedEntries.filter((p) => p.id === 'dhpk@dhpk');
    const identityPath = (value) => {
      try { return fs.realpathSync(value); } catch (_) { return path.resolve(value); }
    };
    const installed = matchingEntries.find((p) => {
      if (p.scope !== 'project') return false;
      // `claude plugin list --json` can include a stale user-scoped copy before
      // the project-scoped install. When available, bind the row to this
      // isolated project as an additional identity check.
      return !p.projectPath || identityPath(p.projectPath) === identityPath(project);
    }) || (matchingEntries.length === 1 && matchingEntries[0].scope === undefined ? matchingEntries[0] : null);
    if (!installed) {
      return finish({ verdict: VERDICTS.FAIL, commands, officialValidation, reasons: ["'dhpk@dhpk' not present in 'claude plugin list --json' after install"], warnings });
    }
    if (installed.version !== version) {
      return finish({ verdict: VERDICTS.FAIL, commands, officialValidation, reasons: [`installed plugin reports version '${installed.version}', expected '${version}'`], warnings });
    }
    if (installed.installPath) {
      const installedRoot = path.resolve(installed.installPath);
      const installedManifest = path.join(installedRoot, '.claude-plugin', 'plugin.json');
      const installedStrict = spawnSync('claude', ['plugin', 'validate', installedManifest, '--strict'], {
        cwd: installedRoot,
        encoding: 'utf8',
      });
      const installedEvidence = {
        cmd: 'claude plugin validate <installed>/.claude-plugin/plugin.json --strict',
        manifest: '<installed>/.claude-plugin/plugin.json',
        exitCode: installedStrict.status,
        claudeVersion: cliVersion,
      };
      commands.push(installedEvidence);
      if (installedStrict.status !== 0) {
        const output = redactEvidence(`${installedStrict.stdout || ''}\n${installedStrict.stderr || ''}`.trim(), root);
        return finish({
          verdict: VERDICTS.FAIL,
          commands,
          officialValidation: { verdict: 'FAIL', ...installedEvidence },
          reasons: [`official Claude strict validation failed on installed cache (exit ${installedStrict.status})${output ? `: ${output}` : ''}`],
          warnings,
        });
      }
    } else {
      const reason = 'installed Claude plugin did not report installPath; installed-cache strict validation was NOT RUN';
      const installedEvidence = {
        cmd: 'claude plugin validate <installed>/.claude-plugin/plugin.json --strict',
        manifest: '<installed>/.claude-plugin/plugin.json',
        exitCode: null,
        status: 'NOT RUN',
        claudeVersion: cliVersion,
      };
      commands.push(installedEvidence);
      warnings.push(reason);
      return finish({
        verdict: VERDICTS.FAIL,
        commands,
        officialValidation: { verdict: 'NOT RUN', ...installedEvidence, reason },
        reasons: [reason],
        warnings,
      });
    }
    return finish({
      verdict: VERDICTS.PASS,
      commands,
      officialValidation,
      reasons: [],
      warnings,
    });
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
  return {
    verdict: VERDICTS.PASS,
    installationEvidence: {
      status: VERDICTS.PASS,
      reason: 'native Codex installation smoke test passed',
    },
    commands,
    reasons: [],
  };
}

function verifyProjectedConsumer(root, platform, version, options = {}) {
  const agentPlugin = platform === 'agent-plugin' || platform === 'codex';
  const packageRoot = path.join(root, 'plugins', agentPlugin ? 'dhpk-agent' : 'dhpk-cursor');
  const probe = path.join(root, 'scripts', 'release', 'consumer-platform-probe.js');
  const probePlatform = agentPlugin ? 'agent-plugin' : 'cursor';
  const probeArgs = [probe, '--platform', probePlatform, '--package-root', packageRoot, '--inventory', path.join(root, 'manifests', 'distribution-inventory.json'), '--version', version];
  if (options.execute === true) probeArgs.push('--execute');
  const res = spawnSync('node', probeArgs, {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, CI: '', DHPK_CONSUMER_PROBE_EXECUTE: '' },
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
  let companionEvidence = null;
  if (!agentPlugin) {
    try {
      const companion = validateAgentPluginPackage(path.join(root, 'plugins', 'dhpk-agent'));
      companionEvidence = {
        status: companion.ok ? 'PASS' : 'FAIL',
        reason: companion.ok
          ? 'sibling Agent Plugin package passes physical package validation'
          : 'sibling Agent Plugin package failed physical package validation',
        diagnostics: (companion.errors || []).slice(0, 10).map((error) => redactEvidence(error, root)),
      };
    } catch (error) {
      companionEvidence = {
        status: 'FAIL',
        reason: 'sibling Agent Plugin package could not be validated safely',
        diagnostics: [redactEvidence(String(error && error.message ? error.message : error), root)],
      };
    }
  }
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
  const structuralValidationPassed = !childFailure
    && ['NOT_RUN', 'UNAVAILABLE'].includes(effectiveStatus)
    && Array.isArray(payload.surfaceResults)
    && payload.surfaceResults.some((entry) => (
      Array.isArray(entry.checkedClaims)
        && entry.checkedClaims.includes('package-manifest')
        && entry.checkedClaims.includes('consumer-route')
    ));
  const installationEvidence = structuralValidationPassed
    ? {
      status: companionEvidence && companionEvidence.status !== 'PASS' ? 'FAIL' : 'PASS',
      reason: companionEvidence && companionEvidence.status !== 'PASS'
        ? `${surface} package preflight passed but its sibling Agent Plugin package closure failed`
        : `${surface} package preflight, manifest, and structural validation passed`,
      ...(companionEvidence ? { companion: companionEvidence } : {}),
    }
    : null;
  const runtimeEvidence = structuralValidationPassed
    ? {
      status: effectiveStatus,
      reason: payload.reason || `${surface} consumer runtime was not invoked`,
    }
    : null;
  const nativeSurface = Array.isArray(payload.surfaceResults)
    ? payload.surfaceResults.find((entry) => entry && entry.nativeProof)
    : null;
  return {
    status: effectiveStatus,
    commands: Array.isArray(payload.commands) && payload.commands.length > 0
      ? payload.commands.map((cmd) => ({ cmd: redactEvidence(typeof cmd === 'string' ? cmd : cmd.cmd || `node scripts/release/consumer-platform-probe.js --platform ${platform}`, root), exitCode: typeof cmd === 'string' ? res.status : (cmd.exitCode === undefined ? res.status : cmd.exitCode) }))
      : [{ cmd: `node scripts/release/consumer-platform-probe.js --platform ${platform}`, exitCode: res.status }],
    reason: effectiveReason ? redactEvidence(effectiveReason, root) : null,
    diagnostics: payload.diagnostics || payload.diagnostic || [],
    artifacts: payload.artifacts || [],
    surfaceResults: normalized.surfaceResults.map((entry) => ({
      ...entry,
      ...(installationEvidence ? { installationEvidence } : {}),
      ...(runtimeEvidence ? { runtimeEvidence } : {}),
    })),
    ...(options.execute === true ? {
      nativeObservation: {
        status: effectiveStatus,
        reason: effectiveReason ? redactEvidence(effectiveReason, root) : null,
        ...(nativeSurface && nativeSurface.nativeProof ? { nativeProof: nativeSurface.nativeProof } : {}),
      },
    } : {}),
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
    ...(result.versionDiscovery ? { versionDiscovery: result.versionDiscovery } : {}),
  }];
  const normalized = normalizeConsumerEvidence({
    stage: 'CONSUMER',
    producer,
    adapter,
    surfaceResults,
  });
  return normalized.surfaceResults.map((entry) => ({
    ...entry,
    ...(result.installationEvidence ? { installationEvidence: result.installationEvidence } : {}),
    ...(result.runtimeEvidence ? { runtimeEvidence: result.runtimeEvidence } : {}),
    ...(result.reasonCode ? { reasonCode: result.reasonCode } : {}),
    ...(result.surfaceVerdict ? { legacySurfaceStatus: result.surfaceVerdict } : {}),
    ...(result.warnings && result.warnings.length > 0 ? { warnings: result.warnings } : {}),
  }));
}

function codexPackageRoles(root) {
  try {
    const manifest = JSON.parse(readFileBounded(path.join(root, 'codex', 'agent-projection-manifest.json')).toString('utf8'));
    if (!manifest || !Array.isArray(manifest.package_roles) || manifest.package_roles.length > 64) return new Set();
    return new Set(manifest.package_roles.filter((role) => (
      typeof role === 'string' && /^[a-z][a-z0-9-]{0,62}$/.test(role)
    )));
  } catch (_) {
    return new Set();
  }
}

function resolveRequirementCheck(check, supportedCodexRoles) {
  const evidenceKind = check.trigger === 'explicit-native' ? 'native' : check.evidenceKind;
  const evidenceSurface = check.surface === 'claude-core' ? 'claude' : check.surface;
  const checkKey = `${evidenceSurface}:${check.capability}:${evidenceKind}`;
  let route = null;
  let role = null;
  if (check.capability === 'installation-contract'
    && evidenceKind === 'contract'
    && !['activation-defect', 'explicit-native'].includes(check.trigger)) {
    route = 'installation-contract';
  } else if (check.capability === 'package-loader'
    && ['agent-plugin', 'cursor-plugin'].includes(check.surface)
    && ['contract', 'native'].includes(evidenceKind)) {
    route = 'package-loader';
  } else if (check.surface === 'codex-sync' && check.capability.startsWith('named-role-')) {
    const candidate = check.capability.slice('named-role-'.length);
    if (supportedCodexRoles.has(candidate)) {
      route = 'named-role';
      role = candidate;
    }
  }
  return {
    ...check,
    requestedEvidenceKind: check.evidenceKind,
    evidenceKind,
    checkKey,
    route,
    role,
  };
}

function uniqueRequirementExecutions(checks, route) {
  const grouped = new Map();
  for (const check of checks.filter((entry) => entry.route === route)) {
    if (!grouped.has(check.checkKey)) grouped.set(check.checkKey, []);
    grouped.get(check.checkKey).push(check);
  }
  return [...grouped.values()].map((group) => ({
    ...group[0],
    authorized: group.some((check) => check.authorization.authorized),
  }));
}

function requirementAdapter(check) {
  if (check.route === 'installation-contract') return { id: 'consumer-gate', version: '1.0.0' };
  if (check.route === 'package-loader') return { id: 'consumer-platform-probe', version: '1.0.0' };
  if (check.route === 'named-role') {
    return check.evidenceKind === 'native'
      ? { id: 'codex-named-role-probe', version: '1.0.0' }
      : { id: 'codex-role-materialization', version: '1.0.0' };
  }
  return null;
}

function runGate(args) {
  const requirements = args.requirements || null;
  const configurationMarkers = Object.fromEntries(CONSUMER_SURFACES.map((surface) => (
    [surface, configuredHostMarkers(args.root, surface)]
  )));
  const scope = requirements
    ? requirements.selectedSurfaces
    : (args.surface ? [args.surface] : configuredConsumerSurfaces(args.root));
  const resolvedRequirements = requirements
    ? requirements.checks.map((check) => resolveRequirementCheck(check, codexPackageRoles(args.root)))
    : [];
  const roleChecks = uniqueRequirementExecutions(resolvedRequirements, 'named-role');
  const selectedOrAll = (surface) => scope.includes(surface);
  const codex = selectedOrAll('codex-sync')
    ? verifyCodexSync(args.root, args.version, { roleChecks })
    : null;
  const claude = selectedOrAll('claude-core') ? verifyClaudeReinstall(args.root, args.version) : null;
  const native = selectedOrAll('codex-native') ? verifyCodexNative(args.root) : null;
  const cursorSync = selectedOrAll('cursor-sync') ? verifyCursorSync(args.root, args.version) : null;
  const projectedCodex = selectedOrAll('agent-plugin')
    ? verifyProjectedConsumer(args.root, 'agent-plugin', args.version)
    : null;
  const projectedCursor = selectedOrAll('cursor-plugin')
    ? verifyProjectedConsumer(args.root, 'cursor', args.version)
    : null;

  const loaderEvidence = new Map();
  for (const surface of ['agent-plugin', 'cursor-plugin']) {
    const selectedChecks = uniqueRequirementExecutions(resolvedRequirements
      .filter((check) => check.surface === surface && check.evidenceKind === 'native'), 'package-loader')
      .filter((check) => selectedOrAll(surface));
    const projection = surface === 'agent-plugin' ? projectedCodex : projectedCursor;
    if (selectedChecks.length === 0) continue;
    const platform = surface === 'agent-plugin' ? 'agent-plugin' : 'cursor';
    const canExecute = Boolean(projection && projection.surfaceResults.some((entry) => (
      entry.installationEvidence && entry.installationEvidence.status === 'PASS'
    )));
    for (const check of selectedChecks) {
      if (!check.authorized || !canExecute) {
        loaderEvidence.set(check.checkKey, {
          status: 'BLOCKED',
          observedStatus: canExecute ? 'NOT_RUN' : (projection ? projection.status : 'NOT_RUN'),
          outcomeReason: check.authorized
            ? 'package installation contract must pass before native loader execution'
            : 'native package-loader execution is not authorized',
        });
        continue;
      }
      const observed = verifyProjectedConsumer(args.root, platform, args.version, { execute: true });
      if (projection) projection.commands.push(...observed.commands);
      const nativeProof = observed.nativeObservation && observed.nativeObservation.nativeProof;
      const status = observed.nativeObservation && observed.nativeObservation.status === 'PASS'
        ? (nativeProof ? 'PASS' : 'BLOCKED')
        : observed.nativeObservation && observed.nativeObservation.status === 'FAIL'
          ? 'FAIL'
          : 'BLOCKED';
      loaderEvidence.set(check.checkKey, {
        status,
        observedStatus: observed.nativeObservation ? observed.nativeObservation.status : 'BLOCKED',
        outcomeReason: observed.nativeObservation && observed.nativeObservation.reason
          ? observed.nativeObservation.reason
          : 'challenged package-loader proof was missing',
        ...(nativeProof && status === 'PASS' ? { nativeProof } : {}),
      });
    }
  }

  const environment = process.env.CI ? 'ci' : 'local';
  const observedSurfaceResults = [
    ...(codex ? normalizeGateSurface('codex-sync', 'consumer-gate', { id: 'codex-sync-installer', version: '1.0.0' }, codex, environment) : []),
    ...(claude ? normalizeGateSurface('claude', 'consumer-gate', { id: 'claude-plugin-cli', version: claude.cliVersion }, claude, environment) : []),
    ...(native ? normalizeGateSurface('codex-native', 'consumer-gate', { id: 'codex-native-install-smoke', version: '1.0.0' }, native, environment) : []),
    ...(cursorSync ? normalizeGateSurface('cursor-sync', 'consumer-gate', { id: 'cursor-sync-installer', version: '1.0.0' }, cursorSync, environment) : []),
    ...(projectedCodex ? projectedCodex.surfaceResults : []),
    ...(projectedCursor ? projectedCursor.surfaceResults : []),
  ];

  const requirementSurface = (surface) => (surface === 'claude-core' ? 'claude' : surface);
  const observedSurfaceNames = new Set(observedSurfaceResults.map((entry) => entry.surface));
  const requirementSurfaces = requirements
    ? [...new Set(requirements.checks
      .filter((check) => !scope.includes(check.surface))
      .map((check) => requirementSurface(check.surface)))]
    : [];
  const excludedRequirementSurfaces = requirementSurfaces
    .filter((surface) => !observedSurfaceNames.has(surface))
    .map((surface) => ({
      surface,
      status: 'NOT_RUN',
      commands: [],
      environment,
      artifacts: [],
      diagnostics: [],
      reasons: ['surface was outside the selected requirements scope; no adapter was invoked'],
      checkedClaims: [],
      stage: 'CONSUMER',
      adapter: { id: 'consumer-gate-requirements', version: '1.0.0' },
    }));
  const allObservedAndExcluded = [...observedSurfaceResults, ...excludedRequirementSurfaces];
  const surfaceResults = allObservedAndExcluded.map((entry) => {
    if (!requirements) return entry;
    const requirementChecks = requirements.checks
      .map((check, index) => ({ check, index }))
      .filter(({ check }) => requirementSurface(check.surface) === entry.surface);
    if (requirementChecks.length === 0) return entry;
    const requirementEvidence = Object.fromEntries(requirementChecks.map(({ check, index }) => {
      const resolved = resolvedRequirements[index];
      const selected = scope.includes(check.surface);
      let status = 'BLOCKED';
      let observedStatus;
      let outcomeReason;
      let contractEvidence;
      let nativeProof;
      const installationEvidence = entry.installationEvidence;

      if (!selected) {
        outcomeReason = 'surface was outside the selected requirements scope; no adapter was invoked';
      } else if (resolved.evidenceKind === 'native' && !check.authorization.authorized) {
        const observation = resolved.route === 'named-role'
          ? codex && codex.targetedRequirementEvidence && codex.targetedRequirementEvidence[resolved.checkKey]
          : loaderEvidence.get(resolved.checkKey);
        observedStatus = observation && observation.observedStatus;
        outcomeReason = 'native execution is not authorized';
      } else if (resolved.route === 'installation-contract'
        || (resolved.route === 'package-loader' && resolved.evidenceKind === 'contract')) {
        if (installationEvidence && installationEvidence.status) {
          status = installationEvidence.status;
          observedStatus = status;
          outcomeReason = installationEvidence.reason || 'installation contract observed';
          contractEvidence = {
            status,
            adapterRoute: resolved.capability === 'installation-contract'
              ? 'consumer-gate-installation'
              : `${resolved.surface === 'agent-plugin' ? 'agent' : 'cursor'}-plugin-package-contract`,
            reason: outcomeReason,
            evidenceRef: `surfaceResults.${entry.surface}.installationEvidence`,
          };
        } else {
          observedStatus = entry.status;
          outcomeReason = 'installation contract evidence was not produced';
        }
      } else if (resolved.route === 'named-role') {
        const observation = codex && codex.targetedRequirementEvidence
          ? codex.targetedRequirementEvidence[resolved.checkKey]
          : null;
        if (observation) {
          status = observation.status;
          observedStatus = observation.observedStatus;
          outcomeReason = observation.outcomeReason;
          contractEvidence = observation.contractEvidence;
          nativeProof = check.authorization.authorized ? observation.nativeProof : undefined;
        } else {
          observedStatus = codex ? codex.status : entry.status;
          outcomeReason = 'the selected Codex role check did not produce capability evidence';
        }
      } else if (resolved.route === 'package-loader' && resolved.evidenceKind === 'native') {
        const observation = loaderEvidence.get(resolved.checkKey);
        if (observation) {
          status = observation.status;
          observedStatus = observation.observedStatus;
          outcomeReason = observation.outcomeReason;
          nativeProof = observation.nativeProof;
        } else {
          observedStatus = entry.status;
          outcomeReason = 'the selected package-loader check did not produce native evidence';
        }
      } else {
        observedStatus = entry.status;
        outcomeReason = `capability '${check.capability}' is not mapped to a supported evidence adapter`;
      }

      const result = {
        id: check.id,
        host: check.host,
        capability: check.capability,
        trigger: check.trigger,
        reason: check.reason,
        question: check.question,
        requestedEvidenceKind: check.evidenceKind,
        evidenceKind: resolved.evidenceKind,
        authorized: check.authorization.authorized,
        checkKey: resolved.checkKey,
        status,
        ...(requirementAdapter(resolved) ? { adapter: requirementAdapter(resolved) } : {}),
        ...(observedStatus ? { observedStatus } : {}),
        ...(outcomeReason ? { outcomeReason: outcomeReason.slice(0, 512) } : {}),
        ...(contractEvidence ? { contractEvidence } : {}),
        ...(nativeProof && status === 'PASS' ? { nativeProof, runtimeVerified: true } : {}),
      };
      return [`check${index + 1}`, result];
    }));
    return { ...entry, requirementEvidence };
  });

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

  const requiredChecks = observedSurfaceResults.map((entry) => ({
    id: `install.${entry.surface}`,
    surface: entry.surface,
    kind: 'installation',
    reason: entry.installationEvidence
      ? entry.installationEvidence.reason
      : `Selected ${entry.surface} installation contract must pass`,
    status: entry.installationEvidence ? entry.installationEvidence.status : entry.status,
    evidenceRef: entry.installationEvidence
      ? `surfaceResults.${entry.surface}.installationEvidence`
      : `surfaceResults.${entry.surface}`,
  }));
  if (scope.length === 0) {
    requiredChecks.push({
      id: 'scope.configuration',
      surface: 'consumer-scope',
      kind: 'contract',
      reason: 'No configured or explicitly selected consumer surface exists; select a target or add a supported configuration marker',
      status: 'BLOCKED',
      evidenceRef: null,
    });
  }
  const unselectedSurfaceChecks = CONSUMER_SURFACES
    .filter((surface) => !scope.includes(surface))
    .map((surface) => {
      const markers = configurationMarkers[surface];
      return {
        id: `scope.${surface}`,
        surface,
        kind: 'installation',
        reason: markers.length > 0
          ? `Configured by ${markers.join(', ')} but outside the selected scope; no adapter was invoked`
          : `No configured-target marker found (${CONSUMER_HOST_CONFIG_MARKERS[CONSUMER_SURFACE_HOSTS[surface]].join(', ')}); no adapter was invoked`,
        status: markers.length > 0 ? 'NOT_RUN' : 'NOT_CONFIGURED',
        evidenceRef: null,
      };
    });
  const excludedChecks = observedSurfaceResults.flatMap((entry) => (
    entry.runtimeEvidence
      ? [{
        id: `runtime.${entry.surface}`,
        surface: entry.surface,
        kind: 'native',
        reason: entry.runtimeEvidence.reason,
        status: entry.runtimeEvidence.status,
        evidenceRef: `surfaceResults.${entry.surface}.runtimeEvidence`,
      }]
      : []
  ));
  excludedChecks.unshift(...unselectedSurfaceChecks);
  if (requirements) {
    requirements.checks.forEach((check, index) => {
      const surface = requirementSurface(check.surface);
      const entry = surfaceResults.find((row) => row.surface === surface);
      const evidenceSlot = `check${index + 1}`;
      const requirementEvidence = entry.requirementEvidence[evidenceSlot];
      const result = {
        id: `requirement.${check.id}`,
        surface,
        kind: resolvedRequirements[index].evidenceKind,
        reason: requirementEvidence.reason,
        status: requirementEvidence.status,
        evidenceRef: `surfaceResults.${surface}.requirementEvidence.${evidenceSlot}`,
      };
      requiredChecks.push(result);
    });
  }
  const acceptance = {
    verdict: requiredChecks.some((check) => check.status === 'FAIL')
      ? 'FAIL'
      : (requiredChecks.some((check) => check.status !== 'PASS') ? 'BLOCKED' : 'PASS'),
    requiredChecks,
    excludedChecks,
  };
  const verdict = acceptance.verdict;

  const stage = {
    schemaVersion: 2,
    verdict,
    commands,
    environment,
    artifacts: !CONSUMER_SURFACES.every((surface) => scope.includes(surface))
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
    acceptance,
    ...(codex && codex.surfaceVerdict ? { legacySurfaceStatus: codex.surfaceVerdict } : {}),
    ...(codex && codex.surfaceVerdict === 'WARN' ? { warnings: ['Codex duplicate-surface matrix returned WARN; compatibility status is not a canonical evidence verdict'] } : {}),
  };

  return requirements ? normalizeConsumerEvidence(stage) : stage;
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
