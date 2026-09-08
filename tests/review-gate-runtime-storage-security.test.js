'use strict';

// RED security contract for the Review Gate runtime storage boundary.  The
// injected read seam makes the check-then-open race deterministic: an
// implementation that reopens a path after lstat without O_NOFOLLOW/fstat
// must observe the swapped symlink and fail closed.

const fs = require('node:fs');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { canonicalJson } = require('../scripts/lib/receipt-primitives');
const runtime = require('../scripts/lib/review-gate-runtime');
const storage = require('../scripts/lib/review-gate-runtime-storage');
const evidence = require('../scripts/lib/review-gate-runtime-evidence');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'scripts', 'review-gate-runtime.js');
const WORK_REQUEST = path.join(
  ROOT,
  'tests',
  'fixtures',
  'review-gate',
  'runtime-work-request-v1.json',
);

const stateRelative = path.join('.dhpk', 'review-gate', 'v1');

function temporaryDirectory(prefix) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

function cleanup(target) {
  fs.rmSync(target, { recursive: true, force: true });
}

function writePrivate(file, value) {
  fs.writeFileSync(file, value, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

function statePath(repoRoot, relative) {
  return path.join(repoRoot, stateRelative, relative);
}

function createState(repoRoot, { key = Buffer.alloc(32, 0x4b), config = storage.defaultConfig() } = {}) {
  const stateRoot = path.join(repoRoot, stateRelative);
  fs.mkdirSync(path.join(stateRoot, 'plans'), { recursive: true, mode: 0o700 });
  writePrivate(path.join(stateRoot, 'config.json'), `${canonicalJson(config)}\n`);
  writePrivate(path.join(stateRoot, 'integrity.key'), key);
  return stateRoot;
}

function createConfigOnlyState(repoRoot, config = storage.defaultConfig()) {
  const stateRoot = path.join(repoRoot, stateRelative);
  fs.mkdirSync(stateRoot, { recursive: true, mode: 0o700 });
  writePrivate(path.join(stateRoot, 'config.json'), `${canonicalJson(config)}\n`);
  return stateRoot;
}

function loadStorageWithUnavailablePhysicalOpenFlags() {
  const modulePath = require.resolve('../scripts/lib/review-gate-runtime-storage');
  const originalLoad = Module._load;
  const fakeFs = Object.create(fs);
  Object.defineProperty(fakeFs, 'constants', {
    value: Object.freeze({
      ...fs.constants,
      O_NOFOLLOW: undefined,
      O_NONBLOCK: undefined,
    }),
  });
  Module._load = function load(request, parent, isMain) {
    if (request === 'node:fs') return fakeFs;
    return originalLoad.apply(this, arguments);
  };
  delete require.cache[modulePath];
  try {
    return require(modulePath);
  } finally {
    Module._load = originalLoad;
    delete require.cache[modulePath];
  }
}

function assertCode(fn, code) {
  assert.throws(fn, (error) => error && error.code === code);
}

function restoreRegularFile(file, bytes) {
  try {
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink() || !stat.isFile()) fs.rmSync(file, { recursive: true, force: true });
  } catch (error) {
    if (!error || error.code !== 'ENOENT') throw error;
  }
  writePrivate(file, bytes);
}

function assertRejectsReadSwap(read, target, outside, expectedCode) {
  const originalReadFileSync = fs.readFileSync;
  const originalOpenSync = fs.openSync;
  let swapped = false;
  let thrown = null;
  const swapBeforeOpen = (file) => {
    if (!swapped && typeof file === 'string' && path.resolve(file) === path.resolve(target)) {
      swapped = true;
      fs.unlinkSync(target);
      fs.symlinkSync(outside, target);
    }
  };
  fs.readFileSync = (file, ...args) => {
    swapBeforeOpen(file);
    return originalReadFileSync(file, ...args);
  };
  fs.openSync = (file, ...args) => {
    swapBeforeOpen(file);
    return originalOpenSync(file, ...args);
  };
  try {
    read();
  } catch (error) {
    thrown = error;
  } finally {
    fs.readFileSync = originalReadFileSync;
    fs.openSync = originalOpenSync;
    restoreRegularFile(target, originalReadFileSync(target));
  }
  // An implementation may avoid the injected read entirely by opening the
  // descriptor with O_NOFOLLOW.  If it does use the read path, it must reject
  // the swapped symlink with the caller's bounded storage error.
  if (swapped) {
    assert.ok(thrown, 'a check-then-open symlink swap must fail closed');
    assert.strictEqual(thrown.code, expectedCode);
  } else {
    assert.strictEqual(thrown, null);
  }
}

function runCli(repoRoot, args = [], input = undefined) {
  return spawnSync(process.execPath, [CLI, ...args, '--repo-root', repoRoot], {
    cwd: repoRoot,
    encoding: 'utf8',
    input,
  });
}

function runBoundedCli(repoRoot, args = [], input = undefined) {
  return spawnSync(process.execPath, [CLI, ...args, '--repo-root', repoRoot], {
    cwd: repoRoot,
    encoding: 'utf8',
    input,
    timeout: 3000,
    killSignal: 'SIGKILL',
  });
}

function assertBoundedFailure(result, label) {
  const childErrorCode = result.error && result.error.code;
  assert.strictEqual(
    childErrorCode,
    undefined,
    `${label}: bounded runtime child failed or timed out (${childErrorCode || 'unknown'})`,
  );
  assert.strictEqual(result.signal, null, `${label}: runtime child timed out`);
  assert.notStrictEqual(result.status, 0, `${label}: hostile storage entry was accepted`);
  assert.strictEqual(result.stdout, '');
  assert.strictEqual(result.stderr, 'review-gate-runtime: ERROR\n');
}

function prepareRuntime(repoRoot) {
  const initialized = runCli(repoRoot, ['init']);
  assert.strictEqual(initialized.status, 0, `${initialized.stdout}\n${initialized.stderr}`);
  const preparedResult = runCli(
    repoRoot,
    ['prepare'],
    fs.readFileSync(WORK_REQUEST, 'utf8'),
  );
  assert.strictEqual(preparedResult.status, 0, `${preparedResult.stdout}\n${preparedResult.stderr}`);
  return JSON.parse(preparedResult.stdout);
}

function replaceWithFifo(file) {
  fs.unlinkSync(file);
  const result = spawnSync('mkfifo', [file], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 2000,
    killSignal: 'SIGKILL',
  });
  const childErrorCode = result.error && result.error.code;
  assert.strictEqual(
    childErrorCode,
    undefined,
    `mkfifo did not terminate (${childErrorCode || 'unknown'})`,
  );
  assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
}

