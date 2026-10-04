'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const ANALYZER = path.join(ROOT, 'skills', 'dhpk-opsx-apply-goal', 'scripts', 'analyze-change.sh');
const context = require(path.join(ROOT, 'skills', 'dhpk-opsx-apply-goal', 'scripts', 'goal-context.js'));

function fakeCli(name) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'opsx-context-')));
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, name), '#!/usr/bin/env bash\nexit 0\n', { mode: 0o755 });
  return { root, bin };
}

function withEnv(values, callback) {
  const keys = [
    ...Object.keys(values),
    'CLAUDE_PLUGIN_OPTION_FAST_WORKER_BACKEND',
    'CLAUDE_PLUGIN_OPTION_FAST_WORKER_BACKEND_ORDER',
    'CLAUDE_PLUGIN_OPTION_FAST_WORKER_FALLBACK',
    'CLAUDE_PLUGIN_OPTION_CROSS_PROVIDER',
    'DHPK_PROJECT_OPTION_FAST_WORKER_BACKEND',
    'DHPK_PROJECT_OPTION_FAST_WORKER_BACKEND_ORDER',
    'DHPK_PROJECT_OPTION_FAST_WORKER_FALLBACK',
    'DHPK_PROJECT_OPTION_CROSS_PROVIDER',
    'DHPK_CLAUDE_BACKEND_AVAILABLE',
  ];
  const prior = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    for (const key of keys) delete process.env[key];
    Object.assign(process.env, values);
    return callback();
  } finally {
    for (const key of keys) prior[key] === undefined ? delete process.env[key] : process.env[key] = prior[key];
  }
}

test('analyzer invocation override selects available AGY over the configured default', () => {
  const { spawnSync } = require('node:child_process');
  const cli = fakeCli('agy');
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'opsx-analyze-worker-override-')));
  try {
    const change = path.join(repo, 'openspec', 'changes', 'demo-change');
    fs.mkdirSync(change, { recursive: true });
    fs.writeFileSync(path.join(change, 'tasks.md'), '- [ ] 1.1 select the requested worker\n');
    fs.writeFileSync(path.join(change, 'proposal.md'), '# Demo\n');

    const result = withEnv({
      CLAUDE_PROJECT_DIR: repo,
      PATH: `${cli.bin}:${process.env.PATH}`,
      CLAUDE_PLUGIN_OPTION_FAST_WORKER_BACKEND: 'claude',
    }, () => {
      const env = { ...process.env };
      delete env.CLAUDE_PLUGIN_ROOT;
      return spawnSync('bash', [ANALYZER, 'demo-change', '--worker=agy'], {
        cwd: repo,
        env,
        encoding: 'utf8',
      });
    });

    assert.strictEqual(result.status, 0, `analyzer exited ${result.status}:\n${result.stderr}`);
    const fields = Object.fromEntries(result.stdout.split('\n')
      .filter((line) => line.includes('='))
      .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
    assert.strictEqual(fields.STATUS, 'active', result.stdout);
    assert.strictEqual(fields.FAST_WORKER_SELECTED, 'agy', result.stdout);
    assert.strictEqual(fields.FAST_WORKER_AGENT, 'dhpk:agy-worker', result.stdout);
  } finally {
    fs.rmSync(cli.root, { recursive: true, force: true });
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('analyzer rejects retired --codex before active analysis and names exact replacements', () => {
  const { spawnSync } = require('node:child_process');
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'opsx-analyze-codex-retired-')));
  try {
    const change = path.join(repo, 'openspec', 'changes', 'demo-change');
    fs.mkdirSync(change, { recursive: true });
    fs.writeFileSync(path.join(change, 'tasks.md'), '- [ ] 1.1 do the thing\n');
    fs.writeFileSync(path.join(change, 'proposal.md'), '# Demo\n');

    const env = { ...process.env, CLAUDE_PROJECT_DIR: repo };
    delete env.CLAUDE_PLUGIN_ROOT;
    const res = spawnSync('bash', [
      path.join(ROOT, 'skills', 'dhpk-opsx-apply-goal', 'scripts', 'analyze-change.sh'),
      'demo-change', '--codex',
    ], { cwd: repo, env, encoding: 'utf8' });

    assert.strictEqual(res.status, 0, `analyzer exited ${res.status}:\n${res.stderr}`);
    assert.ok(res.stdout.includes('STATUS=error'), `missing error status:\n${res.stdout}`);
    assert.ok(res.stdout.includes('DEPRECATED_CODEX_FLAG=true'), `missing deprecation marker:\n${res.stdout}`);
    assert.ok(res.stdout.includes('--worker=codex'), `missing worker replacement:\n${res.stdout}`);
    assert.ok(res.stdout.includes('--second-opinion=codex-exec'), `missing second-opinion replacement:\n${res.stdout}`);
    assert.ok(!res.stdout.includes('STATUS=active'), `retired flag must stop before active analysis:\n${res.stdout}`);
    assert.ok(!res.stdout.includes('FAST_WORKER_SELECTED'), `retired flag must not invoke context analysis:\n${res.stdout}`);
  } finally { fs.rmSync(repo, { recursive: true, force: true }); }
});

