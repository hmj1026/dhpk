'use strict';

const { test, run, assert } = require('./_lib/tinytest');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { resolveNext, formatNextAction } = require('../scripts/lib/skill-next-map');

const terminal = { PASS: 'none', FAIL: 'none', BLOCKED: 'none', NOT_RUN: 'none', UNAVAILABLE: 'none' };
const skills = {
  'tdd-workflow': { values: { 'dhpk-next': { ...terminal, PASS: 'repo-verify', FAIL: 'tdd-workflow' } } },
  'repo-verify': { values: { 'dhpk-next': { ...terminal, PASS: 'change-verdict:code' }, 'dhpk-invocation-class': 'implicit-eligible' } },
  'doc-maintain': { values: { 'dhpk-modes': ['update', 'codemap', 'refactor'], 'dhpk-next': { ...terminal, 'update:PASS': 'git-smart-commit' } } },
  'git-smart-commit': { values: { 'dhpk-next': terminal, 'dhpk-invocation-class': 'explicit-only' } },
  'change-verdict': { values: { 'dhpk-modes': ['code', 'docs'], 'dhpk-next': { ...terminal, 'code:PASS': 'repo-verify', 'docs:PASS': 'git-smart-commit' } } },
};

test('declared PASS resolves to the canonical target identity', () => {
  const target = resolveNext(skills, { name: 'tdd-workflow', state: 'PASS' });
  assert.strictEqual(target.name, 'repo-verify');
  assert.strictEqual(target.terminal, false);
});

test('a mode-specific state wins over the generic state', () => {
  assert.strictEqual(resolveNext(skills, { name: 'change-verdict', mode: 'docs', state: 'PASS' }).name, 'git-smart-commit');
  const noModeList = { source: { values: { 'dhpk-next': { PASS: 'target:fast' } } }, target: { values: {} } };
  assert.strictEqual(resolveNext(noModeList, { name: 'source', state: 'PASS' }).mode, 'fast');
});

test('none resolves as terminal without looking up a skill named none', () => {
  assert.strictEqual(resolveNext(skills, { name: 'tdd-workflow', state: 'BLOCKED' }).terminal, true);
  const absent = { source: { values: { 'dhpk-next': { PASS: 'constructor' } } } };
  assert.strictEqual(resolveNext(absent, { name: 'source', state: 'PASS' }).terminal, true);
  const present = { ...absent, constructor: { values: {} } };
  assert.strictEqual(resolveNext(present, { name: 'source', state: 'PASS' }).name, 'constructor');
  const inherited = Object.create({ source: { values: { 'dhpk-next': { PASS: 'target' } } } });
  inherited.target = { values: {} };
  assert.strictEqual(resolveNext(inherited, { name: 'source', state: 'PASS' }).terminal, true);
  const inheritedTarget = Object.assign(Object.create({ target: { values: {} } }), { source: { values: { 'dhpk-next': { PASS: 'target' } } } });
  assert.strictEqual(resolveNext(inheritedTarget, { name: 'source', state: 'PASS' }).terminal, true);
});

test('doc-maintain update has its own successor while other modes stay terminal', () => {
  assert.strictEqual(resolveNext(skills, { name: 'doc-maintain', mode: 'update', state: 'PASS' }).name, 'git-smart-commit');
  for (const mode of ['codemap', 'refactor', 'unknown']) {
    assert.strictEqual(resolveNext(skills, { name: 'doc-maintain', mode, state: 'PASS' }).terminal, true);
  }
});

test('explicit-only target retains its invocation policy for the handoff owner', () => {
  assert.strictEqual(resolveNext(skills, { name: 'doc-maintain', mode: 'update', state: 'PASS' }).invocationClass, 'explicit-only');
});

test('Host formatting is separate from stored target identity', () => {
  const target = { name: 'change-verdict', mode: 'code', terminal: false };
  assert.strictEqual(formatNextAction(target, { host: 'codex' }), '$change-verdict --mode code');
  assert.strictEqual(formatNextAction(target, { host: 'claude' }), '/dhpk:change-verdict --mode code');
  assert.strictEqual(formatNextAction(target, { host: 'claude-code' }), '/dhpk:change-verdict --mode code');
  assert.deepStrictEqual(target, { name: 'change-verdict', mode: 'code', terminal: false });
});

