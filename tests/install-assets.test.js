'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const INSTALLER = path.join(ROOT, 'scripts', 'setup', 'install-assets.sh');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-install-assets-'));
  const source = path.join(root, 'source');
  const target = path.join(root, 'target');
  fs.mkdirSync(path.join(source, 'hooks'), { recursive: true });
  fs.mkdirSync(path.join(source, 'scripts', 'hooks'), { recursive: true });
  fs.mkdirSync(path.join(source, 'rules'), { recursive: true });
  fs.mkdirSync(path.join(source, 'scripts', 'lib'), { recursive: true });
  fs.writeFileSync(path.join(source, 'hooks', 'hooks.json'), JSON.stringify({
    hooks: {
      PreToolUse: [{ hooks: [{ args: ['${CLAUDE_PLUGIN_ROOT}/scripts/hooks/guard.sh'] }] }],
    },
  }) + '\n');
  fs.writeFileSync(path.join(source, 'scripts', 'hooks', 'guard.sh'), '#!/usr/bin/env bash\necho guard\n');
  fs.chmodSync(path.join(source, 'scripts', 'hooks', 'guard.sh'), 0o755);
  fs.writeFileSync(path.join(source, 'rules', 'execution-policy.md'), '# policy\n');
  fs.writeFileSync(path.join(source, 'scripts', 'lib', 'runner.js'), 'module.exports = 1;\n');
  return { root, source, target };
}

function install(ctx, args) {
  return spawnSync('bash', [INSTALLER, '--source', ctx.source, '--target', ctx.target, ...args], {
    encoding: 'utf8',
    timeout: 10000,
  });
}

test('dry run reports source and target without writing files', () => {
  const ctx = fixture();
  try {
    const res = install(ctx, ['--install', 'hooks', '--dry-run']);
    assert.strictEqual(res.status, 0, res.stderr);
    assert.match(res.stdout, /DRY-RUN .*hooks\.json/);
    assert.ok(!fs.existsSync(ctx.target), 'dry-run must not create the target directory');
  } finally { fs.rmSync(ctx.root, { recursive: true, force: true }); }
});

test('install copies selected assets and preserves executable source files', () => {
  const ctx = fixture();
  try {
    const res = install(ctx, ['--install', 'hooks']);
    const copied = path.join(ctx.target, 'scripts', 'hooks', 'guard.sh');
    assert.strictEqual(res.status, 0, res.stderr);
    assert.ok(fs.existsSync(path.join(ctx.target, 'hooks', 'hooks.json')));
    assert.ok(fs.existsSync(copied));
    assert.ok((fs.statSync(copied).mode & 0o100) !== 0, 'executable source must stay executable');
    assert.ok(!res.stdout.includes('DRY-RUN'), `real install must not print dry-run actions:\n${res.stdout}`);
  } finally { fs.rmSync(ctx.root, { recursive: true, force: true }); }
});

test('installed hooks manifest resolves every plugin-root hook argument inside the target', () => {
  const ctx = fixture();
  try {
    const res = install(ctx, ['--install', 'hooks']);
    assert.strictEqual(res.status, 0, res.stderr);
    const manifest = JSON.parse(fs.readFileSync(path.join(ctx.target, 'hooks', 'hooks.json'), 'utf8'));
    const hookArgs = manifest.hooks.PreToolUse.flatMap((entry) => entry.hooks.flatMap((hook) => hook.args || []));
    for (const arg of hookArgs) {
      const resolved = arg.replace('${CLAUDE_PLUGIN_ROOT}', ctx.target);
      assert.ok(fs.existsSync(resolved), `manifest target must exist: ${resolved}`);
    }
  } finally { fs.rmSync(ctx.root, { recursive: true, force: true }); }
});

test('a conflicting target is reported without overwrite unless --force is explicit', () => {
  const ctx = fixture();
  try {
    fs.mkdirSync(path.join(ctx.target, 'rules'), { recursive: true });
    const target = path.join(ctx.target, 'rules', 'execution-policy.md');
    fs.writeFileSync(target, '# local policy\n');
    const blocked = install(ctx, ['--install', 'rules']);
    assert.strictEqual(blocked.status, 3, blocked.stderr);
    assert.match(blocked.stderr, /CONFLICT/);
    assert.strictEqual(fs.readFileSync(target, 'utf8'), '# local policy\n');
    const forced = install(ctx, ['--install', 'rules', '--force']);
    assert.strictEqual(forced.status, 0, forced.stderr);
    assert.strictEqual(fs.readFileSync(target, 'utf8'), '# policy\n');
  } finally { fs.rmSync(ctx.root, { recursive: true, force: true }); }
});

test('a symlinked destination is rejected without writing outside the selected target', () => {
  const ctx = fixture();
  try {
    const outside = path.join(ctx.root, 'outside-policy.md');
    fs.mkdirSync(path.join(ctx.target, 'rules'), { recursive: true });
    fs.writeFileSync(outside, '# outside policy\n');
    fs.symlinkSync(outside, path.join(ctx.target, 'rules', 'execution-policy.md'));
    const res = install(ctx, ['--install', 'rules', '--force']);
    assert.strictEqual(res.status, 4, res.stderr);
    assert.match(res.stderr, /UNSAFE SYMLINK/);
    assert.strictEqual(fs.readFileSync(outside, 'utf8'), '# outside policy\n');
  } finally { fs.rmSync(ctx.root, { recursive: true, force: true }); }
});

test('--install all copies hooks, rules, and scripts to their deterministic targets', () => {
  const ctx = fixture();
  try {
    const res = install(ctx, ['--install', 'all']);
    assert.strictEqual(res.status, 0, res.stderr);
    assert.ok(fs.existsSync(path.join(ctx.target, 'hooks', 'hooks.json')));
    assert.ok(fs.existsSync(path.join(ctx.target, 'rules', 'execution-policy.md')));
    assert.ok(fs.existsSync(path.join(ctx.target, 'scripts', 'lib', 'runner.js')));
  } finally { fs.rmSync(ctx.root, { recursive: true, force: true }); }
});

run('setup-install-assets');