test('flag overrides config and output carries availability, fallback, and order', () => {
  const cli = fakeCli('agy');
  try {
    const result = withEnv({ PATH: `${cli.bin}:/usr/bin:/bin`, CLAUDE_PLUGIN_OPTION_FAST_WORKER_BACKEND: 'claude', CLAUDE_PLUGIN_OPTION_FAST_WORKER_BACKEND_ORDER: 'codex,agy,claude', CLAUDE_PLUGIN_OPTION_FAST_WORKER_FALLBACK: 'claude' }, () => context.buildContext({ tasks: '- [ ] backend\n', proposal: '', fastWorker: 'agy' }));
    assert.strictEqual(result.fields.FAST_WORKER_SELECTED, 'agy');
    assert.strictEqual(result.fields.FAST_WORKER_AGENT, 'dhpk:agy-worker');
    assert.strictEqual(result.fields.FAST_WORKER_ORDER, 'codex,agy,claude');
    assert.strictEqual(result.fields.FAST_WORKER_FALLBACK, 'claude');
    assert.ok(result.fields.FAST_WORKER_CLAUSE.includes('agy executable available'));
  } finally { fs.rmSync(cli.root, { recursive: true, force: true }); }
});

test('cross-provider resolution preserves project-over-user precedence and one-shot opt-in', () => {
  const cli = fakeCli('codex');
  try {
    const configured = withEnv({
      PATH: `${cli.bin}:${process.env.PATH}`,
      CLAUDE_PLUGIN_OPTION_FAST_WORKER_BACKEND: 'auto',
      CLAUDE_PLUGIN_OPTION_FAST_WORKER_BACKEND_ORDER: 'codex,claude',
      CLAUDE_PLUGIN_OPTION_CROSS_PROVIDER: 'false',
      DHPK_PROJECT_OPTION_CROSS_PROVIDER: 'true',
    }, () => context.buildContext({ tasks: '- [ ] backend\n', proposal: '', fastWorker: 'auto' }));
    assert.strictEqual(configured.fields.FAST_WORKER_CROSS_PROVIDER, 'true');
    assert.strictEqual(configured.fields.FAST_WORKER_SCOPE, 'cross-provider');
    assert.strictEqual(configured.fields.FAST_WORKER_SELECTED, 'codex');

    const oneShot = withEnv({
      PATH: `${cli.bin}:${process.env.PATH}`,
      CLAUDE_PLUGIN_OPTION_FAST_WORKER_BACKEND: 'auto',
      CLAUDE_PLUGIN_OPTION_FAST_WORKER_BACKEND_ORDER: 'codex,claude',
      CLAUDE_PLUGIN_OPTION_CROSS_PROVIDER: 'false',
      DHPK_PROJECT_OPTION_CROSS_PROVIDER: 'false',
    }, () => context.buildContext({
      tasks: '- [ ] backend\n',
      proposal: '',
      fastWorker: 'auto',
      crossProvider: true,
    }));
    assert.strictEqual(oneShot.fields.FAST_WORKER_CROSS_PROVIDER, 'true');
    assert.strictEqual(oneShot.fields.FAST_WORKER_SCOPE, 'cross-provider');
    assert.strictEqual(oneShot.fields.FAST_WORKER_SELECTED, 'codex');
  } finally { fs.rmSync(cli.root, { recursive: true, force: true }); }
});