function replaceDirectoryWithCopiedSymlink(target, outsideRoot) {
  const outside = path.join(outsideRoot, path.basename(target));
  const backup = `${target}.security-test-backup`;
  fs.cpSync(target, outside, { recursive: true });
  fs.renameSync(target, backup);
  fs.symlinkSync(outside, target, 'dir');
  return { outside, backup };
}

function restoreDirectorySwap(target, backup) {
  fs.unlinkSync(target);
  fs.renameSync(backup, target);
}

function planCheckpointPath(repoRoot, workId) {
  return statePath(repoRoot, path.join('plans', `${workId}.json`));
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

test('runtimeState rejects a physical state root with a symlinked .dhpk ancestor', () => {
  const outside = temporaryDirectory('dhpk-runtime-storage-ancestor-outside-');
  const repoRoot = temporaryDirectory('dhpk-runtime-storage-ancestor-repo-');
  createState(outside);
  fs.symlinkSync(path.join(outside, '.dhpk'), path.join(repoRoot, '.dhpk'), 'dir');
  try {
    assertCode(() => storage.runtimeState(repoRoot), 'SETUP_REQUIRED');
  } finally {
    cleanup(repoRoot);
    cleanup(outside);
  }
});

test('runtimeState rejects a physical state root with a symlinked review-gate ancestor', () => {
  const outside = temporaryDirectory('dhpk-runtime-storage-review-ancestor-outside-');
  const repoRoot = temporaryDirectory('dhpk-runtime-storage-review-ancestor-repo-');
  createState(outside);
  fs.mkdirSync(path.join(repoRoot, '.dhpk'), { mode: 0o700 });
  fs.symlinkSync(
    path.join(outside, '.dhpk', 'review-gate'),
    path.join(repoRoot, '.dhpk', 'review-gate'),
    'dir',
  );
  try {
    assertCode(() => storage.runtimeState(repoRoot), 'SETUP_REQUIRED');
  } finally {
    cleanup(repoRoot);
    cleanup(outside);
  }
});

test('evidence read rejects a deterministic check-then-open symlink swap', () => {
  const repoRoot = temporaryDirectory('dhpk-runtime-storage-evidence-race-');
  const relative = path.join('.claude', 'artifacts', 'review.md');
  const target = path.join(repoRoot, relative);
  const outside = path.join(temporaryDirectory('dhpk-runtime-storage-evidence-outside-'), 'review.md');
  const insideBytes = Buffer.from('inside evidence\n');
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    writePrivate(target, insideBytes);
    writePrivate(outside, Buffer.from('outside secret evidence\n'));
    assertRejectsReadSwap(
      () => evidence.readEvidenceFile(repoRoot, relative, 1024, 'MALFORMED_EVIDENCE'),
      target,
      outside,
      'MALFORMED_EVIDENCE',
    );
  } finally {
    cleanup(repoRoot);
    cleanup(path.dirname(outside));
  }
});

