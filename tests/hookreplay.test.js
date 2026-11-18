'use strict';

// tests/_lib/hookreplay.js batches a suite's hook calls into one process (#1506).
// The batch must change only how many processes run: verdicts match direct
// runs, a failing case still names itself, and a body that changes state
// between two hook calls is never batched.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const { makeTempDir } = require('./_lib/temp-dir');

const LIB = path.join(__dirname, '_lib');

// Runs a throwaway suite in its own process and returns its output and the
// hookreplay statistics line.
function runSuite(source) {
  const dir = makeTempDir('dhpk-hookreplay-');
  fs.writeFileSync(path.join(dir, '.env'), 'synthetic');
  fs.writeFileSync(path.join(dir, 'ordinary'), 'synthetic');
  const file = path.join(dir, 'suite.test.js');
  const header = [
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    "const { run, assert } = require(" + JSON.stringify(path.join(LIB, 'tinytest')) + ');',
    "const { batchTest: test } = require(" + JSON.stringify(path.join(LIB, 'hookreplay')) + ');',
    "const { runHook } = require(" + JSON.stringify(path.join(LIB, 'hookharness')) + ');',
    `const DIR = ${JSON.stringify(dir)};`,
    "const guard = (command, extra = {}) => runHook('pre-bash-guard.sh', { cwd: DIR, payload: { tool_input: { command } }, ...extra });",
  ].join('\n');
  fs.writeFileSync(file, `${header}\n${source}\nrun('fixture');\n`);
  const result = spawnSync(process.execPath, [file], {
    encoding: 'utf8',
    env: { ...process.env, DHPK_HOOKREPLAY_STATS: '1' },
  });
  const stats = /hookreplay: (\{.*\})/.exec(result.stderr);
  return { ...result, stats: stats ? JSON.parse(stats[1]) : null };
}

test('hookreplay batches table cases and keeps each verdict', () => {
  const result = runSuite(`
    test('blocks a protected read', () => assert.strictEqual(guard('cat .env').status, 2));
    test('allows an ordinary read', () => assert.strictEqual(guard('cat ordinary').status, 0));
  `);
  assert.strictEqual(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /fixture: 2\/2 passed/);
  assert.deepStrictEqual(
    { batched: result.stats.batched, direct: result.stats.direct, batchedCalls: result.stats.batchedCalls },
    { batched: 2, direct: 0, batchedCalls: 2 }
  );
});

test('hookreplay names the failing case and still runs the others', () => {
  const result = runSuite(`
    test('good case', () => assert.strictEqual(guard('cat .env').status, 2));
    test('wrong expectation case', () => assert.strictEqual(guard('cat .env').status, 0));
    test('later good case', () => assert.strictEqual(guard('cat ordinary').status, 0));
  `);
  assert.notStrictEqual(result.status, 0, 'a wrong expectation must fail the suite');
  assert.match(result.stderr, /FAIL - wrong expectation case/);
  assert.match(result.stdout, /ok\s+- good case/);
  assert.match(result.stdout, /ok\s+- later good case/);
  assert.match(result.stdout, /fixture: 2\/3 passed/);
});

test('hookreplay does not batch a body that changes the filesystem between hook calls', () => {
  const result = runSuite(`
    test('writes a protected file after the first call', () => {
      const first = guard('cat late.env');
      fs.writeFileSync(path.join(DIR, '.env.late'), 'synthetic');
      assert.strictEqual(first.status, 0);
      assert.strictEqual(guard('cat .env.late').status, 2);
    });
  `);
  assert.strictEqual(result.status, 0, result.stdout + result.stderr);
  assert.strictEqual(result.stats.direct, 1);
  assert.strictEqual(result.stats.batched, 0);
});

test('hookreplay does not batch a body that starts a subprocess or edits the environment', () => {
  const result = runSuite(`
    test('subprocess between calls', () => {
      assert.strictEqual(guard('cat ordinary').status, 0);
      require('node:child_process').spawnSync('true');
      assert.strictEqual(guard('cat .env').status, 2);
    });
    test('environment edit between calls', () => {
      process.env.DHPK_HOOKREPLAY_PROBE = '1';
      try {
        assert.strictEqual(guard('cat ordinary').status, 0);
      } finally {
        delete process.env.DHPK_HOOKREPLAY_PROBE;
      }
    });
  `);
  assert.strictEqual(result.status, 0, result.stdout + result.stderr);
  assert.strictEqual(result.stats.direct, 2);
  assert.strictEqual(result.stats.batched, 0);
});

test('hookreplay runs a call the recording could not predict directly', () => {
  const result = runSuite(`
    test('second call depends on the first result', () => {
      const first = guard('cat .env');
      if (first.status === 2) assert.strictEqual(guard('cat ordinary').status, 0);
      else assert.fail('the recording placeholder must not decide the verdict');
    });
  `);
  assert.strictEqual(result.status, 0, result.stdout + result.stderr);
  assert.strictEqual(result.stats.batched, 1);
  assert.strictEqual(result.stats.fallbackCalls, 1);
});

run('hookreplay');