test('invalid worker flag warns and falls back to the configured resolution', () => {
  const cli = fakeCli('codex');
  try {
    const result = withEnv({ PATH: `${cli.bin}:/usr/bin:/bin`, CODEX: 'off', CLAUDE_PLUGIN_OPTION_FAST_WORKER_BACKEND: 'codex' }, () => context.buildContext({ tasks: '- [ ] backend\n', proposal: '', fastWorker: 'wat' }));
    assert.ok(result.warning.includes('invalid --worker value'));
    assert.strictEqual(result.fields.FAST_WORKER_SELECTED, 'codex');
  } finally { fs.rmSync(cli.root, { recursive: true, force: true }); }
});

test('blocked selector status renders stop guidance instead of an actionable worker dispatch', () => {
  const result = withEnv({
    PATH: '/usr/bin:/bin',
    CLAUDE_PLUGIN_OPTION_FAST_WORKER_FALLBACK: 'none',
  }, () => context.buildContext({ tasks: '- [ ] backend\n', proposal: '', fastWorker: 'codex' }));

  assert.strictEqual(result.fields.FAST_WORKER_STATUS, 'blocked');
  assert.ok(result.fields.FAST_WORKER_CLAUSE.startsWith('BLOCKED fast-worker requested=codex'));
  assert.ok(result.fields.FAST_WORKER_CLAUSE.includes('action=STOP and report BLOCKED'));
  assert.ok(result.fields.FAST_WORKER_CLAUSE.includes('sanctioned selected fallback only'));
  assert.ok(!result.fields.FAST_WORKER_CLAUSE.includes('dhpk:codex-fast-worker'),
    'blocked backend must not be rendered as an actionable agent');
});

test('auto stays native-only and preserves UTF-8-safe digest plus conditional E2E', () => {
  const cli = fakeCli('codex');
  try {
    const result = withEnv({ PATH: `${cli.bin}:/usr/bin:/bin`, DHPK_CLAUDE_BACKEND_AVAILABLE: '0', CLAUDE_PLUGIN_OPTION_FAST_WORKER_BACKEND_ORDER: 'agy,codex,claude' }, () => context.buildContext({ tasks: `- [ ] ${'測'.repeat(100)}\n- [ ] checkout.spec.ts browser journey\n`, proposal: '', fastWorker: 'auto' }));
    assert.strictEqual(result.fields.FAST_WORKER_SELECTED, 'auto');
    assert.ok(result.fields.FAST_WORKER_REJECTED.includes('claude:in-process backend'));
    assert.strictEqual(result.fields.HAS_E2E, 'true');
    assert.ok(Buffer.byteLength(result.fields.TASK_DIGEST, 'utf8') <= 200);
    assert.ok(!result.fields.TASK_DIGEST.includes('\uFFFD'));
    assert.strictEqual(context.detectE2e('- [ ] backend\n', ''), false);
  } finally { fs.rmSync(cli.root, { recursive: true, force: true }); }
});

// Issue #81: the task digest must never shear a title mid-sentence. Short
// lists pass through whole; overflow packs whole titles and appends an explicit
// "…(+N more)" trim report instead of a silent hard cut.
test('taskDigest returns the full joined list unchanged when it fits the budget', () => {
  const digest = context.taskDigest('- [ ] first task\n- [ ] second task\n');
  assert.strictEqual(digest, 'first task; second task');
});

test('taskDigest packs whole titles and reports the trimmed remainder on overflow', () => {
  const tasks = Array.from({ length: 12 }, (_, i) => `- [ ] task number ${i} with a reasonably descriptive sentence`).join('\n');
  const digest = context.taskDigest(tasks);
  assert.ok(Buffer.byteLength(digest, 'utf8') <= 200, 'digest stays within the byte budget');
  assert.ok(/ …\(\+\d+ more\)$/.test(digest), 'digest ends with a boundary-aligned trim marker');
  // Every retained segment is a complete title — no partial/sheared task text.
  const body = digest.replace(/ …\(\+\d+ more\)$/, '');
  for (const segment of body.split('; ')) {
    assert.ok(/^task number \d+ with a reasonably descriptive sentence$/.test(segment), `whole title, got: ${segment}`);
  }
});

