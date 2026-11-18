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

const EARLY_EXIT_READER = /\|\s*(?:grep\s+(?:-[A-Za-z]*q[A-Za-z]*|--quiet|--silent)\b|dhpk__version_covered\b)/;

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