test('config read rejects a deterministic check-then-open symlink swap', () => {
  const repoRoot = temporaryDirectory('dhpk-runtime-storage-config-race-');
  const outsideRoot = temporaryDirectory('dhpk-runtime-storage-config-outside-');
  createState(repoRoot);
  const configPath = statePath(repoRoot, 'config.json');
  const outsideConfig = path.join(outsideRoot, 'config.json');
  const configBytes = fs.readFileSync(configPath);
  writePrivate(outsideConfig, configBytes);
  try {
    assertRejectsReadSwap(
      () => storage.readConfig(repoRoot),
      configPath,
      outsideConfig,
      'SETUP_REQUIRED',
    );
  } finally {
    cleanup(repoRoot);
    cleanup(outsideRoot);
  }
});

test('integrity-key read rejects a deterministic check-then-open symlink swap', () => {
  const repoRoot = temporaryDirectory('dhpk-runtime-storage-key-race-');
  const outsideRoot = temporaryDirectory('dhpk-runtime-storage-key-outside-');
  createState(repoRoot);
  const keyPath = statePath(repoRoot, 'integrity.key');
  const outsideKey = path.join(outsideRoot, 'integrity.key');
  const keyBytes = fs.readFileSync(keyPath);
  writePrivate(outsideKey, keyBytes);
  try {
    assertRejectsReadSwap(
      () => storage.readIntegrityKey(repoRoot),
      keyPath,
      outsideKey,
      'SETUP_REQUIRED',
    );
  } finally {
    cleanup(repoRoot);
    cleanup(outsideRoot);
  }
});

test('integrity-key read requires exactly 32 bytes', () => {
  const repoRoot = temporaryDirectory('dhpk-runtime-storage-key-length-');
  try {
    createState(repoRoot, { key: Buffer.alloc(33, 0x4b) });
    assertCode(() => storage.readIntegrityKey(repoRoot), 'CONFIG_INVALID');
  } finally {
    cleanup(repoRoot);
  }
});

test('runtime readers fail closed when physical open flags are unavailable', () => {
  const repoRoot = temporaryDirectory('dhpk-runtime-storage-flags-unavailable-');
  try {
    createState(repoRoot);
    const isolatedStorage = loadStorageWithUnavailablePhysicalOpenFlags();
    assertCode(() => isolatedStorage.readConfig(repoRoot), 'SETUP_REQUIRED');
    assertCode(() => isolatedStorage.readIntegrityKey(repoRoot), 'SETUP_REQUIRED');
  } finally {
    cleanup(repoRoot);
  }
});

