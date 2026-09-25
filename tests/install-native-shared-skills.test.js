'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'ci', 'install-native-shared-skills.js');

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function fixture() {
  const sourceRoot = tmpDir('dhpk-install-native-src-');
  write(path.join(sourceRoot, 'skills', 'dhpk-sample', 'SKILL.md'), [
    '---',
    'name: dhpk-sample',
    'description: Sample',
    '---',
    '',
    '# Sample skill',
    '',
  ].join('\n'));
  write(path.join(sourceRoot, 'manifests', 'distribution-inventory.json'), `${JSON.stringify({
    schema: 'dhpk.distribution-inventory.v2',
    skills: [{
      id: 'sample',
      name: 'dhpk-sample',
      path: 'skills/dhpk-sample',
      lifecycle: 'promoted',
      surfaces: ['cursor-sync', 'cursor-plugin'],
    }],
    project_agent_projection: {
      schema: 'dhpk.project-agent-projection.v1',
      scope: 'project',
      owner: 'dhpk.project-agent-projection',
      managed_root: '.agents/skills',
      receipt: '.agents/.dhpk-installed.json',
      profiles: {
        'portable-core': {
          version: 'portable-core-v1',
          compatibility_mode: 'portable-core',
          stable_ids: ['sample'],
          hosts: ['agy', 'claude', 'codex', 'cursor'],
        },
      },
      hosts: {
        claude: { surface: 'claude-core', evidence_source: 'entry_surfaces', shape: 'project-skill-directory', transform: { id: 'claude-project-skill', version: '1' } },
        codex: { surface: 'codex-sync', evidence_source: 'entry_surfaces', shape: 'project-skill-directory', transform: { id: 'codex-project-skill', version: '1' } },
        cursor: { surface: 'cursor-plugin', evidence_source: 'entry_surfaces', shape: 'project-skill-directory', transform: { id: 'cursor-project-skill', version: '1' } },
        agy: { surface: 'agy-plugin', evidence_source: 'entry_surfaces', shape: 'project-skill-direct-file', transform: { id: 'agy-project-direct-file', version: '1' } },
      },
      dependencies: {},
    },
  }, null, 2)}\n`);
  return sourceRoot;
}

function invoke(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 20000,
  });
}

