'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const {
  discoverCodexSurfaces,
  fingerprintDir,
  fingerprintPath,
} = require('../scripts/release/consumer-gate');
const { loadMarketplaceHostPublication } = require('../scripts/lib/marketplace-host-publication');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'scripts', 'ci', 'check-codex-discovery.js');

// Stub `codex plugin list --json` on PATH so activation-gated tests never
// reach a real Codex CLI. Mirrors the stub in tests/install-codex-skills.test.js.
const CODEX_STUB_BIN = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-discovery-codex-stub-')));
fs.writeFileSync(path.join(CODEX_STUB_BIN, 'codex'), `#!/bin/sh
if [ "$1" = "plugin" ] && [ "$2" = "list" ] && [ "$3" = "--json" ]; then
  if [ -n "\${DHPK_TEST_CODEX_PLUGIN_LIST_JSON:-}" ]; then
    printf '%s\\n' "\${DHPK_TEST_CODEX_PLUGIN_LIST_JSON}"
  else
    printf '%s\\n' '{"installed":[],"available":[]}'
  fi
  exit "\${DHPK_TEST_CODEX_PLUGIN_LIST_EXIT:-0}"
fi
exit 2
`, { mode: 0o755 });
process.on('exit', () => fs.rmSync(CODEX_STUB_BIN, { recursive: true, force: true }));

function withCodexStub(env = {}) {
  return { ...process.env, ...env, PATH: `${CODEX_STUB_BIN}${path.delimiter}${process.env.PATH || ''}` };
}

function withoutCodexOnPath(env = {}) {
  const filtered = String(process.env.PATH || '')
    .split(path.delimiter)
    .filter((entry) => entry && entry !== CODEX_STUB_BIN)
    .join(path.delimiter);
  return { ...process.env, ...env, PATH: filtered };
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-discovery-cli-'));
  const project = path.join(root, 'project');
  const native = path.join(root, 'native');
  fs.mkdirSync(path.join(project, '.codex', 'skills', 'demo'), { recursive: true });
  fs.mkdirSync(native, { recursive: true });
  fs.writeFileSync(path.join(project, '.codex', 'skills', 'demo', 'SKILL.md'), '# demo\n');
  return { root, project, native };
}

