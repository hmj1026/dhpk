'use strict';

// Behavioral contract for scripts/release/release-verify.sh, the single
// pre-publish verification shared by the tag Release job (tag mode) and the
// release-PR rehearsal (dry-run mode). The script runs against a fixture
// checkout: stage commands are stubbed through PATH (`node`, `gh`) and a
// fixture `bin/dhpk`, so no environment override can skip a real stage.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'release', 'release-verify.sh');
const SOURCE = fs.readFileSync(SCRIPT, 'utf8');

const NODE_STUB = `#!/usr/bin/env bash
printf 'node %s\\n' "$*" >> "$CALL_LOG"
if [ "$1" = "-e" ]; then exec "$REAL_NODE" "$@"; fi
script="$(basename "$1")"; shift
arg() { while [ "$#" -gt 0 ]; do if [ "$1" = "$KEY" ]; then printf '%s' "$2"; return; fi; shift; done; }
case "$script" in
  release-artifact-manifest.js) KEY=--output; echo '{}' > "$(arg "$@")" ;;
  release-publication-bundle.js)
    KEY=--notes-file; notes="$(arg "$@")"
    KEY=--output; cp "$notes" "$(arg "$@")"
    KEY=--digest-output; echo '{}' > "$(arg "$@")" ;;
  verify-publication-bundle.js)
    [ "$FAIL_STANDALONE" = "1" ] && exit 1
    KEY=--bundle; bundle="$(arg "$@")"
    KEY=--notes-output; cp "$bundle" "$(arg "$@")" ;;
esac
exit 0
`;

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function makeFixture({ preflightOutcome = 'PASS', preflightExit = 0 } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-release-verify-'));
  const repo = path.join(tmp, 'repo');
  const stubs = path.join(tmp, 'stubs');
  fs.mkdirSync(path.join(repo, 'scripts', 'release'), { recursive: true });
  fs.mkdirSync(path.join(repo, '.claude-plugin'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'bin'), { recursive: true });
  fs.mkdirSync(stubs);
  fs.copyFileSync(SCRIPT, path.join(repo, 'scripts', 'release', 'release-verify.sh'));
  fs.copyFileSync(
    path.join(ROOT, 'scripts', 'release', 'extract-notes.sh'),
    path.join(repo, 'scripts', 'release', 'extract-notes.sh'),
  );
  fs.writeFileSync(path.join(repo, 'scripts', 'release', 'verify-publication-bundle.js'), '// verifier fixture\n');
  fs.writeFileSync(path.join(repo, '.claude-plugin', 'plugin.json'), '{"version":"1.2.3"}\n');
  fs.writeFileSync(path.join(repo, 'CHANGELOG.md'), '# Changelog\n\n## 1.2.3 — 2026-09-24 — fixture\n\n- fixture note\n');
  fs.writeFileSync(path.join(repo, 'bin', 'dhpk'), `#!/usr/bin/env bash
printf 'dhpk %s\\n' "$*" >> "$CALL_LOG"
if [ "$1" = "harness" ]; then echo '{"outcome":"${preflightOutcome}"}'; exit ${preflightExit}; fi
echo '{}'
`, { mode: 0o755 });
  fs.writeFileSync(path.join(stubs, 'node'), NODE_STUB, { mode: 0o755 });
  fs.writeFileSync(path.join(stubs, 'gh'), '#!/bin/sh\nprintf "gh %s\\n" "$*" >> "$CALL_LOG"\n', { mode: 0o755 });
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'add', '-A');
  git(repo, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '-m', 'release');
  git(repo, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  return { tmp, repo, stubs };
}

