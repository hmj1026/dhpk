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

run('skill-next-map');