test('first init rejects an existing config with an untrusted producer entry', () => {
  const repoRoot = temporaryDirectory('dhpk-runtime-storage-init-config-');
  try {
    const config = storage.defaultConfig();
    config.trustPolicy.producers.push({
      producer: 'attacker-producer',
      adapter: 'attacker-adapter',
      eventTypes: ['REVIEW_RESULT_RECORDED'],
      receiptKinds: ['review'],
      lanes: [],
    });
    createConfigOnlyState(repoRoot, config);
    assertCode(() => storage.createIntegrityKey(repoRoot), 'CONFIG_INVALID');
    assert.strictEqual(fs.existsSync(statePath(repoRoot, 'integrity.key')), false);
  } finally {
    cleanup(repoRoot);
  }
});

test('runtimeState rejects a non-canonical config serialization', () => {
  const repoRoot = temporaryDirectory('dhpk-runtime-storage-config-canonical-');
  try {
    createState(repoRoot);
    const configPath = statePath(repoRoot, 'config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    writePrivate(configPath, `${JSON.stringify(config, null, 2)}\n`);
    assertCode(() => storage.runtimeState(repoRoot), 'CONFIG_INVALID');
  } finally {
    cleanup(repoRoot);
  }
});

test('config read rejects bytes above its bounded storage limit', () => {
  const repoRoot = temporaryDirectory('dhpk-runtime-storage-config-bound-');
  try {
    createState(repoRoot);
    const configPath = statePath(repoRoot, 'config.json');
    writePrivate(configPath, Buffer.alloc(storage.MAX_STDIN_BYTES + 1, 0x20));
    assert.throws(() => storage.readConfig(repoRoot));
  } finally {
    cleanup(repoRoot);
  }
});

test('prepare rejects an open stdin stream after the 1 MiB bound', () => {
  const repoRoot = temporaryDirectory('dhpk-runtime-storage-stdin-bound-');
  try {
    const initialized = runCli(repoRoot, ['init']);
    assert.strictEqual(initialized.status, 0, `${initialized.stdout}\n${initialized.stderr}`);
    const producer = [
      'const chunk=Buffer.alloc(65536,120);',
      "process.stdout.on('error',()=>process.exit(0));",
      'function pump(){if(!process.stdout.write(chunk))process.stdout.once(\'drain\',pump);else setImmediate(pump);}pump();',
    ].join(' ');
    const command = [
      `${shellQuote(process.execPath)} -e ${shellQuote(producer)}`,
      `${shellQuote(process.execPath)} ${shellQuote(CLI)} prepare --repo-root ${shellQuote(repoRoot)}`,
    ].join(' | ');
    const result = spawnSync('bash', ['-c', command], {
      cwd: repoRoot,
      encoding: 'utf8',
      timeout: 2000,
      killSignal: 'SIGKILL',
    });
    assert.strictEqual(result.error, undefined, `bounded stdin reader did not terminate: ${result.error && result.error.code}`);
    assert.strictEqual(result.signal, null, `bounded stdin reader timed out: ${result.stderr}`);
    assert.notStrictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.strictEqual(result.stdout, '');
    assert.strictEqual(result.stderr, 'review-gate-runtime: ERROR\n');
    assert.deepStrictEqual(
      fs.readdirSync(statePath(repoRoot, 'plans')),
      [],
    );
  } finally {
    cleanup(repoRoot);
  }
});

test('status exposes a bounded receipt summary instead of raw receipts', () => {
  const repoRoot = temporaryDirectory('dhpk-runtime-storage-status-bound-');
  try {
    const initialized = runCli(repoRoot, ['init']);
    assert.strictEqual(initialized.status, 0, `${initialized.stdout}\n${initialized.stderr}`);
    const preparedResult = runCli(
      repoRoot,
      ['prepare'],
      fs.readFileSync(WORK_REQUEST, 'utf8'),
    );
    assert.strictEqual(preparedResult.status, 0, `${preparedResult.stdout}\n${preparedResult.stderr}`);
    const prepared = JSON.parse(preparedResult.stdout);
    const statusResult = runCli(repoRoot, [
      'status',
      '--work-id', prepared.workId,
      '--wave-id', prepared.waveId,
    ]);
    assert.strictEqual(statusResult.status, 0, `${statusResult.stdout}\n${statusResult.stderr}`);
    const status = JSON.parse(statusResult.stdout);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(status, 'receipts'), false);
    assert.deepStrictEqual(status.receiptSummary, { total: 0, byKind: {} });
    assert.strictEqual(status.migrationObservation, null);
    assert.ok(Buffer.byteLength(statusResult.stdout, 'utf8') < 32 * 1024);
  } finally {
    cleanup(repoRoot);
  }
});