function runVerify(fixture, args, extraEnv = {}) {
  const log = path.join(fixture.tmp, 'calls.log');
  const output = path.join(fixture.tmp, 'github-output');
  fs.writeFileSync(log, '');
  fs.writeFileSync(output, '');
  const res = spawnSync('bash', [path.join(fixture.repo, 'scripts', 'release', 'release-verify.sh'), ...args], {
    cwd: fixture.repo,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${fixture.stubs}:${process.env.PATH}`,
      REAL_NODE: process.execPath,
      CALL_LOG: log,
      GITHUB_OUTPUT: output,
      GITHUB_RUN_ID: '4242',
      ...extraEnv,
    },
  });
  const stages = [...res.stdout.matchAll(/::group::release-verify \[[a-z-]+\] ([a-z-]+)/g)].map((m) => m[1]);
  return {
    res,
    stages,
    calls: fs.readFileSync(log, 'utf8'),
    outputs: Object.fromEntries(fs.readFileSync(output, 'utf8').trim().split('\n').filter(Boolean).map((line) => line.split(/=(.*)/s).slice(0, 2))),
  };
}

function withFixture(options, fn) {
  const fixture = makeFixture(options);
  try { return fn(fixture); } finally { fs.rmSync(fixture.tmp, { recursive: true, force: true }); }
}

test('dry-run verifies the publication bundle with a verifier copied outside the checkout', () => withFixture({}, (fixture) => {
  const out = path.join(fixture.tmp, 'out');
  const { res, calls, stages, outputs } = runVerify(fixture, ['--mode', 'dry-run', '--out-dir', out]);
  assert.strictEqual(res.status, 0, res.stderr + res.stdout);
  const verifyCall = calls.split('\n').find((line) => line.includes('verify-publication-bundle.js'));
  assert.ok(verifyCall, calls);
  assert.ok(!verifyCall.includes(fixture.repo), 'the standalone verifier must run from outside the checkout');
  assert.match(verifyCall, /--expected-tag v1\.2\.3 .*--expected-version 1\.2\.3/);
  assert.strictEqual(stages[stages.length - 1], 'standalone-verify');
  assert.ok(!stages.includes('provenance'), 'dry-run has no tag to prove');
  for (const name of ['dhpk-release-notes.txt', 'dhpk-release-artifact-manifest.json', 'dhpk-release-publication-bundle.json', 'dhpk-release-publication-notes-digest.json']) {
    assert.ok(fs.existsSync(path.join(out, name)), `missing ${name}`);
  }
  assert.strictEqual(outputs.target_commit, git(fixture.repo, 'rev-parse', 'HEAD'));
  assert.strictEqual(outputs.target_tree, git(fixture.repo, 'rev-parse', 'HEAD^{tree}'));
  assert.match(outputs.notes_sha256, /^sha256:[0-9a-f]{64}$/);
  assert.match(outputs.verifier_sha256, /^sha256:[0-9a-f]{64}$/);
  assert.ok(!calls.includes('gh '), 'dry-run must never call gh');
}));

test('dry-run fails when the standalone publication verifier rejects the bundle', () => withFixture({}, (fixture) => {
  const { res, stages } = runVerify(fixture, ['--mode', 'dry-run', '--out-dir', path.join(fixture.tmp, 'out')], { FAIL_STANDALONE: '1' });
  assert.notStrictEqual(res.status, 0);
  assert.strictEqual(stages[stages.length - 1], 'standalone-verify');
  assert.match(res.stderr, /stage standalone-verify failed/);
}));

test('tag mode proves provenance first, writes run outputs, and skips the standalone verifier', () => withFixture({}, (fixture) => {
  git(fixture.repo, 'tag', 'v1.2.3');
  const { res, calls, stages, outputs } = runVerify(fixture, ['--mode', 'tag', '--tag', 'v1.2.3', '--out-dir', path.join(fixture.tmp, 'out')]);
  assert.strictEqual(res.status, 0, res.stderr + res.stdout);
  assert.strictEqual(stages[0], 'provenance');
  assert.ok(!calls.includes('verify-publication-bundle.js'), calls);
  assert.strictEqual(outputs.target_commit, git(fixture.repo, 'rev-list', '-n', '1', 'v1.2.3'));
  assert.ok(outputs.notes_sha256 && outputs.verifier_sha256 && outputs.target_tree, JSON.stringify(outputs));
  assert.ok(!calls.includes('gh '), 'verification must never call gh');
}));

test('the two modes run the same stages apart from tag provenance and the standalone verifier', () => withFixture({}, (fixture) => {
  git(fixture.repo, 'tag', 'v1.2.3');
  const tagRun = runVerify(fixture, ['--mode', 'tag', '--tag', 'v1.2.3', '--out-dir', path.join(fixture.tmp, 'tag')]);
  const dryRun = runVerify(fixture, ['--mode', 'dry-run', '--out-dir', path.join(fixture.tmp, 'dry')]);
  assert.strictEqual(tagRun.res.status, 0, tagRun.res.stderr);
  assert.strictEqual(dryRun.res.status, 0, dryRun.res.stderr);
  assert.deepStrictEqual(
    tagRun.stages.filter((name) => name !== 'provenance'),
    dryRun.stages.filter((name) => name !== 'standalone-verify'),
  );
  assert.deepStrictEqual(dryRun.stages, ['parity', 'preflight', 'packages', 'manifest', 'notes', 'bundle', 'verifier-digest', 'standalone-verify']);
}));

test('tag mode rejects a tag that is not vX.Y.Z before any stage runs', () => withFixture({}, (fixture) => {
  const { res, calls, stages } = runVerify(fixture, ['--mode', 'tag', '--tag', 'v1.2', '--out-dir', path.join(fixture.tmp, 'out')]);
  assert.strictEqual(res.status, 1);
  assert.match(res.stderr, /tag must match vX\.Y\.Z/);
  assert.deepStrictEqual(stages, []);
  assert.strictEqual(calls, '');
}));

test('tag mode rejects a tag commit outside origin/main before parity or packages', () => withFixture({}, (fixture) => {
  git(fixture.repo, 'checkout', '-q', '-b', 'side');
  fs.writeFileSync(path.join(fixture.repo, 'side.txt'), 'side\n');
  git(fixture.repo, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'add', '-A');
  git(fixture.repo, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '-m', 'side');
  git(fixture.repo, 'tag', 'v1.2.3');
  const { res, calls, stages } = runVerify(fixture, ['--mode', 'tag', '--tag', 'v1.2.3', '--out-dir', path.join(fixture.tmp, 'out')]);
  assert.notStrictEqual(res.status, 0);
  assert.match(res.stderr, /not contained in origin\/main/);
  assert.deepStrictEqual(stages, ['provenance']);
  assert.strictEqual(calls, '');
}));

test('a BLOCKED harness preflight fails verification', () => withFixture({ preflightOutcome: 'BLOCKED', preflightExit: 1 }, (fixture) => {
  const { res, stages } = runVerify(fixture, ['--mode', 'dry-run', '--out-dir', path.join(fixture.tmp, 'out')]);
  assert.notStrictEqual(res.status, 0);
  assert.strictEqual(stages[stages.length - 1], 'preflight');
}));

test('an UNAVAILABLE preflight on a standard runner stays non-blocking', () => withFixture({ preflightOutcome: 'UNAVAILABLE', preflightExit: 2 }, (fixture) => {
  const { res } = runVerify(fixture, ['--mode', 'dry-run', '--out-dir', path.join(fixture.tmp, 'out')]);
  assert.strictEqual(res.status, 0, res.stderr);
}));

test('release verification never tags or publishes', () => {
  const code = SOURCE.split('\n').filter((line) => !/^\s*#/.test(line)).join('\n');
  assert.doesNotMatch(code, /\bgit\s+tag\b/);
  assert.doesNotMatch(code, /\bgh\s+release\b/);
  assert.doesNotMatch(code, /\bgit\s+push\b/);
});

run('release-verify-cli');
