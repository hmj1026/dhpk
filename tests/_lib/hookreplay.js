'use strict';

// hookreplay - run an existing hook-table suite's hook invocations in one batch
// process without rewriting its test bodies (#1506, spec #1491 story 29).
//
// A suite swaps `test` from tinytest for `batchTest` from here. For each test
// the body runs twice:
//   1. record, at load time: runHook calls are captured (and answered with a
//      placeholder), assertions are silenced, and any filesystem mutation
//      disqualifies the test, because a mutation between two hook calls would
//      be invisible to a batch that runs later. A disqualified test is
//      registered unchanged and runs the way it always did.
//   2. replay, when the test runs: the same body runs again with real
//      assertions, and every runHook call is answered, in order, from the
//      batch result. A call that differs from the recorded one (a body that
//      branches on a result) is simply run directly, so the verdict never
//      depends on the recording being complete.
// Case names, case counts and assertion messages are those of the original
// bodies, so a failure still names the case and the hook that failed.

const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

let phase = 'direct';
let guardSuspended = 0;
let recordTripped = false;

// Any way a body can change the world between two hook calls is a reason not to
// batch it: the batch runs later, so it would see the final state for every
// call. Subprocesses (a `git checkout` between two calls) are caught by
// wrapping child_process before any suite or helper destructures it, which is
// why this block runs before the other requires.
function trip(what) {
  if (phase !== 'record' || guardSuspended > 0) return false;
  recordTripped = true;
  throw new Error(`hookreplay: ${what} while recording`);
}
for (const name of ['spawnSync', 'execFileSync', 'execSync', 'spawn', 'exec', 'execFile', 'fork']) {
  const original = childProcess[name];
  childProcess[name] = function guardedChildProcess(...args) {
    trip(name);
    return original.apply(this, args);
  };
}
const originalChdir = process.chdir;
process.chdir = function guardedChdir(...args) {
  trip('chdir');
  return originalChdir.apply(this, args);
};
const realEnv = process.env;
process.env = new Proxy(realEnv, {
  set(target, key, value) {
    trip('process.env write');
    target[key] = value;
    return true;
  },
  deleteProperty(target, key) {
    trip('process.env delete');
    return delete target[key];
  },
});

const { test: plainTest, assert } = require('./tinytest');
const { ROOT, hookPath, setRunHookInterceptor } = require('./hookharness');
const { createHookBatch } = require('./hookbatch');

const batch = createHookBatch();
const stats = { batched: 0, direct: 0, batchedCalls: 0, fallbackCalls: 0 };
if (process.env.DHPK_HOOKREPLAY_STATS === '1') {
  process.on('exit', () => console.error(`hookreplay: ${JSON.stringify(stats)}`));
}

const FS_MUTATORS = [
  'writeFileSync', 'appendFileSync', 'mkdirSync', 'mkdtempSync', 'rmSync', 'rmdirSync', 'unlinkSync',
  'symlinkSync', 'linkSync', 'cpSync', 'renameSync', 'copyFileSync', 'chmodSync', 'truncateSync',
  'utimesSync', 'writeSync',
];
const ASSERTIONS = [
  'ok', 'equal', 'notEqual', 'deepEqual', 'notDeepEqual', 'deepStrictEqual', 'notDeepStrictEqual',
  'strictEqual', 'notStrictEqual', 'throws', 'doesNotThrow', 'match', 'doesNotMatch', 'ifError', 'fail',
];

// Fixtures a body needs but must not count as a mutation (shared repos) are
// built through here.
function unguarded(fn) {
  guardSuspended += 1;
  try {
    return fn();
  } finally {
    guardSuspended -= 1;
  }
}

function currentPhase() {
  return phase;
}

function normalize(hook, options) {
  const {
    payload = {}, cwd = ROOT, env = {}, deleteEnv = [], pluginRoot = ROOT, projectDir, profile = 'standard', timeout = 10000,
  } = options;
  const hookFile = path.isAbsolute(hook) ? hook : hookPath(hook);
  const payloadText = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const call = { hook: hookFile, payload: payloadText, cwd, env, deleteEnv, pluginRoot, projectDir, profile, timeout };
  const key = JSON.stringify([
    hookFile, payloadText, cwd, Object.entries(env).sort(), [...deleteEnv].sort(), pluginRoot, projectDir ?? null, profile, timeout,
  ]);
  return { call, key };
}

const PLACEHOLDER = Object.freeze({ status: 0, signal: null, stdout: '', stderr: '', output: [null, '', ''], pid: 0 });

function record(fn) {
  const entries = [];
  recordTripped = false;
  const savedFs = {};
  const savedAssert = {};
  for (const name of FS_MUTATORS) {
    savedFs[name] = fs[name];
    fs[name] = (...args) => {
      // Set the flag first: a body that swallows the error still disqualifies the test.
      phase === 'record' && trip(name);
      return savedFs[name](...args);
    };
  }
  for (const name of ASSERTIONS) {
    savedAssert[name] = assert[name];
    assert[name] = () => {};
  }
  phase = 'record';
  const previous = setRunHookInterceptor((hook, options) => {
    entries.push(normalize(hook, options));
    return { ...PLACEHOLDER };
  });
  try {
    fn();
  } catch {
    // A body that needs a real result stops here; the calls before it still count.
  } finally {
    setRunHookInterceptor(previous);
    phase = 'direct';
    for (const name of FS_MUTATORS) fs[name] = savedFs[name];
    for (const name of ASSERTIONS) assert[name] = savedAssert[name];
  }
  const missingCwd = entries.some(({ call }) => !fs.existsSync(call.cwd));
  return { entries, eligible: !recordTripped && !missingCwd && entries.length > 0 };
}

function batchTest(name, fn) {
  if (fn.constructor.name === 'AsyncFunction') return plainTest(name, fn);
  const { entries, eligible } = record(fn);
  if (!eligible) {
    stats.direct += 1;
    return plainTest(name, fn);
  }
  stats.batched += 1;
  stats.batchedCalls += entries.length;
  const handles = entries.map(({ call }) => batch.add(call));
  return plainTest(name, async () => {
    const results = [];
    for (const handle of handles) results.push({ signal: null, ...(await batch.result(handle)) });
    let next = 0;
    phase = 'replay';
    const previous = setRunHookInterceptor((hook, options, direct) => {
      const index = next++;
      const wanted = normalize(hook, options);
      if (index < entries.length && entries[index].key === wanted.key) return results[index];
      stats.fallbackCalls += 1;
      return direct(hook, options);
    });
    try {
      return fn();
    } finally {
      setRunHookInterceptor(previous);
      phase = 'direct';
    }
  });
}

module.exports = { batchTest, batch, unguarded, currentPhase };
