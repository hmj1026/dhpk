'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
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
const FALLBACK_CLAUSE = 'never filesystem-scan; every reviewer dispatch (even\nconfirm-only) still gets a fresh .claude/artifacts/reviews/ artifact, never\nreply-only';

function orientationCommand(fence) {
  const start = fence.indexOf('`');
  const end = fence.indexOf('`', start + 1);
  assert.ok(start >= 0 && end > start, 'orientation command fence missing');
  return fence.slice(start + 1, end);
}

test('both dispatch modes resolve the compact kernel through the same fixed candidate chain', () => {
  for (const [mode, fence] of Object.entries(FENCES)) {
    const order = ['CLAUDE_PLUGIN_ROOT:-', 'ls -dt', './.claude-plugin/plugin.json', 'q rules/execution-policy-kernel.md', 'POLICY-UNRESOLVED'];
    let cursor = -1;
    for (const token of order) {
      const idx = fence.indexOf(token);
      assert.ok(idx >= 0, `${mode}: missing candidate-chain token "${token}"`);
      assert.ok(idx > cursor, `${mode}: token "${token}" out of precedence order`);
      cursor = idx;
    }
  }
});

test('the source-checkout candidate is root-bound and never scans the filesystem', () => {
  for (const [mode, fence] of Object.entries(FENCES)) {
    assert.ok(!/find\s/.test(fence), `${mode}: must not invoke find`);
    assert.ok(!fence.includes('..'), `${mode}: must not reference a parent directory`);
    assert.ok(!/\*\*/.test(fence), `${mode}: must not use a recursive glob`);
    // The shared `q` helper gates both the cache/plugin-root candidate and the
    // root-bound source-checkout fallback through the project marker.
    assert.ok(fence.includes('test -r ./.claude-plugin/plugin.json&&'), `${mode}: missing plugin.json marker guard`);
    assert.ok(fence.includes('cat "./$1"'), `${mode}: missing root-bound source-checkout read`);
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
    const plugin = path.join(tmp, 'plugin');
    const project = path.join(tmp, 'project');
    fs.mkdirSync(path.join(plugin, 'rules'), { recursive: true });
    fs.mkdirSync(path.join(plugin, 'skills', 'dhpk-execution-policy', 'references'), { recursive: true });
    fs.mkdirSync(path.join(project, '.claude-plugin'), { recursive: true });
    fs.writeFileSync(path.join(project, '.claude-plugin', 'plugin.json'), '{}');
    fs.writeFileSync(path.join(plugin, 'rules', 'execution-policy-kernel.md'), 'KERNEL\n');
    fs.writeFileSync(path.join(plugin, 'skills', 'dhpk-execution-policy', 'references', 'implementation-dispatch.md'), 'DISPATCH\n');
    fs.writeFileSync(path.join(plugin, 'rules', 'execution-policy.md'), 'FULL_POLICY\n');
    const env = { ...process.env, CLAUDE_PLUGIN_ROOT: plugin };
    const off = spawnSync('bash', ['-c', orientationCommand(FENCES['DISPATCH_ON=false'])], {
      cwd: project, env, encoding: 'utf8',
    });
    const on = spawnSync('bash', ['-c', orientationCommand(FENCES['DISPATCH_ON=true'])], {
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

test('the shared fallback clause covers confirm-only, canonical path, freshness, and rejects reply-only', () => {
  assert.ok(/confirm-only/.test(FALLBACK_CLAUSE), 'clause missing confirm-only coverage');
  assert.ok(FALLBACK_CLAUSE.includes('.claude/artifacts/reviews/'), 'clause missing canonical artifact path');
  assert.ok(/fresh/.test(FALLBACK_CLAUSE), 'clause missing fresh-artifact wording');
  assert.ok(/never\s+reply-only/.test(FALLBACK_CLAUSE), 'clause missing reply-only-never-substitutes wording');
});

test('DISPATCH_ON=false goal stays under the hard cap and the normal target', () => {
  const result = generateFixture(readFixture('no-dispatch'));
  assert.strictEqual(result.mode, 'full', 'no-dispatch fixture should emit normally');
  assert.ok(result.bytes <= 4000, `no-dispatch exceeds hard cap: ${result.bytes}`);
  assert.ok(result.bytes <= 3600, `no-dispatch exceeds the normal target: ${result.bytes}`);
});

run('opsx-goal-policy-fallback');
