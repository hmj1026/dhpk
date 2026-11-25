'use strict';

// Exercise the public handoff write/state boundary with both an actual failed
// check and a missing tool. The fixture proves Save remains recoverable and
// Resume state changes do not discard verification evidence.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const WRITE = path.join(ROOT, 'skills', 'opsx-apply-resume', 'scripts', 'write-handoff.sh');
const SET_STATE = path.join(ROOT, 'skills', 'opsx-apply-resume', 'scripts', 'set-handoff-state.sh');

function tempRoot() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'opsx-resume-evidence-')));
}

function runScript(script, args, cwd, input) {
  return spawnSync('/bin/bash', [script, ...args], {
    cwd,
    input,
    encoding: 'utf8',
    timeout: 10_000,
  });
}

test('Save preserves failed and missing-tool evidence through Resume state transition', () => {
  const cwd = tempRoot();
  const handoff = path.join(cwd, '.scratch', 'checkout-a', 'apply-resume.md');
  const payload = [
    'state: saved',
    'change_id: checkout-a',
    '',
    '## Verification Evidence',
    '### Static Rules',
    '- check: npm run lint',
    '  status: PASS',
    '  exit_code: 0',
    '  evidence: .scratch/checkout-a/evidence/lint.txt',
    '  reason: static rules passed',
    '',
    '- check: npm test -- --runInBand',
    '  status: FAIL',
    '  exit_code: 1',
    '  evidence: .scratch/checkout-a/evidence/test-failure.txt',
    '  reason: assertion failure in retry case',
    '',
    '## Next Actions',
    '1. Fix the retry fixture and rerun the failed test command.',
    '',
    '### In Progress',
    '- check: inspect retry fixture',
    '  status: NOT_RUN',
    '  exit_code: N/A',
    '  evidence: (none)',
    '  reason: investigation is in progress',
    '',
    '### Latest Failed Evidence',
    '- check: npm test -- --runInBand',
    '  status: FAIL',
    '  exit_code: 1',
    '  evidence: .scratch/checkout-a/evidence/test-failure.txt',
    '  reason: latest observed failure; rerun after fixture fix',
    '',
  ].join('\n');

  try {
    const save = runScript(WRITE, [handoff], cwd, payload);
    assert.strictEqual(save.status, 0, `${save.stdout}\n${save.stderr}`);
    const beforeResume = fs.readFileSync(handoff, 'utf8');
    assert.match(beforeResume, /status: NOT_RUN/);
    assert.match(beforeResume, /status: FAIL/);
    assert.doesNotMatch(beforeResume, /tool missing[\s\S]*status: PASS/);

    const resume = runScript(SET_STATE, ['consuming', handoff], cwd);
    assert.strictEqual(resume.status, 0, `${resume.stdout}\n${resume.stderr}`);
    const afterResume = fs.readFileSync(handoff, 'utf8');
    assert.match(afterResume, /^state: consuming$/m);
    assert.ok(afterResume.includes('## Verification Evidence'));
    assert.ok(afterResume.includes('Latest Failed Evidence'));
    assert.ok(afterResume.includes('1. Fix the retry fixture'));
    assert.ok(afterResume.includes('status: NOT_RUN'));
    assert.ok(afterResume.includes('exit_code: N/A'));
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('Save can record an unavailable verification tool without claiming PASS', () => {
  const cwd = tempRoot();
  const handoff = path.join(cwd, '.scratch', 'checkout-missing-tool', 'apply-resume.md');
  const payload = [
    'state: saved',
    '',
    '## Verification Evidence',
    '- check: cargo test',
    '  status: NOT_RUN',
    '  exit_code: N/A',
    '  evidence: (none)',
    '  reason: cargo is not installed',
    '',
    '## Next Actions',
    '1. Install cargo, then run cargo test.',
    '',
  ].join('\n');

  try {
    const save = runScript(WRITE, [handoff], cwd, payload);
    assert.strictEqual(save.status, 0, `${save.stdout}\n${save.stderr}`);
    const resume = runScript(SET_STATE, ['consuming', handoff], cwd);
    assert.strictEqual(resume.status, 0, `${resume.stdout}\n${resume.stderr}`);
    const restored = fs.readFileSync(handoff, 'utf8');
    assert.match(restored, /^state: consuming$/m);
    assert.match(restored, /Install cargo, then run cargo test/);
    assert.match(restored, /status: NOT_RUN/);
    assert.match(restored, /reason: cargo is not installed/);
    assert.doesNotMatch(restored, /cargo test[\s\S]*status: PASS/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

run('opsx-resume-evidence');
