'use strict';

// Contract for the on-demand host packages (ADR 0040): the Agent, Cursor and
// AGY packages are built by `bin/dhpk distribution build <surface>`, archived,
// attached to the GitHub Release, and never committed.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const {
  ON_DEMAND_SURFACES,
  ON_DEMAND_LOCK_STALE_GRACE_MS,
  isOnDemandSurface,
  onDemandPackageName,
  onDemandRelativeDir,
  onDemandArchiveName,
  archiveOnDemandPackage,
  withOnDemandSurfaceLock,
  withOnDemandLocks,
} = require('../scripts/lib/on-demand-packages');
const { parseRequest, SURFACES, execute } = require('../scripts/lib/dhpk-distribution');

const ROOT = path.join(__dirname, '..');

function tracked(prefix) {
  const result = spawnSync('git', ['ls-files', '--', prefix], { cwd: ROOT, encoding: 'utf8' });
  return result.stdout.split('\n').filter(Boolean);
}

test('the on-demand surfaces are exactly the Agent, Cursor and AGY packages', () => {
  assert.deepStrictEqual([...ON_DEMAND_SURFACES].sort(), ['agent-plugin', 'agy-plugin', 'cursor-plugin']);
  assert.strictEqual(isOnDemandSurface('codex-native'), false);
  assert.strictEqual(onDemandPackageName('cursor-plugin'), 'dhpk-cursor');
  assert.strictEqual(onDemandRelativeDir('agy-plugin'), 'dist/on-demand/dhpk-agy');
  assert.strictEqual(onDemandArchiveName('agent-plugin', '1.2.3'), 'dhpk-agent-1.2.3.tar.gz');
  assert.throws(() => onDemandPackageName('codex-native'), /not an on-demand/);
});

test('distribution surfaces default to the ignored build directory, not plugins/', () => {
  for (const surface of ON_DEMAND_SURFACES) {
    assert.strictEqual(SURFACES[surface].output, onDemandRelativeDir(surface));
  }
  assert.strictEqual(SURFACES['codex-native'].output, 'plugins/dhpk');
});

test('build parses as an operation on an on-demand surface', () => {
  const request = parseRequest(['build', 'cursor-plugin', '--version', '1.2.3', '--json']);
  assert.strictEqual(request.ok, true);
  assert.strictEqual(request.operation, 'build');
  assert.strictEqual(request.surface, 'cursor-plugin');
  assert.strictEqual(request.options.version, '1.2.3');
});

test('build refuses committed and unknown surfaces', () => {
  for (const surface of ['codex-native', 'openai-submission', 'nope']) {
    const request = parseRequest(['build', surface]);
    assert.strictEqual(request.ok, false, surface);
    assert.strictEqual(request.status, 64);
  }
});

test('the classic surface-first form still parses', () => {
  const request = parseRequest(['codex-native', 'verify']);
  assert.strictEqual(request.ok, true);
  assert.strictEqual(request.operation, 'verify');
});

