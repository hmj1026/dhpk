'use strict';

// Coverage for scripts/lib/resolve-invocation-class.js. The helper is a
// fail-closed boundary for shell hooks, so assertions exercise the exported
// resolver directly (including agent dispatch targets) while hook tests cover
// the CLI boundary.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'lib', 'resolve-invocation-class.js');
const { resolveInvocationClass } = require(SCRIPT);

function makeResolverFixture() {
  const pluginRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'resolve-invocation-class-'));
  for (const dir of ['agents', 'codex/agents', 'commands', 'skills']) {
    fs.mkdirSync(path.join(pluginRoot, dir), { recursive: true });
  }
  fs.mkdirSync(path.join(pluginRoot, 'skills', 'valid'), { recursive: true });
  fs.writeFileSync(
    path.join(pluginRoot, 'commands', 'valid.md'),
    '---\nmetadata:\n  dhpk-invocation-class: explicit-only\n---\n',
  );
  fs.writeFileSync(
    path.join(pluginRoot, 'skills', 'valid', 'SKILL.md'),
    '---\nmetadata:\n  dhpk-invocation-class: implicit-eligible\n---\n',
  );
  fs.writeFileSync(path.join(pluginRoot, 'agents', 'valid-agent.md'), 'name: valid-agent\n');
  return pluginRoot;
}

test('resolves a paired explicit-only command from a namespaced route target', () => {
  assert.strictEqual(resolveInvocationClass(ROOT, 'dhpk:smart-commit'), 'explicit-only');
});

test('resolves an implicit-eligible skill from a namespaced route target', () => {
  assert.strictEqual(resolveInvocationClass(ROOT, 'dhpk:review-pending'), 'implicit-eligible');
});

test('recognizes an existing agent route without treating it as a Skill-tool invocation class', () => {
  assert.strictEqual(resolveInvocationClass(ROOT, 'agent:e2e-runner'), 'agent');
});

test('agent routes fail closed when the name or source is unknown', () => {
  for (const target of ['agent:missing-role', 'agent:../e2e-runner', 'agent:']) {
    assert.strictEqual(resolveInvocationClass(ROOT, target), null, `${target}: expected null class`);
  }
});

test('missing or malformed targets fail closed with no class output', () => {
  for (const target of ['dhpk:deploy-prod', 'dhpk:../commands', '']) {
    assert.strictEqual(resolveInvocationClass(ROOT, target), null, `${target}: expected null class`);
  }
});

test('rejects out-of-root symlink escapes and directory targets for agent and dhpk routes', () => {
  const pluginRoot = makeResolverFixture();
  const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'resolve-invocation-class-outside-'));
  try {
    const outsideFile = path.join(outsideRoot, 'escaped.md');
    fs.writeFileSync(outsideFile, '---\nmetadata:\n  dhpk-invocation-class: explicit-only\n---\n');
    fs.symlinkSync(outsideFile, path.join(pluginRoot, 'agents', 'escaped.md'));
    fs.mkdirSync(path.join(pluginRoot, 'skills', 'escaped'), { recursive: true });
    fs.symlinkSync(outsideFile, path.join(pluginRoot, 'skills', 'escaped', 'SKILL.md'));
    fs.mkdirSync(path.join(pluginRoot, 'agents', 'directory.md'));
    fs.mkdirSync(path.join(pluginRoot, 'commands', 'directory.md'));

    assert.strictEqual(resolveInvocationClass(pluginRoot, 'agent:escaped'), null);
    assert.strictEqual(resolveInvocationClass(pluginRoot, 'dhpk:escaped'), null);
    assert.strictEqual(resolveInvocationClass(pluginRoot, 'agent:directory'), null);
    assert.strictEqual(resolveInvocationClass(pluginRoot, 'dhpk:directory'), null);
  } finally {
    fs.rmSync(pluginRoot, { recursive: true, force: true });
    fs.rmSync(outsideRoot, { recursive: true, force: true });
  }
});

test('accepts canonical in-root symlinks and a symlinked plugin root', () => {
  const pluginRoot = makeResolverFixture();
  const rootAlias = `${pluginRoot}-alias`;
  try {
    fs.symlinkSync('valid-agent.md', path.join(pluginRoot, 'agents', 'linked-agent.md'));
    fs.symlinkSync('valid', path.join(pluginRoot, 'skills', 'linked'));
    fs.symlinkSync(pluginRoot, rootAlias);

    assert.strictEqual(resolveInvocationClass(rootAlias, 'agent:linked-agent'), 'agent');
    assert.strictEqual(resolveInvocationClass(rootAlias, 'dhpk:linked'), 'implicit-eligible');
  } finally {
    fs.rmSync(rootAlias, { recursive: true, force: true });
    fs.rmSync(pluginRoot, { recursive: true, force: true });
  }
});

run('resolve-invocation-class');
