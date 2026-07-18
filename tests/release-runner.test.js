'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const RUNNER = path.join(ROOT, 'skills', 'release-creator', 'scripts', 'release-runner.sh');
const SKILL = fs.readFileSync(path.join(ROOT, 'skills', 'release-creator', 'SKILL.md'), 'utf8');

test('release skill documents prepare, human merge, then publish', () => {
  const flat = SKILL.replace(/\s+/g, ' ');
  const prepare = flat.indexOf('"prepare" "<version>"');
  const publish = flat.indexOf('"publish" "<version>"');
  assert.ok(prepare >= 0);
  assert.ok(publish > prepare);
  assert.ok(flat.slice(prepare, publish).includes('human merge'));
});

test('prepare creates the release PR and stops before tagging', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-release-runner-'));
  try {
    const bin = path.join(tmp, 'bin');
    const log = path.join(tmp, 'calls.log');
    fs.mkdirSync(bin);
    for (const name of ['git', 'gh']) {
      const body = name === 'gh'
        ? '#!/bin/sh\nprintf "gh %s\\n" "$*" >> "$CALL_LOG"\n[ "$1 $2" = "run list" ] && printf "run-123\\n"\nexit 0\n'
        : '#!/bin/sh\nprintf "git %s\\n" "$*" >> "$CALL_LOG"\n';
      fs.writeFileSync(path.join(bin, name), body, { mode: 0o755 });
    }
    const res = spawnSync('bash', [RUNNER, 'prepare', '1.2.3', 'develop', 'main', 'v', 'release.yml'], {
      cwd: tmp,
      encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, CALL_LOG: log },
    });
    assert.strictEqual(res.status, 0, res.stderr);
    const calls = fs.readFileSync(log, 'utf8');
    const ordered = [
      'git checkout develop', 'git pull', 'git add -A',
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
    assert.ok(calls.includes('gh pr view develop --json mergedAt --jq .mergedAt'), calls);
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
    fs.writeFileSync(path.join(bin, 'gh'), `#!/bin/sh
printf "gh %s\\n" "$*" >> "$CALL_LOG"
if [ "$1 $2" = "pr view" ]; then printf "2026-07-18T12:00:00Z\\n"; fi
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
    assert.ok(calls.includes('git tag v1.2.3'), calls);
    const query = 'gh run list --workflow release.yml --branch v1.2.3 --event push --limit 1 --json databaseId --jq .[0].databaseId // empty';
    assert.strictEqual(calls.split(query).length - 1, 2, calls);
    assert.ok(calls.includes('gh run watch run-123'), calls);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('publish fails when the tag workflow never appears', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-release-runner-'));
  try {
    const bin = path.join(tmp, 'bin');
    const log = path.join(tmp, 'calls.log');
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'git'), '#!/bin/sh\nprintf "git %s\\n" "$*" >> "$CALL_LOG"\n', { mode: 0o755 });
    fs.writeFileSync(path.join(bin, 'gh'), '#!/bin/sh\nprintf "gh %s\\n" "$*" >> "$CALL_LOG"\n[ "$1 $2" = "pr view" ] && printf "2026-07-18T12:00:00Z\\n"\nexit 0\n', { mode: 0o755 });
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

run('release-runner');
