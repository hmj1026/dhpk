'use strict';

const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const context = require(path.join(ROOT, 'skills', 'opsx-apply-goal', 'scripts', 'goal-context.js'));

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
  assert.strictEqual(result.fields.FAST_WORKER_CLAUSE, '');
  assert.strictEqual(result.fields.FAST_WORKER_STATUS, 'skipped');
});

test('Mechanical no does not create eligibility even with five files', () => {
  const result = build([
    '- [ ] 1.1 Non-mechanical task',
    '  - **Mechanical:** no; **Files:** a.js, b.js, c.js, d.js, e.js',
  ].join('\n'));

  assert.strictEqual(result.fields.FAST_WORKER_CLAUSE, '');
  assert.strictEqual(result.fields.FAST_WORKER_STATUS, 'skipped');
});

test('conclusive tasks within the inline limit skip an unavailable backend', () => {
  const result = build([
    '- [ ] 1.1 Small mechanical task',
    '  - **Mechanical:** yes; **Files:** a.js, ./b.js',
  ].join('\n'), {
    PATH: '/usr/bin:/bin',
    CLAUDE_PLUGIN_OPTION_FAST_WORKER_BACKEND: 'codex',
    CLAUDE_PLUGIN_OPTION_FAST_WORKER_FALLBACK: 'none',
  });

  assert.strictEqual(result.fields.FAST_WORKER_CLAUSE, '');
  assert.strictEqual(result.fields.FAST_WORKER_STATUS, 'skipped');
  assert.notStrictEqual(result.fields.FAST_WORKER_STATUS, 'blocked');
});

test('a mechanical task with three distinct files embeds the clause', () => {
  const result = build([
    '- [ ] 1.1 Large mechanical task',
    '  - **Mechanical:** yes; **Files:** a.js, b.js, c.js',
  ].join('\n'));

  assert.ok(result.fields.FAST_WORKER_CLAUSE);
  assert.notStrictEqual(result.fields.FAST_WORKER_STATUS, 'skipped');
});

test('duplicate paths count once and a genuinely large distinct set is eligible', () => {
  const duplicateResult = build([
    '- [ ] 1.1 Duplicate paths',
    '  - **Mechanical:** yes; **Files:** a.js, ./a.js, a.js, b.js',
  ].join('\n'));
  const eligibleResult = build([
    '- [ ] 1.1 Distinct paths',
    '  - **Mechanical:** yes; **Files:** a.js, ./a.js, b.js, c.js',
  ].join('\n'));

  assert.strictEqual(duplicateResult.fields.FAST_WORKER_CLAUSE, '');
  assert.strictEqual(duplicateResult.fields.FAST_WORKER_STATUS, 'skipped');
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
  assert.strictEqual(result.fields.FAST_WORKER_CLAUSE, '');
  assert.strictEqual(result.fields.FAST_WORKER_STATUS, 'skipped');
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
    const result = build(tasks);
    assert.ok(result.fields.FAST_WORKER_CLAUSE, taskId);
    assert.ok(result.warning.includes(`[opsx-goal] WARN: footprint scan inconclusive at task '${taskId}'`), taskId);
  }
});

run('opsx-goal-footprint');