test('taskDigest truncates a single oversized leading title with an ellipsis rather than emit nothing', () => {
  const digest = context.taskDigest(`- [ ] ${'長'.repeat(120)}\n- [ ] second\n`);
  assert.ok(Buffer.byteLength(digest, 'utf8') <= 200, 'digest stays within the byte budget');
  assert.ok(digest.endsWith('…'), 'oversized single title is ellipsis-marked');
  assert.ok(!digest.includes('�'), 'truncation respects UTF-8 boundaries');
});

// End-to-end execution, not just source inspection. CLAUDE_PLUGIN_ROOT is
// interpolated into skill markdown but is NOT exported into the Bash tool's
// environment, so this is the only condition under which the analyzer ever
// actually runs — and it used to resolve goal-context.js against the *project*
// root, exit 1, and truncate the block before every FAST_WORKER_* field.
test('analyzer emits the full block when CLAUDE_PLUGIN_ROOT is unset (its real invocation condition)', () => {
  const { spawnSync } = require('node:child_process');
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'opsx-analyze-e2e-')));
  try {
    const change = path.join(repo, 'openspec', 'changes', 'demo-change');
    fs.mkdirSync(change, { recursive: true });
    fs.writeFileSync(path.join(change, 'tasks.md'), '- [ ] 1.1 do the thing\n- [x] 1.2 done\n');
    fs.writeFileSync(path.join(change, 'proposal.md'), '# Demo\n');

    const env = { ...process.env, CLAUDE_PROJECT_DIR: repo };
    delete env.CLAUDE_PLUGIN_ROOT;
    const res = spawnSync('bash',
      [ANALYZER, 'demo-change'],
      { cwd: repo, env, encoding: 'utf8' });

    assert.strictEqual(res.status, 0, `analyzer exited ${res.status}:\n${res.stderr}`);
    const fields = Object.fromEntries(res.stdout.split('\n')
      .filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
    assert.strictEqual(fields.STATUS, 'active');
    for (const key of ['FAST_WORKER_SELECTED', 'FAST_WORKER_AGENT', 'FAST_WORKER_CLAUSE', 'HAS_E2E', 'TASK_DIGEST']) {
      assert.ok(key in fields, `${key} missing — the goal-context tail was truncated:\n${res.stdout}`);
    }
  } finally { fs.rmSync(repo, { recursive: true, force: true }); }
});