test('status reads a valid prepared checkpoint without depending on /proc/self/fd', () => {
  if (process.platform !== 'linux') return;
  const repoRoot = temporaryDirectory('dhpk-runtime-storage-no-proc-');
  const originalRealpathSync = fs.realpathSync;
  let procAccesses = 0;
  let thrown = null;
  try {
    const prepared = prepareRuntime(repoRoot);
    fs.realpathSync = (target, ...args) => {
      if (typeof target === 'string' && target.startsWith('/proc/self/fd/')) {
        procAccesses += 1;
        const error = new Error('blocked /proc/self/fd access');
        error.code = 'PROC_ACCESS_BLOCKED';
        throw error;
      }
      return originalRealpathSync(target, ...args);
    };
    let status = null;
    try {
      status = runtime.status({ repoRoot, workId: prepared.workId });
    } catch (error) {
      thrown = error;
    }
    assert.strictEqual(
      procAccesses,
      0,
      `package-local status read accessed /proc/self/fd (${procAccesses} time(s)); ${thrown && thrown.code}`,
    );
    assert.strictEqual(thrown, null);
    assert.strictEqual(status.status, 'PENDING');
    assert.strictEqual(status.workId, prepared.workId);
  } finally {
    fs.realpathSync = originalRealpathSync;
    cleanup(repoRoot);
  }
});

test('status rejects a FIFO latest sequence within the bounded child deadline', () => {
  const repoRoot = temporaryDirectory('dhpk-runtime-storage-sequence-fifo-');
  try {
    const prepared = prepareRuntime(repoRoot);
    const sequencePath = statePath(
      repoRoot,
      path.join('works', prepared.workId, 'events', '000000000001.json'),
    );
    replaceWithFifo(sequencePath);
    assertBoundedFailure(
      runBoundedCli(repoRoot, ['status', '--work-id', prepared.workId]),
      'latest sequence FIFO',
    );
  } finally {
    cleanup(repoRoot);
  }
});

test('status rejects a latest sequence above the 1 MiB byte budget', () => {
  const repoRoot = temporaryDirectory('dhpk-runtime-storage-sequence-oversize-');
  try {
    const prepared = prepareRuntime(repoRoot);
    const sequencePath = statePath(
      repoRoot,
      path.join('works', prepared.workId, 'events', '000000000001.json'),
    );
    const sequence = JSON.parse(fs.readFileSync(sequencePath, 'utf8'));
    const oversized = `${canonicalJson({
      ...sequence,
      padding: 'x'.repeat(storage.MAX_STDIN_BYTES),
    })}\n`;
    assert.ok(Buffer.byteLength(oversized, 'utf8') > storage.MAX_STDIN_BYTES);
    writePrivate(sequencePath, oversized);
    assertBoundedFailure(
      runBoundedCli(repoRoot, ['status', '--work-id', prepared.workId]),
      'latest sequence above byte budget',
    );
  } finally {
    cleanup(repoRoot);
  }
});

