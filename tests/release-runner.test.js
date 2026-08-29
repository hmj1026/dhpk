'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const RUNNER = path.join(ROOT, 'skills', 'dhpk-release-creator', 'scripts', 'release-runner.sh');
const SKILL = fs.readFileSync(path.join(ROOT, 'skills', 'dhpk-release-creator', 'SKILL.md'), 'utf8');
const RELEASE = fs.readFileSync(path.join(ROOT, 'RELEASE.md'), 'utf8');

test('release skill documents prepare, human merge, then publish', () => {
  const flat = SKILL.replace(/\s+/g, ' ');
  const prepare = flat.indexOf('"prepare" "<version>"');
  const publish = flat.indexOf('"publish" "<version>"');
  assert.ok(prepare >= 0);
  assert.ok(publish > prepare);
  assert.ok(flat.slice(prepare, publish).includes('human merge'));
});

test('release skill verifies develop/main SHAs after publish and does not instruct a force-push', () => {
  assert.match(SKILL, /origin\/develop/);
  assert.match(SKILL, /origin\/main/);
  assert.ok(!/git push --force(?!-with-lease)/.test(SKILL), 'skill must not be a force-push writer');
  assert.ok(!/force-push `?develop`?/i.test(SKILL) || /verify|SHA|compare/i.test(SKILL));
});

test('release flow requires a merge commit before creating the immutable tag', () => {
  assert.match(SKILL, /Create a merge commit/);
  assert.match(RELEASE, /Create a merge commit/);
  assert.match(RELEASE, /reruns the PACKAGE provenance gate/i);
});

