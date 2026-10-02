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
const CONTRACT = fs.readFileSync(path.join(ROOT, 'skills', 'dhpk-opsx-apply-goal', 'references', 'gate-contracts.md'), 'utf8');

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
  for (const token of ['UTF-8 bytes', '3,600', '4,000', 'Required gates']) {
    assert.ok(CONTRACT.includes(token), `gate contract reference missing: ${token}`);
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

// The clause shared verbatim by both dispatch modes (design.md decision 4).
// This is a hand-typed literal, not extracted from the template — it must be
// kept byte-identical to goal-templates.md's DISPATCH_ON=true/false fences or
// the assertions below will fail, which is the intended tripwire against the
// two branches drifting apart.
const FALLBACK_CLAUSE = 'never filesystem-scan; every reviewer dispatch\nstill gets a fresh .claude/artifacts/reviews/ artifact, never\nreply-only';

function orientationCommand(fence) {
  const start = fence.indexOf('`');
  const end = fence.indexOf('`', start + 1);
  assert.ok(start >= 0 && end > start, 'orientation command fence missing');
  return fence.slice(start + 1, end);
}

test('both dispatch modes resolve the compact kernel through the same local Skill candidate chain', () => {
  for (const [mode, fence] of Object.entries(FENCES)) {
    const order = ['p=<SKILL_ROOT_Q>', 'q references/execution-bundle/rules/execution-policy-kernel.md', 'POLICY-UNRESOLVED'];
    let cursor = -1;
    for (const token of order) {
      const idx = fence.indexOf(token);
      assert.ok(idx >= 0, `${mode}: missing candidate-chain token "${token}"`);
      assert.ok(idx > cursor, `${mode}: token "${token}" out of precedence order`);
      cursor = idx;
    }
  }
});

test('the local Skill candidate is root-bound and never scans the filesystem', () => {
  for (const [mode, fence] of Object.entries(FENCES)) {
    assert.ok(!/find\s/.test(fence), `${mode}: must not invoke find`);
    assert.ok(!fence.includes('..'), `${mode}: must not reference a parent directory`);
    assert.ok(!/\*\*/.test(fence), `${mode}: must not use a recursive glob`);
    assert.ok(fence.includes('p=<SKILL_ROOT_Q>'), `${mode}: missing physical Skill root placeholder`);
    assert.ok(fence.includes('cat "$p/$1"'), `${mode}: missing Skill-root-bound read`);
    assert.ok(!fence.includes('CLAUDE_PLUGIN_ROOT'), `${mode}: must not consult ambient plugin root`);
    assert.ok(!fence.includes('ls -dt'), `${mode}: must not scan plugin cache candidates`);
  }
});

test('dispatch-on orientation adds only the implementation route reference', () => {
  assert.ok(FENCES['DISPATCH_ON=true'].includes('implementation-dispatch.md'));
  assert.ok(!FENCES['DISPATCH_ON=false'].includes('implementation-dispatch.md'));
  for (const fence of Object.values(FENCES)) {
    assert.ok(!fence.includes('cat ./rules/execution-policy.md'), 'orientation must not cat the full policy');
  }
});

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

test('POLICY-UNRESOLVED remains the terminal fallback and still proceeds on inline gates', () => {
  for (const [mode, fence] of Object.entries(FENCES)) {
    assert.ok(fence.trimEnd().includes('POLICY-UNRESOLVED') || fence.includes('POLICY-UNRESOLVED` —'), `${mode}: missing POLICY-UNRESOLVED echo`);
    assert.ok(/never filesystem-scan/.test(fence), `${mode}: missing no-filesystem-scan wording`);
  }
});

test('both dispatch modes carry an identical fallback reviewer-artifact clause', () => {
  for (const [mode, fence] of Object.entries(FENCES)) {
    assert.ok(fence.includes(FALLBACK_CLAUSE), `${mode}: does not carry the shared fallback clause verbatim`);
  }
});



test('DISPATCH_ON=false goal stays under the hard cap and the normal target', () => {
  const result = generateFixture(readFixture('no-dispatch'));
  assert.strictEqual(result.mode, 'full', 'no-dispatch fixture should emit normally');
  assert.ok(result.bytes <= 4000, `no-dispatch exceeds hard cap: ${result.bytes}`);
  assert.ok(result.bytes <= 3600, `no-dispatch exceeds the normal target: ${result.bytes}`);
});
}

