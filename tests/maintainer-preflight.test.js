'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { test, run: runSuite } = require('./_lib/tinytest');
const { runPreflight } = require('../scripts/maintainer/delivery-preflight.js');

const temporaryRoots = [];
const CHECKERS = [
  {
    name: 'changelog',
    relativePath: 'scripts/ci/validate-changelog-fragments.js',
    args: (base) => ['--diff-base', base, '--base-ref', 'develop'],
  },
  {
    name: 'metadata',
    relativePath: 'tests/codex-skill-metadata.test.js',
    args: () => [],
  },
  {
    name: 'catalog',
    relativePath: 'scripts/ci/catalog.js',
    args: (base) => ['--check', 'all', '--diff-base', base],
  },
];

function createFixture(objectFormat = 'sha1') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-preflight-'));
  temporaryRoots.push(root);
  execFileSync('git', ['init', '-q', '-b', 'develop', ...(objectFormat === 'sha256' ? ['--object-format=sha256'] : [])], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Preflight Test'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'preflight@example.invalid'], { cwd: root });
  fs.mkdirSync(path.join(root, 'scripts/ci'), { recursive: true });
  fs.mkdirSync(path.join(root, 'tests'), { recursive: true });
  for (const checker of CHECKERS) {
    const checkerPath = path.join(root, checker.relativePath);
    fs.mkdirSync(path.dirname(checkerPath), { recursive: true });
    fs.writeFileSync(checkerPath, [
      "'use strict';",
      "const fs = require('node:fs');",
      "const path = require('node:path');",
      'const entry = { name: path.basename(__filename), args: process.argv.slice(2), cwd: process.cwd() };',
      "fs.appendFileSync(process.env.PREFLIGHT_TRACE, `${JSON.stringify(entry)}\\n`);",
      "if (process.env.PREFLIGHT_FAIL === path.basename(__filename)) process.exit(1);",
      "if (process.env.PREFLIGHT_WARN === path.basename(__filename)) process.stderr.write('warning\\n');",
    ].join('\n'));
  }
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'fixture'], { cwd: root });
  return { root: fs.realpathSync(root), base: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim() };
}

function run(root, base, options = {}) {
  const trace = path.join(root, 'trace.jsonl');
  const previousTrace = process.env.PREFLIGHT_TRACE;
  const previousFail = process.env.PREFLIGHT_FAIL;
  const previousWarn = process.env.PREFLIGHT_WARN;
  process.env.PREFLIGHT_TRACE = trace;
  if (options.fail) process.env.PREFLIGHT_FAIL = options.fail;
  else delete process.env.PREFLIGHT_FAIL;
  if (options.warn) process.env.PREFLIGHT_WARN = options.warn;
  else delete process.env.PREFLIGHT_WARN;
  return Promise.resolve()
    .then(() => runPreflight({ root, base, baseRef: options.baseRef ?? 'develop' }))
    .finally(() => {
      for (const [name, value] of Object.entries({
        PREFLIGHT_TRACE: previousTrace,
        PREFLIGHT_FAIL: previousFail,
        PREFLIGHT_WARN: previousWarn,
      })) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    });
}

