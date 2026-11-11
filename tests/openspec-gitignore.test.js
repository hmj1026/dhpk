'use strict';

const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');

function checkIgnore(relative) {
  return spawnSync('git', ['-C', ROOT, 'check-ignore', '--no-index', '--quiet', relative]);
}

test('OpenSpec policy ignores changes and workflow state but permits main specs', () => {
  assert.strictEqual(checkIgnore('openspec/changes/example/tasks.md').status, 0, 'changes must be ignored');
  assert.strictEqual(checkIgnore('openspec/config.yaml').status, 0, 'config must be ignored');
  assert.notStrictEqual(checkIgnore('openspec/specs/example/spec.md').status, 0, 'main specs must remain trackable');
  assert.strictEqual(checkIgnore('openspec/specs/.hyperweave/cache.json').status, 0, 'spec cache must be ignored');
});

test('Git index contains specs only under openspec', () => {
  const trackedChanges = spawnSync('git', ['-C', ROOT, 'ls-files', 'openspec/changes'], { encoding: 'utf8' });
  const trackedSpecs = spawnSync('git', ['-C', ROOT, 'ls-files', 'openspec/specs'], { encoding: 'utf8' });
  assert.strictEqual(trackedChanges.status, 0, trackedChanges.stderr);
  assert.strictEqual(trackedChanges.stdout.trim(), '', 'openspec/changes must not be tracked');
  assert.ok(trackedSpecs.stdout.trim().length > 0, 'accepted openspec/specs files must stay tracked');
});

test('External agent skill installs are ignored without hiding project surfaces', () => {
  assert.strictEqual(checkIgnore('.agents/skills/openspec-new-change/SKILL.md').status, 0,
    'external OpenSpec skills must be ignored');
  assert.strictEqual(checkIgnore('.agents/skills/.openspec-target').status, 0,
    'external OpenSpec installation metadata must be ignored');
  assert.notStrictEqual(checkIgnore('.agents/plugins/marketplace.json').status, 0,
    'repo-scoped marketplace metadata must remain trackable');
  assert.notStrictEqual(checkIgnore('docs/agents/domain.md').status, 0,
    'project agent documentation must remain trackable');
  assert.notStrictEqual(checkIgnore('skills/openspec-artifact-guard/SKILL.md').status, 0,
    'first-party OpenSpec adapter skills must remain trackable');
  assert.notStrictEqual(checkIgnore('openspec/specs/example/spec.md').status, 0,
    'accepted OpenSpec specs must remain trackable');
});

test('test scratch directories under the repo root are ignored and every ROOT mkdtemp uses that prefix', () => {
  assert.strictEqual(checkIgnore('.dhpk-test-scratch-x/.projection-stage-1-abcdef/change-verdict.md').status, 0,
    'projection stage files under test scratch must be ignored');
  assert.strictEqual(checkIgnore('.dhpk-test-scratch-x/skills/flow-guide.md').status, 0,
    'projected skill files under test scratch must be ignored');
  const fs = require('node:fs');
  for (const file of ['gen-agents-skills.test.js', 'validate-agents-behavior.test.js']) {
    const text = fs.readFileSync(path.join(__dirname, file), 'utf8');
    const prefixes = [...text.matchAll(/mkdtempSync\(path\.join\(ROOT,\s*'([^']*)'/g)].map((m) => m[1]);
    assert.ok(prefixes.length > 0, `${file} must create ROOT scratch dirs`);
    for (const prefix of prefixes) {
      assert.ok(prefix.startsWith('.dhpk-test-scratch-'), `${file}: ${prefix} must use .dhpk-test-scratch- prefix`);
    }
  }
});

run('openspec-gitignore');
