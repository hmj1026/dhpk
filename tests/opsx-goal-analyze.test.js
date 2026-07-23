'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const analyzer = fs.readFileSync(path.join(ROOT, 'skills', 'opsx-apply-goal', 'scripts', 'analyze-change.sh'), 'utf8');
const context = require(path.join(ROOT, 'skills', 'opsx-apply-goal', 'scripts', 'goal-context.js'));

function fakeCli(name) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'opsx-context-')));
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, name), '#!/usr/bin/env bash\nexit 0\n', { mode: 0o755 });
  return { root, bin };
}

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

test('analyzer strips the invocation override and delegates deterministic context generation', () => {
  assert.ok(analyzer.includes('--worker=*'));
  assert.ok(analyzer.includes('goal-context.js'));
});

test('flag overrides config and output carries availability, fallback, and order', () => {
  const cli = fakeCli('agy');
  try {
    const result = withEnv({ PATH: `${cli.bin}:/usr/bin:/bin`, CLAUDE_PLUGIN_OPTION_FAST_WORKER_BACKEND: 'claude', CLAUDE_PLUGIN_OPTION_FAST_WORKER_BACKEND_ORDER: 'codex,agy,claude', CLAUDE_PLUGIN_OPTION_FAST_WORKER_FALLBACK: 'claude' }, () => context.buildContext({ tasks: '- [ ] backend\n', proposal: '', fastWorker: 'agy' }));
    assert.strictEqual(result.fields.FAST_WORKER_SELECTED, 'agy');
    assert.strictEqual(result.fields.FAST_WORKER_AGENT, 'dhpk:agy-fast-worker');
    assert.strictEqual(result.fields.FAST_WORKER_ORDER, 'codex,agy,claude');
    assert.strictEqual(result.fields.FAST_WORKER_FALLBACK, 'claude');
    assert.ok(result.fields.FAST_WORKER_CLAUSE.includes('agy executable available'));
  } finally { fs.rmSync(cli.root, { recursive: true, force: true }); }
});

test('invalid flag warns and falls back to configured resolution even when CODEX review mode is off', () => {
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

test('auto reports rejected candidates and UTF-8-safe digest plus conditional E2E', () => {
  const cli = fakeCli('codex');
  try {
    const result = withEnv({ PATH: `${cli.bin}:/usr/bin:/bin`, DHPK_CLAUDE_BACKEND_AVAILABLE: '0', CLAUDE_PLUGIN_OPTION_FAST_WORKER_BACKEND_ORDER: 'agy,codex,claude' }, () => context.buildContext({ tasks: `- [ ] ${'測'.repeat(100)}\n- [ ] checkout.spec.ts browser journey\n`, proposal: '', fastWorker: 'auto' }));
    assert.strictEqual(result.fields.FAST_WORKER_SELECTED, 'codex');
    assert.ok(result.fields.FAST_WORKER_REJECTED.includes('agy:missing executable: agy'));
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
      [path.join(ROOT, 'skills', 'opsx-apply-goal', 'scripts', 'analyze-change.sh'), 'demo-change'],
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

run('opsx-goal-analyze');