test('CLI installs Cursor native-link bindings from a declared selection', () => {
  const sourceRoot = fixture();
  const projectRoot = tmpDir('dhpk-install-native-project-');
  try {
    const result = invoke([
      'install',
      '--source', sourceRoot,
      '--project-root', projectRoot,
      '--host', 'cursor',
      '--selected-id', 'sample',
      '--declared-selection',
      '--json',
    ]);
    assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const report = JSON.parse(result.stdout);
    assert.strictEqual(report.ok, true);
    assert.strictEqual(report.bindingShape, 'native-link');
    assert.deepStrictEqual(report.selectedIds, ['sample']);
    const nativeSkill = path.join(projectRoot, '.cursor', 'skills', 'dhpk-sample');
    assert.ok(fs.lstatSync(nativeSkill).isSymbolicLink());
    assert.strictEqual(fs.readlinkSync(nativeSkill), '../../.agents/skills/dhpk-sample');
  } finally {
    fs.rmSync(sourceRoot, { recursive: true, force: true });
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('CLI usage fails closed without a source, project, or selected id', () => {
  const result = invoke(['install', '--json']);
  assert.notStrictEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /usage: install-native-shared-skills/);
});

test('CLI classify and install honor an injected Cursor PASS probe record', () => {
  const sourceRoot = fixture();
  const projectRoot = tmpDir('dhpk-install-native-direct-');
  const evidence = path.join(projectRoot, 'cursor-probe.json');
  try {
    write(evidence, `${JSON.stringify({
      stage: 'CONSUMER',
      producer: 'consumer-platform-probe',
      adapter: { id: 'cursor-project-discovery', version: '1.0.0' },
      surfaceResults: [{
        surface: 'cursor-project',
        status: 'PASS',
        adapter: { id: 'cursor-project-discovery', version: '1.0.0' },
        commands: [{ cmd: 'node scripts/release/consumer-platform-probe.js --platform cursor-project', exitCode: 0 }],
        environment: { CI: 'true', DHPK_CONSUMER_PROBE_NETWORK: 'disabled' },
        artifacts: [],
        diagnostics: [],
        reasons: ['bounded Cursor project probe PASS'],
        checkedClaims: ['project-artifact-structure', 'cursor-project-discovery', 'consumer-route'],
      }],
    })}\n`);
    const classified = invoke(['classify', '--json', '--consumer-evidence', evidence]);
    assert.strictEqual(classified.status, 0, `${classified.stdout}\n${classified.stderr}`);
    const classification = JSON.parse(classified.stdout);
    assert.strictEqual(classification.bindingShape, 'direct');
    assert.match(String(classification.reason || ''), /PASS/i);

    const result = invoke([
      'install',
      '--source', sourceRoot,
      '--project-root', projectRoot,
      '--host', 'cursor',
      '--selected-id', 'sample',
      '--declared-selection',
      '--consumer-evidence', evidence,
      '--json',
    ]);
    assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const report = JSON.parse(result.stdout);
    assert.strictEqual(report.bindingShape, 'direct');
    assert.ok(!fs.existsSync(path.join(projectRoot, '.cursor', 'skills', 'dhpk-sample')));
  } finally {
    fs.rmSync(sourceRoot, { recursive: true, force: true });
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('CLI classify --host codex honors Codex PASS and ignores Cursor PASS', () => {
  const projectRoot = tmpDir('dhpk-install-native-codex-classify-');
  const codexEvidence = path.join(projectRoot, 'codex-probe.json');
  const cursorEvidence = path.join(projectRoot, 'cursor-probe.json');
  try {
    write(codexEvidence, `${JSON.stringify({
      stage: 'CONSUMER',
      producer: 'consumer-platform-probe',
      adapter: { id: 'codex-project-discovery', version: '1.0.0' },
      surfaceResults: [{
        surface: 'codex-project',
        status: 'PASS',
        adapter: { id: 'codex-project-discovery', version: '1.0.0' },
        commands: [{ cmd: 'node scripts/release/consumer-platform-probe.js --platform codex-project', exitCode: 0 }],
        environment: { CI: 'true', DHPK_CONSUMER_PROBE_NETWORK: 'disabled' },
        artifacts: [],
        diagnostics: [],
        reasons: ['bounded Codex project probe PASS'],
        checkedClaims: ['project-artifact-structure', 'codex-project-discovery', 'consumer-route'],
      }],
    })}\n`);
    write(cursorEvidence, `${JSON.stringify({
      stage: 'CONSUMER',
      producer: 'consumer-platform-probe',
      adapter: { id: 'cursor-project-discovery', version: '1.0.0' },
      surfaceResults: [{
        surface: 'cursor-project',
        status: 'PASS',
        adapter: { id: 'cursor-project-discovery', version: '1.0.0' },
        commands: [{ cmd: 'node scripts/release/consumer-platform-probe.js --platform cursor-project', exitCode: 0 }],
        environment: { CI: 'true', DHPK_CONSUMER_PROBE_NETWORK: 'disabled' },
        artifacts: [],
        diagnostics: [],
        reasons: ['bounded Cursor project probe PASS'],
        checkedClaims: ['project-artifact-structure', 'cursor-project-discovery', 'consumer-route'],
      }],
    })}\n`);
    const classified = invoke(['classify', '--json', '--host', 'codex', '--consumer-evidence', codexEvidence]);
    assert.strictEqual(classified.status, 0, `${classified.stdout}\n${classified.stderr}`);
    assert.strictEqual(JSON.parse(classified.stdout).bindingShape, 'direct');
    const ignored = invoke(['classify', '--json', '--host', 'codex', '--consumer-evidence', cursorEvidence]);
    assert.strictEqual(ignored.status, 0, `${ignored.stdout}\n${ignored.stderr}`);
    assert.strictEqual(JSON.parse(ignored.stdout).bindingShape, 'native-link');
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('CLI installs Codex native-link bindings from a declared selection', () => {
  const sourceRoot = fixture();
  const projectRoot = tmpDir('dhpk-install-native-codex-project-');
  try {
    const result = invoke([
      'install',
      '--source', sourceRoot,
      '--project-root', projectRoot,
      '--host', 'codex',
      '--selected-id', 'sample',
      '--declared-selection',
      '--json',
    ]);
    assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const report = JSON.parse(result.stdout);
    assert.strictEqual(report.ok, true);
    assert.strictEqual(report.host, 'codex');
    assert.strictEqual(report.bindingShape, 'native-link');
    const nativeSkill = path.join(projectRoot, '.codex', 'skills', 'dhpk-sample');
    assert.ok(fs.lstatSync(nativeSkill).isSymbolicLink());
    assert.strictEqual(fs.readlinkSync(nativeSkill), '../../.agents/skills/dhpk-sample');
  } finally {
    fs.rmSync(sourceRoot, { recursive: true, force: true });
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('CLI uninstalls one Host and keeps the remaining Host bindings', () => {
  const sourceRoot = fixture();
  const projectRoot = tmpDir('dhpk-install-native-uninstall-');
  try {
    const cursor = invoke([
      'install',
      '--source', sourceRoot,
      '--project-root', projectRoot,
      '--host', 'cursor',
      '--selected-id', 'sample',
      '--declared-selection',
      '--json',
    ]);
    assert.strictEqual(cursor.status, 0, `${cursor.stdout}\n${cursor.stderr}`);
    const codex = invoke([
      'install',
      '--source', sourceRoot,
      '--project-root', projectRoot,
      '--host', 'codex',
      '--selected-id', 'sample',
      '--declared-selection',
      '--json',
    ]);
    assert.strictEqual(codex.status, 0, `${codex.stdout}\n${codex.stderr}`);
    const removed = invoke([
      'uninstall',
      '--source', sourceRoot,
      '--project-root', projectRoot,
      '--host', 'cursor',
      '--json',
    ]);
    assert.strictEqual(removed.status, 0, `${removed.stdout}\n${removed.stderr}`);
    assert.ok(!fs.existsSync(path.join(projectRoot, '.cursor', 'skills', 'dhpk-sample')));
    assert.ok(fs.lstatSync(path.join(projectRoot, '.codex', 'skills', 'dhpk-sample')).isSymbolicLink());
    assert.ok(fs.existsSync(path.join(projectRoot, '.agents', 'skills', 'dhpk-sample', 'SKILL.md')));
    const receipt = JSON.parse(fs.readFileSync(path.join(projectRoot, '.agents', '.dhpk-installed.json'), 'utf8'));
    assert.strictEqual(receipt.hostBindings.cursor, undefined);
    assert.deepStrictEqual(receipt.hostBindings.codex.selectedStableIds, ['sample']);
  } finally {
    fs.rmSync(sourceRoot, { recursive: true, force: true });
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

run('install-native-shared-skills');
