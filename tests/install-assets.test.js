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
  fs.writeFileSync(path.join(source, 'hooks', 'hooks.json'), '{"hooks":{}}\n');
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
    const copied = path.join(ctx.target, 'hooks', 'scripts', 'guard.sh');
    assert.strictEqual(res.status, 0, res.stderr);
    assert.ok(fs.existsSync(path.join(ctx.target, 'hooks', 'hooks.json')));
    assert.ok(fs.existsSync(copied));
    assert.ok((fs.statSync(copied).mode & 0o100) !== 0, 'executable source must stay executable');
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
