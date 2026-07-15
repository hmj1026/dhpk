'use strict';

// Coverage for post-edit-advisory.sh (PostToolUse Edit|Write|MultiEdit, async):
//   - CRLF normalization: a .sh file containing \r\n line endings gets its \r
//     stripped in place, with a plain stdout echo (not systemMessage JSON).
//   - Root-manifest lockfile-sync reminder: editing a ROOT-LEVEL package
//     manifest (e.g. package.json) emits a systemMessage naming the lock file.
//   - Negative: a nested manifest (contains a slash) does NOT trigger the
//     lockfile reminder.
//   - Always exits 0.

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const { mkRepo: mkRepoRaw, runHook: runHookRaw } = require('./_lib/hookharness');

const HOOK = 'post-edit-advisory.sh';

function mkRepo() {
  return mkRepoRaw({ prefix: 'dhpk-pea-' });
}

function runHook(repo, filePath) {
  return runHookRaw(HOOK, {
    payload: { tool_input: { file_path: filePath } },
    cwd: repo,
  });
}

test('CRLF line endings in a .sh file are normalised to LF', () => {
  const repo = mkRepo();
  try {
    const shFile = path.join(repo, 'script.sh');
    fs.writeFileSync(shFile, '#!/usr/bin/env bash\r\necho hi\r\n');
    const res = runHook(repo, shFile);
    assert.strictEqual(res.status, 0, `expected exit 0: ${res.stderr}`);
    assert.ok(res.stdout.includes('[crlf-fix] normalised line endings'),
      `expected crlf-fix message, got: ${res.stdout}`);
    const content = fs.readFileSync(shFile, 'utf8');
    assert.ok(!content.includes('\r'), 'expected \\r stripped from file');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('a .sh file with no CRLF is left untouched (no crlf-fix message)', () => {
  const repo = mkRepo();
  try {
    const shFile = path.join(repo, 'clean.sh');
    fs.writeFileSync(shFile, '#!/usr/bin/env bash\necho hi\n');
    const res = runHook(repo, shFile);
    assert.strictEqual(res.status, 0, `expected exit 0: ${res.stderr}`);
    assert.ok(!res.stdout.includes('crlf-fix'), `expected no crlf-fix message, got: ${res.stdout}`);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('editing root-level package.json emits lockfile-sync systemMessage', () => {
  const repo = mkRepo();
  try {
    const manifest = path.join(repo, 'package.json');
    fs.writeFileSync(manifest, '{}');
    const res = runHook(repo, manifest);
    assert.strictEqual(res.status, 0, `expected exit 0: ${res.stderr}`);
    assert.ok(res.stdout.includes('"systemMessage"'), `expected systemMessage JSON, got: ${res.stdout}`);
    assert.ok(res.stdout.includes('package-lock.json'),
      `expected package-lock.json mention, got: ${res.stdout}`);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('editing a NESTED package.json (contains slash) does not trigger lockfile reminder', () => {
  const repo = mkRepo();
  try {
    const nestedDir = path.join(repo, 'vendor', 'lib');
    fs.mkdirSync(nestedDir, { recursive: true });
    const manifest = path.join(nestedDir, 'package.json');
    fs.writeFileSync(manifest, '{}');
    const res = runHook(repo, manifest);
    assert.strictEqual(res.status, 0, `expected exit 0: ${res.stderr}`);
    assert.ok(!res.stdout.includes('systemMessage'), `expected no reminder, got: ${res.stdout}`);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('editing composer.json at root names composer.lock', () => {
  const repo = mkRepo();
  try {
    const manifest = path.join(repo, 'composer.json');
    fs.writeFileSync(manifest, '{}');
    const res = runHook(repo, manifest);
    assert.strictEqual(res.status, 0, `expected exit 0: ${res.stderr}`);
    assert.ok(res.stdout.includes('composer.lock'), `expected composer.lock mention, got: ${res.stdout}`);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

run('post-edit-advisory');