test('prepare creates the release PR and stops before tagging', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-release-runner-'));
  try {
    const bin = path.join(tmp, 'bin');
    const log = path.join(tmp, 'calls.log');
    fs.mkdirSync(bin);
    fs.mkdirSync(path.join(tmp, '.claude-plugin'));
    fs.writeFileSync(path.join(tmp, '.claude-plugin', 'plugin.json'), '{}\n');
    fs.writeFileSync(path.join(tmp, 'CHANGELOG.md'), '# Changelog\n');
    for (const name of ['git', 'gh']) {
      const body = name === 'gh'
        ? '#!/bin/sh\nprintf "gh %s\\n" "$*" >> "$CALL_LOG"\n[ "$1 $2" = "run list" ] && printf "run-123\\n"\nexit 0\n'
        : '#!/bin/sh\nprintf "git %s\\n" "$*" >> "$CALL_LOG"\nif [ "$1" = "diff" ] && [ "$2" = "--cached" ] && [ "$3" = "--name-only" ]; then printf "%s\\n" "$5"; fi\n';
      fs.writeFileSync(path.join(bin, name), body, { mode: 0o755 });
    }
    const res = spawnSync('bash', [
      RUNNER, 'prepare', '1.2.3', 'develop', 'main', 'v', 'release.yml',
      '.claude-plugin/plugin.json', 'CHANGELOG.md',
    ], {
      cwd: tmp,
      encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, CALL_LOG: log },
    });
    assert.strictEqual(res.status, 0, res.stderr);
    const calls = fs.readFileSync(log, 'utf8');
    const ordered = [
      'git checkout develop', 'git pull', 'git add -- .claude-plugin/plugin.json',
      'git add -- CHANGELOG.md',
      'git commit -m chore(release): bump version to 1.2.3 and update changelog',
      'git push origin develop',
      'gh pr create --head develop --base main --title Release v1.2.3 --body Release version 1.2.3',
    ];
    let cursor = -1;
    for (const item of ordered) {
      const next = calls.indexOf(item, cursor + 1);
      assert.ok(next > cursor, `missing/out-of-order ${item}:\n${calls}`);
      cursor = next;
    }
    assert.ok(!calls.includes('git checkout main'), calls);
    assert.ok(!calls.includes('git tag '), calls);
    assert.ok(!calls.includes('gh run list'), calls);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('publish refuses to tag while the release PR is unmerged', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-release-runner-'));
  try {
    const bin = path.join(tmp, 'bin');
    const log = path.join(tmp, 'calls.log');
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'git'), '#!/bin/sh\nprintf "git %s\\n" "$*" >> "$CALL_LOG"\n', { mode: 0o755 });
    fs.writeFileSync(path.join(bin, 'gh'), '#!/bin/sh\nprintf "gh %s\\n" "$*" >> "$CALL_LOG"\n', { mode: 0o755 });
    const res = spawnSync('bash', [RUNNER, 'publish', '1.2.3', 'develop', 'main', 'v', 'release.yml'], {
      cwd: tmp,
      encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, CALL_LOG: log },
    });
    assert.notStrictEqual(res.status, 0);
    const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '';
    assert.ok(calls.includes('gh pr list --head develop --base main --state merged --limit 1 --json mergedAt --jq .[0].mergedAt // empty'), calls);
    assert.ok(!calls.includes('git tag '), calls);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('publish runs the post-merge package gate before creating an immutable tag', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-release-runner-'));
  try {
    const bin = path.join(tmp, 'bin');
    const log = path.join(tmp, 'calls.log');
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'git'), '#!/bin/sh\nprintf "git %s\\n" "$*" >> "$CALL_LOG"\n', { mode: 0o755 });
    fs.writeFileSync(path.join(bin, 'gh'), '#!/bin/sh\nprintf "gh %s\\n" "$*" >> "$CALL_LOG"\n[ "$1 $2" = "pr list" ] && printf "2026-07-18T12:00:00Z\\n"\nexit 0\n', { mode: 0o755 });
    fs.writeFileSync(path.join(bin, 'node'), '#!/bin/sh\nprintf "node %s\\n" "$*" >> "$CALL_LOG"\nprintf "package provenance gate failed\\n" >&2\nexit 1\n', { mode: 0o755 });
    const res = spawnSync('bash', [RUNNER, 'publish', '1.2.3', 'develop', 'main', 'v', 'release.yml'], {
      cwd: tmp,
      encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, CALL_LOG: log },
    });
    assert.notStrictEqual(res.status, 0);
    assert.match(`${res.stdout}\n${res.stderr}`, /package gate|provenance/i);
    const calls = fs.readFileSync(log, 'utf8');
    assert.ok(calls.includes('node scripts/release/package-gate.js --version 1.2.3'), calls);
    assert.ok(!calls.includes('git tag '), calls);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('publish waits for and watches only the workflow run for the new tag', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-release-runner-'));
  try {
    const bin = path.join(tmp, 'bin');
    const log = path.join(tmp, 'calls.log');
    const count = path.join(tmp, 'run-list-count');
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'git'), '#!/bin/sh\nprintf "git %s\\n" "$*" >> "$CALL_LOG"\n', { mode: 0o755 });
    fs.writeFileSync(path.join(bin, 'node'), '#!/bin/sh\nprintf "node %s\\n" "$*" >> "$CALL_LOG"\nexit 0\n', { mode: 0o755 });
    fs.writeFileSync(path.join(bin, 'gh'), `#!/bin/sh
printf "gh %s\\n" "$*" >> "$CALL_LOG"
if [ "$1 $2" = "pr list" ]; then printf "2026-07-18T12:00:00Z\\n"; fi
if [ "$1 $2" = "run list" ]; then
  n=0
  [ -f "$COUNT_FILE" ] && n=$(sed -n '1p' "$COUNT_FILE")
  n=$((n + 1))
  printf "%s\\n" "$n" > "$COUNT_FILE"
  [ "$n" -ge 2 ] && printf "run-123\\n"
fi
exit 0
`, { mode: 0o755 });
    const res = spawnSync('bash', [RUNNER, 'publish', '1.2.3', 'develop', 'main', 'v', 'release.yml'], {
      cwd: tmp,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        CALL_LOG: log,
        COUNT_FILE: count,
        DHPK_RELEASE_POLL_INTERVAL: '0',
        DHPK_RELEASE_POLL_ATTEMPTS: '3',
      },
    });
    assert.strictEqual(res.status, 0, res.stderr);
    const calls = fs.readFileSync(log, 'utf8');
    assert.ok(calls.includes('git checkout main'), calls);
    assert.ok(calls.includes('git tag -a v1.2.3 -m Release v1.2.3'), calls);
    const query = 'gh run list --workflow release.yml --branch v1.2.3 --event push --limit 1 --json databaseId --jq .[0].databaseId // empty';
    assert.strictEqual(calls.split(query).length - 1, 2, calls);
    assert.ok(calls.includes('gh run watch run-123'), calls);
    assert.ok(calls.includes('git fetch origin main develop') || calls.includes('git fetch origin develop main'), calls);
    assert.ok(calls.includes('git rev-parse origin/main'), calls);
    assert.ok(calls.includes('git rev-parse origin/develop'), calls);
    assert.ok(calls.includes('git checkout -B develop origin/develop'), calls);
    assert.strictEqual((calls.match(/git pull --ff-only/g) || []).length, 1, 'publish must not ff-pull rewritten develop after watch');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('publish fails when post-release trees match but develop and main SHAs differ', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-release-runner-'));
  try {
    const bin = path.join(tmp, 'bin');
    const log = path.join(tmp, 'calls.log');
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'git'), `#!/bin/sh
printf "git %s\\n" "$*" >> "$CALL_LOG"
if [ "$1" = "rev-parse" ] && [ "$2" = "origin/main" ]; then printf "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\n"; exit 0; fi
if [ "$1" = "rev-parse" ] && [ "$2" = "origin/develop" ]; then printf "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\\n"; exit 0; fi
if [ "$1" = "diff" ] && [ "$2" = "--quiet" ]; then exit 0; fi
exit 0
`, { mode: 0o755 });
    fs.writeFileSync(path.join(bin, 'node'), '#!/bin/sh\nprintf "node %s\\n" "$*" >> "$CALL_LOG"\nexit 0\n', { mode: 0o755 });
    fs.writeFileSync(path.join(bin, 'gh'), `#!/bin/sh
printf "gh %s\\n" "$*" >> "$CALL_LOG"
if [ "$1 $2" = "pr list" ]; then printf "2026-07-18T12:00:00Z\\n"; fi
if [ "$1 $2" = "run list" ]; then printf "run-123\\n"; fi
exit 0
`, { mode: 0o755 });
    const res = spawnSync('bash', [RUNNER, 'publish', '1.2.3', 'develop', 'main', 'v', 'release.yml'], {
      cwd: tmp,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        CALL_LOG: log,
        DHPK_RELEASE_POLL_INTERVAL: '0',
        DHPK_RELEASE_POLL_ATTEMPTS: '1',
      },
    });
    assert.notStrictEqual(res.status, 0, 'matching trees with unequal SHAs must fail the publish verifier');
    assert.match(`${res.stdout}\n${res.stderr}`, /trees match but SHAs differ|idle-align/i);
    assert.ok(!fs.readFileSync(log, 'utf8').includes('push --force'), fs.readFileSync(log, 'utf8'));
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('publish fails when the tag workflow never appears', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-release-runner-'));
  try {
    const bin = path.join(tmp, 'bin');
    const log = path.join(tmp, 'calls.log');
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'git'), '#!/bin/sh\nprintf "git %s\\n" "$*" >> "$CALL_LOG"\n', { mode: 0o755 });
    fs.writeFileSync(path.join(bin, 'node'), '#!/bin/sh\nprintf "node %s\\n" "$*" >> "$CALL_LOG"\nexit 0\n', { mode: 0o755 });
    fs.writeFileSync(path.join(bin, 'gh'), '#!/bin/sh\nprintf "gh %s\\n" "$*" >> "$CALL_LOG"\n[ "$1 $2" = "pr list" ] && printf "2026-07-18T12:00:00Z\\n"\nexit 0\n', { mode: 0o755 });
    const res = spawnSync('bash', [RUNNER, 'publish', '1.2.3', 'develop', 'main', 'v', 'release.yml'], {
      cwd: tmp,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        CALL_LOG: log,
        DHPK_RELEASE_POLL_INTERVAL: '0',
        DHPK_RELEASE_POLL_ATTEMPTS: '2',
      },
    });
    assert.notStrictEqual(res.status, 0);
    assert.ok(res.stderr.includes('workflow run not found'), res.stderr);
    assert.ok(!fs.readFileSync(log, 'utf8').includes('gh run watch'));
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('release runner rejects missing tokens before invoking commands', () => {
  const res = spawnSync('bash', [RUNNER, '1.2.3'], { encoding: 'utf8' });
  assert.strictEqual(res.status, 2);
  assert.ok(res.stderr.includes('usage:'));
});

