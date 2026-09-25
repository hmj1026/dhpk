'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const { installNativeSharedSkills } = require('../scripts/lib/native-shared-skill-install');

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function fixture() {
  const sourceRoot = tmpDir('dhpk-native-shared-src-');
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

test('installNativeSharedSkills materializes shared skills and Cursor native-link bindings', () => {
  const sourceRoot = fixture();
  const projectRoot = tmpDir('dhpk-native-shared-project-');
  try {
    const result = installNativeSharedSkills({
      sourceRoot,
      projectRoot,
      host: 'cursor',
      selectedStableIds: ['sample'],
      declaredSelection: true,
    });
    const nativeSkill = path.join(projectRoot, '.cursor', 'skills', 'dhpk-sample');
    assert.ok(fs.existsSync(path.join(projectRoot, '.agents', 'skills', 'dhpk-sample', 'SKILL.md')));
    assert.ok(fs.lstatSync(nativeSkill).isSymbolicLink());
    assert.strictEqual(fs.readlinkSync(nativeSkill), '../../.agents/skills/dhpk-sample');
    assert.strictEqual(result.receipt.hostBindings.cursor.bindingShape, 'native-link');
    assert.deepStrictEqual(result.receipt.bindingPaths.cursor, [{
      path: '.cursor/skills/dhpk-sample',
      target: '../../.agents/skills/dhpk-sample',
    }]);
  } finally {
    fs.rmSync(sourceRoot, { recursive: true, force: true });
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('installNativeSharedSkills records direct bindings when a PASS probe record is injected', () => {
  const sourceRoot = fixture();
  const projectRoot = tmpDir('dhpk-native-shared-direct-');
  try {
    const result = installNativeSharedSkills({
      sourceRoot,
      projectRoot,
      host: 'cursor',
      selectedStableIds: ['sample'],
      declaredSelection: true,
      consumerEvidence: {
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
      },
    });
    assert.strictEqual(result.receipt.hostBindings.cursor.bindingShape, 'direct');
    assert.deepStrictEqual(result.receipt.bindingPaths.cursor || [], []);
    assert.ok(!fs.existsSync(path.join(projectRoot, '.cursor', 'skills', 'dhpk-sample')));
    assert.ok(fs.existsSync(path.join(projectRoot, '.agents', 'skills', 'dhpk-sample', 'SKILL.md')));
  } finally {
    fs.rmSync(sourceRoot, { recursive: true, force: true });
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('installNativeSharedSkills rejects an unsupported Host', () => {
  assert.throws(
    () => installNativeSharedSkills({
      sourceRoot: '/tmp/dhpk-native-shared-unused-source',
      projectRoot: '/tmp/dhpk-native-shared-unused-project',
      host: 'claude',
      selectedStableIds: ['sample'],
    }),
    /unsupported native shared-skill Host/,
  );
});

run('native-shared-skill-install');
