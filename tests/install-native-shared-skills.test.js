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

run('install-native-shared-skills');
