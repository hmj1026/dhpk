'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const { runNodeTest } = require('../scripts/lib/bounded-child-process');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-bounded-child-'));
  const child = path.join(root, 'child.js');
  const marker = path.join(root, 'grandchild-ran');
  fs.writeFileSync(child, [
    "const { spawn } = require('node:child_process');",
    `spawn(process.execPath, ['-e', ${JSON.stringify(`setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'late'), 1500)`)}], { stdio: 'ignore' });`,
    'setTimeout(() => {}, 5000);',
  ].join('\n'));
  return { root, child, marker };
}

function stubbornFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-bounded-stubborn-'));
  const child = path.join(root, 'child.js');
  const marker = path.join(root, 'grandchild-ran');
  fs.writeFileSync(child, [
    "const { spawn } = require('node:child_process');",
    `spawn(process.execPath, ['-e', ${JSON.stringify(`process.on('SIGTERM', () => {}); setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'late'), 1500)`)}], { stdio: 'ignore' });`,
    'setTimeout(() => {}, 5000);',
  ].join('\n'));
  return { root, child, marker };
}

function stubbornDirectFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-bounded-direct-'));
  const child = path.join(root, 'child.js');
  const marker = path.join(root, 'direct-ran');
  fs.writeFileSync(child, [
    "process.on('SIGTERM', () => {});",
    `setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'late'), 1500);`,
  ].join('\n'));
  return { root, child, marker };
}

function normalDescendantFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-bounded-normal-'));
  const child = path.join(root, 'child.js');
  const marker = path.join(root, 'normal-descendant-ran');
  fs.writeFileSync(child, [
    "const { spawn } = require('node:child_process');",
    `spawn(process.execPath, ['-e', ${JSON.stringify(`setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'done'), 250)`)}], { stdio: 'ignore' });`,
  ].join('\n'));
  return { root, child, marker };
}

test('timed-out Node test leaves no grandchild running in the process group', () => {
  const { root, child, marker } = fixture();
  try {
    const result = runNodeTest(child, { timeoutMs: 100, env: process.env });
    assert.ok(result.error, 'spawnSync should report the timeout');
    assert.strictEqual(result.error.code, 'ETIMEDOUT');
    spawnSync('sleep', ['2']);
    assert.strictEqual(fs.existsSync(marker), false, 'grandchild must be terminated with its test group');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('timed-out Node test force-kills descendants that ignore SIGTERM', () => {
  const { root, child, marker } = stubbornFixture();
  try {
    const result = runNodeTest(child, { timeoutMs: 100, env: process.env });
    assert.ok(result.error, 'spawnSync should report the timeout');
    assert.strictEqual(result.error.code, 'ETIMEDOUT');
    spawnSync('sleep', ['2']);
    assert.strictEqual(fs.existsSync(marker), false, 'stubborn descendants must be force-killed with their test group');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('timed-out Node test force-kills a direct child that ignores SIGTERM', () => {
  const { root, child, marker } = stubbornDirectFixture();
  try {
    const started = Date.now();
    const result = runNodeTest(child, { timeoutMs: 100, env: process.env });
    const elapsed = Date.now() - started;
    assert.ok(result.error, 'spawnSync should report the timeout');
    assert.strictEqual(result.error.code, 'ETIMEDOUT');
    assert.ok(elapsed < 1000, `direct child should be killed promptly, took ${elapsed}ms`);
    assert.strictEqual(fs.existsSync(marker), false, 'direct child must not finish after the timeout');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('successful Node test does not kill a descendant that is still flushing its result', () => {
  const { root, child, marker } = normalDescendantFixture();
  try {
    const result = runNodeTest(child, { timeoutMs: 1000, env: process.env });
    assert.strictEqual(result.status, 0, result.error && result.error.message);
    spawnSync('sleep', ['1']);
    assert.strictEqual(fs.existsSync(marker), true, 'normal completion must not race descendant output cleanup');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

run('bounded-child-process');
