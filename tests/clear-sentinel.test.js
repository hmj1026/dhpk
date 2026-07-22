'use strict';

// Dedicated coverage for scripts/hooks/clear-sentinel.sh — parametric
// sentinel cleaner. tests/subagent-stop-verify-autoclear.test.js exercises it
// indirectly (via subagent-stop-verify.sh); this file calls it directly with
// a scratch git repo + sessions dir, covering: normal clear, idempotency on
// an already-missing sentinel, --all, unknown-name rejection, and the
// fail-loud empty-name front door.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const HOOK = path.join(ROOT, 'scripts', 'hooks', 'clear-sentinel.sh');

function mkRepo() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'clear-sentinel-')));
  spawnSync('git', ['init', '-q', dir]);
  spawnSync('git', ['-C', dir, 'symbolic-ref', 'HEAD', 'refs/heads/main']);
  spawnSync('git', ['-C', dir, '-c', 'user.email=t@t.test', '-c', 'user.name=test', 'commit', '-q', '--allow-empty', '-m', 'init']);
  return dir;
}

function sessDir(repo) {
  return path.join(repo, '.claude', 'artifacts', 'sessions');
}

function mkSentinel(repo, name, body = 'stub') {
  fs.mkdirSync(sessDir(repo), { recursive: true });
  fs.writeFileSync(path.join(sessDir(repo), name), body);
}

function runHook(repo, args) {
  return spawnSync('bash', [HOOK, ...args], {
    cwd: repo,
    encoding: 'utf8',
    timeout: 10000,
    env: { ...process.env, CLAUDE_PROJECT_DIR: repo },
  });
}