test('status rejects a symlinked works ancestor without reading external state', () => {
  const repoRoot = temporaryDirectory('dhpk-runtime-storage-works-ancestor-');
  const outsideRoot = temporaryDirectory('dhpk-runtime-storage-works-ancestor-outside-');
  const worksPath = statePath(repoRoot, 'works');
  try {
    const prepared = prepareRuntime(repoRoot);
    const swapped = replaceDirectoryWithCopiedSymlink(worksPath, outsideRoot);
    const outsideSequence = path.join(
      swapped.outside,
      prepared.workId,
      'events',
      '000000000001.json',
    );
    const outsideBytes = fs.readFileSync(outsideSequence);
    try {
      assertBoundedFailure(
        runBoundedCli(repoRoot, ['status', '--work-id', prepared.workId]),
        'works ancestor symlink',
      );
      assert.deepStrictEqual(fs.readFileSync(outsideSequence), outsideBytes);
    } finally {
      restoreDirectorySwap(worksPath, swapped.backup);
    }
  } finally {
    cleanup(repoRoot);
    cleanup(outsideRoot);
  }
});

test('status rejects a symlinked work ancestor without reading external state', () => {
  const repoRoot = temporaryDirectory('dhpk-runtime-storage-work-ancestor-');
  const outsideRoot = temporaryDirectory('dhpk-runtime-storage-work-ancestor-outside-');
  try {
    const prepared = prepareRuntime(repoRoot);
    const workPath = statePath(repoRoot, path.join('works', prepared.workId));
    const swapped = replaceDirectoryWithCopiedSymlink(workPath, outsideRoot);
    const outsideSequence = path.join(swapped.outside, 'events', '000000000001.json');
    const outsideBytes = fs.readFileSync(outsideSequence);
    try {
      assertBoundedFailure(
        runBoundedCli(repoRoot, ['status', '--work-id', prepared.workId]),
        'work ancestor symlink',
      );
      assert.deepStrictEqual(fs.readFileSync(outsideSequence), outsideBytes);
    } finally {
      restoreDirectorySwap(workPath, swapped.backup);
    }
  } finally {
    cleanup(repoRoot);
    cleanup(outsideRoot);
  }
});

test('status rejects a symlinked events ancestor without reading external state', () => {
  const repoRoot = temporaryDirectory('dhpk-runtime-storage-events-ancestor-');
  const outsideRoot = temporaryDirectory('dhpk-runtime-storage-events-ancestor-outside-');
  try {
    const prepared = prepareRuntime(repoRoot);
    const eventsPath = statePath(repoRoot, path.join('works', prepared.workId, 'events'));
    const swapped = replaceDirectoryWithCopiedSymlink(eventsPath, outsideRoot);
    const outsideSequence = path.join(swapped.outside, '000000000001.json');
    const outsideBytes = fs.readFileSync(outsideSequence);
    try {
      assertBoundedFailure(
        runBoundedCli(repoRoot, ['status', '--work-id', prepared.workId]),
        'events ancestor symlink',
      );
      assert.deepStrictEqual(fs.readFileSync(outsideSequence), outsideBytes);
    } finally {
      restoreDirectorySwap(eventsPath, swapped.backup);
    }
  } finally {
    cleanup(repoRoot);
    cleanup(outsideRoot);
  }
});

test('status rejects a FIFO plan checkpoint within the bounded child deadline', () => {
  const repoRoot = temporaryDirectory('dhpk-runtime-storage-plan-fifo-');
  try {
    const prepared = prepareRuntime(repoRoot);
    const checkpointPath = planCheckpointPath(repoRoot, prepared.workId);
    replaceWithFifo(checkpointPath);
    assertBoundedFailure(
      runBoundedCli(repoRoot, ['status', '--work-id', prepared.workId]),
      'plan checkpoint FIFO',
    );
  } finally {
    cleanup(repoRoot);
  }
});

test('status rejects a plan checkpoint above the 1 MiB byte budget', () => {
  const repoRoot = temporaryDirectory('dhpk-runtime-storage-plan-oversize-');
  try {
    const prepared = prepareRuntime(repoRoot);
    const checkpointPath = planCheckpointPath(repoRoot, prepared.workId);
    const checkpoint = JSON.parse(fs.readFileSync(checkpointPath, 'utf8'));
    const oversized = `${canonicalJson({
      ...checkpoint,
      padding: 'x'.repeat(storage.MAX_STDIN_BYTES),
    })}\n`;
    assert.ok(Buffer.byteLength(oversized, 'utf8') > storage.MAX_STDIN_BYTES);
    writePrivate(checkpointPath, oversized);
    assertBoundedFailure(
      runBoundedCli(repoRoot, ['status', '--work-id', prepared.workId]),
      'plan checkpoint above byte budget',
    );
  } finally {
    cleanup(repoRoot);
  }
});

