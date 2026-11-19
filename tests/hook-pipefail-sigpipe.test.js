'use strict';

// A hook that runs under `set -o pipefail` must never read a verdict from the
// end of a pipe whose reader exits early. `producer | grep -q pat` returns 141
// (the producer's SIGPIPE) whenever grep matches before the producer finishes
// writing, and pipefail turns that into "no match". pre-edit-guard.sh judged a
// path that way and exited 0 on `x\n.env` under load. These tests make the
// race deterministic: the match is on the first line and the rest of the input
// is larger than any pipe buffer, so the producer is always still writing when
// grep -q exits.

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const { runHook, ROOT } = require('./_lib/hookharness');
const { makeTempDir } = require('./_lib/temp-dir');

const FILLER = 'y'.repeat(99).concat('\n').repeat(1000); // about 100 KB, above any pipe buffer and below the 128 KB per-variable env limit the harness passes the payload through
const editHook = (filePath, env = {}) =>
  runHook('pre-edit-guard.sh', { payload: { tool_input: { file_path: filePath } }, env, deleteEnv: ['GUARD_EXTRA_PATTERNS'], timeout: 30000 });

test('pre-edit-guard blocks a multi-line .env path even when the reader exits before the writer finishes', () => {
  const res = editHook(`.env\n${FILLER}`);
  assert.strictEqual(res.status, 2, `expected exit 2, got ${res.status}; stderr=${res.stderr}`);
  assert.match(res.stderr, /blocked sensitive file/);
});

test('pre-edit-guard blocks a multi-line lock-file path with the same early-exiting reader', () => {
  const res = editHook(`package-lock.json\n${FILLER}`);
  assert.strictEqual(res.status, 2, `expected exit 2, got ${res.status}; stderr=${res.stderr}`);
  assert.match(res.stderr, /blocked lock file/);
});

test('pre-edit-guard applies GUARD_EXTRA_PATTERNS to a path the reader leaves early', () => {
  const res = editHook(`secret-area/x\n${FILLER}`, { GUARD_EXTRA_PATTERNS: '^secret-area/' });
  assert.strictEqual(res.status, 2, `expected exit 2, got ${res.status}; stderr=${res.stderr}`);
  assert.match(res.stderr, /GUARD_EXTRA_PATTERNS/);
});

test('pre-edit-guard still allows an ordinary multi-line path', () => {
  const res = editHook(`notes.txt\n${FILLER}`);
  assert.strictEqual(res.status, 0, `expected exit 0, got ${res.status}; stderr=${res.stderr}`);
});

test('pre-edit-guard blocks a normal-length non-ASCII path that reaches .git through a dot-dot segment', () => {
  const res = editHook('/work/é/../.git/hooks/pre-commit');
  assert.strictEqual(res.status, 2, `expected exit 2, got ${res.status}; stderr=${res.stderr}`);
});

// The decision must not depend on any external reader: a grep that always exits
// 2 (and a failed redirect, which reads the same way) must neither allow a
// blocked path nor block an ordinary one.
test('pre-edit-guard decides without grep: a grep stub that exits 2 changes no verdict', () => {
  const stubDir = makeTempDir('dhpk-grep-stub-');
  fs.writeFileSync(path.join(stubDir, 'grep'), '#!/bin/sh\nexit 2\n', { mode: 0o755 });
  const env = { PATH: `${stubDir}${path.delimiter}${process.env.PATH}` };
  for (const blocked of ['.env\nx', 'x\n.env', 'é/../.git/config', 'a/package-lock.json\nb']) {
    const res = editHook(blocked, env);
    assert.strictEqual(res.status, 2, `${JSON.stringify(blocked)}: expected exit 2, got ${res.status}; stderr=${res.stderr}`);
  }
  const allowed = editHook('notes.txt\nmore', env);
  assert.strictEqual(allowed.status, 0, `expected exit 0, got ${allowed.status}; stderr=${allowed.stderr}`);
});

test('pre-edit-guard fails closed on a GUARD_EXTRA_PATTERNS regex that does not compile', () => {
  for (const filePath of ['notes.txt', `notes\n${FILLER}`]) {
    const res = editHook(filePath, { GUARD_EXTRA_PATTERNS: '(unbalanced' });
    assert.strictEqual(res.status, 2, `expected exit 2, got ${res.status}; stderr=${res.stderr}`);
    assert.match(res.stderr, /invalid GUARD_EXTRA_PATTERNS regex/);
  }
});

test('pre-edit-guard applies a GUARD_EXTRA_PATTERNS regex that starts with a dash', () => {
  const blocked = editHook('src/a-secret.txt', { GUARD_EXTRA_PATTERNS: '-secret' });
  assert.strictEqual(blocked.status, 2, `expected exit 2, got ${blocked.status}; stderr=${blocked.stderr}`);
  assert.match(blocked.stderr, /blocked by GUARD_EXTRA_PATTERNS/);
  assert.strictEqual(editHook('src/plain.txt', { GUARD_EXTRA_PATTERNS: '-secret' }).status, 0);
});

