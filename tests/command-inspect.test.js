'use strict';

// Owner coverage for scripts/hooks/_lib/command-inspect.sh. The library is
// sourced and never executes the inspected command.

const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');

const LIB = path.join(__dirname, '..', 'scripts', 'hooks', '_lib', 'command-inspect.sh');

function inspect(command, cwd = '/session') {
  const res = spawnSync('bash', ['-c', `
    set -u
    # shellcheck disable=SC1090
    . "$DHPK_CI_LIB"
    dhpk_inspect_command "$DHPK_CI_CMD" "$DHPK_CI_CWD"
    i=0
    printf 'count=%s\\n' "$DHPK_GIT_COUNT"
    while [ "$i" -lt "$DHPK_GIT_COUNT" ]; do
      printf 'sub=%s\\nrepo=%s\\nstate=%s\\nno_verify=%s\\nexempt=%s\\n' \\
        "\${DHPK_GIT_SUB[$i]}" \\
        "\${DHPK_GIT_REPO[$i]}" \\
        "\${DHPK_GIT_REPO_STATE[$i]}" \\
        "\${DHPK_GIT_NO_VERIFY[$i]}" \\
        "\${DHPK_GIT_EXEMPT[$i]}"
      i=$((i + 1))
    done
  `], {
    encoding: 'utf8',
    env: {
      ...process.env,
      DHPK_CI_LIB: LIB,
      DHPK_CI_CMD: command,
      DHPK_CI_CWD: cwd,
    },
  });
  assert.strictEqual(res.status, 0, res.stderr || res.stdout);
  const fields = {};
  for (const line of res.stdout.split('\n')) {
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    fields[line.slice(0, eq)] = line.slice(eq + 1);
  }
  return fields;
}

test('a commit message of --dry-run is not an exemption', () => {
  const got = inspect('git commit -m "--dry-run"');
  assert.strictEqual(got.sub, 'commit');
  assert.strictEqual(got.exempt, '0', got.exempt);
  assert.strictEqual(got.no_verify, '0');
});

test('a commit message of --no-verify is not a bypass flag', () => {
  const got = inspect('git commit -m "--no-verify"');
  assert.strictEqual(got.sub, 'commit');
  assert.strictEqual(got.no_verify, '0');
  assert.strictEqual(got.exempt, '0');
});

test('joined message forms do not become flags', () => {
  const message = inspect('git commit --message=--dry-run');
  assert.strictEqual(message.exempt, '0');
  assert.strictEqual(message.no_verify, '0');
  const attached = inspect('git commit -m--no-verify');
  assert.strictEqual(attached.no_verify, '0');
  assert.strictEqual(attached.exempt, '0');
});

test('stacked -C resolves each relative path from the directory already chosen', () => {
  const got = inspect('git -C /repoA -C sub commit -m test');
  assert.strictEqual(got.sub, 'commit');
  assert.strictEqual(got.repo, '/repoA/sub');
  assert.strictEqual(got.state, 'literal');
  assert.strictEqual(got.exempt, '0');
});

test('a real --dry-run and a real --no-verify stay flags', () => {
  const dry = inspect('git commit --dry-run');
  assert.strictEqual(dry.exempt, '1');
  assert.strictEqual(dry.no_verify, '0');
  const bypass = inspect('git commit --no-verify');
  assert.strictEqual(bypass.no_verify, '1');
  assert.strictEqual(bypass.exempt, '0');
  const both = inspect('git commit -m "--dry-run" --no-verify');
  assert.strictEqual(both.exempt, '0');
  assert.strictEqual(both.no_verify, '1');
});

test('a dynamic -C stays unresolved and does not fall back to the session cwd', () => {
  const got = inspect('git -C "$UNRESOLVED_REPO" commit -m test');
  assert.strictEqual(got.state, 'unresolved');
  assert.strictEqual(got.repo, '');
  assert.strictEqual(got.exempt, '0');
});

run('command-inspect');
