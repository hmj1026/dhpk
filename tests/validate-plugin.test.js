'use strict';

// Behavioral guard for scripts/ci/validate-plugin.js: every path declared in
// .claude-plugin/plugin.json (agents/skills/commands) must resolve on disk,
// and every on-disk agent file must be registered (reverse check).

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');

function makeTempRepo() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-validate-plugin-'));
  fs.cpSync(path.join(ROOT, 'scripts'), path.join(tmp, 'scripts'), { recursive: true });
  return tmp;
}

function writePluginJson(tmp, plugin) {
  const dir = path.join(tmp, '.claude-plugin');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'plugin.json'), JSON.stringify(plugin, null, 2));
}

function runValidator(tmp) {
  const res = spawnSync('node', [path.join(tmp, 'scripts', 'ci', 'validate-plugin.js')], {
    encoding: 'utf8',
  });
  return { status: res.status, out: (res.stdout || '') + (res.stderr || '') };
}

test('real repo plugin.json passes validation', () => {
  const res = spawnSync('node', [path.join(ROOT, 'scripts', 'ci', 'validate-plugin.js')], {
    encoding: 'utf8',
  });
  assert.strictEqual(res.status, 0, `expected real repo to pass, got:\n${res.stdout}${res.stderr}`);
});

test('missing plugin.json fails', () => {
  const tmp = makeTempRepo();
  try {
    const { status, out } = runValidator(tmp);
    assert.strictEqual(status, 1);
    assert.match(out, /plugin\.json not found/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('invalid JSON fails', () => {
  const tmp = makeTempRepo();
  try {
    fs.mkdirSync(path.join(tmp, '.claude-plugin'), { recursive: true });
    fs.writeFileSync(path.join(tmp, '.claude-plugin', 'plugin.json'), '{ not valid json');
    const { status, out } = runValidator(tmp);
    assert.strictEqual(status, 1);
    assert.match(out, /invalid JSON/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('a missing agents[] file fails', () => {
  const tmp = makeTempRepo();
  try {
    writePluginJson(tmp, { version: '1.0.0', agents: ['agents/ghost.md'] });
    const { status, out } = runValidator(tmp);
    assert.strictEqual(status, 1);
    assert.match(out, /agents\[\] — missing file: agents\/ghost\.md/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('a missing skills[] directory fails', () => {
  const tmp = makeTempRepo();
  try {
    writePluginJson(tmp, { version: '1.0.0', skills: ['skills/ghost'] });
    const { status, out } = runValidator(tmp);
    assert.strictEqual(status, 1);
    assert.match(out, /skills\[\] — missing directory: skills\/ghost/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('a missing commands[] path fails', () => {
  const tmp = makeTempRepo();
  try {
    writePluginJson(tmp, { version: '1.0.0', commands: ['commands/ghost.md'] });
    const { status, out } = runValidator(tmp);
    assert.strictEqual(status, 1);
    assert.match(out, /commands\[\] — missing path: commands\/ghost\.md/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('non-semver version warns but does not fail (non-strict)', () => {
  const tmp = makeTempRepo();
  try {
    writePluginJson(tmp, { version: 'not-a-version' });
    const { status, out } = runValidator(tmp);
    assert.strictEqual(status, 0);
    assert.match(out, /is not semver/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('an unregistered on-disk agent file fails (reverse check)', () => {
  const tmp = makeTempRepo();
  try {
    writePluginJson(tmp, { version: '1.0.0', agents: [] });
    fs.mkdirSync(path.join(tmp, 'agents'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'agents', 'stray.md'), '# stray agent\n');
    const { status, out } = runValidator(tmp);
    assert.strictEqual(status, 1);
    assert.match(out, /unregistered agent file on disk: agents\/stray\.md/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('a fully self-consistent minimal plugin passes', () => {
  const tmp = makeTempRepo();
  try {
    fs.mkdirSync(path.join(tmp, 'agents'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'agents', 'a.md'), '# a\n');
    fs.mkdirSync(path.join(tmp, 'skills', 's'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'skills', 's', 'SKILL.md'), '# s\n');
    fs.mkdirSync(path.join(tmp, 'commands'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'commands', 'c.md'), '# c\n');
    writePluginJson(tmp, {
      version: '1.0.0',
      agents: ['agents/a.md'],
      skills: ['skills/s'],
      commands: ['commands/c.md'],
    });
    const { status, out } = runValidator(tmp);
    assert.strictEqual(status, 0, out);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('a goal script with an unresolved local require fails, naming the path', () => {
  const tmp = makeTempRepo();
  try {
    writePluginJson(tmp, { version: '1.0.0' });
    const dir = path.join(tmp, 'skills', 'opsx-apply-goal', 'scripts');
    fs.mkdirSync(dir, { recursive: true });
    fs.mkdirSync(path.join(tmp, 'rules'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'rules', 'execution-policy.md'), '# policy\n');
    fs.writeFileSync(path.join(dir, 'broken.js'), "require('./ghost-module.js');\n");
    const { status, out } = runValidator(tmp);
    assert.strictEqual(status, 1);
    assert.match(out, /broken\.js — unresolved local require\('\.\/ghost-module\.js'\)/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('a bare external require in a goal script fails unless allow-listed', () => {
  const tmp = makeTempRepo();
  try {
    writePluginJson(tmp, { version: '1.0.0' });
    const dir = path.join(tmp, 'skills', 'opsx-apply-goal', 'scripts');
    fs.mkdirSync(dir, { recursive: true });
    fs.mkdirSync(path.join(tmp, 'rules'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'rules', 'execution-policy.md'), '# policy\n');
    fs.writeFileSync(path.join(dir, 'ext.js'), "require('left-pad');\nrequire('node:fs');\n");
    const { status, out } = runValidator(tmp);
    assert.strictEqual(status, 1);
    assert.match(out, /ext\.js — bare external require\('left-pad'\) is not allow-listed/);
    assert.doesNotMatch(out, /node:fs/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('missing execution-policy.md in the packaged layout fails when goal scripts ship', () => {
  const tmp = makeTempRepo();
  try {
    writePluginJson(tmp, { version: '1.0.0' });
    const dir = path.join(tmp, 'skills', 'opsx-apply-goal', 'scripts');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'ok.js'), "require('node:path');\n");
    const { status, out } = runValidator(tmp);
    assert.strictEqual(status, 1);
    assert.match(out, /rules\/execution-policy\.md — goal-orientation-referenced policy path missing/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('goal-script static require graph resolves transitively (real repo edge)', () => {
  const tmp = makeTempRepo();
  try {
    writePluginJson(tmp, { version: '1.0.0' });
    const dir = path.join(tmp, 'skills', 'opsx-apply-goal', 'scripts');
    fs.mkdirSync(dir, { recursive: true });
    fs.mkdirSync(path.join(tmp, 'rules'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'rules', 'execution-policy.md'), '# policy\n');
    fs.writeFileSync(path.join(dir, 'entry.js'), "require('./mid.js');\n");
    fs.writeFileSync(path.join(dir, 'mid.js'), "require('./ghost-leaf.js');\n");
    const { status, out } = runValidator(tmp);
    assert.strictEqual(status, 1);
    assert.match(out, /mid\.js — unresolved local require\('\.\/ghost-leaf\.js'\)/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('shell source and node-invocation edges in goal scripts are resolved', () => {
  const tmp = makeTempRepo();
  try {
    writePluginJson(tmp, { version: '1.0.0' });
    const dir = path.join(tmp, 'skills', 'opsx-apply-goal', 'scripts');
    fs.mkdirSync(dir, { recursive: true });
    fs.mkdirSync(path.join(tmp, 'rules'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'rules', 'execution-policy.md'), '# policy\n');
    fs.writeFileSync(path.join(dir, 'runner.sh'), [
      '#!/usr/bin/env bash',
      'source ./ghost-lib.sh',
      'node "${CLAUDE_PLUGIN_ROOT:-$ROOT}/skills/opsx-apply-goal/scripts/ghost-entry.js"',
      '',
    ].join('\n'));
    const { status, out } = runValidator(tmp);
    assert.strictEqual(status, 1);
    assert.match(out, /runner\.sh — unresolved shell source '\.\/ghost-lib\.sh'/);
    assert.match(out, /runner\.sh — unresolved node invocation path 'skills\/opsx-apply-goal\/scripts\/ghost-entry\.js'/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('dynamic shell source paths fail unless explicitly allow-listed', () => {
  const tmp = makeTempRepo();
  try {
    writePluginJson(tmp, { version: '1.0.0' });
    const dir = path.join(tmp, 'skills', 'opsx-apply-goal', 'scripts');
    fs.mkdirSync(dir, { recursive: true });
    fs.mkdirSync(path.join(tmp, 'rules'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'rules', 'execution-policy.md'), '# policy\n');
    fs.writeFileSync(path.join(dir, 'dynamic.sh'), 'source "$LIB_DIR/missing.sh"\n');
    const { status, out } = runValidator(tmp);
    assert.strictEqual(status, 1);
    assert.match(out, /dynamic\.sh — dynamic shell source '\$LIB_DIR\/missing\.sh' is not allow-listed/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('shell source graph resolves transitively', () => {
  const tmp = makeTempRepo();
  try {
    writePluginJson(tmp, { version: '1.0.0' });
    const dir = path.join(tmp, 'skills', 'opsx-apply-goal', 'scripts');
    const common = path.join(tmp, 'skills', 'opsx-apply-goal', 'common');
    fs.mkdirSync(dir, { recursive: true });
    fs.mkdirSync(common, { recursive: true });
    fs.mkdirSync(path.join(tmp, 'rules'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'rules', 'execution-policy.md'), '# policy\n');
    fs.writeFileSync(path.join(dir, 'entry.sh'), 'source ../common/mid.sh\n');
    fs.writeFileSync(path.join(common, 'mid.sh'), 'source ./missing-leaf.sh\n');
    const { status, out } = runValidator(tmp);
    assert.strictEqual(status, 1);
    assert.match(out, /mid\.sh — unresolved shell source '\.\/missing-leaf\.sh'/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('absolute dependencies outside the packaged layout fail validation', () => {
  const tmp = makeTempRepo();
  try {
    writePluginJson(tmp, { version: '1.0.0' });
    const dir = path.join(tmp, 'skills', 'opsx-apply-goal', 'scripts');
    fs.mkdirSync(dir, { recursive: true });
    fs.mkdirSync(path.join(tmp, 'rules'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'rules', 'execution-policy.md'), '# policy\n');
    fs.writeFileSync(path.join(dir, 'outside.js'), "require('/etc/hosts');\n");
    fs.writeFileSync(path.join(dir, 'outside.sh'), 'source /etc/hosts\n');
    const { status, out } = runValidator(tmp);
    assert.strictEqual(status, 1);
    assert.match(out, /outside\.js — local require '\/etc\/hosts' escapes packaged layout/);
    assert.match(out, /outside\.sh — shell source '\/etc\/hosts' escapes packaged layout/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('concatenated require expressions are rejected as dynamic paths', () => {
  const tmp = makeTempRepo();
  try {
    writePluginJson(tmp, { version: '1.0.0' });
    const dir = path.join(tmp, 'skills', 'opsx-apply-goal', 'scripts');
    fs.mkdirSync(dir, { recursive: true });
    fs.mkdirSync(path.join(tmp, 'rules'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'rules', 'execution-policy.md'), '# policy\n');
    fs.writeFileSync(path.join(dir, 'dynamic.js'), "const name = process.env.MODULE;\nrequire('./' + name);\n");
    const { status, out } = runValidator(tmp);
    assert.strictEqual(status, 1);
    assert.match(out, /dynamic\.js — dynamic require\(\) expression is not allow-listed/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('single-quoted static shell source resolves successfully', () => {
  const tmp = makeTempRepo();
  try {
    writePluginJson(tmp, { version: '1.0.0' });
    const dir = path.join(tmp, 'skills', 'opsx-apply-goal', 'scripts');
    fs.mkdirSync(dir, { recursive: true });
    fs.mkdirSync(path.join(tmp, 'rules'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'rules', 'execution-policy.md'), '# policy\n');
    fs.writeFileSync(path.join(dir, 'entry.sh'), "source './lib.sh'\n");
    fs.writeFileSync(path.join(dir, 'lib.sh'), '#!/usr/bin/env bash\n');
    const { status, out } = runValidator(tmp);
    assert.strictEqual(status, 0, out);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

run('validate-plugin');