test('pre-edit-guard treats a newline-separated GUARD_EXTRA_PATTERNS value as one regex per line', () => {
  const patterns = 'secret\nnotes';
  assert.strictEqual(editHook('/repo/notes.txt', { GUARD_EXTRA_PATTERNS: patterns }).status, 2);
  assert.strictEqual(editHook('/repo/secret.txt', { GUARD_EXTRA_PATTERNS: patterns }).status, 2);
  assert.strictEqual(editHook('/repo/other.txt', { GUARD_EXTRA_PATTERNS: patterns }).status, 0);
  // A single trailing newline adds no pattern.
  assert.strictEqual(editHook('/repo/other.txt', { GUARD_EXTRA_PATTERNS: 'secret\n' }).status, 0);
});

test('pre-edit-guard lets an empty GUARD_EXTRA_PATTERNS line match every path, as grep does', () => {
  const res = editHook('/repo/anything.txt', { GUARD_EXTRA_PATTERNS: 'secret\n\nnotes' });
  assert.strictEqual(res.status, 2, `expected exit 2, got ${res.status}; stderr=${res.stderr}`);
  assert.match(res.stderr, /blocked by GUARD_EXTRA_PATTERNS/);
});

test('pre-edit-guard blocks a bad regex on any GUARD_EXTRA_PATTERNS line', () => {
  const res = editHook('/repo/anything.txt', { GUARD_EXTRA_PATTERNS: 'secret\n(unbalanced' });
  assert.strictEqual(res.status, 2);
  assert.match(res.stderr, /invalid GUARD_EXTRA_PATTERNS regex/);
});

test('pre-edit-guard does not let one clean template line vouch for a multi-line path', () => {
  for (const filePath of ['/repo/.env.example\nX/.env', '/repo/.env.example\nX/.git/config', 'X/.env\n/repo/.env.example']) {
    const res = editHook(filePath);
    assert.strictEqual(res.status, 2, `${JSON.stringify(filePath)}: expected exit 2, got ${res.status}; stderr=${res.stderr}`);
  }
  assert.strictEqual(editHook('/repo/.env.example').status, 0, 'a plain template path stays allowed');
});

test('pre-edit-guard keeps case-insensitive matching out of the case-sensitive checks', () => {
  // .env and .git names are matched case-insensitively; lock files and extra patterns are not.
  assert.strictEqual(editHook('/repo/.ENV').status, 2);
  assert.strictEqual(editHook('/repo/COMPOSER.LOCK').status, 0);
  assert.strictEqual(editHook('/repo/NOTES.txt', { GUARD_EXTRA_PATTERNS: 'notes' }).status, 0);
  assert.strictEqual(editHook('/repo/notes.txt', { GUARD_EXTRA_PATTERNS: 'notes' }).status, 2);
});

// Static guard for the whole class: no hook script may put an early-exiting
// reader at the end of a pipe inside a condition.
function hookScripts() {
  const out = [];
  const walk = (dir, filter) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, filter);
      else if (entry.name.endsWith('.sh') && filter(full)) out.push(full);
    }
  };
  walk(path.join(ROOT, 'scripts', 'hooks'), () => true);
  for (const mod of fs.readdirSync(path.join(ROOT, 'modules'))) {
    const hooks = path.join(ROOT, 'modules', mod, 'hooks');
    if (fs.existsSync(hooks)) walk(hooks, () => true);
  }
  return out;
}

// An early-exiting reader at the end of a pipe: grep with -q or -m (in any option
// position, short or long), dhpk__version_covered (returns on the first match),
// and head or awk ...exit when the pipe sits in a condition (if, elif, while,
// until, !, &&, ||).
const EARLY_EXIT_READER = new RegExp(
  [
    String.raw`\|\s*grep\b[^|;&]*\s(?:-[A-Za-z]*[qm][A-Za-z]*|--quiet|--silent|--max-count)`,
    String.raw`\|\s*dhpk__version_covered\b`,
    String.raw`(?:^\s*(?:if|elif|while|until)\b|\s&&\s|\s\|\|\s|^\s*!)[^#]*\|\s*(?:head\b|awk\b[^|]*\bexit\b)`,
  ].join('|')
);

test('no hook script ends a pipe in an early-exiting reader', () => {
  const offenders = [];
  for (const file of hookScripts()) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (/^\s*#/.test(line)) return;
      if (EARLY_EXIT_READER.test(line)) offenders.push(`${path.relative(ROOT, file)}:${i + 1}: ${line.trim()}`);
    });
    // A pipe continued onto the next line.
    lines.forEach((line, i) => {
      if (/\|\s*\\$/.test(line) && EARLY_EXIT_READER.test(`|${lines[i + 1] || ''}`.replace(/^\|\s*/, '| '))) {
        offenders.push(`${path.relative(ROOT, file)}:${i + 2}: ${(lines[i + 1] || '').trim()}`);
      }
    });
  }
  assert.deepStrictEqual(offenders, [], `use grep -q < <(producer) instead:\n${offenders.join('\n')}`);
});

run('hook-pipefail-sigpipe');