test('archiving writes <name>-<version>.tar.gz holding the package under its own name', () => {
  const parent = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-on-demand-archive-')));
  try {
    const packageDir = path.join(parent, 'dhpk-agent');
    fs.mkdirSync(packageDir);
    fs.writeFileSync(path.join(packageDir, 'plugin.json'), '{}\n');
    const { archivePath, sha256 } = archiveOnDemandPackage({ surface: 'agent-plugin', packageDir, version: '1.2.3' });
    assert.strictEqual(archivePath, path.join(parent, 'dhpk-agent-1.2.3.tar.gz'));
    assert.match(sha256, /^[0-9a-f]{64}$/);
    const listing = spawnSync('tar', ['-tzf', archivePath], { encoding: 'utf8' });
    assert.strictEqual(listing.status, 0, listing.stderr);
    assert.ok(listing.stdout.split('\n').includes('dhpk-agent/plugin.json'), listing.stdout);
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test('the repository commits only the Published Packages', () => {
  for (const name of ['dhpk-agent', 'dhpk-cursor', 'dhpk-agy']) {
    assert.deepStrictEqual(tracked(`plugins/${name}`), [], `plugins/${name} must not be tracked`);
  }
  assert.deepStrictEqual(tracked('generated'), [], 'generated/ is renamed dist/');
  assert.ok(tracked('plugins/dhpk').length > 0, 'the Public Plugin stays committed');
  assert.ok(tracked('dist/claude-marketplace/package').length > 0, 'the Directory Plugin stays committed');
  assert.ok(tracked('dist/claude-marketplace/stacks-package').length > 0, 'dhpk-stacks stays committed');
  assert.deepStrictEqual(tracked('dist/on-demand'), [], 'on-demand builds are never committed');
});

test('the Claude marketplace sources point at dist/', () => {
  const marketplace = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin', 'marketplace.json'), 'utf8'));
  assert.deepStrictEqual(
    marketplace.plugins.map((entry) => entry.source).sort(),
    ['./dist/claude-marketplace/package', './dist/claude-marketplace/stacks-package'],
  );
});

test('the release workflow attaches an archive for every on-demand surface', () => {
  const workflow = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'release.yml'), 'utf8');
  assert.match(workflow, /dhpk-release-host-packages-\$\{\{ github\.run_id \}\}/);
  assert.match(workflow, /gh release upload "\$GITHUB_REF_NAME"/);
  assert.match(workflow, /gh release download "\$GITHUB_REF_NAME"/);
  const verify = fs.readFileSync(path.join(ROOT, 'scripts', 'release', 'release-verify.sh'), 'utf8');
  for (const surface of ON_DEMAND_SURFACES) assert.ok(verify.includes(surface), `release-verify.sh must build ${surface}`);
  assert.match(verify, /bin\/dhpk distribution build "\$surface"/);
});

test('archiveOnDemandPackage writes atomically and leaves no temp files on failure', () => {
  const parent = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-on-demand-atomic-')));
  try {
    const packageDir = path.join(parent, 'dhpk-agent');
    fs.mkdirSync(packageDir);
    fs.writeFileSync(path.join(packageDir, 'plugin.json'), '{"v":1}\n');
    const first = archiveOnDemandPackage({ surface: 'agent-plugin', packageDir, version: '1.2.3' });
    assert.strictEqual(fs.readdirSync(parent).filter((name) => name.includes('.tmp-')).length, 0);

    // A failed archive build must preserve the previously valid archive and leave no temp artifact.
    fs.rmSync(packageDir, { recursive: true, force: true });
    assert.throws(() => archiveOnDemandPackage({ surface: 'agent-plugin', packageDir, version: '1.2.3' }), /archive failed/);
    assert.strictEqual(fs.existsSync(first.archivePath), true, 'existing archive must stay intact on failed rebuild');
    assert.strictEqual(fs.readdirSync(parent).filter((name) => name.includes('.tmp-')).length, 0);
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test('withOnDemandSurfaceLock supports re-entrancy and reclaims stale dead-PID locks', () => {
  const parent = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-on-demand-lock-')));
  try {
    const packageDir = path.join(parent, 'dhpk-cursor');
    const lockDir = path.join(parent, '.dhpk-cursor.build-lock');
    const exited = spawnSync(process.execPath, ['-e', ''], { encoding: 'utf8' });
    assert.strictEqual(exited.status, 0);
    fs.mkdirSync(lockDir);
    fs.writeFileSync(path.join(lockDir, 'owner.json'), JSON.stringify({ pid: exited.pid, createdAt: 1 }));
    let nestedRan = false;
    const result = withOnDemandSurfaceLock(packageDir, () => withOnDemandLocks([packageDir, packageDir], () => {
      nestedRan = true;
      return 'ok';
    }));
    assert.strictEqual(result, 'ok');
    assert.strictEqual(nestedRan, true);
    assert.strictEqual(fs.existsSync(lockDir), false, 'lock directory must be cleaned up on exit');
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test('withOnDemandSurfaceLock uses a load-safe ownerless grace window and reclaims expired ownerless locks', () => {
  assert.ok(ON_DEMAND_LOCK_STALE_GRACE_MS >= 5000, `expected >= 5000ms grace window, got ${ON_DEMAND_LOCK_STALE_GRACE_MS}`);
  const parent = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-on-demand-grace-')));
  try {
    const packageDir = path.join(parent, 'dhpk-cursor');
    const lockDir = path.join(parent, '.dhpk-cursor.build-lock');
    // Fresh ownerless lock directory must NOT be stolen prematurely under the default grace window.
    fs.mkdirSync(lockDir);
    assert.throws(
      () => withOnDemandSurfaceLock(packageDir, () => 'should-not-run', { timeoutMs: 150, pollMs: 25 }),
      /timed out waiting for on-demand package lock/,
    );
    assert.strictEqual(fs.existsSync(lockDir), true, 'fresh ownerless lock must remain untouched');

    // A lock left 60s ago (half the 120s acquire timeout) must be reclaimable
    // under the default grace window. The literal stays independent of the
    // implementation constant, so an oversized grace window fails here.
    const expiredAt = new Date(Date.now() - 60_000);
    fs.utimesSync(lockDir, expiredAt, expiredAt);
    // A short timeout keeps waiting from aging the lock into any oversized window.
    const result = withOnDemandSurfaceLock(packageDir, () => 'reclaimed', { timeoutMs: 2000, pollMs: 25 });
    assert.strictEqual(result, 'reclaimed');
    assert.strictEqual(fs.existsSync(lockDir), false, 'reclaimed lock must be cleaned up on release');
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test('withOnDemandSurfaceLock verifies ownership on release so reclaimed live locks are not deleted', () => {
  const parent = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-on-demand-owner-')));
  try {
    const packageDir = path.join(parent, 'dhpk-cursor');
    const lockDir = path.join(parent, '.dhpk-cursor.build-lock');
    const replacementOwner = { pid: process.pid, token: 'other-live-owner-token', createdAt: Date.now() };
    const replacementMarker = path.join(lockDir, 'sentinel.txt');

    const replaceLock = () => {
      const moved = `${lockDir}.simulated-reclaim`;
      fs.renameSync(lockDir, moved);
      fs.rmSync(moved, { recursive: true, force: true });
      fs.mkdirSync(lockDir);
      fs.writeFileSync(path.join(lockDir, 'owner.json'), `${JSON.stringify(replacementOwner)}\n`);
      fs.writeFileSync(replacementMarker, 'live-owner\n');
    };

    // Normal return path: must not remove another owner's replacement lock.
    const result = withOnDemandSurfaceLock(packageDir, () => {
      const current = JSON.parse(fs.readFileSync(path.join(lockDir, 'owner.json'), 'utf8'));
      assert.strictEqual(current.pid, process.pid);
      assert.strictEqual(typeof current.token, 'string');
      assert.ok(current.token.length >= 16, 'owner token must be non-trivial');
      replaceLock();
      return 'done';
    });
    assert.strictEqual(result, 'done');
    assert.strictEqual(fs.existsSync(lockDir), true, 'replacement lock must survive stale owner release');
    assert.strictEqual(fs.readFileSync(replacementMarker, 'utf8'), 'live-owner\n');
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(lockDir, 'owner.json'), 'utf8')), replacementOwner);

    // Clear replacement lock and verify the error path also preserves a replacement lock
    // and clears HELD_LOCKS for future acquisitions.
    fs.rmSync(lockDir, { recursive: true, force: true });
    assert.throws(() => {
      withOnDemandSurfaceLock(packageDir, () => {
        replaceLock();
        throw new Error('boom');
      });
    }, /boom/);
    assert.strictEqual(fs.existsSync(lockDir), true, 'replacement lock must survive failed owner release');
    assert.strictEqual(fs.readFileSync(replacementMarker, 'utf8'), 'live-owner\n');

    // Once the other owner finishes, this process can acquire and release again normally.
    fs.rmSync(lockDir, { recursive: true, force: true });
    assert.strictEqual(withOnDemandSurfaceLock(packageDir, () => 'again'), 'again');
    assert.strictEqual(fs.existsSync(lockDir), false);
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test('withOnDemandSurfaceLock serializes concurrent processes without overlapping critical sections', async () => {
  const parent = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-on-demand-mp-')));
  try {
    const packageDir = path.join(parent, 'dhpk-cursor');
    const lockDir = path.join(parent, '.dhpk-cursor.build-lock');
    const traceFile = path.join(parent, 'trace.log');
    const libPath = path.join(ROOT, 'scripts', 'lib', 'on-demand-packages.js');
    const script = [
      'const fs = require("node:fs");',
      'const { withOnDemandSurfaceLock } = require(process.argv[1]);',
      'const buf = new Int32Array(new SharedArrayBuffer(4));',
      'withOnDemandSurfaceLock(process.argv[2], () => {',
      '  fs.appendFileSync(process.argv[3], `enter:${process.argv[4]}\\n`);',
      '  Atomics.wait(buf, 0, 0, 60);',
      '  fs.appendFileSync(process.argv[3], `exit:${process.argv[4]}\\n`);',
      '});',
    ].join('\n');

    const children = ['w1', 'w2', 'w3'].map((id) => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['-e', script, libPath, packageDir, traceFile, id], { stdio: ['ignore', 'pipe', 'pipe'] });
      let stderr = '';
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      child.on('error', reject);
      child.on('close', (code) => resolve({ id, code, stderr }));
    }));
    const results = await Promise.all(children);
    for (const res of results) {
      assert.strictEqual(res.code, 0, `${res.id} failed: ${res.stderr}`);
    }
    const lines = fs.readFileSync(traceFile, 'utf8').trim().split('\n');
    assert.strictEqual(lines.length, 6, `expected 6 trace lines, got ${JSON.stringify(lines)}`);
    for (let index = 0; index < lines.length; index += 2) {
      const entered = lines[index].match(/^enter:(w\d)$/);
      assert.ok(entered, `expected enter line at ${index}, got ${lines[index]}`);
      assert.strictEqual(lines[index + 1], `exit:${entered[1]}`, `critical sections overlapped: ${JSON.stringify(lines)}`);
    }
    assert.strictEqual(fs.existsSync(lockDir), false, 'lock directory must be cleaned up after concurrent workers finish');
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test('withOnDemandSurfaceLock canonicalizes symlinked parent paths for re-entrancy', () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-on-demand-symlink-')));
  try {
    const realParent = path.join(root, 'real');
    const linkParent = path.join(root, 'link');
    fs.mkdirSync(realParent);
    fs.symlinkSync(realParent, linkParent, 'dir');
    const result = withOnDemandSurfaceLock(path.join(linkParent, 'dhpk-cursor'), () => (
      withOnDemandLocks(
        [path.join(realParent, 'dhpk-cursor'), path.join(linkParent, 'dhpk-cursor')],
        () => 'reentrant-across-symlink',
        { timeoutMs: 250, pollMs: 25 },
      )
    ), { timeoutMs: 250, pollMs: 25 });
    assert.strictEqual(result, 'reentrant-across-symlink');
    assert.strictEqual(fs.existsSync(path.join(realParent, '.dhpk-cursor.build-lock')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('withOnDemandSurfaceLock handles ENOTSUP link fallback and stale-reclaim races without deadlock or live-lock yank', () => {
  const parent = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-on-demand-race-')));
  try {
    const packageDir = path.join(parent, 'dhpk-cursor');
    const lockDir = path.join(parent, '.dhpk-cursor.build-lock');

    // Case 1: ENOTSUP fallback where lockDir is swapped to a distinct inode right as wx runs
    // must release its misplaced token claim instead of self-deadlocking on its own live PID.
    const origLink = fs.linkSync;
    const origWrite = fs.writeFileSync;
    let swapped = false;
    fs.linkSync = (src, dst) => {
      if (!swapped && dst === path.join(lockDir, 'owner.json')) {
        const err = new Error('Operation not supported');
        err.code = 'ENOTSUP';
        throw err;
      }
      return origLink.call(fs, src, dst);
    };
    fs.writeFileSync = (file, data, opts) => {
      if (!swapped && file === path.join(lockDir, 'owner.json') && opts && opts.flag === 'wx') {
        swapped = true;
        fs.renameSync(lockDir, path.join(parent, '.held-original'));
        fs.mkdirSync(lockDir);
      }
      return origWrite.call(fs, file, data, opts);
    };
    try {
      const result = withOnDemandSurfaceLock(packageDir, () => 'recovered-wx', { timeoutMs: 500, pollMs: 25 });
      assert.strictEqual(result, 'recovered-wx');
      assert.strictEqual(fs.existsSync(lockDir), false);
    } finally {
      fs.linkSync = origLink;
      fs.writeFileSync = origWrite;
      fs.rmSync(path.join(parent, '.held-original'), { recursive: true, force: true });
    }

    // Case 2: Slow live acquirer finishes writing owner.json right before tombstone links
    // -> reclaimer must abort without ever renaming or removing the live lock.
    fs.mkdirSync(lockDir);
    const expiredAt = new Date(Date.now() - 60_000);
    fs.utimesSync(lockDir, expiredAt, expiredAt);
    const origRename = fs.renameSync;
    let injectedLiveOwner = false;
    let renamedLiveLock = false;
    fs.linkSync = (src, dst) => {
      if (!injectedLiveOwner && String(src).includes('.tombstone-') && dst === path.join(lockDir, 'owner.json')) {
        injectedLiveOwner = true;
        fs.writeFileSync(path.join(lockDir, 'owner.json'), `${JSON.stringify({ pid: process.pid, token: 'live-acquirer', createdAt: Date.now() })}\n`);
      }
      return origLink.call(fs, src, dst);
    };
    fs.renameSync = (from, to) => {
      if (from === lockDir && String(to).includes('.stale-')) renamedLiveLock = true;
      return origRename.call(fs, from, to);
    };
    try {
      assert.throws(
        () => withOnDemandSurfaceLock(packageDir, () => 'should-not-run', { timeoutMs: 150, pollMs: 25 }),
        /timed out waiting for on-demand package lock/,
      );
      assert.strictEqual(injectedLiveOwner, true);
      assert.strictEqual(renamedLiveLock, false, 'live lock must never be moved during stale reclaim');
      assert.strictEqual(JSON.parse(fs.readFileSync(path.join(lockDir, 'owner.json'), 'utf8')).token, 'live-acquirer');
      assert.deepStrictEqual(
        fs.readdirSync(parent).filter((name) => name.includes('.stale-') || name.includes('.reclaim')),
        [],
      );
    } finally {
      fs.linkSync = origLink;
      fs.renameSync = origRename;
      fs.rmSync(lockDir, { recursive: true, force: true });
    }

    // Case 3: Corrupted/truncated owner.json older than staleGraceMs is still reclaimed cleanly.
    fs.mkdirSync(lockDir);
    const corruptOwner = path.join(lockDir, 'owner.json');
    fs.writeFileSync(corruptOwner, '{truncated');
    fs.utimesSync(corruptOwner, expiredAt, expiredAt);
    fs.utimesSync(lockDir, expiredAt, expiredAt);
    assert.strictEqual(withOnDemandSurfaceLock(packageDir, () => 'reclaimed-corrupt'), 'reclaimed-corrupt');
    assert.deepStrictEqual(fs.readdirSync(parent), []);
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test('withOnDemandSurfaceLock serializes concurrent stale-lock reclamation across workers without overlaps or strays', async () => {
  const parent = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-on-demand-mp-reclaim-')));
  try {
    const packageDir = path.join(parent, 'dhpk-cursor');
    const lockDir = path.join(parent, '.dhpk-cursor.build-lock');
    const libPath = path.join(ROOT, 'scripts', 'lib', 'on-demand-packages.js');
    const workerScript = [
      'const fs = require("node:fs");',
      'const { withOnDemandSurfaceLock } = require(process.argv[1]);',
      'const buf = new Int32Array(new SharedArrayBuffer(4));',
      'withOnDemandSurfaceLock(process.argv[2], () => {',
      '  fs.appendFileSync(process.argv[3], `enter:${process.argv[4]}\\n`);',
      '  Atomics.wait(buf, 0, 0, 20);',
      '  fs.appendFileSync(process.argv[3], `exit:${process.argv[4]}\\n`);',
      '}, { timeoutMs: 15000, pollMs: 10, staleGraceMs: 500 });',
    ].join('\n');

    for (const kind of ['expired-ownerless', 'dead-pid']) {
      const traceFile = path.join(parent, `trace-${kind}.log`);
      fs.rmSync(lockDir, { recursive: true, force: true });
      fs.mkdirSync(lockDir);
      if (kind === 'expired-ownerless') {
        const old = new Date(Date.now() - 10_000);
        fs.utimesSync(lockDir, old, old);
      } else {
        const exited = spawnSync(process.execPath, ['-e', ''], { encoding: 'utf8' });
        assert.strictEqual(exited.status, 0);
        fs.writeFileSync(path.join(lockDir, 'owner.json'), JSON.stringify({ pid: exited.pid, token: 'dead', createdAt: 1 }));
      }
      const workers = ['w1', 'w2', 'w3', 'w4', 'w5'].map((id) => new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ['-e', workerScript, libPath, packageDir, traceFile, id], { stdio: ['ignore', 'pipe', 'pipe'] });
        let stderr = '';
        child.stderr.on('data', (chunk) => { stderr += chunk; });
        child.on('error', reject);
        child.on('close', (code) => resolve({ id, code, stderr }));
      }));
      const results = await Promise.all(workers);
      for (const res of results) {
        assert.strictEqual(res.code, 0, `${kind} ${res.id} failed: ${res.stderr}`);
      }
      const lines = fs.readFileSync(traceFile, 'utf8').trim().split('\n');
      assert.strictEqual(lines.length, 10, `${kind}: expected 10 trace lines, got ${JSON.stringify(lines)}`);
      for (let index = 0; index < lines.length; index += 2) {
        const entered = lines[index].match(/^enter:(w\d)$/);
        assert.ok(entered, `${kind}: expected enter at ${index}, got ${lines[index]}`);
        assert.strictEqual(lines[index + 1], `exit:${entered[1]}`, `${kind}: critical sections overlapped: ${JSON.stringify(lines)}`);
      }
      assert.deepStrictEqual(
        fs.readdirSync(parent).filter((name) => name.startsWith('.dhpk-cursor')),
        [],
        `${kind}: no stray lock/reclaim/stale dirs may remain`,
      );
    }
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

function waitForLine(child, marker, label) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (stdout.includes(marker)) resolve();
    });
    child.on('error', reject);
    child.on('close', (code) => reject(new Error(`${label} exited before ${marker} (${code}): ${stderr}`)));
  });
}

const HOLDER_SCRIPT = [
  'const fs = require("node:fs");',
  'const { withOnDemandSurfaceLock } = require(process.argv[1]);',
  'const buf = new Int32Array(new SharedArrayBuffer(4));',
  'withOnDemandSurfaceLock(process.argv[2], () => {',
  '  process.stdout.write("LOCKED\\n");',
  '  while (!fs.existsSync(process.argv[3])) Atomics.wait(buf, 0, 0, 10);',
  '  fs.writeFileSync(process.argv[4], String(Date.now()));',
  '});',
].join('\n');

const VALIDATOR_SCRIPT = [
  'const fs = require("node:fs");',
  'const { execute } = require(process.argv[1]);',
  'process.stdout.write("STARTED\\n");',
  'const result = execute(JSON.parse(process.argv[2]), process.argv[3]);',
  'fs.writeFileSync(process.argv[4], JSON.stringify({ finishedAt: Date.now(), result }));',
].join('\n');

// A validate that ignores the lock finishes in tens of milliseconds, so it is
// still running after this window only if it is blocked on the lock.
const BLOCKED_WINDOW_MS = 400;

// The holder keeps the lock until the test signals release, and the test only
// signals after observing that the started validator is still blocked. A
// validate that skips the lock exits inside the window and fails the check.
async function assertValidateWaitsForLock({ scratch, packageDir, argv, root }) {
  const libPath = path.join(ROOT, 'scripts', 'lib', 'on-demand-packages.js');
  const distributionPath = path.join(ROOT, 'scripts', 'lib', 'dhpk-distribution.js');
  const releaseSignal = path.join(scratch, 'release.signal');
  const releasedFile = path.join(scratch, 'released.txt');
  const resultFile = path.join(scratch, 'validate-result.json');
  const holder = spawn(process.execPath, ['-e', HOLDER_SCRIPT, libPath, packageDir, releaseSignal, releasedFile], { stdio: ['ignore', 'pipe', 'pipe'] });
  const holderExit = new Promise((resolve) => holder.on('close', resolve));
  try {
    await waitForLine(holder, 'LOCKED', 'lock holder');
    const validator = spawn(process.execPath, ['-e', VALIDATOR_SCRIPT, distributionPath, JSON.stringify(argv), root, resultFile], { stdio: ['ignore', 'pipe', 'pipe'] });
    const validatorExit = new Promise((resolve) => validator.on('close', resolve));
    await waitForLine(validator, 'STARTED', 'validator');
    await new Promise((resolve) => setTimeout(resolve, BLOCKED_WINDOW_MS));
    assert.strictEqual(validator.exitCode, null, 'distribution validate must block while the surface lock is held');
    assert.strictEqual(fs.existsSync(resultFile), false, 'validate must not finish while the surface lock is held');
    fs.writeFileSync(releaseSignal, 'release\n');
    assert.strictEqual(await validatorExit, 0);
    assert.strictEqual(await holderExit, 0);
    const { finishedAt, result } = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
    const releasedAt = Number(fs.readFileSync(releasedFile, 'utf8'));
    assert.ok(finishedAt >= releasedAt, `validate finished (${finishedAt}) before holder released (${releasedAt})`);
    return result;
  } finally {
    fs.writeFileSync(releaseSignal, 'release\n');
    await holderExit;
  }
}

test('distribution validate serializes against an active on-demand surface lock before reading provenance', async () => {
  const tempRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-on-demand-dist-lock-')));
  try {
    const packageDir = path.join(tempRoot, 'dist', 'on-demand', 'dhpk-cursor');
    fs.mkdirSync(path.dirname(packageDir), { recursive: true });
    const result = await assertValidateWaitsForLock({
      scratch: tempRoot,
      packageDir,
      argv: ['cursor-plugin', 'validate', '--json'],
      root: tempRoot,
    });
    // The fixture root has no sources, so validate fails after the lock opens.
    assert.strictEqual(result.ok, false, JSON.stringify(result));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('distribution validate with a custom --output waits for the build lock on that directory', async () => {
  const tempRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-on-demand-custom-lock-')));
  try {
    const packageDir = path.join(tempRoot, 'custom', 'dhpk-cursor');
    fs.mkdirSync(packageDir, { recursive: true });
    const result = await assertValidateWaitsForLock({
      scratch: tempRoot,
      packageDir,
      argv: ['cursor-plugin', 'validate', '--output', packageDir, '--json'],
      root: ROOT,
    });
    // An empty package directory is read and rejected, proving validate ran.
    assert.strictEqual(result.payload.operation, 'validate', JSON.stringify(result));
    assert.strictEqual(result.payload.output, packageDir);
    assert.strictEqual(result.payload.verdict, 'FAIL');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('distribution validate falls back to an unlocked read when the package parent is read-only', () => {
  if (typeof process.getuid === 'function' && process.getuid() === 0) return; // root ignores directory modes
  const tempRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-on-demand-readonly-')));
  const parent = path.join(tempRoot, 'readonly');
  const packageDir = path.join(parent, 'dhpk-cursor');
  try {
    fs.mkdirSync(packageDir, { recursive: true });
    fs.chmodSync(parent, 0o555);
    const result = execute(['cursor-plugin', 'validate', '--output', packageDir, '--json'], ROOT);
    assert.strictEqual(result.payload && result.payload.operation, 'validate', JSON.stringify(result));
    assert.strictEqual(result.payload.verdict, 'FAIL');
    assert.deepStrictEqual(fs.readdirSync(parent), ['dhpk-cursor'], 'no lock directory may be created in a read-only parent');
  } finally {
    fs.chmodSync(parent, 0o755);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

run('on-demand-packages');