test('clears an existing sentinel and reports success', () => {
  const repo = mkRepo();
  try {
    mkSentinel(repo, '.pending-review');
    const res = runHook(repo, ['.pending-review', 'code-reviewer']);
    assert.strictEqual(res.status, 0, res.stderr);
    assert.ok(res.stdout.includes('sentinel cleared (.pending-review)'));
    assert.ok(!fs.existsSync(path.join(sessDir(repo), '.pending-review')));
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('idempotent on an already-missing sentinel (no error, distinct message)', () => {
  const repo = mkRepo();
  try {
    const res = runHook(repo, ['.pending-review', 'code-reviewer']);
    assert.strictEqual(res.status, 0, res.stderr);
    assert.ok(res.stdout.includes('sentinel already clean (.pending-review)'));
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('--all clears every present sentinel and reports each', () => {
  const repo = mkRepo();
  try {
    mkSentinel(repo, '.pending-review');
    mkSentinel(repo, '.pending-db-review');
    const res = runHook(repo, ['--all', 'batch']);
    assert.strictEqual(res.status, 0, res.stderr);
    assert.ok(res.stdout.includes('sentinel cleared (.pending-review)'));
    assert.ok(res.stdout.includes('sentinel cleared (.pending-db-review)'));
    assert.ok(!fs.existsSync(path.join(sessDir(repo), '.pending-review')));
    assert.ok(!fs.existsSync(path.join(sessDir(repo), '.pending-db-review')));
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('--all with nothing to clear reports "no sentinels to clear"', () => {
  const repo = mkRepo();
  try {
    const res = runHook(repo, ['--all']);
    assert.strictEqual(res.status, 0, res.stderr);
    assert.ok(res.stdout.includes('no sentinels to clear'));
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('unknown sentinel name is rejected with exit 2', () => {
  const repo = mkRepo();
  try {
    const res = runHook(repo, ['.pending-bogus', 'x']);
    assert.strictEqual(res.status, 2);
    assert.ok(res.stderr.includes("unknown sentinel name '.pending-bogus'"));
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('empty sentinel name fails loud with exit 2 (stale/partial payload front door)', () => {
  const repo = mkRepo();
  try {
    const res = runHook(repo, []);
    assert.strictEqual(res.status, 2);
    assert.ok(res.stderr.includes('no sentinel name provided'));
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

// --- escalation-counter reset (the "ignored N times" backoff row) ---

const BACKOFF = '.review-reminder-backoff';

function writeBackoff(repo, rows) {
  fs.mkdirSync(sessDir(repo), { recursive: true });
  fs.writeFileSync(path.join(sessDir(repo), BACKOFF),
    rows.map((r) => `${r.name}\t${r.session}\t${r.fingerprint}\t1783440000\t${r.count}\n`).join(''));
}

function readBackoff(repo) {
  const p = path.join(sessDir(repo), BACKOFF);
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => l.split('\t'));
}

test('clearing a sentinel drops its escalation rows', () => {
  const repo = mkRepo();
  try {
    mkSentinel(repo, '.pending-review');
    writeBackoff(repo, [
      { name: '.pending-review', session: 's1', fingerprint: 'abc', count: 3 },
      { name: '.pending-doc-review', session: 's1', fingerprint: 'def', count: 2 },
    ]);
    const res = runHook(repo, ['.pending-review', 'code-reviewer']);
    assert.strictEqual(res.status, 0, res.stderr);
    const rows = readBackoff(repo);
    assert.strictEqual(rows.length, 1, `only the cleared slot's rows should go: ${JSON.stringify(rows)}`);
    assert.strictEqual(rows[0][0], '.pending-doc-review',
      'an unrelated slot must keep its counter');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('rows from every session are dropped, not just one', () => {
  const repo = mkRepo();
  try {
    mkSentinel(repo, '.pending-review');
    writeBackoff(repo, [
      { name: '.pending-review', session: 's1', fingerprint: 'abc', count: 3 },
      { name: '.pending-review', session: 's2', fingerprint: 'abc', count: 4 },
    ]);
    runHook(repo, ['.pending-review', 'code-reviewer']);
    assert.strictEqual(readBackoff(repo).length, 0,
      'a cleared sentinel leaves no session holding a live fingerprint');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('the reset also fires when the sentinel was already clean (idempotent)', () => {
  const repo = mkRepo();
  try {
    writeBackoff(repo, [{ name: '.pending-review', session: 's1', fingerprint: 'abc', count: 3 }]);
    const res = runHook(repo, ['.pending-review', 'code-reviewer']);
    assert.strictEqual(res.status, 0, res.stderr);
    assert.ok(res.stdout.includes('already clean'));
    assert.strictEqual(readBackoff(repo).length, 0,
      'a stale counter must not survive a no-op clear');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('--all drops the escalation rows of every slot it clears', () => {
  const repo = mkRepo();
  try {
    mkSentinel(repo, '.pending-review');
    mkSentinel(repo, '.pending-doc-review');
    writeBackoff(repo, [
      { name: '.pending-review', session: 's1', fingerprint: 'abc', count: 3 },
      { name: '.pending-doc-review', session: 's1', fingerprint: 'def', count: 2 },
    ]);
    runHook(repo, ['--all', 'orchestrator']);
    assert.strictEqual(readBackoff(repo).length, 0);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('a missing backoff file is not an error', () => {
  const repo = mkRepo();
  try {
    mkSentinel(repo, '.pending-review');
    const res = runHook(repo, ['.pending-review', 'code-reviewer']);
    assert.strictEqual(res.status, 0, res.stderr);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

// --- short-form sentinel name normalisation (issue #53) ---
//
// Agents keep passing the short form ("security-review") instead of the full
// basename ("pending-security-review" prefixed with ".pending-"). The fix
// normalises X -> .pending-X when that prefixed form is a known sentinel,
// and must rewrite NAME itself so every downstream consumer (sentinel path,
// stdout message, learning-db signature, dhpk_reset_review_backoff) sees the
// canonical name — not just pass the known-name check on a derived value.

test('short form "security-review" normalises to canonical .pending-security-review and clears it', () => {
  const repo = mkRepo();
  try {
    mkSentinel(repo, '.pending-security-review');
    const res = runHook(repo, ['security-review', 'security-reviewer']);
    assert.strictEqual(res.status, 0, res.stderr);
    assert.ok(!fs.existsSync(path.join(sessDir(repo), '.pending-security-review')));
    assert.ok(res.stdout.includes('sentinel cleared (.pending-security-review)'),
      `stdout must report the CANONICAL name, not the short form typed on the CLI:\n${res.stdout}`);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('short form "security-review" resets the backoff row seeded under the canonical key', () => {
  const repo = mkRepo();
  try {
    mkSentinel(repo, '.pending-security-review');
    writeBackoff(repo, [
      { name: '.pending-security-review', session: 's1', fingerprint: 'abc', count: 3 },
    ]);
    const res = runHook(repo, ['security-review', 'security-reviewer']);
    assert.strictEqual(res.status, 0, res.stderr);
    assert.strictEqual(readBackoff(repo).length, 0,
      'the canonically-keyed row must be dropped even though the CLI arg was the short form ' +
      '(proves the canonical name reached dhpk_reset_review_backoff, not just the path lookup)');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

// Regression guard (must already pass): normalisation must not loosen the
// fail-loud contract for a genuinely unknown name.
test('regression guard: a genuinely unknown name still exits 2 with the known-sentinels list', () => {
  const repo = mkRepo();
  try {
    const res = runHook(repo, ['banana', 'x']);
    assert.strictEqual(res.status, 2);
    assert.ok(res.stderr.includes("unknown sentinel name 'banana'"));
    assert.ok(res.stderr.includes('known sentinels:'));
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

run('clear-sentinel');
