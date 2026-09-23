'use strict';

// RED contract for portable workflow helpers and the JS static-check status
// entrypoint.  These tests exercise the caller-facing shell/CLI interfaces so
// a Codex handoff path cannot silently alter the legacy Claude path.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const DETECT = path.join(ROOT, 'skills', 'opsx-apply-resume', 'scripts', 'detect-phase.sh');
const SET_STATE = path.join(ROOT, 'skills', 'opsx-apply-resume', 'scripts', 'set-handoff-state.sh');
const STATUS = path.join(ROOT, 'skills', 'js-static-check-strategy', 'scripts', 'status.js');

function makeTemp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function legacyPath(root) {
  return path.join(root, '.claude', 'artifacts', 'apply-resume', 'latest.md');
}

function writeHandoff(file, state, savedAt = '2020-01-01T00:00:00Z') {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `state: ${state}\nsaved_at: ${savedAt}\n`);
}

function runDetect(cwd, handoffFile) {
  const args = handoffFile ? [DETECT, handoffFile] : [DETECT];
  return spawnSync('bash', args, { cwd, encoding: 'utf8', timeout: 10000 });
}

function runSet(cwd, state, handoffFile) {
  const args = handoffFile ? [SET_STATE, state, handoffFile] : [SET_STATE, state];
  return spawnSync('bash', args, { cwd, encoding: 'utf8', timeout: 10000 });
}

test('detect-phase accepts an explicit handoff file without reading the legacy file', () => {
  const tmp = makeTemp('portable-detect-');
  try {
    const legacy = legacyPath(tmp);
    const explicit = path.join(tmp, 'codex', 'handoff.md');
    writeHandoff(legacy, 'consuming');
    writeHandoff(explicit, 'saved');
    const result = runDetect(tmp, explicit);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.strictEqual(result.stdout.trim(), 'resume');
    assert.match(fs.readFileSync(legacy, 'utf8'), /^state: consuming$/m);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('detect-phase keeps the legacy relative path as the default interface', () => {
  const tmp = makeTemp('portable-detect-default-');
  try {
    writeHandoff(legacyPath(tmp), 'consuming');
    const result = runDetect(tmp);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.strictEqual(result.stdout.trim(), 'consuming');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('set-handoff-state updates only the explicit file when one is supplied', () => {
  const tmp = makeTemp('portable-set-state-');
  try {
    const legacy = legacyPath(tmp);
    const explicit = path.join(tmp, 'codex', 'handoff.md');
    writeHandoff(legacy, 'saved');
    writeHandoff(explicit, 'consuming');
    const result = runSet(tmp, 'consumed', explicit);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.match(fs.readFileSync(explicit, 'utf8'), /^state: consumed$/m);
    assert.match(fs.readFileSync(legacy, 'utf8'), /^state: saved$/m);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('set-handoff-state retains the legacy path when no explicit file is supplied', () => {
  const tmp = makeTemp('portable-set-state-default-');
  try {
    const legacy = legacyPath(tmp);
    writeHandoff(legacy, 'saved');
    const result = runSet(tmp, 'consuming');
    assert.strictEqual(result.status, 0, result.stderr);
    assert.match(fs.readFileSync(legacy, 'utf8'), /^state: consuming$/m);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('JS status counts only immediate files and only anchored directives', () => {
  const tmp = makeTemp('portable-ts-status-');
  try {
    fs.writeFileSync(path.join(tmp, 'strict.js'), '// @ts-check\nconst strict = true;\n');
    fs.writeFileSync(path.join(tmp, 'transition.js'), '// @ts-nocheck\nconst transition = true;\n');
    fs.writeFileSync(path.join(tmp, 'comment-only.js'), '// TODO: enable @ts-check after cleanup\n');
    fs.mkdirSync(path.join(tmp, 'nested'));
    fs.writeFileSync(path.join(tmp, 'nested', 'ignored.js'), '// @ts-check\n');

    const result = spawnSync('node', [STATUS, '--path', tmp], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 10000,
    });
    assert.strictEqual(result.status, 0, result.stderr);
    assert.match(result.stdout, /total=3\s+strict=1\s+nocheck=1\s+unmarked=1/);
    assert.match(result.stdout, /strict\.js/);
    assert.match(result.stdout, /transition\.js/);
    assert.match(result.stdout, /comment-only\.js/);
    assert.doesNotMatch(result.stdout, /ignored\.js/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('JS status reports a missing scan path without fabricating counts', () => {
  const tmp = makeTemp('portable-ts-status-missing-');
  const missing = path.join(tmp, 'does-not-exist');
  try {
    const result = spawnSync('node', [STATUS, '--path', missing], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 10000,
    });
    assert.strictEqual(result.status, 0, result.stderr);
    assert.match(result.stdout, /scan path .*does-not-exist.*does not exist/i);
    assert.doesNotMatch(result.stdout, /total=\d+\s+strict=\d+/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

run('portable-workflow-runtime');
