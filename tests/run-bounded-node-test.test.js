'use strict';

// Coverage for scripts/ci/run-bounded-node-test.sh

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'ci', 'run-bounded-node-test.sh');

function runBounded(args, env = {}) {
  return spawnSync(SCRIPT, args, {
    encoding: 'utf8',
    env: { ...process.env, ...env },
    timeout: 10000,
  });
}

function fakeSystemdPath() {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-bounded-portable-'));
  fs.writeFileSync(path.join(bin, 'systemd-run'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  return bin;
}

test('portable fallback bounds a command and scrubs runner control variables', () => {
  const bin = fakeSystemdPath();
  const child = [
    "const names = ['DHPK_BOUNDED_REQUIRE_CGROUP', 'DHPK_BOUNDED_ALLOW_FALLBACK', 'DHPK_BOUNDED_EXPECT_MEMORY_MAX_BYTES', 'DHPK_BOUNDED_EXPECT_MEMORY_SWAP_MAX_BYTES', 'DHPK_BOUNDED_READY_FILE', 'DHPK_BOUNDED_HANDSHAKE_TIMEOUT_SECONDS'];",
    "if (names.some((name) => process.env[name])) process.exit(17);",
    "console.log('portable bounded');",
  ].join('\n');
  try {
    const res = runBounded(['node', '-e', child], {
      PATH: `${bin}:${process.env.PATH}`,
      DHPK_BOUNDED_REQUIRE_CGROUP: '0',
      DHPK_BOUNDED_ALLOW_FALLBACK: '1',
    });
    assert.strictEqual(res.status, 0, `${res.stdout}\n${res.stderr}`);
    assert.match(res.stderr, /portable fallback/i);
    assert.match(res.stdout, /portable bounded/);
  } finally {
    fs.rmSync(bin, { recursive: true, force: true });
  }
});

test('portable fallback terminates a command after its wall-time bound', () => {
  const bin = fakeSystemdPath();
  try {
    const res = runBounded(['node', '-e', 'setTimeout(() => {}, 5000);'], {
      PATH: `${bin}:${process.env.PATH}`,
      TIMEOUT_SECONDS: '1s',
      DHPK_BOUNDED_REQUIRE_CGROUP: '0',
      DHPK_BOUNDED_ALLOW_FALLBACK: '1',
    });
    assert.strictEqual(res.status, 124, `${res.stdout}\n${res.stderr}`);
    assert.match(res.stderr, /portable fallback/i);
    assert.match(res.stderr, /timed out/i);
  } finally {
    fs.rmSync(bin, { recursive: true, force: true });
  }
});

// The containment contract is Linux-only: Darwin has neither the verified
// systemd user cgroup boundary nor the GNU `timeout` prerequisite. Keep the
// runner itself fail-closed, but classify this test file explicitly so the
// aggregate macOS result does not present an incompatible host as a product
// failure. Linux registers the complete fail-closed suite below unchanged.
if (process.platform === 'darwin') {
  test('Linux-only bounded runner remains fail-closed on Darwin', () => {
    const result = runBounded(['node', '-e', 'process.exit(0);']);
    assert.notStrictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stderr, /systemd cgroup|timeout command/i);
  });
  console.log('SKIP_INCOMPATIBLE: run-bounded-node-test requires Linux systemd cgroup and timeout prerequisites');
} else {
test('command finishing successfully returns 0 and outputs stdout', () => {
  const res = runBounded(['node', '-e', 'console.log("hello bounded");']);
  assert.strictEqual(res.status, 0, res.stderr);
  assert.match(res.stdout, /hello bounded/);
});

test('command exceeding timeout is terminated with code 124', () => {
  const res = runBounded(['sleep', '5'], { TIMEOUT_SECONDS: '1s' });
  assert.strictEqual(res.status, 124, `expected 124, got ${res.status}`);
  assert.match(res.stderr, /timed out/i);
});

test('timeout cleanup kills a detached descendant before it can write after the wrapper exits', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-bounded-detached-'));
  const marker = path.join(root, 'detached-ran');
  const child = [
    "const { spawn } = require('node:child_process');",
    `spawn(process.execPath, ['-e', ${JSON.stringify(`setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'late'), 1500)`)}], { detached: true, stdio: 'ignore' });`,
    'setTimeout(() => {}, 5000);',
  ].join('\n');
  try {
    const res = runBounded(['node', '-e', child], { TIMEOUT_SECONDS: '1s' });
    assert.strictEqual(res.status, 124, `${res.stdout}\n${res.stderr}`);
    spawnSync('sleep', ['2']);
    assert.strictEqual(fs.existsSync(marker), false, 'detached descendants must be killed with the complete cgroup');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('cleanup failure fails closed instead of claiming a contained timeout', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-bounded-cleanup-failure-'));
  const marker = path.join(root, 'detached-ran');
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'systemctl'), [
    '#!/bin/sh',
    'if [ "$2" = show ]; then exec /usr/bin/systemctl "$@"; fi',
    'exit 1',
  ].join('\n'), { mode: 0o755 });
  const child = [
    "const { spawn } = require('node:child_process');",
    `spawn(process.execPath, ['-e', ${JSON.stringify(`setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'late'), 1500)`)}], { detached: true, stdio: 'ignore' });`,
    'setTimeout(() => {}, 5000);',
  ].join('\n');
  try {
    const res = runBounded(['node', '-e', child], {
      TIMEOUT_SECONDS: '1s',
      PATH: `${bin}:${process.env.PATH}`,
    });
    assert.strictEqual(res.status, 125, `${res.stdout}\n${res.stderr}`);
    spawnSync('sleep', ['2']);
    assert.strictEqual(fs.existsSync(marker), true, 'the fixture must prove cleanup was not silently reported as successful');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('scope state-query failure fails closed instead of treating an unknown unit as absent', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-bounded-query-failure-'));
  const bin = path.join(root, 'bin');
  const flag = path.join(root, 'killed');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'systemctl'), [
    '#!/bin/sh',
    `if [ "$2" = kill ]; then : > ${JSON.stringify(flag)}; exec /usr/bin/systemctl "$@"; fi`,
    `if [ "$2" = show ] && [ -e ${JSON.stringify(flag)} ]; then exit 1; fi`,
    'exec /usr/bin/systemctl "$@"',
  ].join('\n'), { mode: 0o755 });
  try {
    const child = [
      "const { spawn } = require('node:child_process');",
      `spawn(process.execPath, ['-e', ${JSON.stringify('setTimeout(() => {}, 5000)')}], { detached: true, stdio: 'ignore' });`,
      'setTimeout(() => {}, 5000);',
    ].join('\n');
    const res = runBounded(['node', '-e', child], {
      TIMEOUT_SECONDS: '1s',
      PATH: `${bin}:${process.env.PATH}`,
    });
    assert.ok(fs.existsSync(flag), 'cleanup probe must reach the forced state-query failure');
    assert.strictEqual(res.status, 125, `${res.stdout}\n${res.stderr}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('payload waits for verified scope ownership before executing', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-bounded-handshake-'));
  const bin = path.join(root, 'bin');
  const marker = path.join(root, 'payload-ran');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'systemctl'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  const child = [
    `setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran'), 1000);`,
    'setTimeout(() => {}, 5000);',
  ].join('\n');
  try {
    const res = runBounded(['node', '-e', child], {
      PATH: `${bin}:${process.env.PATH}`,
    });
    assert.strictEqual(res.status, 125, `${res.stdout}\n${res.stderr}`);
    assert.strictEqual(fs.existsSync(marker), false, 'payload must not run when scope ownership cannot be verified');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('failed scope creation never authorizes cleanup of a colliding unit name', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-bounded-scope-collision-'));
  const bin = path.join(root, 'bin');
  const log = path.join(root, 'systemctl.log');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'systemd-run'), [
    '#!/bin/sh',
    'last=""',
    'for arg in "$@"; do last="$arg"; done',
    'if [ "$last" = true ]; then exit 0; fi',
    'exit 9',
  ].join('\n'), { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'systemctl'), `#!/bin/sh\nprintf '%s\\n' "$*" >> ${JSON.stringify(log)}\nexit 0\n`, { mode: 0o755 });
  try {
    const res = runBounded(['node', '-e', 'process.exit(0);'], {
      PATH: `${bin}:${process.env.PATH}`,
    });
    assert.strictEqual(res.status, 9, `${res.stdout}\n${res.stderr}`);
    assert.ok(!fs.existsSync(log) || !/kill|stop/.test(fs.readFileSync(log, 'utf8')),
      'a failed create must not kill or stop a pre-existing unit with the same name');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('default batch timeout exceeds the per-file test timeout', () => {
  const script = fs.readFileSync(SCRIPT, 'utf8');
  assert.match(script, /TIMEOUT_SECONDS="\$\{TIMEOUT_SECONDS:-900s\}"/);
});

test('propagates non-zero exit codes from the wrapped command', () => {
  const res = runBounded(['node', '-e', 'process.exit(42);']);
  assert.strictEqual(res.status, 42, res.stderr);
});

test('exits with code 2 if no command is provided', () => {
  const res = runBounded([]);
  assert.strictEqual(res.status, 2, `expected 2, got ${res.status}`);
  assert.match(res.stderr, /Usage:/);
});

test('fallback is explicit and applies a portable heap and wall-time bound when user cgroups are unavailable', () => {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-bounded-no-systemd-'));
  try {
    fs.writeFileSync(path.join(bin, 'systemd-run'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    const res = runBounded(['node', '-e', 'console.log("fallback bounded");'], {
      PATH: `${bin}:${process.env.PATH}`,
      DHPK_BOUNDED_REQUIRE_CGROUP: '0',
      DHPK_BOUNDED_ALLOW_FALLBACK: '1',
    });
    assert.strictEqual(res.status, 0, res.stderr);
    assert.match(res.stderr, /portable fallback/i);
    assert.match(res.stdout, /fallback bounded/);
  } finally {
    fs.rmSync(bin, { recursive: true, force: true });
  }
});

test('required cgroup mode fails closed when the user scope cannot be created', () => {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-bounded-required-cgroup-'));
  try {
    fs.writeFileSync(path.join(bin, 'systemd-run'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    const res = runBounded(['node', '-e', 'process.exit(99);'], {
      PATH: `${bin}:/usr/bin:/bin`,
      DHPK_BOUNDED_REQUIRE_CGROUP: '1',
    });
    assert.strictEqual(res.status, 125, res.stderr);
    assert.match(res.stderr, /verified systemd cgroup is unavailable/i);
  } finally {
    fs.rmSync(bin, { recursive: true, force: true });
  }
});

test('unverified fallback is rejected unless explicitly opted in', () => {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-bounded-no-fallback-'));
  try {
    fs.writeFileSync(path.join(bin, 'systemd-run'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    const res = runBounded(['node', '-e', 'process.exit(0);'], {
      PATH: `${bin}:/usr/bin:/bin`,
      DHPK_BOUNDED_REQUIRE_CGROUP: '0',
      DHPK_BOUNDED_ALLOW_FALLBACK: '0',
    });
    assert.strictEqual(res.status, 125, res.stderr);
    assert.match(res.stderr, /verified systemd cgroup is unavailable/i);
  } finally {
    fs.rmSync(bin, { recursive: true, force: true });
  }
});

test('zero or malformed timeout values fail closed instead of disabling the guard', () => {
  const zero = runBounded(['node', '-e', 'process.exit(0);'], { TIMEOUT_SECONDS: '0' });
  assert.strictEqual(zero.status, 125, zero.stderr);
  assert.match(zero.stderr, /TIMEOUT_SECONDS|positive|invalid/i);
  const malformed = runBounded(['node', '-e', 'process.exit(0);'], { TIMEOUT_SECONDS: 'not-a-duration' });
  assert.strictEqual(malformed.status, 125, malformed.stderr);
  assert.match(malformed.stderr, /TIMEOUT_SECONDS|invalid/i);
});

test('portable fallback rejects an unbounded or malformed heap size', () => {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-bounded-invalid-size-'));
  try {
    fs.writeFileSync(path.join(bin, 'systemd-run'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    const res = runBounded(['node', '-e', 'process.exit(0);'], {
      PATH: `${bin}:/usr/bin:/bin`,
      DHPK_BOUNDED_PORTABLE_NODE_HEAP_MB: '0',
    });
    assert.strictEqual(res.status, 125, res.stderr);
    assert.match(res.stderr, /DHPK_BOUNDED_PORTABLE_NODE_HEAP_MB|positive|invalid/i);
  } finally {
    fs.rmSync(bin, { recursive: true, force: true });
  }
});
}

run('run-bounded-node-test');