test('release runner rejects versions that are not strict semver', () => {
  const res = spawnSync('bash', [RUNNER, 'publish', '1.2', 'develop', 'main', 'v', 'release.yml'], {
    encoding: 'utf8',
  });
  assert.strictEqual(res.status, 2);
  assert.ok(res.stderr.includes('version must match X.Y.Z'), res.stderr);
});

test('prepare stages only explicitly declared release files', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-release-runner-'));
  try {
    const bin = path.join(tmp, 'bin');
    const log = path.join(tmp, 'calls.log');
    fs.mkdirSync(bin);
    fs.mkdirSync(path.join(tmp, '.claude-plugin'));
    fs.writeFileSync(path.join(tmp, '.claude-plugin', 'plugin.json'), '{}\n');
    fs.writeFileSync(path.join(tmp, 'CHANGELOG.md'), '# Changelog\n');
    fs.writeFileSync(path.join(bin, 'git'), '#!/bin/sh\nprintf "git %s\\n" "$*" >> "$CALL_LOG"\nif [ "$1" = "diff" ] && [ "$2" = "--cached" ] && [ "$3" = "--name-only" ]; then printf "%s\\n" "$5"; fi\n', { mode: 0o755 });
    fs.writeFileSync(path.join(bin, 'gh'), '#!/bin/sh\nprintf "gh %s\\n" "$*" >> "$CALL_LOG"\n', { mode: 0o755 });
    const res = spawnSync('bash', [
      RUNNER, 'prepare', '1.2.4', 'develop', 'main', 'v', 'release.yml',
      '.claude-plugin/plugin.json', 'CHANGELOG.md',
    ], {
      cwd: tmp,
      encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, CALL_LOG: log },
    });
    assert.strictEqual(res.status, 0, res.stderr);
    const calls = fs.readFileSync(log, 'utf8');
    assert.ok(calls.includes('git add -- .claude-plugin/plugin.json'), calls);
    assert.ok(calls.includes('git add -- CHANGELOG.md'), calls);
    assert.ok(!calls.includes('git add -A'), calls);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('prepare refuses unrelated worktree changes before committing', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-release-runner-'));
  try {
    const bin = path.join(tmp, 'bin');
    const log = path.join(tmp, 'calls.log');
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'git'), `#!/bin/sh
printf "git %s\\n" "$*" >> "$CALL_LOG"
if [ "$1 $2" = "status --porcelain" ]; then printf " M unrelated.md\\n"; fi
`, { mode: 0o755 });
    fs.writeFileSync(path.join(bin, 'gh'), '#!/bin/sh\nprintf "gh %s\\n" "$*" >> "$CALL_LOG"\n', { mode: 0o755 });
    const res = spawnSync('bash', [
      RUNNER, 'prepare', '1.2.5', 'develop', 'main', 'v', 'release.yml',
      '.claude-plugin/plugin.json', 'CHANGELOG.md',
    ], {
      cwd: tmp,
      encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, CALL_LOG: log },
    });
    assert.notStrictEqual(res.status, 0);
    assert.ok(res.stderr.includes('unexpected worktree changes'), res.stderr);
    assert.ok(!fs.readFileSync(log, 'utf8').includes('git commit'), fs.readFileSync(log, 'utf8'));
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('prepare stages explicitly declared release files that were deleted by changelog promotion', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-release-runner-'));
  try {
    const bin = path.join(tmp, 'bin');
    const log = path.join(tmp, 'calls.log');
    fs.mkdirSync(bin);
    fs.mkdirSync(path.join(tmp, '.claude-plugin'), { recursive: true });
    fs.writeFileSync(path.join(tmp, '.claude-plugin', 'plugin.json'), '{}\n');
    fs.writeFileSync(path.join(tmp, 'CHANGELOG.md'), '# Changelog\n');
    fs.writeFileSync(path.join(bin, 'git'), `#!/bin/sh
printf "git %s\\n" "$*" >> "$CALL_LOG"
if [ "$1" = "status" ]; then
  printf " D changelog.d/promoted.md\\n"
fi
if [ "$1" = "diff" ] && [ "$2" = "--cached" ] && [ "$3" = "--quiet" ]; then
  exit 0
fi
if [ "$1" = "diff" ] && [ "$2" = "--cached" ] && [ "$3" = "--name-only" ]; then
  printf "%s\\n" "$5"
fi
`, { mode: 0o755 });
    fs.writeFileSync(path.join(bin, 'gh'), '#!/bin/sh\nprintf "gh %s\\n" "$*" >> "$CALL_LOG"\n', { mode: 0o755 });
    const res = spawnSync('bash', [
      RUNNER, 'prepare', '1.2.6', 'develop', 'main', 'v', 'release.yml',
      '.claude-plugin/plugin.json', 'CHANGELOG.md', 'changelog.d/promoted.md',
    ], {
      cwd: tmp,
      encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, CALL_LOG: log },
    });
    assert.strictEqual(res.status, 0, res.stderr);
    const calls = fs.readFileSync(log, 'utf8');
    assert.ok(calls.includes('git add -- .claude-plugin/plugin.json'), calls);
    assert.ok(calls.includes('git add -- CHANGELOG.md'), calls);
    assert.ok(calls.includes('git add -u -- changelog.d/promoted.md'), calls);
    assert.ok(calls.includes('git commit -m chore(release): bump version to 1.2.6 and update changelog'), calls);
    assert.ok(calls.includes('gh pr create --head develop --base main --title Release v1.2.6 --body Release version 1.2.6'), calls);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('prepare commits an already-staged changelog deletion in a real git repository', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-release-runner-real-git-'));
  const repo = path.join(tmp, 'repo');
  const remote = path.join(tmp, 'remote.git');
  const bin = path.join(tmp, 'bin');
  const log = path.join(tmp, 'calls.log');
  try {
    fs.mkdirSync(repo, { recursive: true });
    fs.mkdirSync(bin);
    execFileSync('git', ['init', '--bare', remote], { encoding: 'utf8' });
    execFileSync('git', ['init', '-b', 'develop', repo], { encoding: 'utf8' });
    const git = (args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
    git(['config', 'user.name', 'Release Runner Test']);
    git(['config', 'user.email', 'release-runner@example.invalid']);
    fs.mkdirSync(path.join(repo, '.claude-plugin'), { recursive: true });
    fs.mkdirSync(path.join(repo, 'changelog.d'), { recursive: true });
    fs.writeFileSync(path.join(repo, '.claude-plugin', 'plugin.json'), '{"version":"1.2.6"}\n');
    fs.writeFileSync(path.join(repo, 'CHANGELOG.md'), '# Changelog\n');
    fs.writeFileSync(path.join(repo, 'changelog.d', 'promoted.md'), 'promoted\n');
    git(['add', '--', '.claude-plugin/plugin.json', 'CHANGELOG.md', 'changelog.d/promoted.md']);
    git(['commit', '-m', 'seed release runner integration repository']);
    git(['remote', 'add', 'origin', remote]);
    git(['push', '--set-upstream', 'origin', 'develop']);

    fs.writeFileSync(path.join(repo, '.claude-plugin', 'plugin.json'), '{"version":"1.2.7"}\n');
    fs.writeFileSync(path.join(repo, 'CHANGELOG.md'), '# Changelog\n\n## 1.2.7\n');
    fs.rmSync(path.join(repo, 'changelog.d', 'promoted.md'));
    git(['add', '-u', '--', 'changelog.d/promoted.md']);
    fs.writeFileSync(path.join(bin, 'gh'), '#!/bin/sh\nprintf "gh %s\\n" "$*" >> "$CALL_LOG"\n', { mode: 0o755 });

    const res = spawnSync('bash', [
      RUNNER, 'prepare', '1.2.7', 'develop', 'main', 'v', 'release.yml',
      '.claude-plugin/plugin.json', 'CHANGELOG.md', 'changelog.d/promoted.md',
    ], {
      cwd: repo,
      encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, CALL_LOG: log },
    });
    assert.strictEqual(res.status, 0, `${res.stdout}\n${res.stderr}`);
    const committed = git(['show', '--format=', '--name-status', 'HEAD']);
    assert.ok(committed.includes('M\t.claude-plugin/plugin.json'), committed);
    assert.ok(committed.includes('M\tCHANGELOG.md'), committed);
    assert.ok(committed.includes('D\tchangelog.d/promoted.md'), committed);
    assert.strictEqual(git(['status', '--porcelain']), '');
    assert.ok(fs.readFileSync(log, 'utf8').includes('gh pr create --head develop --base main --title Release v1.2.7 --body Release version 1.2.7'));
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

run('release-runner');