function nativePublicationFixture({ marker = 'valid', profile = false, removeSelection = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-native-publication-'));
  const nativeRoot = path.join(root, 'native');
  const project = path.join(root, 'project');
  fs.mkdirSync(path.join(root, 'manifests'), { recursive: true });
  fs.mkdirSync(project, { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'manifests', 'distribution-inventory.json'), path.join(root, 'manifests', 'distribution-inventory.json'));
  fs.copyFileSync(path.join(ROOT, 'manifests', 'marketplace-selection.json'), path.join(root, 'manifests', 'marketplace-selection.json'));
  const inventory = JSON.parse(fs.readFileSync(path.join(root, 'manifests', 'distribution-inventory.json'), 'utf8'));
  const selectionPath = path.join(root, 'manifests', 'marketplace-selection.json');
  const selection = JSON.parse(fs.readFileSync(selectionPath, 'utf8'));
  const view = loadMarketplaceHostPublication({ root, inventory, hostSurface: 'codex-native' });
  const legacyExpected = inventory.skills.filter((skill) => (
    (skill.surfaces || []).includes('codex-native') && skill.lifecycle !== 'deprecated'
  ));
  const selectedSkills = marker === 'absent'
    ? legacyExpected
    : [...view.publicEntries, ...view.hostOnly];
  const materializedSkills = profile ? [legacyExpected[0]] : selectedSkills;
  const names = materializedSkills.map((skill) => skill.name || skill.id).sort();
  const ids = materializedSkills.map((skill) => skill.id).sort();

  fs.mkdirSync(path.join(nativeRoot, '.codex-plugin'), { recursive: true });
  fs.mkdirSync(path.join(nativeRoot, 'skills'), { recursive: true });
  fs.writeFileSync(path.join(nativeRoot, '.codex-plugin', 'plugin.json'), JSON.stringify({ version: '1.2.3' }));
  const fingerprints = {};
  for (const name of names) {
    const skillRoot = path.join(nativeRoot, 'skills', name);
    fs.mkdirSync(skillRoot, { recursive: true });
    fs.writeFileSync(path.join(skillRoot, 'SKILL.md'), `# ${name}\n`);
    fingerprints[name] = fingerprintDir(skillRoot);
  }
  fs.writeFileSync(path.join(nativeRoot, 'fingerprints.json'), `${JSON.stringify(fingerprints)}\n`);

  const provenance = {
    sourceCommit: 'a'.repeat(40),
    sourceVersion: '1.2.3',
    inventoryDigest: crypto.createHash('sha256').update(JSON.stringify(inventory)).digest('hex'),
    materializedSkillIds: ids,
    materializedSkillNames: names,
  };
  if (marker !== 'absent') {
    provenance.marketplacePublication = {
      selectionDigest: marker === 'tampered-digest' ? '0'.repeat(64) : view.selectionDigest,
      publicEntryIds: [...view.publicEntries.map((entry) => entry.id)].sort(),
      hostOnlyIds: [...view.hostOnly.map((entry) => entry.id)].sort(),
    };
    if (marker === 'tampered-list') provenance.marketplacePublication.hostOnlyIds.pop();
  }
  if (profile) {
    provenance.emittedStableIds = [ids[0]];
    provenance.materializedSkillIds = [ids[0]];
    provenance.materializedSkillNames = [names[0]];
    provenance.runtimeSupportStableIds = [];
  }
  fs.writeFileSync(path.join(nativeRoot, 'provenance.json'), `${JSON.stringify(provenance)}\n`);
  if (removeSelection) fs.rmSync(selectionPath);

  return { root, project, nativeRoot, inventory, selection, view };
}

function discoverNativeFixture(paths) {
  return discoverCodexSurfaces({ root: paths.root, project: paths.project, version: '1.2.3', nativeRoot: paths.nativeRoot });
}

test('native marketplace publication provenance accepts the complete canonical Codex catalog', () => {
  const paths = nativePublicationFixture();
  try {
    const expectedPublication = [...paths.view.publicEntries, ...paths.view.hostOnly]
      .map((skill) => ({ id: skill.id, name: skill.name || skill.id }))
      .sort((left, right) => left.id.localeCompare(right.id));
    const surfaces = discoverNativeFixture(paths);
    const inventoryIdsByName = new Map(paths.inventory.skills.map((skill) => [skill.name || skill.id, skill.id]));
    const observedPublication = surfaces.native
      .map((entry) => ({ id: inventoryIdsByName.get(entry.id), name: entry.id }))
      .sort((left, right) => String(left.id).localeCompare(String(right.id)));
    assert.deepStrictEqual(observedPublication, expectedPublication,
      'native directories must exactly match the selected Codex stable ID to name mapping');
    assert.ok(surfaces.native.every((entry) => entry.owned && entry.current), JSON.stringify(surfaces.native.map((entry) => ({ id: entry.id, owned: entry.owned, current: entry.current }))));
  } finally {
    fs.rmSync(paths.root, { recursive: true, force: true });
  }
});

test('native marketplace publication provenance rejects a tampered selection digest', () => {
  const paths = nativePublicationFixture({ marker: 'tampered-digest' });
  try {
    const surfaces = discoverNativeFixture(paths);
    assert.ok(surfaces.native.length > 0);
    assert.ok(surfaces.native.every((entry) => !entry.owned && !entry.current));
  } finally {
    fs.rmSync(paths.root, { recursive: true, force: true });
  }
});

test('native marketplace publication provenance rejects a tampered host-only ID list', () => {
  const paths = nativePublicationFixture({ marker: 'tampered-list' });
  try {
    const surfaces = discoverNativeFixture(paths);
    assert.ok(surfaces.native.length > 0);
    assert.ok(surfaces.native.every((entry) => !entry.owned && !entry.current));
  } finally {
    fs.rmSync(paths.root, { recursive: true, force: true });
  }
});

test('native marketplace publication marker fails closed when its canonical selection is unavailable', () => {
  const paths = nativePublicationFixture({ marker: 'absent', removeSelection: true });
  try {
    const provenancePath = path.join(paths.nativeRoot, 'provenance.json');
    const provenance = JSON.parse(fs.readFileSync(provenancePath, 'utf8'));
    provenance.marketplacePublication = {
      selectionDigest: 'b'.repeat(64),
      publicEntryIds: [],
      hostOnlyIds: [],
    };
    fs.writeFileSync(provenancePath, `${JSON.stringify(provenance)}\n`);
    const surfaces = discoverNativeFixture(paths);
    assert.ok(surfaces.native.length > 0);
    assert.ok(surfaces.native.every((entry) => !entry.owned && !entry.current));
  } finally {
    fs.rmSync(paths.root, { recursive: true, force: true });
  }
});

test('legacy and explicit-profile native provenance without a marketplace marker keeps its prior validation', () => {
  for (const options of [{ marker: 'absent' }, { marker: 'absent', profile: true }]) {
    const paths = nativePublicationFixture(options);
    try {
      const surfaces = discoverNativeFixture(paths);
      assert.ok(surfaces.native.length > 0);
      assert.ok(surfaces.native.every((entry) => entry.owned && entry.current));
    } finally {
      fs.rmSync(paths.root, { recursive: true, force: true });
    }
  }
});

test('check-codex-discovery reports a read-only PASS for a single surface', () => {
  const paths = fixture();
  try {
    const result = spawnSync(process.execPath, [CLI, '--repo-root', paths.root, '--project-root', paths.project, '--native-root', paths.native], {
      cwd: ROOT,
      encoding: 'utf8',
      env: withCodexStub(),
    });
    assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const report = JSON.parse(result.stdout);
    assert.strictEqual(report.verdict, 'PASS');
    assert.strictEqual(report.effective.length, 1);
    assert.strictEqual(report.effective[0].name, 'demo');
    assert.strictEqual(report.providers.native.length, 0);
    assert.ok(report.activation);
  } finally {
    fs.rmSync(paths.root, { recursive: true, force: true });
  }
});

test('check-codex-discovery blocks duplicate runtime providers while preserving PASS integrity evidence', () => {
  const project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-discovery-dual-')));
  const native = path.join(ROOT, 'plugins', 'dhpk');
  const version = JSON.parse(fs.readFileSync(path.join(native, '.codex-plugin', 'plugin.json'), 'utf8')).version;
  const skillName = 'flow-drive';
  const destination = path.join(project, '.codex', 'skills', skillName);
  try {
    fs.cpSync(path.join(native, 'skills', skillName), destination, { recursive: true, dereference: true });
    fs.writeFileSync(path.join(project, '.codex', '.dhpk-installed.json'), `${JSON.stringify({
      schema_version: 3,
      plugin_version: version,
      managed_entries: {
        skills: {
          [skillName]: { destination_fingerprint: fingerprintPath(destination) },
        },
      },
    })}\n`);
    const result = spawnSync(process.execPath, [
      CLI,
      '--repo-root', ROOT,
      '--project-root', project,
      '--native-root', native,
      '--version', version,
    ], {
      cwd: ROOT,
      encoding: 'utf8',
      env: withCodexStub({
        DHPK_TEST_CODEX_PLUGIN_LIST_JSON: JSON.stringify({
          installed: [{ pluginId: 'dhpk@dhpk', enabled: true, version }],
          available: [],
        }),
      }),
    });
    assert.strictEqual(result.status, 1, `${result.stdout}\n${result.stderr}`);
    const report = JSON.parse(result.stdout);
    assert.strictEqual(report.verdict, 'BLOCKED');
    assert.strictEqual(report.integrityVerdict, 'PASS');
    assert.strictEqual(report.reasonCode, 'DUPLICATE_CODEX_PROVIDER');
    assert.deepStrictEqual(report.duplicateInvokableNames, [skillName]);
    assert.strictEqual(report.activation.status, 'ENABLED');
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
  }
});

test('source-tree native artifact without an enabled Codex plugin passes', () => {
  const project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-discovery-inactive-')));
  const native = path.join(ROOT, 'plugins', 'dhpk');
  const version = JSON.parse(fs.readFileSync(path.join(native, '.codex-plugin', 'plugin.json'), 'utf8')).version;
  const skillName = 'flow-drive';
  const destination = path.join(project, '.codex', 'skills', skillName);
  try {
    fs.cpSync(path.join(native, 'skills', skillName), destination, { recursive: true, dereference: true });
    fs.writeFileSync(path.join(project, '.codex', '.dhpk-installed.json'), `${JSON.stringify({
      schema_version: 3,
      plugin_version: version,
      managed_entries: {
        skills: {
          [skillName]: { destination_fingerprint: fingerprintPath(destination) },
        },
      },
    })}\n`);
    const result = spawnSync(process.execPath, [
      CLI,
      '--repo-root', ROOT,
      '--project-root', project,
      '--native-root', native,
      '--version', version,
    ], { cwd: ROOT, encoding: 'utf8', env: withCodexStub() });
    assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const report = JSON.parse(result.stdout);
    assert.strictEqual(report.verdict, 'PASS');
    assert.strictEqual(report.reasonCode, null);
    assert.deepStrictEqual(report.duplicateInvokableNames, []);
    assert.deepStrictEqual(report.inactiveDuplicateInvokableNames, [skillName]);
    assert.ok(report.providers.native.length > 0);
    assert.ok(report.providers.native.every((provider) => provider.active === false));
    assert.strictEqual(report.activation.status, 'AVAILABLE');
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
  }
});

test('disabled native Codex plugin passes', () => {
  const project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-discovery-disabled-')));
  const native = path.join(ROOT, 'plugins', 'dhpk');
  const version = JSON.parse(fs.readFileSync(path.join(native, '.codex-plugin', 'plugin.json'), 'utf8')).version;
  const skillName = 'flow-drive';
  const destination = path.join(project, '.codex', 'skills', skillName);
  try {
    fs.cpSync(path.join(native, 'skills', skillName), destination, { recursive: true, dereference: true });
    fs.writeFileSync(path.join(project, '.codex', '.dhpk-installed.json'), `${JSON.stringify({
      schema_version: 3,
      plugin_version: version,
      managed_entries: {
        skills: {
          [skillName]: { destination_fingerprint: fingerprintPath(destination) },
        },
      },
    })}\n`);
    const result = spawnSync(process.execPath, [
      CLI,
      '--repo-root', ROOT,
      '--project-root', project,
      '--native-root', native,
      '--version', version,
    ], {
      cwd: ROOT,
      encoding: 'utf8',
      env: withCodexStub({
        DHPK_TEST_CODEX_PLUGIN_LIST_JSON: JSON.stringify({ installed: [{ pluginId: 'dhpk@dhpk', enabled: false }], available: [] }),
      }),
    });
    assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const report = JSON.parse(result.stdout);
    assert.strictEqual(report.verdict, 'PASS');
    assert.strictEqual(report.activation.status, 'DISABLED');
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
  }
});

test('indeterminate Codex activation warns without blocking', () => {
  const project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-discovery-unknown-')));
  const native = path.join(ROOT, 'plugins', 'dhpk');
  const version = JSON.parse(fs.readFileSync(path.join(native, '.codex-plugin', 'plugin.json'), 'utf8')).version;
  const skillName = 'flow-drive';
  const destination = path.join(project, '.codex', 'skills', skillName);
  try {
    fs.cpSync(path.join(native, 'skills', skillName), destination, { recursive: true, dereference: true });
    fs.writeFileSync(path.join(project, '.codex', '.dhpk-installed.json'), `${JSON.stringify({
      schema_version: 3,
      plugin_version: version,
      managed_entries: {
        skills: {
          [skillName]: { destination_fingerprint: fingerprintPath(destination) },
        },
      },
    })}\n`);
    const result = spawnSync(process.execPath, [
      CLI,
      '--repo-root', ROOT,
      '--project-root', project,
      '--native-root', native,
      '--version', version,
    ], { cwd: ROOT, encoding: 'utf8', env: withCodexStub({ DHPK_TEST_CODEX_PLUGIN_LIST_EXIT: '1' }) });
    assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const report = JSON.parse(result.stdout);
    assert.strictEqual(report.verdict, 'WARN');
    assert.strictEqual(report.ok, true);
    assert.strictEqual(report.reasonCode, 'CODEX_ACTIVATION_UNKNOWN');
    assert.deepStrictEqual(report.inactiveDuplicateInvokableNames, [skillName]);
    assert.match(report.nextAction, /codex plugin list/);
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
  }
});

test('--native-activation override selects the runtime judgment without a CLI probe', () => {
  const project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-discovery-override-')));
  const native = path.join(ROOT, 'plugins', 'dhpk');
  const version = JSON.parse(fs.readFileSync(path.join(native, '.codex-plugin', 'plugin.json'), 'utf8')).version;
  const skillName = 'flow-drive';
  const destination = path.join(project, '.codex', 'skills', skillName);
  try {
    fs.cpSync(path.join(native, 'skills', skillName), destination, { recursive: true, dereference: true });
    fs.writeFileSync(path.join(project, '.codex', '.dhpk-installed.json'), `${JSON.stringify({
      schema_version: 3,
      plugin_version: version,
      managed_entries: {
        skills: {
          [skillName]: { destination_fingerprint: fingerprintPath(destination) },
        },
      },
    })}\n`);
    const enabled = spawnSync(process.execPath, [
      CLI,
      '--repo-root', ROOT,
      '--project-root', project,
      '--native-root', native,
      '--version', version,
      '--native-activation', 'enabled',
    ], { cwd: ROOT, encoding: 'utf8', env: withoutCodexOnPath() });
    assert.strictEqual(enabled.status, 1, `${enabled.stdout}\n${enabled.stderr}`);
    const enabledReport = JSON.parse(enabled.stdout);
    assert.strictEqual(enabledReport.reasonCode, 'DUPLICATE_CODEX_PROVIDER');
    assert.strictEqual(enabledReport.activation.source, 'override');

    const inactive = spawnSync(process.execPath, [
      CLI,
      '--repo-root', ROOT,
      '--project-root', project,
      '--native-root', native,
      '--version', version,
      '--native-activation', 'inactive',
    ], { cwd: ROOT, encoding: 'utf8', env: withoutCodexOnPath() });
    assert.strictEqual(inactive.status, 0, `${inactive.stdout}\n${inactive.stderr}`);
    const inactiveReport = JSON.parse(inactive.stdout);
    assert.strictEqual(inactiveReport.verdict, 'PASS');
    assert.strictEqual(inactiveReport.activation.status, 'INACTIVE');
    assert.strictEqual(inactiveReport.activation.source, 'override');

    const bogus = spawnSync(process.execPath, [
      CLI,
      '--repo-root', ROOT,
      '--project-root', project,
      '--native-root', native,
      '--native-activation', 'bogus',
    ], { cwd: ROOT, encoding: 'utf8', env: withoutCodexOnPath() });
    assert.strictEqual(bogus.status, 2);
    assert.match(bogus.stderr, /native-activation/);
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
  }
});

test('check-codex-discovery blocks a dangling project-local skill with structured redacted evidence', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-discovery-dangling-'));
  const project = path.join(root, 'project');
  const native = path.join(root, 'native');
  const source = path.join(root, 'source', 'dangling-demo');
  const destination = path.join(project, '.codex', 'skills', 'dangling-demo');
  try {
    fs.mkdirSync(source, { recursive: true });
    fs.writeFileSync(path.join(source, 'SKILL.md'), '# dangling demo\n');
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.mkdirSync(native, { recursive: true });
    fs.symlinkSync(source, destination, 'dir');
    fs.rmSync(source, { recursive: true, force: true });
    assert.strictEqual(fs.lstatSync(destination).isSymbolicLink(), true);

    const result = spawnSync(process.execPath, [
      CLI,
      '--repo-root', root,
      '--project-root', project,
      '--native-root', native,
    ], { cwd: ROOT, encoding: 'utf8', env: withCodexStub() });
    assert.strictEqual(result.status, 1, `${result.stdout}\n${result.stderr}`);
    assert.strictEqual(result.stderr, '');
    assert.doesNotMatch(result.stderr, /usage:/i);
    const report = JSON.parse(result.stdout);
    assert.strictEqual(report.ok, false);
    assert.strictEqual(report.verdict, 'BLOCKED');
    assert.strictEqual(report.integrityVerdict, 'BLOCKED');
    assert.strictEqual(report.reasonCode, 'CODEX_PROVIDER_FINGERPRINT_ERROR');
    assert.strictEqual(report.effective.length, 0);
    assert.strictEqual(report.invalidProviders.length, 1);
    const invalid = report.invalidProviders[0];
    assert.strictEqual(invalid.name, 'dangling-demo');
    assert.strictEqual(invalid.surface, 'project-local');
    assert.strictEqual(invalid.fingerprint, '');
    assert.strictEqual(invalid.owned, false);
    assert.match(invalid.sourcePath, /project\/\.codex\/skills\/dangling-demo/);
    assert.match(invalid.fingerprintError, /ENOENT|no such file|dangling|missing/i);
    assert.doesNotMatch(result.stdout, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(report.nextAction, /--update/i);
    assert.match(report.nextAction, /(?:receipt[- ]owned|\b(?:if|when|only)\b)/i);
    assert.match(report.nextAction, /\bowned\b/i);
    assert.match(report.nextAction, /unowned/i);
    assert.match(report.nextAction, /manual/i);
    assert.match(report.nextAction, /inspect/i);
    assert.match(report.nextAction, /repair/i);
    assert.match(report.nextAction, /remov/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('check-codex-discovery blocks a dangling project-local agent with structured redacted evidence', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-discovery-dangling-agent-'));
  const project = path.join(root, 'project');
  const native = path.join(root, 'native');
  const source = path.join(root, 'source', 'dangling-agent');
  const destination = path.join(project, '.codex', 'agents', 'dangling-agent');
  try {
    fs.mkdirSync(source, { recursive: true });
    fs.writeFileSync(path.join(source, 'AGENT.md'), '# dangling agent\n');
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.mkdirSync(native, { recursive: true });
    fs.symlinkSync(source, destination, 'dir');
    fs.rmSync(source, { recursive: true, force: true });
    assert.strictEqual(fs.lstatSync(destination).isSymbolicLink(), true);

    const result = spawnSync(process.execPath, [
      CLI,
      '--repo-root', root,
      '--project-root', project,
      '--native-root', native,
    ], { cwd: ROOT, encoding: 'utf8', env: withCodexStub() });
    assert.strictEqual(result.status, 1, `${result.stdout}\n${result.stderr}`);
    assert.strictEqual(result.stderr, '');
    assert.doesNotMatch(result.stderr, /usage:/i);
    const report = JSON.parse(result.stdout);
    assert.strictEqual(report.ok, false);
    assert.strictEqual(report.verdict, 'BLOCKED');
    assert.strictEqual(report.integrityVerdict, 'BLOCKED');
    assert.strictEqual(report.reasonCode, 'CODEX_PROVIDER_FINGERPRINT_ERROR');
    assert.strictEqual(report.effective.length, 0);
    assert.strictEqual(report.invalidProviders.length, 1);
    const invalid = report.invalidProviders[0];
    assert.strictEqual(invalid.id, 'dangling-agent');
    assert.strictEqual(invalid.name, 'dangling-agent');
    assert.strictEqual(invalid.kind, 'agents');
    assert.strictEqual(invalid.surface, 'project-local');
    assert.strictEqual(invalid.fingerprint, '');
    assert.strictEqual(invalid.owned, false);
    assert.match(invalid.sourcePath, /project\/\.codex\/agents\/dangling-agent/);
    assert.match(invalid.fingerprintError, /ENOENT|no such file|dangling|missing/i);
    assert.doesNotMatch(result.stdout, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(report.nextAction, /--update/i);
    assert.match(report.nextAction, /(?:receipt[- ]owned|\b(?:if|when|only)\b)/i);
    assert.match(report.nextAction, /\bowned\b/i);
    assert.match(report.nextAction, /unowned/i);
    assert.match(report.nextAction, /manual/i);
    assert.match(report.nextAction, /inspect/i);
    assert.match(report.nextAction, /repair/i);
    assert.match(report.nextAction, /remov/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('check-codex-discovery exposes help and rejects unknown arguments', () => {
  const help = spawnSync(process.execPath, [CLI, '--help'], { cwd: ROOT, encoding: 'utf8' });
  assert.strictEqual(help.status, 0);
  assert.match(help.stdout, /check-codex-discovery\.js/);

  const invalid = spawnSync(process.execPath, [CLI, '--no-such-option'], { cwd: ROOT, encoding: 'utf8' });
  assert.strictEqual(invalid.status, 2);
  assert.match(invalid.stderr, /unknown argument/);
});


// Consolidated from tests/codex-discovery-registry.test.js; imports and helpers stay local.
{

  const { test, assert } = require('./_lib/tinytest');
  const {
    inspectCodexActivation,
    inspectCodexDiscovery,
  } = require('../scripts/lib/codex-discovery-registry');

  function provider(overrides = {}) {
    return {
      id: 'dhpk-demo',
      kind: 'skills',
      surface: 'project-local',
      version: '1.0.0',
      fingerprint: 'same',
      sourcePath: 'project/.codex/skills/dhpk-demo',
      current: true,
      owned: true,
      ...overrides,
    };
  }

  test('fingerprint failures block activation while retaining the invalid provider and identity evidence', () => {
    const result = inspectCodexActivation({
      project: [provider({
        fingerprint: '',
        fingerprintError: 'ENOENT: no such file or directory, realpath project/.codex/skills/dhpk-demo',
        current: false,
        owned: false,
      })],
    });
    assert.strictEqual(result.ok, false, JSON.stringify(result));
    assert.strictEqual(result.verdict, 'BLOCKED');
    assert.strictEqual(result.integrityVerdict, 'BLOCKED');
    assert.strictEqual(result.reasonCode, 'CODEX_PROVIDER_FINGERPRINT_ERROR');
    assert.strictEqual(result.effective.length, 0);
    assert.strictEqual(result.invalidProviders.length, 1);
    assert.strictEqual(result.invalidProviders[0].id, 'dhpk-demo');
    assert.strictEqual(result.invalidProviders[0].name, 'dhpk-demo');
    assert.strictEqual(result.invalidProviders[0].fingerprint, '');
    assert.strictEqual(result.invalidProviders[0].fingerprintError, 'ENOENT: no such file or directory, realpath project/.codex/skills/dhpk-demo');
  });

  test('empty fingerprint without fingerprint error remains malformed', () => {
    assert.throws(
      () => inspectCodexActivation({ project: [provider({ fingerprint: '' })] }),
      /missing fingerprint/i,
    );
  });

  test('fingerprint failure outranks duplicate activation for an invalid project provider', () => {
    const result = inspectCodexActivation({
      project: [provider({
        fingerprint: '',
        fingerprintError: 'ENOENT: no such file or directory, realpath project/.codex/skills/dhpk-demo',
        current: false,
        owned: false,
      })],
      native: [provider({
        surface: 'native-experimental',
        sourcePath: 'native/plugins/dhpk/skills/dhpk-demo',
        fingerprint: 'native-good',
      })],
      precedence: ['project-local'],
    });
    assert.strictEqual(result.ok, false, JSON.stringify(result));
    assert.strictEqual(result.verdict, 'BLOCKED');
    assert.strictEqual(result.integrityVerdict, 'BLOCKED');
    assert.strictEqual(result.reasonCode, 'CODEX_PROVIDER_FINGERPRINT_ERROR');
    assert.deepStrictEqual(result.duplicateInvokableNames, []);
    assert.strictEqual(result.invalidProviders.length, 1);
    assert.strictEqual(result.providers.project.length, 1);
    assert.strictEqual(result.providers.native.length, 1);
    assert.strictEqual(result.providers.project[0].fingerprint, '');
    assert.strictEqual(result.providers.native[0].fingerprint, 'native-good');
    assert.strictEqual(result.conflicts.length, 1);
    assert.deepStrictEqual(
      result.conflicts[0].providers.map((item) => `${item.surface}:${item.fingerprint}`).sort(),
      ['native-experimental:native-good', 'project-local:'],
    );
    assert.strictEqual(result.effective.length, 0);
  });

  test('fingerprint failure reason remains primary while valid duplicate names stay observable', () => {
    const result = inspectCodexActivation({
      project: [
        provider({
          id: 'dhpk-shared',
          name: 'dhpk-shared',
          sourcePath: 'project/.codex/skills/dhpk-shared',
          fingerprint: 'shared-good',
        }),
        provider({
          id: 'dhpk-broken',
          name: 'dhpk-broken',
          sourcePath: 'project/.codex/skills/dhpk-broken',
          fingerprint: '',
          fingerprintError: 'ENOENT: no such file or directory, realpath project/.codex/skills/dhpk-broken',
          current: false,
          owned: false,
        }),
      ],
      native: [provider({
        id: 'dhpk-shared',
        name: 'dhpk-shared',
        surface: 'native-experimental',
        sourcePath: 'native/plugins/dhpk/skills/dhpk-shared',
        fingerprint: 'shared-good',
      })],
      precedence: ['project-local'],
    });
    assert.strictEqual(result.ok, false, JSON.stringify(result));
    assert.strictEqual(result.verdict, 'BLOCKED');
    assert.strictEqual(result.integrityVerdict, 'BLOCKED');
    assert.strictEqual(result.reasonCode, 'CODEX_PROVIDER_FINGERPRINT_ERROR');
    assert.deepStrictEqual(result.duplicateInvokableNames, ['dhpk-shared']);
    assert.strictEqual(result.invalidProviders.length, 1);
    assert.strictEqual(result.invalidProviders[0].name, 'dhpk-broken');
  });

  test('same public name and fingerprint merge into one effective entry with providers', () => {
    const result = inspectCodexDiscovery({
      project: [provider()],
      native: [provider({ surface: 'native-experimental', sourcePath: 'native/plugins/dhpk/skills/dhpk-demo', experimental: true })],
      precedence: ['project-local', 'native-experimental'],
    });
    assert.strictEqual(result.ok, true, JSON.stringify(result));
    assert.strictEqual(result.effective.length, 1);
    assert.strictEqual(result.effective[0].status, 'merged');
    assert.strictEqual(result.effective[0].providers.length, 2);
    assert.strictEqual(result.duplicates.length, 1);
    assert.deepStrictEqual(result.conflicts, []);
  });

  test('runtime activation blocks duplicate invokable names even when integrity fingerprints match', () => {
    const result = inspectCodexActivation({
      project: [provider()],
      native: [provider({ surface: 'native-experimental', sourcePath: 'native/plugins/dhpk/skills/dhpk-demo' })],
      precedence: ['project-local'],
    });
    assert.strictEqual(result.ok, false, JSON.stringify(result));
    assert.strictEqual(result.verdict, 'BLOCKED');
    assert.strictEqual(result.integrityVerdict, 'PASS');
    assert.strictEqual(result.reasonCode, 'DUPLICATE_CODEX_PROVIDER');
    assert.deepStrictEqual(result.duplicateInvokableNames, ['dhpk-demo']);
  });

  test('runtime activation ignores overlapping non-invokable support skills', () => {
    const result = inspectCodexActivation({
      project: [provider()],
      native: [provider({ surface: 'native-experimental', sourcePath: 'native/plugins/dhpk/skills/dhpk-demo' })],
      precedence: ['project-local'],
      nonInvokableSkillNames: ['dhpk-demo'],
    });
    assert.strictEqual(result.ok, true, JSON.stringify(result));
    assert.strictEqual(result.verdict, 'PASS');
    assert.strictEqual(result.integrityVerdict, 'PASS');
    assert.strictEqual(result.reasonCode, null);
    assert.deepStrictEqual(result.duplicateInvokableNames, []);
  });

  test('different fingerprints block without explicit precedence', () => {
    const result = inspectCodexDiscovery({
      project: [provider({ fingerprint: 'project' })],
      native: [provider({ surface: 'native-experimental', fingerprint: 'native', sourcePath: 'native/plugins/dhpk/skills/dhpk-demo' })],
    });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.effective.length, 0);
    assert.strictEqual(result.conflicts.length, 1);
    assert.match(result.conflicts[0].reason, /precedence/i);
  });

  test('explicit precedence selects a current owned provider and preserves conflict evidence', () => {
    const result = inspectCodexDiscovery({
      project: [provider({ fingerprint: 'project' })],
      native: [provider({ surface: 'native-experimental', fingerprint: 'native', sourcePath: 'native/plugins/dhpk/skills/dhpk-demo', experimental: true })],
      precedence: ['project-local', 'native-experimental'],
    });
    assert.strictEqual(result.ok, true, JSON.stringify(result));
    assert.strictEqual(result.effective.length, 1);
    assert.strictEqual(result.effective[0].status, 'selected');
    assert.strictEqual(result.effective[0].provider.surface, 'project-local');
    assert.strictEqual(result.effective[0].providers.length, 2);
    assert.strictEqual(result.conflicts.length, 1);
    assert.strictEqual(result.conflicts[0].resolvedBy, 'project-local');
  });

  test('same canonical identity is retained as one provider when discovery repeats it', () => {
    const result = inspectCodexDiscovery({
      project: [provider(), provider({ sourcePath: 'project/.codex/skills/dhpk-demo' })],
    });
    assert.strictEqual(result.ok, true, JSON.stringify(result));
    assert.strictEqual(result.effective.length, 1);
    assert.strictEqual(result.effective[0].providers.length, 1);
  });

  test('kind and public name form the identity and malformed providers are rejected', () => {
    assert.throws(
      () => inspectCodexDiscovery({ project: [provider({ id: '' })] }),
      /public name|id|identity/i
    );
    assert.throws(
      () => inspectCodexDiscovery({ project: [provider({ kind: '' })] }),
      /kind|identity/i
    );
  });

  test('stable provider id is retained separately from the public name', () => {
    const result = inspectCodexDiscovery({
      project: [provider({ id: 'fastapi-pro', name: 'dhpk-fastapi-pro' })],
      receipt: { schema_version: 3, plugin_version: '1.0.0' },
    });
    assert.strictEqual(result.effective[0].name, 'dhpk-fastapi-pro');
    assert.strictEqual(result.effective[0].provider.id, 'fastapi-pro');
    assert.deepStrictEqual(result.receipt, { schema_version: 3, plugin_version: '1.0.0' });
  });

  test('default surface labels are applied consistently to the report providers', () => {
    const result = inspectCodexDiscovery({
      project: [{ id: 'demo', kind: 'skills', fingerprint: 'same', current: true, owned: true }],
    });
    assert.strictEqual(result.effective.length, 1);
    assert.strictEqual(result.providers.project[0].surface, 'project-local');
  });

  test('inactive native providers do not raise a runtime duplicate', () => {
    const result = inspectCodexActivation({
      project: [provider()],
      native: [provider({
        surface: 'native-experimental',
        sourcePath: 'plugins/dhpk/skills/dhpk-demo',
        experimental: true,
        active: false,
      })],
      precedence: ['project-local'],
    });
    assert.strictEqual(result.verdict, 'PASS');
    assert.strictEqual(result.reasonCode, null);
    assert.deepStrictEqual(result.duplicateInvokableNames, []);
    assert.deepStrictEqual(result.inactiveDuplicateInvokableNames, ['dhpk-demo']);
    assert.strictEqual(result.providers.native[0].active, false);
  });

  test('active native providers still raise a runtime duplicate', () => {
    const result = inspectCodexActivation({
      project: [provider()],
      native: [provider({
        surface: 'native-experimental',
        sourcePath: 'plugins/dhpk/skills/dhpk-demo',
        experimental: true,
        active: true,
      })],
      precedence: ['project-local'],
    });
    assert.strictEqual(result.verdict, 'BLOCKED');
    assert.strictEqual(result.reasonCode, 'DUPLICATE_CODEX_PROVIDER');
    assert.deepStrictEqual(result.duplicateInvokableNames, ['dhpk-demo']);
    assert.deepStrictEqual(result.inactiveDuplicateInvokableNames, []);
  });

  test('active defaults to true when unspecified', () => {
    const result = inspectCodexActivation({
      project: [provider()],
      native: [provider({
        surface: 'native-experimental',
        sourcePath: 'plugins/dhpk/skills/dhpk-demo',
        experimental: true,
      })],
      precedence: ['project-local'],
    });
    assert.strictEqual(result.verdict, 'BLOCKED');
    assert.strictEqual(result.reasonCode, 'DUPLICATE_CODEX_PROVIDER');
    assert.deepStrictEqual(result.duplicateInvokableNames, ['dhpk-demo']);
  });
}

run('check-codex-discovery');