test('status rejects a symlinked plan directory ancestor without reading external state', () => {
  const repoRoot = temporaryDirectory('dhpk-runtime-storage-plan-ancestor-');
  const outsideRoot = temporaryDirectory('dhpk-runtime-storage-plan-ancestor-outside-');
  const plansPath = statePath(repoRoot, 'plans');
  try {
    const prepared = prepareRuntime(repoRoot);
    const swapped = replaceDirectoryWithCopiedSymlink(plansPath, outsideRoot);
    const outsideCheckpoint = path.join(swapped.outside, `${prepared.workId}.json`);
    const outsideBytes = fs.readFileSync(outsideCheckpoint);
    try {
      assertBoundedFailure(
        runBoundedCli(repoRoot, ['status', '--work-id', prepared.workId]),
        'plan directory ancestor symlink',
      );
      assert.deepStrictEqual(fs.readFileSync(outsideCheckpoint), outsideBytes);
    } finally {
      restoreDirectorySwap(plansPath, swapped.backup);
    }
  } finally {
    cleanup(repoRoot);
    cleanup(outsideRoot);
  }
});

test('status rejects a symlinked latest sequence without leaking external evidence', () => {
  const repoRoot = temporaryDirectory('dhpk-runtime-storage-sequence-symlink-repo-');
  const outsideRoot = temporaryDirectory('dhpk-runtime-storage-sequence-symlink-outside-');
  try {
    const initialized = runCli(repoRoot, ['init']);
    assert.strictEqual(initialized.status, 0, `${initialized.stdout}\n${initialized.stderr}`);
    const preparedResult = runCli(
      repoRoot,
      ['prepare'],
      fs.readFileSync(WORK_REQUEST, 'utf8'),
    );
    assert.strictEqual(preparedResult.status, 0, `${preparedResult.stdout}\n${preparedResult.stderr}`);
    const prepared = JSON.parse(preparedResult.stdout);
    const sequencePath = statePath(
      repoRoot,
      path.join('works', prepared.workId, 'events', '000000000001.json'),
    );
    const outsideSequence = path.join(outsideRoot, '000000000001.json');
    fs.copyFileSync(sequencePath, outsideSequence);
    const outsideBytes = fs.readFileSync(outsideSequence);
    fs.unlinkSync(sequencePath);
    fs.symlinkSync(outsideSequence, sequencePath);

    const statusResult = runCli(repoRoot, ['status', '--work-id', prepared.workId]);
    assert.notStrictEqual(statusResult.status, 0, `${statusResult.stdout}\n${statusResult.stderr}`);
    assert.strictEqual(statusResult.stdout, '');
    assert.strictEqual(statusResult.stderr, 'review-gate-runtime: ERROR\n');
    assert.deepStrictEqual(fs.readFileSync(outsideSequence), outsideBytes);
    const diagnosticsPath = statePath(repoRoot, 'diagnostics');
    const diagnostics = fs.readdirSync(diagnosticsPath).map((name) => (
      JSON.parse(fs.readFileSync(path.join(diagnosticsPath, name), 'utf8'))
    ));
    assert.strictEqual(diagnostics.length, 1);
    assert.strictEqual(diagnostics[0].command, 'status');
    assert.ok(typeof diagnostics[0].code === 'string' && diagnostics[0].code.length > 0);
    assert.strictEqual(JSON.stringify(diagnostics[0]).includes(repoRoot), false);
    assert.strictEqual(JSON.stringify(diagnostics[0]).includes(outsideRoot), false);
  } finally {
    cleanup(repoRoot);
    cleanup(outsideRoot);
  }
});

run('review-gate-runtime-storage-security');
