'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const {
  mkRepo,
  sessionsDir: sessDir,
  runHook: runHookRaw,
} = require('./_lib/hookharness');

const HOOK = 'stop-review-reminder.sh';

function mkTempRepo() {
  return mkRepo({ prefix: 'dhpk-stop-reminder-' });
}

function writeFile(repo, name, body) {
  fs.mkdirSync(sessDir(repo), { recursive: true });
  fs.writeFileSync(path.join(sessDir(repo), name), body);
}

function runHook(repo, payload = {}, env = {}) {
  return runHookRaw(HOOK, {
    payload,
    cwd: repo,
    env,
    deleteEnv: ['CLAUDE_PLUGIN_OPTION_REVIEW_AGENTS'],
  });
}

test('stale sentinel exposes exact manual-clear basename as triage-drop only', () => {
  const repo = mkTempRepo();
  try {
    writeFile(repo, '.pending-db-review', '2026-07-07 12:00 src/Repo.php\n');
    const stale = new Date(Date.now() - 61 * 60 * 1000);
    fs.utimesSync(path.join(sessDir(repo), '.pending-db-review'), stale, stale);
    const res = runHook(repo);
    assert.strictEqual(res.status, 2, `expected stop block, got ${res.status}`);
    assert.ok(res.stderr.includes('clear-sentinel.sh" .pending-db-review manual'),
      `manual clear command must use exact basename:\n${res.stderr}`);
    assert.ok(!res.stderr.includes('clear-sentinel.sh" db manual'),
      `manual clear command must not use shorthand:\n${res.stderr}`);
    assert.ok(res.stderr.includes('triage-drop'));
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('Stop reminder reports matching active marker as in-flight work to wait for', () => {
  const repo = mkTempRepo();
  try {
    writeFile(repo, '.pending-doc-review', '2026-07-07 12:00 docs/Guide.md\n');
    writeFile(repo, '.active-doc-review', '1783440000 doc-reviewer\n');
    const res = runHook(repo);
    assert.strictEqual(res.status, 2, `expected stop block, got ${res.status}`);
    assert.ok(res.stderr.includes('[WARN] IN-FLIGHT: doc-reviewer'),
      `missing in-flight status:\n${res.stderr}`);
    assert.ok(res.stderr.includes('wait for the existing doc-reviewer result'),
      `missing wait instruction:\n${res.stderr}`);
    assert.ok(!res.stderr.includes('Recommended: invoke \'doc-reviewer\''),
      `must not suggest duplicate dispatch for in-flight reviewer:\n${res.stderr}`);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('Stop reminder recommends one merged dispatch with every pending file and no fresh manual clear', () => {
  const repo = mkTempRepo();
  try {
    writeFile(repo, '.pending-doc-review', [
      '2026-07-07 12:00 docs/Guide.md',
      '2026-07-07 12:01 docs/API.md',
      '2026-07-07 12:02 docs/Runbook.md',
      '2026-07-07 12:03 docs/Policy.md',
      '2026-07-07 12:04 docs/FAQ.md',
      '2026-07-07 12:05 docs/Sixth.md',
    ].join('\n') + '\n');
    const res = runHook(repo);
    assert.strictEqual(res.status, 2, `expected stop block, got ${res.status}`);
    assert.ok(res.stderr.includes('[WARN] PENDING: doc-reviewer'),
      `missing existing pending status:\n${res.stderr}`);
    assert.ok(res.stderr.includes('dispatch ONE \'doc-reviewer\' covering ALL 6 pending files'), res.stderr);
    assert.ok(res.stderr.includes('docs/Sixth.md'), `complete file list missing:\n${res.stderr}`);
    assert.ok(!res.stderr.includes('Manual clear:'), `fresh sentinel advertised manual clear:\n${res.stderr}`);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('third unchanged reminder escalates after two ignored reminders', () => {
  const repo = mkTempRepo();
  try {
    writeFile(repo, '.pending-doc-review', '2026-07-07 12:00 docs/Guide.md\n');
    const payload = { session_id: 'ignored' };
    const env = { DHPK_REVIEW_REMINDER_BACKOFF_SECONDS: '0' };
    runHook(repo, payload, env);
    runHook(repo, payload, env);
    const third = runHook(repo, payload, env);
    assert.strictEqual(third.status, 2, third.stderr);
    assert.ok(third.stderr.includes('ignored 2 times'), third.stderr);
    assert.ok(third.stderr.includes('dispatch before any further implementation work'), third.stderr);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('arm-on-dispatch marker is treated as owed review without a phantom file path', () => {
  const repo = mkTempRepo();
  try {
    writeFile(repo, '.pending-doc-review', '1783440000 arm-on-dispatch:doc-reviewer [arm-on-dispatch]\n');
    const res = runHook(repo);
    assert.strictEqual(res.status, 2, `expected stop block, got ${res.status}`);
    assert.ok(res.stderr.includes('[WARN] PENDING: doc-reviewer'));
    assert.ok(!res.stderr.includes('    · [arm-on-dispatch]'), `marker leaked as file path:\n${res.stderr}`);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('GNU stat filesystem output does not break sentinel age detection', () => {
  const repo = mkTempRepo();
  try {
    writeFile(repo, '.pending-doc-review', '2026-07-07 12:00 docs/Guide.md\n');
    const bin = path.join(repo, 'bin');
    const fakeStat = path.join(bin, 'stat');
    fs.mkdirSync(bin, { recursive: true });
    fs.writeFileSync(fakeStat, [
      '#!/usr/bin/env bash',
      'if [ "$1" = "-f" ]; then',
      '  echo "File: sentinel Type: ext2/ext3"',
      '  exit 0',
      'fi',
      'printf "1\\n"',
    ].join('\n'));
    fs.chmodSync(fakeStat, 0o755);

    const res = runHook(repo, {}, { PATH: `${bin}:${process.env.PATH}` });
    assert.strictEqual(res.status, 2, `GNU stat compatibility failed:\n${res.stderr}`);
    assert.ok(res.stderr.includes('[WARN] PENDING: doc-reviewer'), res.stderr);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

// --- provenance scoping: concurrent sessions must not review each other's work ---

const OWN = 'sess-own';
const OTHER = 'sess-other';

function withProvenance(repo, sentinel, rows) {
  writeFile(repo, sentinel, rows.map((r) => `2026-07-07 12:00 ${r.path}\n`).join(''));
  writeFile(repo, '.sentinel-provenance',
    rows.map((r) => `${sentinel}\t${r.path}\t${r.prov}\n`).join(''));
}

test('entries owned by another live session do not trigger a dispatch recommendation', () => {
  const repo = mkTempRepo();
  try {
    withProvenance(repo, '.pending-doc-review', [
      { path: 'docs/TheirGuide.md', prov: `session:${OTHER}` },
    ]);
    const res = runHook(repo, { session_id: OWN, stop_hook_active: false });
    assert.strictEqual(res.status, 0, `foreign-only sentinel must not block:\n${res.stderr}`);
    assert.ok(!res.stderr.includes('Recommended: dispatch'),
      `recommended a dispatch for another session's file:\n${res.stderr}`);
    assert.ok(res.stderr.includes('pending from another session'),
      `foreign entries should still be surfaced as INFO:\n${res.stderr}`);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('the owning session still gets the full pending gate for its own entries', () => {
  const repo = mkTempRepo();
  try {
    withProvenance(repo, '.pending-doc-review', [
      { path: 'docs/TheirGuide.md', prov: `session:${OTHER}` },
      { path: 'docs/MyGuide.md', prov: `session:${OWN}` },
    ]);
    const res = runHook(repo, { session_id: OWN, stop_hook_active: false });
    assert.strictEqual(res.status, 2, `own entry must still block:\n${res.stderr}`);
    assert.ok(res.stderr.includes('docs/MyGuide.md'));
    assert.ok(!res.stderr.includes('    · docs/TheirGuide.md'),
      `another session's file leaked into the dispatch list:\n${res.stderr}`);
    assert.ok(res.stderr.includes('(+1 file(s) pending from another session'),
      `excluded count should be disclosed:\n${res.stderr}`);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('legacy slug-only provenance (no session field) is never treated as foreign', () => {
  const repo = mkTempRepo();
  try {
    withProvenance(repo, '.pending-doc-review', [
      { path: 'openspec/changes/some-change/design.md', prov: 'some-change' },
    ]);
    const res = runHook(repo, { session_id: OWN, stop_hook_active: false });
    assert.strictEqual(res.status, 2, `slug-attributed entry must still block:\n${res.stderr}`);
    assert.ok(res.stderr.includes('openspec/changes/some-change/design.md'));
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('OpenSpec edits are attributed by the session field, not the change slug', () => {
  const repo = mkTempRepo();
  try {
    // Field 3 carries the change slug for OpenSpec edits, so field 4 is the
    // only thing that can tell two sessions working the same change apart.
    writeFile(repo, '.pending-doc-review',
      '2026-07-07 12:00 openspec/changes/some-change/design.md\n'
      + '2026-07-07 12:00 openspec/changes/some-change/tasks.md\n');
    writeFile(repo, '.sentinel-provenance',
      `.pending-doc-review\topenspec/changes/some-change/design.md\tsome-change\tsession:${OTHER}\n`
      + `.pending-doc-review\topenspec/changes/some-change/tasks.md\tsome-change\tsession:${OWN}\n`);
    const res = runHook(repo, { session_id: OWN, stop_hook_active: false });
    assert.strictEqual(res.status, 2, `own OpenSpec entry must still block:\n${res.stderr}`);
    assert.ok(res.stderr.includes('    · openspec/changes/some-change/tasks.md'));
    assert.ok(!res.stderr.includes('    · openspec/changes/some-change/design.md'),
      `another session's OpenSpec file leaked into the dispatch list:\n${res.stderr}`);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('missing provenance sidecar fails open — every entry stays owned', () => {
  const repo = mkTempRepo();
  try {
    writeFile(repo, '.pending-doc-review', '2026-07-07 12:00 docs/Guide.md\n');
    const res = runHook(repo, { session_id: OWN, stop_hook_active: false });
    assert.strictEqual(res.status, 2, `absent sidecar must not silence the gate:\n${res.stderr}`);
    assert.ok(res.stderr.includes('docs/Guide.md'));
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('payload without session_id fails open — provenance filter is disabled', () => {
  const repo = mkTempRepo();
  try {
    withProvenance(repo, '.pending-doc-review', [
      { path: 'docs/TheirGuide.md', prov: `session:${OTHER}` },
    ]);
    const res = runHook(repo, { stop_hook_active: false });
    assert.strictEqual(res.status, 2, `unknown session must not silence the gate:\n${res.stderr}`);
    assert.ok(res.stderr.includes('docs/TheirGuide.md'));
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('empty sentinel plus a stale active marker stays silent instead of "0 file(s)"', () => {
  const repo = mkTempRepo();
  try {
    writeFile(repo, '.pending-doc-review', '');
    writeFile(repo, '.active-doc-review', 'doc-reviewer\n');
    const res = runHook(repo, { session_id: OWN, stop_hook_active: false });
    assert.strictEqual(res.status, 0, `empty sentinel must not block:\n${res.stderr}`);
    assert.ok(!res.stderr.includes('0 file(s) awaiting review'),
      `emitted a phantom in-flight warning:\n${res.stderr}`);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

run('stop-review-reminder-liveness');
