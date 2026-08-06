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
//     clean temp project. Only safe to run for real on an ephemeral CI
//     runner (a dev machine's `claude plugin install` writes to the shared
//     global plugin cache) — reported UNAVAILABLE when the `claude` CLI is
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
const { VERDICTS } = require('../lib/release-evidence');
const { fingerprintDir } = require('../lib/codex-native-package');
const { collectCodexProjectionReferenceErrors } = require('../ci/_lib/codex-runtime');

const DEFAULT_ROOT = path.join(__dirname, '..', '..');
const CODEX_SURFACE_VERDICTS = Object.freeze({ PASS: 'PASS', WARN: 'WARN', BLOCKED: 'BLOCKED' });

function fingerprintPath(target) {
  const hashNode = (current) => {
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) return hashNode(fs.realpathSync(current));
    const nodeDigest = crypto.createHash('sha256');
    if (stat.isDirectory()) {
      nodeDigest.update('dir\0');
      for (const name of fs.readdirSync(current).sort()) {
        nodeDigest.update(name);
        nodeDigest.update('\0');
        nodeDigest.update(hashNode(path.join(current, name)));
        nodeDigest.update('\0');
      }
      return nodeDigest.digest('hex');
    }
    nodeDigest.update('file\0');
    nodeDigest.update(fs.readFileSync(current));
    return nodeDigest.digest('hex');
  };
  try {
    return hashNode(target);
  } catch (_) {
    return '';
  }
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
  return redactSandboxPath(redacted);
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
}) {
  return ['skills', 'agents'].flatMap((kind) => {
    const kindRoot = path.join(surfaceRoot, kind);
    if (!fs.existsSync(kindRoot)) return [];
    const managed = manifest && manifest.managed_entries && manifest.managed_entries[kind];
    return fs.readdirSync(kindRoot).sort().flatMap((id) => {
      const target = path.join(kindRoot, id);
      let stat;
      try { stat = fs.lstatSync(target); } catch (_) { return []; }
      if (!stat.isDirectory() && !stat.isSymbolicLink()) return [];
      const fingerprint = fingerprintFn(target);
      const expectedFingerprint = expectedFingerprints ? expectedFingerprintFn(target) : null;
      const receiptEntry = managed && managed[id];
      const owned = manifest
        ? Boolean(receiptEntry && receiptEntry.destination_fingerprint === fingerprint)
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
  if (project.fingerprint === native.fingerprint) {
    return { verdict: CODEX_SURFACE_VERDICTS.PASS, reason: 'identical fingerprints with valid provenance' };
  }
  if (precedence === 'project-local' && nativeExperimental) {
    return { verdict: CODEX_SURFACE_VERDICTS.WARN, reason: 'current receipt-owned fallback takes explicit precedence over experimental native surface' };
  }
  return { verdict: CODEX_SURFACE_VERDICTS.BLOCKED, reason: 'duplicate surfaces differ without an approved precedence' };
}

function discoverCodexSurfaces({ root, project, version }) {
  const manifestPath = path.join(project, '.codex', '.dhpk-installed.json');
  let manifest = null;
  if (fs.existsSync(manifestPath)) {
    try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch (_) { manifest = null; }
  }
  const projectEntries = discoverCodexSurface({
    root,
    surfaceRoot: path.join(project, '.codex'),
    label: 'project-local',
    version,
    manifest,
  });
  const nativeRoot = path.join(root, 'plugins', 'dhpk');
  let nativeVersion = version;
  const nativeManifestPath = path.join(nativeRoot, '.codex-plugin', 'plugin.json');
  if (fs.existsSync(nativeManifestPath)) {
    try { nativeVersion = JSON.parse(fs.readFileSync(nativeManifestPath, 'utf8')).version || version; } catch (_) { /* keep target version */ }
  }
  let nativeProvenance = { valid: false, current: false, packageVersion: nativeVersion, sourceVersion: null };
  let nativeFingerprints = {};
  const provenancePath = path.join(nativeRoot, 'provenance.json');
  const fingerprintsPath = path.join(nativeRoot, 'fingerprints.json');
  const inventoryPath = path.join(root, 'manifests', 'distribution-inventory.json');
  let inventory = null;
  try {
    inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
    nativeFingerprints = JSON.parse(fs.readFileSync(fingerprintsPath, 'utf8'));
  } catch (_) {
    inventory = null;
    nativeFingerprints = {};
  }
  if (fs.existsSync(provenancePath)) {
    try {
      const provenance = JSON.parse(fs.readFileSync(provenancePath, 'utf8'));
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
    fingerprintFn: fingerprintPath,
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
    else {
      console.error(`consumer-gate: unknown argument '${arg}'`);
      process.exit(2);
    }
  }
  if (!args.version) {
    console.error('usage: consumer-gate.js --version X.Y.Z [--repo-root <path>]');
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
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const skillsPresent = fs.existsSync(path.join(project, '.codex', 'skills')) && fs.readdirSync(path.join(project, '.codex', 'skills')).length > 0;
    const agentsPresent = fs.existsSync(path.join(project, '.codex', 'agents')) && fs.readdirSync(path.join(project, '.codex', 'agents')).length > 0;
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
      const inventory = JSON.parse(fs.readFileSync(path.join(root, 'manifests', 'distribution-inventory.json'), 'utf8'));
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
    const surfaces = discoverCodexSurfaces({ root, project, version });
    const nativeByPublicName = new Map(surfaces.native.map((entry) => [`${entry.kind}:${entry.id}`, entry]));
    const duplicateEvidence = [];
    let surfaceVerdict = CODEX_SURFACE_VERDICTS.PASS;
    for (const projectEntry of surfaces.project) {
      const nativeEntry = nativeByPublicName.get(`${projectEntry.kind}:${projectEntry.id}`);
      if (!nativeEntry) continue;
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
      if (matrix.verdict === CODEX_SURFACE_VERDICTS.BLOCKED) surfaceVerdict = CODEX_SURFACE_VERDICTS.BLOCKED;
      else if (matrix.verdict === CODEX_SURFACE_VERDICTS.WARN && surfaceVerdict === CODEX_SURFACE_VERDICTS.PASS) surfaceVerdict = CODEX_SURFACE_VERDICTS.WARN;
    }
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
  const project = mkTempProject();
  try {
    const add = spawnSync('claude', ['plugin', 'marketplace', 'add', root, '--scope', 'project'], { cwd: project, encoding: 'utf8' });
    commands.push({ cmd: 'claude plugin marketplace add <root> --scope project', exitCode: add.status });
    if (add.status !== 0) {
      return { verdict: VERDICTS.FAIL, commands, officialValidation, reasons: [`marketplace add exited ${add.status}: ${redactEvidence((add.stderr || '').trim(), root)}`] };
    }

    const install = spawnSync('claude', ['plugin', 'install', 'dhpk@dhpk', '--scope', 'project'], { cwd: project, encoding: 'utf8' });
    commands.push({ cmd: 'claude plugin install dhpk@dhpk --scope project', exitCode: install.status });
    if (install.status !== 0) {
      return { verdict: VERDICTS.FAIL, commands, officialValidation, reasons: [`plugin install exited ${install.status}: ${redactEvidence((install.stderr || '').trim(), root)}`] };
    }

    const list = spawnSync('claude', ['plugin', 'list', '--json'], { cwd: project, encoding: 'utf8' });
    commands.push({ cmd: 'claude plugin list --json', exitCode: list.status });
    if (list.status !== 0) {
      return { verdict: VERDICTS.FAIL, commands, officialValidation, reasons: [`plugin list exited ${list.status}`] };
    }
    const installed = JSON.parse(list.stdout || '[]').find((p) => p.id === 'dhpk@dhpk');
    if (!installed) {
      return { verdict: VERDICTS.FAIL, commands, officialValidation, reasons: ["'dhpk@dhpk' not present in 'claude plugin list --json' after install"] };
    }
    if (installed.version !== version) {
      return { verdict: VERDICTS.FAIL, commands, officialValidation, reasons: [`installed plugin reports version '${installed.version}', expected '${version}'`] };
    }
    return {
      verdict: VERDICTS.PASS,
      commands,
      officialValidation,
      reasons: [],
    };
  } finally {
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

function runGate(args) {
  const codex = verifyCodexSync(args.root, args.version);
  const claude = verifyClaudeReinstall(args.root, args.version);
  const native = verifyCodexNative(args.root);

  const commands = [...codex.commands, ...claude.commands, ...native.commands];
  const failureReasons = [
    ...codex.reasons.map((r) => `codex-sync: ${r}`),
    ...claude.reasons.map((r) => `claude-reinstall: ${r}`),
    ...native.reasons.map((r) => `native-codex-marketplace: ${r}`),
  ];

  let verdict;
  if (codex.verdict === VERDICTS.FAIL || claude.verdict === VERDICTS.FAIL) verdict = VERDICTS.FAIL;
  else if (claude.verdict === VERDICTS.UNAVAILABLE) verdict = VERDICTS.UNAVAILABLE;
  else verdict = VERDICTS.PASS;

  const stage = {
    verdict,
    commands,
    environment: process.env.CI ? 'ci' : 'local',
    artifacts: [
      `claude-official-strict: ${claude.officialValidation ? claude.officialValidation.verdict : 'NOT RUN'}${claude.officialValidation && claude.officialValidation.reason ? ` (${claude.officialValidation.reason})` : ''}`,
      `native-codex-marketplace: ${native.verdict} (experimental support tier; consumer proof does not itself graduate the support tier)`,
      ...(codex.surfaceVerdict ? [`codex-surface: ${codex.surfaceVerdict}`] : []),
    ],
    failureReasons,
    ...(codex.surfaces ? { codexSurfaces: { ...codex.surfaces, duplicates: codex.duplicateEvidence || [] } } : {}),
  };

  return stage;
}

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  const stage = runGate(args);
  console.log(JSON.stringify(stage, null, 2));
  process.exit(stage.verdict === VERDICTS.FAIL ? 1 : 0);
}

module.exports = {
  CODEX_SURFACE_VERDICTS,
  discoverCodexSurface,
  discoverCodexSurfaces,
  evaluateCodexSurfaceMatrix,
  fingerprintDir,
  fingerprintPath,
  redactEvidence,
  verifyCodexSync,
  runGate,
};
