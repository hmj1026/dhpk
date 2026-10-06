'use strict';

// Task 4 RED coverage.  Each test describes an observable defect contract and
// is intentionally run before the corresponding implementation change.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');

function tempDir(prefix) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

function writeFile(file, content, mode) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  if (mode) fs.chmodSync(file, mode);
}

function initRepo() {
  const repo = tempDir('dhpk-task4-repo-');
  assert.strictEqual(spawnSync('git', ['init', '-q'], { cwd: repo }).status, 0);
  spawnSync('git', ['config', 'user.email', 'task4@example.test'], { cwd: repo });
  spawnSync('git', ['config', 'user.name', 'Task 4'], { cwd: repo });
  return repo;
}

test('next-step analyzer uses the exported resolveFeature API and emits JSON', () => {
  const repo = initRepo();
  try {
    const script = path.join(ROOT, 'skills', 'flow-guide', 'scripts', 'analyze.js');
    const res = spawnSync('node', [script, '--json'], {
      cwd: repo,
      encoding: 'utf8',
      env: { ...process.env, PLUGIN_ROOT: ROOT },
    });
    assert.strictEqual(res.status, 0, res.stderr);
    const output = JSON.parse(res.stdout);
    assert.strictEqual(output.version, 2);
    assert.ok(output.feature_context);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('next-step analyzer does not require retired skill quality lint', () => {
  const repo = initRepo();
  try {
    writeFile(path.join(repo, 'skills', 'sample', 'SKILL.md'), '# sample\n');
    assert.strictEqual(spawnSync('git', ['add', '.'], { cwd: repo }).status, 0);
    assert.strictEqual(spawnSync('git', ['commit', '-qm', 'fixture'], { cwd: repo }).status, 0);
    writeFile(path.join(repo, 'skills', 'sample', 'SKILL.md'), '# changed sample\n');
    const script = path.join(ROOT, 'skills', 'flow-guide', 'scripts', 'analyze.js');
    const res = spawnSync('node', [script, '--json'], {
      cwd: repo, encoding: 'utf8', env: { ...process.env, PLUGIN_ROOT: ROOT },
    });
    assert.strictEqual(res.status, 0, res.stderr);
    const output = JSON.parse(res.stdout);
    assert.ok(!output.findings.some((finding) => finding.id === 'skill-lint-needed'));
    assert.ok(!output.next_actions.some((action) => JSON.stringify(action).includes('skill-scope')));
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('release runner propagates a failed workflow through gh run watch --exit-status', () => {
  const repo = initRepo();
  const bin = path.join(repo, 'bin');
  const log = path.join(repo, 'calls.log');
  fs.mkdirSync(bin);
  fs.mkdirSync(path.join(repo, 'scripts', 'release'), { recursive: true });
  writeFile(path.join(repo, 'scripts', 'release', 'package-gate.js'), '// package gate fixture\n');
  writeFile(path.join(bin, 'git'), '#!/bin/sh\nprintf "git %s\\n" "$*" >> "$CALL_LOG"\nif [ "$1" = "rev-parse" ] && [ "$2" = "HEAD" ]; then printf "merge-commit-sha\\n"; fi\nif [ "$1" = "rev-list" ]; then printf "merge-commit-sha parent-a parent-b\\n"; fi\n', 0o755);
  writeFile(path.join(bin, 'node'), '#!/bin/sh\nprintf "node %s\\n" "$*" >> "$CALL_LOG"\nexit 0\n', 0o755);
  writeFile(path.join(bin, 'gh'), '#!/bin/sh\nprintf "gh %s\\n" "$*" >> "$CALL_LOG"\n\nif [ "$1 $2" = "pr list" ]; then printf "merge-commit-sha\\n"; fi\nif [ "$1 $2" = "run list" ]; then printf "run-123\\n"; fi\nif [ "$1 $2" = "run watch" ]; then exit 1; fi\n', 0o755);
  try {
    const script = path.join(ROOT, 'skills', 'release-creator', 'scripts', 'release-runner.sh');
    const res = spawnSync('bash', [script, 'publish', '1.2.3', 'develop', 'main', 'v', 'release.yml'], {
      cwd: repo,
      encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, CALL_LOG: log, DHPK_RELEASE_POLL_INTERVAL: '0' },
    });
    assert.notStrictEqual(res.status, 0);
    const calls = fs.readFileSync(log, 'utf8');
    assert.ok(calls.includes('gh run watch run-123 --exit-status'), calls);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('risk assessment reports inconclusive for an unsupported source language', () => {
  const repo = initRepo();
  try {
    writeFile(path.join(repo, 'README.md'), '# baseline\n');
    spawnSync('git', ['add', 'README.md'], { cwd: repo });
    assert.strictEqual(spawnSync('git', ['commit', '-qm', 'baseline'], { cwd: repo }).status, 0);
    writeFile(path.join(repo, 'src', 'lib.rs'), 'pub fn answer() -> i32 { 42 }\n');
    const script = path.join(ROOT, 'skills', 'change-verdict', 'scripts', 'risk-analyze.js');
    const res = spawnSync('node', [script, '--json'], {
      cwd: repo,
      encoding: 'utf8',
      env: { ...process.env, PLUGIN_ROOT: ROOT },
    });
    assert.notStrictEqual(res.status, 0);
    const output = JSON.parse(res.stdout);
    assert.strictEqual(output.inconclusive, true);
    assert.match(output.reason, /unsupported|adapter|classification/i);
    assert.notStrictEqual(output.risk_level, 'Low');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('risk assessment classifies omitted source extensions by path, not by Low fallback', () => {
  const script = path.join(ROOT, 'skills', 'change-verdict', 'scripts', 'risk-analyze.js');
  const runFixture = (file, content) => {
    const repo = initRepo();
    try {
      writeFile(path.join(repo, 'README.md'), '# baseline\n');
      spawnSync('git', ['add', 'README.md'], { cwd: repo });
      assert.strictEqual(spawnSync('git', ['commit', '-qm', 'baseline'], { cwd: repo }).status, 0);
      writeFile(path.join(repo, file), content);
      return spawnSync('node', [script, '--json'], {
        cwd: repo,
        encoding: 'utf8',
        env: { ...process.env, PLUGIN_ROOT: ROOT },
      });
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  };

  for (const [file, content] of [
    ['src/Answer.fs', 'module Answer\nlet answer = 42\n'],
    ['src/Answer.unknown', 'answer = 42\n'],
  ]) {
    const res = runFixture(file, content);
    assert.notStrictEqual(res.status, 0, `${file} should require review`);
    const output = JSON.parse(res.stdout);
    assert.strictEqual(output.inconclusive, true, file);
    assert.match(output.reason, /unsupported|adapter|classification/i, file);
  }

  for (const [file, content] of [
    ['docs/guide.unknown', 'documentation\n'],
    ['assets/data.unknown', 'asset payload\n'],
  ]) {
    const res = runFixture(file, content);
    assert.strictEqual(res.status, 0, `${file}: ${res.stderr}`);
    const output = JSON.parse(res.stdout);
    assert.strictEqual(output.inconclusive, undefined, file);
    assert.strictEqual(output.risk_level, 'Low', file);
  }
});

test('codex CLI review passes hostile values as literal arguments without eval', () => {
  const repo = initRepo();
  const bin = path.join(repo, 'bin');
  const argsFile = path.join(repo, 'codex-args.log');
  const sideEffect = path.join(repo, 'side-effect');
  fs.mkdirSync(bin);
  try {
    writeFile(path.join(repo, 'tracked.txt'), 'before\n');
    spawnSync('git', ['add', 'tracked.txt'], { cwd: repo });
    assert.strictEqual(spawnSync('git', ['commit', '-qm', 'baseline'], { cwd: repo }).status, 0);
    writeFile(path.join(repo, 'tracked.txt'), 'after\n');
    writeFile(path.join(bin, 'codex'), '#!/bin/sh\nprintf "<%s>\\n" "$@" > "$CODEX_ARGS"\ncat >/dev/null\n', 0o755);
    const title = `$(touch ${sideEffect})`;
    const prompt = `$(touch ${sideEffect})`;
    const script = path.join(ROOT, 'skills', 'change-verdict', 'scripts', 'review-cli.sh');
    const res = spawnSync('bash', [script, '--backend', 'cli', '--title', title, '--prompt', prompt], {
      cwd: repo,
      encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, CODEX_ARGS: argsFile },
    });
    assert.strictEqual(res.status, 0, res.stderr);
    assert.ok(!fs.existsSync(sideEffect), 'hostile command substitution executed');
    const args = fs.readFileSync(argsFile, 'utf8');
    assert.ok(args.includes(`<${title}>`), args);
    assert.ok(args.includes('<--title>'), args);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('pr hygiene does not infer squash from the current HEAD message', () => {
  const repo = initRepo();
  try {
    writeFile(path.join(repo, 'README.md'), '# branch\n');
    spawnSync('git', ['add', 'README.md'], { cwd: repo });
    assert.strictEqual(spawnSync('git', ['commit', '-qm', 'Squash merge of #42'], { cwd: repo }).status, 0);
    const script = path.join(ROOT, 'skills', 'change-verdict', 'scripts', 'check-unrelated-changes.sh');
    const res = spawnSync('bash', [script, '42'], {
      cwd: repo,
      encoding: 'utf8',
      env: { ...process.env, PATH: '/usr/bin:/bin' },
    });
    assert.strictEqual(res.status, 0, res.stderr);
    assert.doesNotMatch(res.stdout, /^\[skip\] not a squash merge/m);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

// Consolidated source suite: task4-consolidation.
{

  const fs = require('node:fs');
  const path = require('node:path');
  const { test, assert } = require('./_lib/tinytest');

  const ROOT = path.join(__dirname, '..');
  const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

  test('change verdict shell permissions are scoped to read-only helpers', () => {
    const skill = read('skills/change-verdict/SKILL.md');
    for (const broadGrant of ['Bash(git:*)', 'Bash(node:*)', 'Bash(gh:*)', 'Bash(bash:*)']) {
      assert.doesNotMatch(skill, new RegExp(broadGrant.replace(/[()*]/g, '\\$&')), broadGrant);
    }
    assert.match(skill, /Bash\(git diff:\*\)/);
    assert.match(skill, /Bash\(node skills\/change-verdict\/scripts\/risk-analyze\.js:\*\)/);
    assert.match(skill, /Bash\(bash skills\/change-verdict\/scripts\/check-unrelated-changes\.sh:\*\)/);
  });

}


run('task4-defects');