// BEGIN historical source: tests/opsx-apply-goal-guardrails.test.js
// Former suite: opsx-apply-goal-guardrails
{
const fs = require('node:fs');
const path = require('node:path');
const { test, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const SKILL_DIR = path.join(ROOT, 'skills', 'dhpk-opsx-apply-goal');

// The skill was refactored into SKILL.md + references/*.md (progressive
// disclosure). Package-level guardrail phrases assert the safety clauses exist
// somewhere in the skill *package*; read the whole package: SKILL.md plus every
// references/*.md.
const refsDir = path.join(SKILL_DIR, 'references');
const skill = [
  fs.readFileSync(path.join(SKILL_DIR, 'SKILL.md'), 'utf8'),
  ...fs
    .readdirSync(refsDir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => fs.readFileSync(path.join(refsDir, f), 'utf8')),
].join('\n');

// Since harvest-advice-20260712 the emitted Part 0 is a bounded kickoff: the
// behavioral elaborations (premise routing, doubt cycle, CODEX high-stakes peer
// path, expanded triggers, session-end self-check) moved to
// rules/execution-policy.md and bind goal sessions via the orientation read.
// Assert the inline survivors inside the emitted DISPATCH_ON=true block
// specifically (the doc prose around it may legitimately *name* the relocated
// concepts), and assert the relocated phrases in the policy file.
const goalTemplatesRaw = fs.readFileSync(path.join(refsDir, 'goal-templates.md'), 'utf8');
// The template blocks are hard-wrapped prose — normalize whitespace so phrase
// assertions cannot be broken by a line-wrap position change.
const flat = (s) => s.replace(/\s+/g, ' ');
const goalTemplates = flat(goalTemplatesRaw);

function readGoalSections() {
  const markers = [
    ['dispatch-off', '**`DISPATCH_ON=false`**'],
    ['dispatch-on', '**`DISPATCH_ON=true`**'],
    ['part-1', '## Part 1 (always)'],
    ['part-2', '## Part 2 (always'],
    ['part-3', '## Part 3'],
    ['part-4', '## Part 4 (always'],
  ];
  const offsets = markers.map(([name, marker]) => {
    const offset = goalTemplatesRaw.indexOf(marker);
    assert.ok(offset >= 0, `goal template is missing ${name} marker: ${marker}`);
    return offset;
  });
  for (let index = 1; index < offsets.length; index += 1) {
    assert.ok(offsets[index - 1] < offsets[index],
      `${markers[index][0]} must follow ${markers[index - 1][0]}`);
  }

  const [dispatchOff, dispatchOn, part1, part2, part3, part4] = offsets;
  return {
    noDispatchPart0: flat(goalTemplatesRaw.slice(dispatchOff, dispatchOn)),
    dispatchPart0: flat(goalTemplatesRaw.slice(dispatchOn, part1)),
    part2: flat(goalTemplatesRaw.slice(part2, part3)),
    part3: flat(goalTemplatesRaw.slice(part3, part4)),
    part4: flat(goalTemplatesRaw.slice(part4)),
  };
}

test('goal dispatch mode enables the runtime batch gate and carries cwd-safe Bash guidance', () => {
  const { dispatchPart0 } = readGoalSections();
  assert.ok(dispatchPart0.includes('DHPK_ORCHESTRATION_DISPATCH=on'));
  assert.ok(dispatchPart0.includes('absolute paths') && dispatchPart0.includes('git -C'));
});

test('dispatch-on Part 0 names the repo launcher and requires an explicit READY packet', () => {
  const { dispatchPart0, noDispatchPart0 } = readGoalSections();
  const launcher = 'node <SKILL_ROOT_Q>/scripts/launch-cli-dispatch.js';
  assert.ok(dispatchPart0.includes(launcher), 'dispatch-on roster must name the repo-owned launcher command');
  for (const field of [
    'dispatching_agent', 'execution_provider', 'requested_role', 'mode', 'task_id', 'attempt_id',
    'workdir', 'prompt', 'scope', 'config',
  ]) {
    assert.ok(dispatchPart0.includes(field), `dispatch-on launcher packet missing ${field}`);
  }
  assert.ok(dispatchPart0.includes('distinct from'),
    'dispatch-on packet must keep dispatching_agent distinct from execution_provider');
  assert.ok(dispatchPart0.includes('READY'), 'launcher must require a READY context result');
  assert.ok(dispatchPart0.includes('never infer authority'), 'launcher must not infer execution authority');
  assert.ok(dispatchPart0.includes('runtime binding') && dispatchPart0.includes('execution-policy decision'),
    'launcher instruction must preserve runtime binding and the execution-policy decision');
  assert.ok(!noDispatchPart0.includes('launch-cli-dispatch.js'),
    'dispatch-off Part 0 must not expose the CLI dispatch launcher');
  assert.ok(!noDispatchPart0.includes('dispatching_agent') && !noDispatchPart0.includes('execution_provider'),
    'dispatch-off Part 0 must not carry the CLI dispatch packet');
});
const policy = flat(fs.readFileSync(path.join(ROOT, 'rules', 'execution-policy.md'), 'utf8'));

test('retired --codex has no goal-template ON/OFF branch and keeps explicit replacements', () => {
  const { dispatchPart0 } = readGoalSections();
  for (const phrase of ['<CODEX_STATEMENT>', '### CODEX_STATEMENT', 'CODEX is ON', 'CODEX is OFF']) {
    assert.ok(!goalTemplates.includes(phrase), `obsolete goal-template branch remains: ${phrase}`);
  }
  assert.ok(skill.includes('DEPRECATED_CODEX_FLAG'),
    'analyzer deprecation outcome must be documented');
  assert.ok(skill.includes('--worker=codex'),
    'retired --codex replacement must retain the explicit Codex worker selector');
  assert.ok(skill.includes('--second-opinion=codex-exec'),
    'retired --codex replacement must name the explicit CLI second opinion');
  // the expanded trigger list and self-check procedure reside in the policy
  for (const phrase of [
    'first-seen query/repository pattern',
    'framework-internal hack',
    'explicit-rule deferral',
    'dispatched `codex-bridge` 0 times',
  ]) {
    assert.ok(policy.includes(phrase), `execution-policy missing relocated CODEX phrase: ${phrase}`);
  }
  assert.ok(dispatchPart0.includes('codex-bridge only as explicit escalation'),
    'template must retain explicit codex-bridge escalation wording');
});

test('relocated dispatch elaborations exist in execution-policy, not the emitted Part 0', () => {
  const { dispatchPart0 } = readGoalSections();
  for (const phrase of [
    'when unsure between inline and a worker, dispatch',
    'scratch executable probe',
    'multi-file doc-consistency',
    'whole implement-step footprint',
    'orientation step',
  ]) {
    assert.ok(policy.includes(phrase), `execution-policy missing relocated dispatch phrase: ${phrase}`);
  }
  for (const phrase of ['premise', 'when unsure', 'doubt cycle', 'Repository Discovery Gate', 'verify its output']) {
    assert.ok(!dispatchPart0.includes(phrase),
      `emitted DISPATCH_ON=true Part 0 must not restate relocated elaboration: ${phrase}`);
  }
});

test('emitted Part 0 carries the compact directive inline survivors', () => {
  const { dispatchPart0 } = readGoalSections();
  assert.ok(dispatchPart0.includes('You are the orchestrator'), 'missing orchestrator naming');
  assert.ok(dispatchPart0.includes('repo="<project>"') && dispatchPart0.includes('gitnexus'),
    'missing explicit multi-repo gitnexus guidance');
  for (const role of ['<FAST_WORKER_CLAUSE>', 'dhpk:deep-reasoner', 'dhpk:tdd-guide', '<E2E_ROSTER_CLAUSE>']) {
    assert.ok(dispatchPart0.includes(role), `missing roster role: ${role}`);
  }
  assert.ok(dispatchPart0.includes('<TASK_DIGEST>'), 'missing bounded task digest placeholder');
  assert.ok(!dispatchPart0.includes('head -40 openspec/changes/<CHANGE_ID>/tasks.md'),
    'kickoff must not duplicate the tasks.md orientation read');
  assert.ok(dispatchPart0.includes('ONE consolidated parallel batch per wave'),
    'missing consolidated reviewer-wave contract');
  assert.ok(dispatchPart0.includes('codex-bridge only as explicit escalation, at most once per change'),
    'missing codex-bridge escalation bound');
  assert.ok(/never\s+general-purpose/.test(dispatchPart0), 'missing never-general-purpose rule');
  assert.ok(dispatchPart0.includes('≤2-file whole-implement-step'), 'missing inline footprint bound');
  assert.ok(dispatchPart0.includes('bookkeeping'), 'missing orchestrator bookkeeping carve-out');
  // self-locating policy pointer, read by the orientation command
  assert.ok(dispatchPart0.includes('p=<SKILL_ROOT_Q>')
    && dispatchPart0.includes('references/execution-bundle/rules/execution-policy-kernel.md')
    && !dispatchPart0.includes('CLAUDE_PLUGIN_ROOT'),
    'missing self-locating execution-policy kernel pointer');
  assert.ok(dispatchPart0.includes('never filesystem-scan'), 'missing never-filesystem-scan clause');
});

test('goal generator documents fast-worker override, task digest, and conditional e2e composition', () => {
  for (const phrase of [
    '--worker=<claude|codex|agy|auto>',
    'flag > userConfig > shipped default',
    'HAS_E2E',
    '200 UTF-8 bytes',
    '<FAST_WORKER_CLAUSE>',
    '<TASK_DIGEST>',
    '<E2E_ROSTER_CLAUSE>',
  ]) {
    assert.ok(skill.includes(phrase), `missing goal-generation contract: ${phrase}`);
  }
});

test('flow-drive carries the implementation route while flow-guide owns workflow branches', () => {
  const routeTable = fs.readFileSync(
    path.join(ROOT, 'skills', 'flow-guide', 'references', 'route-table.json'),
    'utf8',
  );
  assert.ok(routeTable.includes('"id": "flow-guide"'));
  assert.ok(routeTable.includes('"id": "dhpk-opsx-apply-goal"'));
  assert.ok(!routeTable.includes('dhpk-bug-fix'));
  assert.ok(!routeTable.includes('dhpk-feature-dev'));

  assert.strictEqual(fs.existsSync(path.join(ROOT, 'commands', 'do.md')), false);
  const drive = fs.readFileSync(path.join(ROOT, 'skills', 'flow-drive', 'SKILL.md'), 'utf8');
  assert.match(drive, /route[\s\S]*implement/);
  const guide = fs.readFileSync(path.join(ROOT, 'skills', 'flow-guide', 'SKILL.md'), 'utf8');
  assert.match(guide, /`help`[\s\S]*`route`[\s\S]*`rules`[\s\S]*`next`[\s\S]*`close`/);
  assert.match(guide, /route-result\.v3/);
  assert.doesNotMatch(guide, /dhpk-(bug-fix|feature-dev)/);
});

test('Part 0 and verification checklist carve hard-rule conflicts out of unattended confirmation', () => {
  const { dispatchPart0 } = readGoalSections();
  assert.ok(skill.includes('without stopping for confirmation'), 'baseline kickoff phrase missing');
  assert.ok(skill.includes('ordinary implementation judgment calls only'),
    'missing hard-rule carve-out wording');
  assert.ok(skill.includes('never an explicit project hard-rule conflict'),
    'missing explicit hard-rule conflict limit');
  assert.ok(dispatchPart0.includes('project hard rules cannot be deferred because a prior design chose a cheaper implementation'),
    'missing inline design-snapshot hard-rule guardrail');
});

test('Part 2 and Part 4 include unresolved reviewer-finding and hard-rule escalation gates', () => {
  const { part2 } = readGoalSections();
  assert.ok(part2.includes('no CRITICAL reviewer finding for `<CHANGE_ID>` remains unfixed'),
    'missing unresolved CRITICAL finding gate');
  assert.ok(!skill.includes('.unresolved-verdict'),
    'retired unresolved-verdict sidecar wording remains');
  assert.ok(skill.includes('openspec/changes/<CHANGE_ID>/.hard-rule-escalation.md'),
    'missing hard-rule escalation artifact path');
  assert.ok(skill.includes('rule, conflicting decision with file:line evidence, and why compliance is blocked'),
    'missing hard-rule escalation contents');
});

test('stop and verification clauses use mechanical formulations, not judgment adjectives', () => {
  const { part3, part4 } = readGoalSections();
  // turn budget: finish the current item, no half-edited file (no "next safe point")
  assert.ok(part4.includes('stop after finishing the current tasks.md item'),
    'missing finish-current-item turn checkpoint');
  assert.ok(part4.includes('no half-edited file'), 'missing no-half-edited-file clause');
  assert.ok(!part4.includes('next safe point'), 'stale "next safe point" phrasing remains');
  // pre-existing failure/warning: git stash reappearance + named in summary (no "unrelated" judgment)
  assert.ok(/reproduces identically on a `git stash`-ed clean HEAD/.test(part3),
    'missing mechanical git-stash pre-existing test');
  assert.ok(part3.includes('named in the completion summary'),
    'missing completion-summary naming requirement');
  assert.ok(!part3.includes('unrelated to the change'),
    'stale "unrelated to the change" judgment clause remains');
  // smoke evidence: Verdict line + observed output line (no "key observed value")
  assert.ok(part3.includes('at least one observed output line'),
    'missing observed-output-line smoke evidence requirement');
  assert.ok(!part3.includes('key observed value'),
    'stale "key observed value" phrasing remains');
});

test('smoke gate: flags, HAS_SMOKE conditioning, Block A row, and self-escaping hatch are wired', () => {
  // flags parsed
  assert.ok(skill.includes('--smoke') && skill.includes('--no-smoke'),
    'missing --smoke/--no-smoke flags');
  assert.ok(skill.includes('HAS_SMOKE'), 'missing HAS_SMOKE detection flag');
  // Part 3 line emitted iff HAS_SMOKE=true
  assert.ok(skill.includes('ONLY when `HAS_SMOKE=true`') || skill.includes('only when `HAS_SMOKE=true`'),
    'smoke gate line is not conditioned on HAS_SMOKE=true');
  // PASS satisfies, and the FAIL-does-not-satisfy rule is stated
  assert.ok(skill.includes('Verdict: PASS'), 'missing Verdict: PASS satisfy condition');
  assert.ok(skill.includes('Verdict: FAIL') && /does NOT satisfy the gate/.test(skill),
    'missing FAIL-does-not-satisfy rule');
  // Block A enum states (on/off, both flag and signal variants)
  for (const state of ['on (signal)', 'on (--smoke)', 'off (--no-smoke)', 'off (no strong signal, hint emitted)']) {
    assert.ok(skill.includes(state), `missing Block A smoke-gate state: ${state}`);
  }
  // self-escaping hatch (branch b) is discoverable in the Part 3 gate text
  assert.ok(skill.includes('could not be driven this session'),
    'missing self-escaping hatch note wording');
  assert.ok(skill.includes("failing command's output"),
    'missing escape-hatch evidence requirement');
});

test('4000-char paste guard: single variant, measured length, hard-stop wiring', () => {
  // threshold + Block A row
  assert.ok(skill.includes('4000'), 'missing 4000-character threshold reference');
  assert.ok(skill.includes('Goal length'), 'missing Block A Goal length row');
  assert.ok(skill.includes('GOAL_MODE'), 'missing GOAL_MODE state tracking');
  for (const state of ['full', 'BLOCKED']) {
    assert.ok(skill.includes(state), `missing GOAL_MODE state: ${state}`);
  }
  // the compact-variant machinery is gone: no compacted mode, no compact template sections
  assert.ok(!skill.includes('compacted'), 'stale compacted GOAL_MODE remains');
  assert.ok(!skill.includes('compact variant'), 'stale compact template variant section remains');
  assert.ok(skill.includes('should-never-fire'), 'missing should-never-fire regression semantics');
  // hard-block behavior and operator guidance
  assert.ok(skill.includes('No /goal command was emitted this run'), 'missing hard-stop notice');
  assert.ok(skill.includes('do **not** print Block B, C, or C2') || skill.includes('do not print Block B, C, or C2'),
    'missing suppression of Block B/C/C2 when blocked');
  for (const bullet of [
    'turn off the orchestration_dispatch project setting',
    'drop --smoke / pass --no-smoke (removes the smoke-gate line)',
    'fewer verification gates detected',
  ]) {
    assert.ok(skill.includes(bullet), `missing hard-stop guidance bullet: ${bullet}`);
  }
  assert.ok(!skill.includes('drop --codex (removes the CODEX statement)'),
    'hard-stop guidance must not offer the retired CODEX statement branch');
});
}
// END historical source: tests/opsx-apply-goal-guardrails.test.js

run('opsx-goal-analyze');