function readTrace(root) {
  const location = path.join(root, 'trace.jsonl');
  if (!fs.existsSync(location)) return [];
  return fs.readFileSync(location, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

async function assertInputFailure(promise) {
  let result;
  try {
    result = await promise;
  } catch (error) {
    assert.ok(error instanceof Error);
    return;
  }
  // 斷言須放在 catch 外，避免把錯誤的成功結果也當成預期的輸入拒絕。
  assert.equal(result.status, 'failed');
  assert.notEqual(result.exitCode, 0);
}

test('preflight runs all three checkers in order from the canonical repository root', async () => {
  const { root, base } = createFixture();

  const result = await run(root, base);

  assert.equal(result.status, 'passed');
  assert.equal(result.exitCode, 0);
  assert.equal(result.stages.length, 3);
  assert.deepEqual(readTrace(root), CHECKERS.map((checker) => ({
    name: path.basename(checker.relativePath), args: checker.args(base), cwd: root,
  })));
});

test('preflight accepts an existing full SHA-256 commit identifier', async () => {
  const { root, base } = createFixture('sha256');

  const result = await run(root, base);

  assert.equal(base.length, 64);
  assert.equal(result.status, 'passed');
  assert.deepEqual(readTrace(root).map((entry) => entry.name), CHECKERS.map((checker) => path.basename(checker.relativePath)));
});

test('preflight stops after a changelog checker failure', async () => {
  const { root, base } = createFixture();

  const result = await run(root, base, { fail: 'validate-changelog-fragments.js' });

  assert.equal(result.status, 'failed');
  assert.equal(result.exitCode, 1);
  assert.deepEqual(readTrace(root).map((entry) => entry.name), ['validate-changelog-fragments.js']);
});

test('preflight stops after a skill metadata checker failure', async () => {
  const { root, base } = createFixture();

  const result = await run(root, base, { fail: 'codex-skill-metadata.test.js' });

  assert.equal(result.status, 'failed');
  assert.equal(result.exitCode, 1);
  assert.deepEqual(readTrace(root).map((entry) => entry.name), [
    'validate-changelog-fragments.js', 'codex-skill-metadata.test.js',
  ]);
});

test('a catalog warning with a successful checker exit remains passed', async () => {
  const { root, base } = createFixture();

  const result = await run(root, base, { warn: 'catalog.js' });

  assert.equal(result.status, 'passed');
  assert.equal(result.exitCode, 0);
  assert.match(result.stages[2].stderr, /warning/);
  assert.deepEqual(readTrace(root).map((entry) => entry.name), CHECKERS.map((checker) => path.basename(checker.relativePath)));
});

test('preflight preserves a catalog failure and completed stage records', async () => {
  const { root, base } = createFixture();

  const result = await run(root, base, { fail: 'catalog.js' });

  assert.equal(result.status, 'failed');
  assert.equal(result.exitCode, 1);
  assert.deepEqual(result.stages.map((stage) => stage.exitCode), [0, 0, 1]);
  assert.deepEqual(readTrace(root).map((entry) => entry.name), CHECKERS.map((checker) => path.basename(checker.relativePath)));
});

test('preflight rejects a subdirectory root before invoking any checker', async () => {
  const { root, base } = createFixture();
  const subdirectory = path.join(root, 'tests');

  await assertInputFailure(run(subdirectory, base));

  assert.deepEqual(readTrace(root), []);
});

test('preflight rejects a non-Git root before invoking any checker', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-preflight-not-git-'));
  temporaryRoots.push(root);

  await assertInputFailure(run(root, 'a'.repeat(40)));

  assert.deepEqual(readTrace(root), []);
});

test('preflight rejects a non-full or nonexistent commit SHA before invoking any checker', async () => {
  const { root, base } = createFixture();

  await assertInputFailure(run(root, base.slice(0, 12)));
  await assertInputFailure(run(root, 'a'.repeat(39)));
  await assertInputFailure(run(root, 'a'.repeat(40)));

  assert.deepEqual(readTrace(root), []);
});

test('preflight rejects a full object SHA that identifies a tree instead of a commit', async () => {
  const { root } = createFixture();
  const tree = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: root, encoding: 'utf8' }).trim();

  await assertInputFailure(run(root, tree));

  assert.deepEqual(readTrace(root), []);
});

test('preflight accepts only the develop base ref', async () => {
  const { root, base } = createFixture();

  await assertInputFailure(run(root, base, { baseRef: 'main' }));

  assert.deepEqual(readTrace(root), []);
});

// 專案 runner 以 tinytest 的摘要確認斷言證據；結束時仍須清除所有暫存 Git fixture。
async function main() {
  try {
    await runSuite('maintainer-preflight');
  } finally {
    for (const root of temporaryRoots) fs.rmSync(root, { recursive: true, force: true });
  }
}

main();