test('an isolated analyzer consumes declarations and keeps explicit-only handoffs unstarted', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-next-consumer-'));
  const source = path.join(__dirname, '..');
  try {
    const guide = path.join(root, 'skills', 'flow-guide');
    fs.cpSync(path.join(source, 'skills', 'flow-guide'), guide, { recursive: true });
    for (const [from, to] of [
      ['scripts/lib/skill-next-map.js', 'skill-next-map.js'],
      ['scripts/ci/_lib/frontmatter.js', 'frontmatter.js'],
      ['scripts/lib/flow-handoff-contract.js', 'flow-handoff-contract.js'],
    ]) fs.copyFileSync(path.join(source, from), path.join(guide, 'scripts', '_lib', to));
    for (const [name, metadata] of Object.entries(skills)) {
      const dir = path.join(root, 'skills', name);
      fs.mkdirSync(dir, { recursive: true });
      const values = metadata.values;
      const lines = ['---', `name: ${name}`, 'metadata:', `  dhpk-invocation-class: ${values['dhpk-invocation-class'] || 'implicit-eligible'}`];
      if (values['dhpk-modes']) lines.push(`  dhpk-modes: [${values['dhpk-modes'].join(', ')}]`);
      lines.push('  dhpk-next:', ...Object.entries(values['dhpk-next']).map(([state, target]) => `    ${state}: ${target}`), '---', 'Procedure body is irrelevant.');
      fs.writeFileSync(path.join(dir, 'SKILL.md'), lines.join('\n'));
    }
    for (const args of [['init', '-q'], ['config', 'user.email', 'test@example.invalid'], ['config', 'user.name', 'Test'], ['commit', '--allow-empty', '-qm', 'fixture']]) {
      assert.strictEqual(spawnSync('git', args, { cwd: root }).status, 0);
    }
    fs.writeFileSync(path.join(root, '.claude_review_state.json'), '{}');
    const gateResult = spawnSync('node', [path.join(guide, 'scripts', 'analyze.js'), '--json'], { cwd: root, encoding: 'utf8' });
    const gateReport = JSON.parse(gateResult.stdout);
    const gateAction = gateReport.next_actions.find(item => item.id === 'gate-missing-code');
    assert.strictEqual(gateAction.skill, 'change-verdict');
    assert.strictEqual(gateAction.mode, 'code');
    assert.strictEqual(gateAction.handoff.execution, 'not-started');
    for (const [lastSkill, expected, disposition] of [
      [{ name: 'tdd-workflow', state: 'PASS' }, 'repo-verify', 'advice'],
      [{ name: 'tdd-workflow', state: 'PARTIAL' }, 'tdd-workflow', 'advice'],
      [{ name: 'doc-maintain', mode: 'update', state: 'PASS' }, 'git-smart-commit', 'explicit-required'],
      [{ name: 'doc-maintain', mode: 'codemap', state: 'PASS' }, null, 'advice'],
    ]) {
      fs.writeFileSync(path.join(root, '.claude_review_state.json'), JSON.stringify({ last_skill: lastSkill }));
      const result = spawnSync('node', [path.join(guide, 'scripts', 'analyze.js'), '--json'], { cwd: root, encoding: 'utf8' });
      const report = JSON.parse(result.stdout);
      assert.strictEqual(report.version, 2);
      const action = report.next_actions.find(item => item.id === 'declared-next');
      assert.ok(action, result.stdout);
      assert.strictEqual(action.skill, expected);
      assert.strictEqual(action.handoff.schema, 'dhpk.flow.handoff.v1');
      assert.strictEqual(action.handoff.execution, 'not-started');
      assert.strictEqual(action.handoff.disposition, disposition);
    }
    fs.writeFileSync(path.join(root, '.claude_review_state.json'), JSON.stringify({ last_skill: { name: 'tdd-workflow', state: 'PASS' } }));
    for (const [script, args, host, command] of [
      ['analyze.js', [], 'claude-code', '/dhpk:repo-verify'],
      ['action-runner.js', ['next', '--host', 'codex-cli'], 'codex-cli', '$repo-verify'],
      ['analyze.js', ['--host', 'cursor'], 'cursor', '$repo-verify'],
    ]) {
      const result = spawnSync('node', [path.join(guide, 'scripts', script), ...args], { cwd: root, encoding: 'utf8' });
      const action = JSON.parse(result.stdout).next_actions.find(item => item.id === 'declared-next');
      assert.strictEqual(action.command, command);
      assert.strictEqual(action.handoff.host, host);
    }
    for (const [script, args] of [['analyze.js', ['--host', 'invalid']], ['action-runner.js', ['next', '--host', 'invalid']]]) {
      const result = spawnSync('node', [path.join(guide, 'scripts', script), ...args], { cwd: root, encoding: 'utf8' });
      assert.notStrictEqual(result.status, 0);
      assert.match(result.stderr, /host.*must be|unsupported.*host/i);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function gitOk(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.strictEqual(result.status, 0, `${args.join(' ')}\n${result.stdout}\n${result.stderr}`);
  return result;
}

test('stale or unbound gate passes do not become the current progress claim', () => {
  const { evaluateGates } = require('../skills/flow-guide/scripts/analyze');
  const isolated = evaluateGates(
    { head: 'old', code_review: { passed: true }, precommit: { passed: true } },
    [{ status: 'A', file: 'src/new-behavior.js' }],
    { head: 'abc1234', diffIdentity: 'A\tsrc/new-behavior.js\n--\n src/new-behavior.js | 1 +\n' },
  );
  assert.strictEqual(isolated.code_review.passed, false);
  assert.strictEqual(isolated.precommit.passed, false);
  assert.strictEqual(isolated.code_review.evidence, 'stale');
  assert.strictEqual(isolated.precommit.evidence, 'stale');

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-gate-evidence-'));
  const analyze = path.join(__dirname, '..', 'skills', 'flow-guide', 'scripts', 'analyze.js');
  const statePath = path.join(root, '.claude_review_state.json');
  try {
    gitOk(root, ['init', '-q']);
    gitOk(root, ['config', 'user.email', 'test@example.invalid']);
    gitOk(root, ['config', 'user.name', 'Test']);
    gitOk(root, ['commit', '--allow-empty', '-qm', 'fixture']);
    fs.mkdirSync(path.join(root, 'lib'));
    fs.writeFileSync(path.join(root, 'lib', 'sample.js'), 'module.exports = 1;\n');
    const runState = (state) => {
      const before = JSON.stringify(state);
      fs.writeFileSync(statePath, before);
      const result = spawnSync(process.execPath, [analyze, '--json'], { cwd: root, encoding: 'utf8' });
      assert.strictEqual(fs.readFileSync(statePath, 'utf8'), before);
      const report = JSON.parse(result.stdout);
      return { result, report };
    };
    const completed = ['post_precommit', 'ready_to_commit', 'feature_complete', 'clean'];
    const stale = runState({ head: 'old', code_review: { passed: true }, precommit: { passed: true } });
    assert.strictEqual(stale.report.gates.code_review.passed, false);
    assert.strictEqual(stale.report.gates.precommit.passed, false);
    assert.strictEqual(stale.report.gates.code_review.evidence, 'stale');
    assert.ok(!completed.includes(stale.report.phase), stale.report.phase);
    assert.ok(!stale.report.next_actions.some((item) => /required gates passed|precommit passed/i.test(item.reason)));

    const unbound = runState({ code_review: { passed: true }, precommit: { passed: true } });
    assert.strictEqual(unbound.report.gates.code_review.evidence, 'unbound');
    assert.strictEqual(unbound.report.gates.code_review.passed, false);
    assert.ok(!completed.includes(unbound.report.phase), unbound.report.phase);

    const headOnly = runState({ head: stale.report.head, code_review: { passed: true }, precommit: { passed: true } });
    assert.strictEqual(headOnly.report.gates.code_review.evidence, 'unbound');
    assert.strictEqual(headOnly.report.gates.code_review.passed, false);

    const moved = runState({
      head: stale.report.head,
      diff: `${stale.report.diff_identity}-stale`,
      code_review: { passed: true },
      precommit: { passed: true },
    });
    assert.strictEqual(moved.report.gates.code_review.evidence, 'scope-changed');
    assert.strictEqual(moved.report.gates.precommit.passed, false);
    assert.ok(!completed.includes(moved.report.phase), moved.report.phase);

    const reused = runState({
      head: stale.report.head,
      diff: stale.report.diff_identity,
      code_review: { passed: true },
      precommit: { passed: true },
    });
    assert.strictEqual(reused.report.gates.code_review.passed, true);
    assert.strictEqual(reused.report.gates.precommit.passed, true);
    assert.strictEqual(reused.report.gates.code_review.evidence, 'applicable');
    assert.strictEqual(reused.report.phase, 'post_precommit');
    assert.ok(reused.report.next_actions.some((item) => /precommit passed/i.test(item.reason)));

    const scoped = runState({
      head: stale.report.head,
      scope: { diff: stale.report.diff_identity },
      code_review: { passed: true },
      precommit: { passed: true },
    });
    assert.strictEqual(scoped.report.gates.code_review.passed, true);
    assert.strictEqual(scoped.report.gates.code_review.evidence, 'applicable');

    const distinct = runState({
      head: stale.report.head,
      diff: stale.report.diff_identity,
      code_review: { passed: false },
      doc_review: { skipped: true },
    });
    assert.strictEqual(distinct.report.gates.code_review.evidence, 'failed');
    assert.strictEqual(distinct.report.gates.code_review.passed, false);
    assert.strictEqual(distinct.report.gates.doc_review.evidence, 'skipped');
    assert.strictEqual(distinct.report.gates.precommit.evidence, 'unobserved');
    assert.notStrictEqual(distinct.report.phase, 'ready_to_commit');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function withoutContentProof(identity) {
  return String(identity).replace(/^content [0-9a-f]{64}\n/, '');
}

function initContentRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-diff-content-'));
  gitOk(root, ['init', '-q']);
  gitOk(root, ['config', 'user.email', 'test@example.invalid']);
  gitOk(root, ['config', 'user.name', 'Test']);
  gitOk(root, ['commit', '--allow-empty', '-qm', 'fixture']);
  fs.mkdirSync(path.join(root, 'lib'));
  return root;
}

function runAnalyze(root, state) {
  const statePath = path.join(root, '.claude_review_state.json');
  const before = JSON.stringify(state);
  fs.writeFileSync(statePath, before);
  const analyze = path.join(__dirname, '..', 'skills', 'flow-guide', 'scripts', 'analyze.js');
  const result = spawnSync(process.execPath, [analyze, '--json'], { cwd: root, encoding: 'utf8' });
  assert.strictEqual(fs.readFileSync(statePath, 'utf8'), before);
  return JSON.parse(result.stdout);
}

test('an old diff identity without content proof cannot pass', () => {
  const { evaluateGates } = require('../skills/flow-guide/scripts/analyze');
  const old = 'M\tlib/sample.js\n--\n lib/sample.js | 2 +-';
  const gates = evaluateGates(
    { head: 'abc1234', diff: old, code_review: { passed: true }, precommit: { passed: true } },
    [{ status: 'M', file: 'lib/sample.js' }],
    { head: 'abc1234', diffIdentity: old },
  );
  assert.strictEqual(gates.code_review.passed, false);
  assert.strictEqual(gates.precommit.passed, false);
  assert.strictEqual(gates.code_review.evidence, 'unbound');
  assert.strictEqual(gates.precommit.evidence, 'unbound');

  const unreadable = evaluateGates(
    { head: 'abc1234', code_review: { passed: true }, precommit: { passed: true } },
    [],
    { head: 'abc1234', diffReadable: false },
  );
  assert.strictEqual(unreadable.code_review.passed, false);
  assert.strictEqual(unreadable.precommit.passed, false);
  assert.strictEqual(unreadable.code_review.evidence, 'unbound');
});

test('same path and diff stat do not reuse a pass after tracked content changes', () => {
  const root = initContentRepo();
  const file = path.join(root, 'lib', 'sample.js');
  try {
    fs.writeFileSync(file, 'module.exports = 0;\n');
    gitOk(root, ['add', 'lib/sample.js']);
    gitOk(root, ['commit', '-qm', 'sample']);
    fs.writeFileSync(file, 'module.exports = 1;\n');
    const first = runAnalyze(root, { head: 'placeholder' });
    fs.writeFileSync(file, 'module.exports = 2;\n');
    const second = runAnalyze(root, {
      head: first.head,
      diff: first.diff_identity,
      code_review: { passed: true },
      precommit: { passed: true },
    });
    assert.match(first.diff_identity, /^content [0-9a-f]{64}\n/);
    assert.strictEqual(withoutContentProof(second.diff_identity), withoutContentProof(first.diff_identity));
    assert.notStrictEqual(second.diff_identity, first.diff_identity);
    assert.strictEqual(second.gates.code_review.passed, false);
    assert.strictEqual(second.gates.precommit.passed, false);
    assert.strictEqual(second.gates.code_review.evidence, 'scope-changed');
    assert.strictEqual(second.gates.precommit.evidence, 'scope-changed');

    fs.writeFileSync(file, 'module.exports = 2;\n');
    const same = runAnalyze(root, {
      head: second.head,
      diff: second.diff_identity,
      code_review: { passed: true },
      precommit: { passed: true },
    });
    assert.strictEqual(same.diff_identity, second.diff_identity);
    assert.strictEqual(same.gates.code_review.passed, true);
    assert.strictEqual(same.gates.precommit.passed, true);
    assert.strictEqual(same.gates.code_review.evidence, 'applicable');

    gitOk(root, ['add', 'lib/sample.js']);
    const staged = runAnalyze(root, {
      head: same.head,
      diff: same.diff_identity,
      code_review: { passed: true },
      precommit: { passed: true },
    });
    assert.strictEqual(staged.diff_identity, same.diff_identity);
    assert.strictEqual(staged.gates.code_review.passed, true);
    assert.strictEqual(staged.gates.precommit.evidence, 'applicable');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('staged content hidden from the worktree still invalidates a saved pass', () => {
  const root = initContentRepo();
  const file = path.join(root, 'lib', 'sample.js');
  try {
    fs.writeFileSync(file, 'module.exports = 0;\n');
    gitOk(root, ['add', 'lib/sample.js']);
    gitOk(root, ['commit', '-qm', 'sample']);
    const headCopy = gitOk(root, ['show', 'HEAD:lib/sample.js']).stdout;
    fs.writeFileSync(file, 'module.exports = 1;\n');
    gitOk(root, ['add', 'lib/sample.js']);
    fs.writeFileSync(file, headCopy);
    const first = runAnalyze(root, { head: 'placeholder' });
    fs.writeFileSync(file, 'module.exports = 2;\n');
    gitOk(root, ['add', 'lib/sample.js']);
    fs.writeFileSync(file, headCopy);
    const second = runAnalyze(root, {
      head: first.head,
      diff: first.diff_identity,
      code_review: { passed: true },
      precommit: { passed: true },
    });
    assert.strictEqual(withoutContentProof(second.diff_identity), withoutContentProof(first.diff_identity));
    assert.notStrictEqual(second.diff_identity, first.diff_identity);
    assert.strictEqual(second.gates.code_review.passed, false);
    assert.strictEqual(second.gates.precommit.passed, false);
    assert.strictEqual(second.gates.code_review.evidence, 'scope-changed');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('untracked content changes and unreadable content do not reuse a pass', () => {
  const root = initContentRepo();
  const file = path.join(root, 'lib', 'new.js');
  try {
    fs.writeFileSync(file, 'module.exports = 1;\n');
    const first = runAnalyze(root, { head: 'placeholder' });
    fs.writeFileSync(file, 'module.exports = 2;\n');
    const second = runAnalyze(root, {
      head: first.head,
      diff: first.diff_identity,
      code_review: { passed: true },
      precommit: { passed: true },
    });
    assert.strictEqual(withoutContentProof(second.diff_identity), withoutContentProof(first.diff_identity));
    assert.notStrictEqual(second.diff_identity, first.diff_identity);
    assert.strictEqual(second.gates.code_review.passed, false);
    assert.strictEqual(second.gates.precommit.passed, false);
    assert.strictEqual(second.gates.code_review.evidence, 'scope-changed');

    const oldFormat = runAnalyze(root, {
      head: second.head,
      diff: withoutContentProof(second.diff_identity),
      code_review: { passed: true },
      precommit: { passed: true },
    });
    assert.strictEqual(oldFormat.gates.code_review.passed, false);
    assert.strictEqual(oldFormat.gates.precommit.passed, false);
    assert.strictEqual(oldFormat.gates.code_review.evidence, 'unbound');

    fs.chmodSync(file, 0);
    const unreadable = runAnalyze(root, {
      head: second.head,
      diff: second.diff_identity,
      code_review: { passed: true },
      precommit: { passed: true },
    });
    assert.strictEqual(unreadable.gates.code_review.passed, false);
    assert.strictEqual(unreadable.gates.precommit.passed, false);
    assert.strictEqual(unreadable.gates.code_review.evidence, 'unbound');
    assert.strictEqual(unreadable.diff_identity, null);
  } finally {
    fs.chmodSync(file, 0o644);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

run('skill-next-map');