test('analyzer forwards --cross-provider as a one-shot auto-selection opt-in', () => {
  const { spawnSync } = require('node:child_process');
  const cli = fakeCli('codex');
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'opsx-analyze-cross-provider-')));
  try {
    const change = path.join(repo, 'openspec', 'changes', 'demo-change');
    fs.mkdirSync(change, { recursive: true });
    fs.writeFileSync(path.join(change, 'tasks.md'), '- [ ] 1.1 do the thing\n');
    fs.writeFileSync(path.join(change, 'proposal.md'), '# Demo\n');

    const env = {
      ...process.env,
      CLAUDE_PROJECT_DIR: repo,
      PATH: `${cli.bin}:${process.env.PATH}`,
      CLAUDE_PLUGIN_OPTION_FAST_WORKER_BACKEND: 'auto',
      CLAUDE_PLUGIN_OPTION_FAST_WORKER_BACKEND_ORDER: 'codex,claude',
      CLAUDE_PLUGIN_OPTION_CROSS_PROVIDER: 'false',
      DHPK_PROJECT_OPTION_CROSS_PROVIDER: 'false',
    };
    delete env.CLAUDE_PLUGIN_ROOT;
    const res = spawnSync('bash', [
      ANALYZER,
      'demo-change', '--worker=auto', '--cross-provider',
    ], { cwd: repo, env, encoding: 'utf8' });

    assert.strictEqual(res.status, 0, `analyzer exited ${res.status}:\n${res.stderr}`);
    assert.ok(res.stdout.includes('FAST_WORKER_CROSS_PROVIDER=true'), res.stdout);
    assert.ok(res.stdout.includes('FAST_WORKER_SCOPE=cross-provider'), res.stdout);
    assert.ok(res.stdout.includes('FAST_WORKER_SELECTED=codex'), res.stdout);
  } finally {
    fs.rmSync(cli.root, { recursive: true, force: true });
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

// Former suite: opsx-goal-budget
{
const fs = require('node:fs');
const path = require('node:path');
const { test, assert } = require('./_lib/tinytest');
const { generateFixture, readFixture } = require('./_lib/opsx-goal-fixtures');

const ROOT = path.join(__dirname, '..');

test('representative goal fixtures stay within the target or hard-stop without output', () => {
  for (const name of ['minimal', 'normal', 'maximum-gate', 'codex', 'smoke']) {
    const result = generateFixture(readFixture(name));
    assert.ok(result.bytes <= 4000, `${name} exceeds hard cap: ${result.bytes}`);
    assert.strictEqual(result.mode, 'full', `${name} should emit normally`);
  }
  assert.ok(generateFixture(readFixture('normal')).bytes <= 3600, 'normal fixture must meet target');
  assert.ok(
    generateFixture(readFixture('normal')).goal.includes('First run ONE Bash orientation command'),
    'fixture must compose the production goal-template literal, not a parallel test-only core',
  );
});

test('verification fixtures emit only their configured Part 3 gates into the measured goal', () => {
  const minimal = generateFixture(readFixture('minimal'));
  const normal = generateFixture(readFixture('normal'));
  const codex = generateFixture(readFixture('codex'));
  const smoke = generateFixture(readFixture('smoke'));

  for (const gate of ['TEST:', 'COVERAGE:', 'BUILD:', 'LINT:', 'SMOKE:']) {
    assert.ok(!minimal.goal.includes(gate), `minimal fixture must omit ${gate}`);
  }
  assert.ok(normal.goal.includes('TEST: node tests/run-all.js --jobs 4 output shows 0 failures.'));
  for (const gate of ['COVERAGE:', 'BUILD:', 'LINT:', 'SMOKE:']) {
    assert.ok(!normal.goal.includes(gate), `normal fixture must omit ${gate}`);
  }
  assert.ok(!normal.goal.includes('dhpk:codex-fast-worker'), 'normal fixture uses the default worker clause');
  assert.ok(codex.goal.includes('dhpk:codex-fast-worker selected; fallback dhpk:agy-fast-worker → dhpk:fast-worker'));
  assert.notStrictEqual(codex.goal, normal.goal, 'the Codex fixture must select a different dispatch clause');
  assert.ok(smoke.goal.includes('SMOKE: read-only runtime probe via dhpk:smoke-tester; require first-line Verdict: PASS and one pasted observed output line, or paste the failing launch command and output.'));
  assert.notStrictEqual(smoke.goal, minimal.goal, 'the smoke fixture must emit its configured smoke gate');
});

test('maximum verification fixture measures each configured command and the exact UTF-8 output', () => {
  const result = generateFixture(readFixture('maximum-gate'));
  assert.strictEqual(result.mode, 'full', 'maximum-gate fixture must stay below the hard cap');
  assert.ok(result.goal.includes('COVERAGE: node tests/run-all.js --coverage output shows 0 failures AND total coverage ≥ 80%.'));
  assert.ok(result.goal.includes('BUILD: npm run build output shows 0 errors.'));
  assert.ok(result.goal.includes('LINT: npm run lint output shows 0 errors.'));
  assert.ok(result.goal.includes('SMOKE: read-only runtime probe via dhpk:smoke-tester; require first-line Verdict: PASS and one pasted observed output line, or paste the failing launch command and output.'));
  assert.ok(result.goal.includes('RED/E2E Playwright → dhpk:e2e-runner;'));
  assert.strictEqual(result.bytes, Buffer.byteLength(result.goal, 'utf8'));
});

test('over-cap fixture uses wc -c measurement and emits Block A without a goal', () => {
  const result = generateFixture(readFixture('over-cap'));
  assert.ok(result.bytes > 4000, `fixture did not exceed cap: ${result.bytes}`);
  assert.strictEqual(result.mode, 'blocked');
  assert.strictEqual(result.goal, '');
  assert.ok(result.blockA.includes(`${result.bytes} UTF-8 bytes`));
});

test('goal fixtures retain required safety tokens and compact gate contracts', () => {
  const goal = generateFixture(readFixture('maximum-gate')).goal;
  for (const token of ['references/execution-bundle/rules/execution-policy-kernel.md', 'hard-rule', 'Unknown skill', 'dhpk:codex-fast-worker', 'dhpk:agy-fast-worker']) {
    assert.ok(goal.includes(token), `missing required safety token: ${token}`);
  }
  for (const token of ['COVERAGE:', 'BUILD:', 'LINT:', 'SMOKE:']) {
    assert.ok(goal.includes(token), `missing gate token: ${token}`);
  }

});
}

// Former suite: opsx-goal-footprint
{
const path = require('node:path');
const { test, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const context = require(path.join(ROOT, 'skills', 'dhpk-opsx-apply-goal', 'scripts', 'goal-context.js'));

function withEnv(values, callback) {
  const keys = [...Object.keys(values), 'CLAUDE_PLUGIN_OPTION_FAST_WORKER_BACKEND', 'CLAUDE_PLUGIN_OPTION_FAST_WORKER_BACKEND_ORDER', 'CLAUDE_PLUGIN_OPTION_FAST_WORKER_FALLBACK', 'DHPK_CLAUDE_BACKEND_AVAILABLE'];
  const prior = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    for (const key of keys) delete process.env[key];
    Object.assign(process.env, values);
    return callback();
  } finally {
    for (const key of keys) prior[key] === undefined ? delete process.env[key] : process.env[key] = prior[key];
  }
}

function build(tasks, values = { PATH: '/usr/bin:/bin' }) {
  return withEnv(values, () => context.buildContext({ tasks, proposal: '', fastWorker: 'codex' }));
}

test('exports the inline limit and ignores checkboxes after Verification headings', () => {
  assert.strictEqual(context.MAX_INLINE_FILES, 2);
  const tasks = [
    '## 9. Verification',
    '- [ ] 9.1 Verification-only task',
    '  - **Mechanical:** yes; **Files:** one.js, two.js, three.js',
  ].join('\n');
  const result = build(tasks);

  assert.deepStrictEqual(context.scanFootprint(tasks), {
    eligible: false,
    inconclusive: false,
    offendingTaskId: null,
  });
  // No eligible batch, but the clause now emits unconditionally: an
  // ineligible-but-conclusive scan still resolves and names a backend.
  assert.ok(result.fields.FAST_WORKER_CLAUSE);
  assert.notStrictEqual(result.fields.FAST_WORKER_STATUS, 'skipped');
});

test('Mechanical no does not create eligibility even with five files', () => {
  const tasks = [
    '- [ ] 1.1 Non-mechanical task',
    '  - **Mechanical:** no; **Files:** a.js, b.js, c.js, d.js, e.js',
  ].join('\n');
  const result = build(tasks);

  // scanFootprint still gates eligibility on Mechanical: yes — this is the
  // classification the test exists to prove, unaffected by unconditional
  // clause emission.
  assert.deepStrictEqual(context.scanFootprint(tasks), {
    eligible: false,
    inconclusive: false,
    offendingTaskId: null,
  });
  assert.ok(result.fields.FAST_WORKER_CLAUSE);
  assert.notStrictEqual(result.fields.FAST_WORKER_STATUS, 'skipped');
});

test('conclusive tasks within the inline limit still resolve the backend and report blocked when unavailable', () => {
  const result = build([
    '- [ ] 1.1 Small mechanical task',
    '  - **Mechanical:** yes; **Files:** a.js, ./b.js',
  ].join('\n'), {
    PATH: '/usr/bin:/bin',
    CLAUDE_PLUGIN_OPTION_FAST_WORKER_BACKEND: 'codex',
    CLAUDE_PLUGIN_OPTION_FAST_WORKER_FALLBACK: 'none',
  });

  // An ineligible batch no longer skips selection: with no sanctioned
  // fallback and an unavailable requested backend, the selector now
  // surfaces as blocked instead of being suppressed as skipped.
  assert.strictEqual(result.fields.FAST_WORKER_STATUS, 'blocked');
  assert.ok(result.fields.FAST_WORKER_CLAUSE.startsWith('BLOCKED fast-worker requested=codex'));
});

test('a mechanical task with three distinct files embeds the clause', () => {
  const tasks = [
    '- [ ] 1.1 Large mechanical task',
    '  - **Mechanical:** yes; **Files:** a.js, b.js, c.js',
  ].join('\n');
  const scan = context.scanFootprint(tasks);
  assert.strictEqual(scan.eligible, true, 'three distinct files exceed the inline limit');

  const result = build(tasks);
  assert.ok(result.fields.FAST_WORKER_CLAUSE);
  assert.notStrictEqual(result.fields.FAST_WORKER_STATUS, 'skipped');
});

test('duplicate paths count once and a genuinely large distinct set is eligible', () => {
  const duplicateTasks = [
    '- [ ] 1.1 Duplicate paths',
    '  - **Mechanical:** yes; **Files:** a.js, ./a.js, a.js, b.js',
  ].join('\n');
  const eligibleTasks = [
    '- [ ] 1.1 Distinct paths',
    '  - **Mechanical:** yes; **Files:** a.js, ./a.js, b.js, c.js',
  ].join('\n');
  const duplicateResult = build(duplicateTasks);
  const eligibleResult = build(eligibleTasks);

  // The dedup proof lives in scanFootprint's classification, not in the
  // clause: 2 distinct files stays ineligible, 3 distinct files is
  // eligible. This is what the test exists to prove and is unaffected by
  // unconditional clause emission.
  assert.deepStrictEqual(context.scanFootprint(duplicateTasks), {
    eligible: false,
    inconclusive: false,
    offendingTaskId: null,
  });
  assert.deepStrictEqual(context.scanFootprint(eligibleTasks), {
    eligible: true,
    inconclusive: false,
    offendingTaskId: null,
  });
  assert.ok(duplicateResult.fields.FAST_WORKER_CLAUSE);
  assert.notStrictEqual(duplicateResult.fields.FAST_WORKER_STATUS, 'skipped');
  assert.ok(eligibleResult.fields.FAST_WORKER_CLAUSE);
});

test('Files none is conclusive and contributes zero files', () => {
  const result = build([
    '- [ ] 1.1 No files task',
    '  - **Mechanical:** yes; **Files:** none',
  ].join('\n'));

  assert.deepStrictEqual(context.scanFootprint([
    '- [ ] 1.1 No files task',
    '  - **Mechanical:** yes; **Files:** none',
  ].join('\n')), {
    eligible: false,
    inconclusive: false,
    offendingTaskId: null,
  });
  assert.ok(result.fields.FAST_WORKER_CLAUSE);
  assert.notStrictEqual(result.fields.FAST_WORKER_STATUS, 'skipped');
});

test('a single-file mechanical task is ineligible but still resolves and names an agent', () => {
  const tasks = [
    '- [ ] 1.1 Single file mechanical task',
    '  - **Mechanical:** yes; **Files:** a.js',
  ].join('\n');

  assert.deepStrictEqual(context.scanFootprint(tasks), {
    eligible: false,
    inconclusive: false,
    offendingTaskId: null,
  });

  const result = withEnv({ PATH: '/usr/bin:/bin' }, () => context.buildContext({ tasks, proposal: '', fastWorker: 'claude' }));

  assert.strictEqual(result.fields.FAST_WORKER_STATUS, 'selected');
  assert.notStrictEqual(result.fields.FAST_WORKER_STATUS, 'skipped');
  assert.ok(result.fields.FAST_WORKER_CLAUSE.includes('dhpk:fast-worker'));
});

test('inconclusive footprint metadata fails open and names the first offending task', () => {
  const cases = [
    ['1. missing metadata', '- [ ] 1. missing metadata'],
    ['1. unrelated metadata', '- [ ] 1. unrelated metadata\nnot metadata'],
    ['1. malformed metadata', '- [ ] 1. malformed metadata\n  - Mechanical: yes; Files: a.js, b.js, c.js'],
    ['1. glob path', '- [ ] 1. glob path\n  - **Mechanical:** yes; **Files:** src/*.js'],
    ['1. directory path', '- [ ] 1. directory path\n  - **Mechanical:** yes; **Files:** src/'],
    ['1. existing directory', '- [ ] 1. existing directory\n  - **Mechanical:** yes; **Files:** skills'],
    ['1. absolute path', '- [ ] 1. absolute path\n  - **Mechanical:** yes; **Files:** /etc/passwd'],
    ['1. traversal path', '- [ ] 1. traversal path\n  - **Mechanical:** yes; **Files:** ../outside.js'],
    ['1. invalid non-mechanical files', '- [ ] 1. invalid non-mechanical files\n  - **Mechanical:** no; **Files:** '],
  ];

  for (const [taskId, tasks] of cases) {
    // The scan's own classification, asserted directly: the warning below is
    // downstream of it, so checking both keeps a silent misclassification from
    // hiding behind a warning that happens to still fire.
    const scan = context.scanFootprint(tasks);
    assert.strictEqual(scan.inconclusive, true, taskId);
    assert.strictEqual(scan.offendingTaskId, taskId, taskId);

    const result = build(tasks);
    assert.ok(result.fields.FAST_WORKER_CLAUSE, taskId);
    assert.ok(result.warning.includes(`[opsx-goal] WARN: footprint scan inconclusive at task '${taskId}'`), taskId);
  }
});
}

// Former suite: opsx-goal-policy-fallback
{
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, assert } = require('./_lib/tinytest');
const {
  DISPATCH_TRUE_FENCE,
  DISPATCH_FALSE_FENCE,
  generateFixture,
  readFixture,
} = require('./_lib/opsx-goal-fixtures');

const FENCES = { 'DISPATCH_ON=true': DISPATCH_TRUE_FENCE, 'DISPATCH_ON=false': DISPATCH_FALSE_FENCE };

function orientationCommand(fence) {
  const start = fence.indexOf('`');
  const end = fence.indexOf('`', start + 1);
  assert.ok(start >= 0 && end > start, 'orientation command fence missing');
  return fence.slice(start + 1, end);
}

test('orientation reads the kernel and selected route reference without loading full policy', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-goal-orientation-'));
  try {
    const skill = path.join(tmp, 'skill root');
    const project = path.join(tmp, 'project');
    fs.mkdirSync(path.join(skill, 'references', 'execution-bundle', 'rules'), { recursive: true });
    fs.mkdirSync(path.join(skill, 'references', 'execution-bundle', 'skills', 'flow-guide', 'references'), { recursive: true });
    fs.mkdirSync(path.join(project, '.claude-plugin'), { recursive: true });
    fs.writeFileSync(path.join(project, '.claude-plugin', 'plugin.json'), '{}');
    fs.writeFileSync(path.join(skill, 'references', 'execution-bundle', 'rules', 'execution-policy-kernel.md'), 'KERNEL\n');
    fs.writeFileSync(path.join(skill, 'references', 'execution-bundle', 'skills', 'flow-guide', 'references', 'implementation-dispatch.md'), 'DISPATCH\n');
    fs.writeFileSync(path.join(skill, 'references', 'execution-bundle', 'rules', 'execution-policy.md'), 'FULL_POLICY\n');
    const rootQuote = spawnSync('bash', ['-c', 'printf "%q" "$1"', 'quote', skill], { encoding: 'utf8' }).stdout;
    const env = { ...process.env, CLAUDE_PLUGIN_ROOT: path.join(tmp, 'hostile plugin') };
    const off = spawnSync('bash', ['-c', orientationCommand(FENCES['DISPATCH_ON=false']).replaceAll('<SKILL_ROOT_Q>', rootQuote)], {
      cwd: project, env, encoding: 'utf8',
    });
    const on = spawnSync('bash', ['-c', orientationCommand(FENCES['DISPATCH_ON=true']).replaceAll('<SKILL_ROOT_Q>', rootQuote)], {
      cwd: project, env, encoding: 'utf8',
    });
    assert.strictEqual(off.status, 0, off.stderr);
    assert.strictEqual(on.status, 0, on.stderr);
    assert.strictEqual(off.stdout, 'KERNEL\n');
    assert.strictEqual(on.stdout, 'KERNEL\nDISPATCH\n');
    assert.ok(!off.stdout.includes('FULL_POLICY'));
    assert.ok(!on.stdout.includes('FULL_POLICY'));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});



test('DISPATCH_ON=false goal stays under the hard cap and the normal target', () => {
  const result = generateFixture(readFixture('no-dispatch'));
  assert.strictEqual(result.mode, 'full', 'no-dispatch fixture should emit normally');
  assert.ok(result.bytes <= 4000, `no-dispatch exceeds hard cap: ${result.bytes}`);
  assert.ok(result.bytes <= 3600, `no-dispatch exceeds the normal target: ${result.bytes}`);
});
}



run('opsx-goal-analyze');
