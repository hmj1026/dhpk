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
    [path.resolve(os.tmpdir()), '<sandbox>'],
    [path.resolve(root), '<repo>'],
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
        expectedFingerprint = expectedFingerprints
          ? expectedFingerprintFn(target, fingerprintOptions(expectedFingerprintFn, allowedRoots))
          : null;
        ownershipFingerprint = ownershipFn === contentFingerprintFn
          ? fingerprint
          : ownershipFn(target, fingerprintOptions(ownershipFn, allowedRoots));
      } catch (error) {
        fingerprintError = error;
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
        ...(fingerprintError ? { fingerprintError: fingerprintError.message } : {}),
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
  if (!precedence || project.current !== true || project.owned !== true || native.current !== true || native.owned !== true) {
    return {
      verdict: CODEX_SURFACE_VERDICTS.BLOCKED,
      reason: 'selected project-local surface is stale/unowned or precedence is missing',
    };
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
      const expectedNativeSkills = inventory && Array.isArray(inventory.skills)
        ? inventory.skills.filter((skill) => (skill.surfaces || []).includes('codex-native') && skill.lifecycle !== 'deprecated')
        : [];
      const expectedNativeIds = expectedNativeSkills.map((skill) => skill.id).sort();
      const expectedNativeNames = expectedNativeSkills.map((skill) => skill.name || skill.id).sort();
      const selectedNativeIds = Array.isArray(provenance.selectedSkillIds) ? [...provenance.selectedSkillIds].sort() : [];
      const selectedNativeNames = Array.isArray(provenance.selectedSkillNames) ? [...provenance.selectedSkillNames].sort() : [];
      const membershipMatches = JSON.stringify(selectedNativeIds) === JSON.stringify(expectedNativeIds)
        && JSON.stringify(selectedNativeNames) === JSON.stringify(expectedNativeNames)
        && JSON.stringify(Object.keys(nativeFingerprints).sort()) === JSON.stringify(expectedNativeNames);
      const expectedInventoryDigest = inventory
        ? crypto.createHash('sha256').update(JSON.stringify(inventory)).digest('hex')
        : null;
      const inventoryMatches = Boolean(expectedInventoryDigest && provenance.inventoryDigest === expectedInventoryDigest);
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
  return { project: projectEntries, native: nativeEntries, manifest };
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
    const discovery = inspectCodexDiscovery({
      project: surfaces.project,
      native: surfaces.native.map((entry) => ({ ...entry, experimental: true })),
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
        reasons: ['Codex duplicate-surface validation is BLOCKED'],
        surfaceVerdict,
        duplicateEvidence,
        surfaces: {
          project: surfaces.project,
          native: surfaces.native,
          effective: discoverySummary.effective,
          conflicts: discoverySummary.conflicts,
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
    return {
      verdict: VERDICTS.PASS,
      commands,
      reasons,
      surfaceVerdict,
      duplicateEvidence,
      surfaces: {
        project: surfaces.project,
        native: surfaces.native,
        effective: discoverySummary.effective,
        conflicts: discoverySummary.conflicts,
        receipt: {
          schema_version: manifest.schema_version,
          plugin_version: manifest.plugin_version,
          source_fingerprint: manifest.source_fingerprint,
          mode: manifest.mode,
          reconciliation: manifest.reconciliation || null,
        },
      },
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
    const installed = JSON.parse(list.stdout || '[]').find((p) => p.id === 'dhpk@dhpk');
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
  const packageRoot = platform === 'codex'
    ? path.join(root, 'plugins', 'dhpk-agent')
    : path.join(root, 'plugins', 'dhpk-cursor');
  const probe = path.join(root, 'scripts', 'release', 'consumer-platform-probe.js');
  const res = spawnSync('node', [probe, '--platform', platform, '--package-root', packageRoot, '--version', version], {
    cwd: root,
    encoding: 'utf8',
  });
  let payload;
  try { payload = JSON.parse(res.stdout || '{}'); } catch (_) {
    payload = { status: 'FAIL', reason: `consumer probe emitted invalid JSON (exit ${res.status})` };
  }
  const surface = platform === 'codex' ? 'agent-plugin' : 'cursor-plugin';
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
  const projectedCodex = selectedOrAll('agent-plugin')
    ? verifyProjectedConsumer(args.root, 'codex', args.version)
    : null;
  const projectedCursor = selectedOrAll('cursor-plugin')
    ? verifyProjectedConsumer(args.root, 'cursor', args.version)
    : null;

  const environment = process.env.CI ? 'ci' : 'local';
  const surfaceResults = [
    ...(codex ? normalizeGateSurface('codex-sync', 'consumer-gate', { id: 'codex-sync-installer', version: '1.0.0' }, codex, environment) : []),
    ...(claude ? normalizeGateSurface('claude', 'consumer-gate', { id: 'claude-plugin-cli', version: claude.cliVersion || 'unknown' }, claude, environment) : []),
    ...(native ? normalizeGateSurface('codex-native', 'consumer-gate', { id: 'codex-native-install-smoke', version: '1.0.0' }, native, environment) : []),
    ...(projectedCodex ? projectedCodex.surfaceResults : []),
    ...(projectedCursor ? projectedCursor.surfaceResults : []),
  ];

  const commands = [
    ...(codex ? codex.commands : []),
    ...(claude ? claude.commands : []),
    ...(native ? native.commands : []),
    ...(projectedCodex ? projectedCodex.commands : []),
    ...(projectedCursor ? projectedCursor.commands : []),
  ];
  const failureReasons = [
    ...(codex ? codex.reasons.map((r) => `codex-sync: ${r}`) : []),
    ...(claude ? claude.reasons.map((r) => `claude-reinstall: ${r}`) : []),
    ...(native ? native.reasons.map((r) => `native-codex-marketplace: ${r}`) : []),
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
    verdict = row && row.status ? row.status : VERDICTS.FAIL;
  } else if (codex.verdict === VERDICTS.FAIL || claude.verdict === VERDICTS.FAIL || projectedCodex.status === 'FAIL' || projectedCursor.status === 'FAIL') verdict = VERDICTS.FAIL;
  else if (projectedCodex.status === 'BLOCKED' || projectedCursor.status === 'BLOCKED') verdict = VERDICTS.BLOCKED;
  else if (claude.verdict === VERDICTS.UNAVAILABLE) verdict = VERDICTS.UNAVAILABLE;
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
  verifyCodexSync,
  verifyProjectedConsumer,
  normalizeGateSurface,
  runGate,
};
