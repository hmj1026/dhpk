'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'bin', 'dhpk-install');

function invoke(args, options = {}) {
  return spawnSync('bash', [CLI, ...args], {
    cwd: options.cwd || ROOT,
    encoding: 'utf8',
    env: { ...process.env, ...(options.env || {}) },
  });
}

function json(result) {
  return JSON.parse(result.stdout);
}

test('cursor JSON plan normalizes project defaults without mutation and is deterministic', () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-install-plan-'));
  try {
    const args = ['cursor', 'plan', '--scope', 'project', '--json'];
    const first = invoke(args, { cwd: project });
    const second = invoke(args, { cwd: project });
    assert.strictEqual(first.status, 0, first.stderr);
    assert.strictEqual(second.status, 0, second.stderr);
    const firstResult = json(first);
    const secondResult = json(second);
    assert.deepStrictEqual(firstResult.request, {
      surface: 'cursor', action: 'plan', scope: 'project', mode: 'auto', source: 'local',
      offline: false, dryRun: false, yes: false, json: true, agentProfile: 'core', agents: [],
    });
    assert.strictEqual(firstResult.lifecycle.verdict, 'NOT_RUN');
    assert.strictEqual(firstResult.stages.compile.verdict, 'PASS');
    assert.strictEqual(firstResult.plan.id, secondResult.plan.id);
    assert.deepStrictEqual(fs.readdirSync(project), []);
  } finally { fs.rmSync(project, { recursive: true, force: true }); }
});

test('unknown arguments fail before a plan or filesystem mutation', () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-install-invalid-'));
  try {
    const result = invoke(['cursor', 'plan', '--scope', 'project', '--unknown'], { cwd: project });
    assert.strictEqual(result.status, 64);
    assert.match(result.stderr, /unknown option/i);
    assert.deepStrictEqual(fs.readdirSync(project), []);
  } finally { fs.rmSync(project, { recursive: true, force: true }); }
});

test('write actions remain explicitly blocked while legacy Codex sync is preserved', () => {
  const result = invoke(['codex-sync', 'install', '--scope', 'project', '--json']);
  assert.strictEqual(result.status, 2, result.stderr);
  const output = json(result);
  assert.strictEqual(output.lifecycle.verdict, 'BLOCKED');
  assert.strictEqual(output.diagnostics[0].code, 'NOT_IMPLEMENTED');
  assert.match(output.remediation[0], /install-codex-skills\.sh/);
});

test('non-Cursor plans select actual inventory entries and retain their IDs for status and verify', () => {
  for (const action of ['plan', 'status', 'verify']) {
    const result = invoke(['codex-sync', action, '--scope', 'project', '--json']);
    assert.strictEqual(result.status, 0, result.stderr);
    const output = json(result);
    assert.ok(output.plan.selectedIds.length > 0, `${action} must select Codex inventory IDs`);
    assert.deepStrictEqual(output.plan.selectedIds, output.plan.distribution.entries.map((entry) => entry.stableId));
    assert.strictEqual(output.lifecycle.verdict, 'NOT_RUN');
  }
});

test('Cursor agent additions and dangling surface membership fail closed before a plan is accepted', () => {
  const arbitrary = invoke(['cursor', 'plan', '--scope', 'project', '--agent', '../../unowned', '--json']);
  assert.strictEqual(arbitrary.status, 2, arbitrary.stderr);
  assert.strictEqual(json(arbitrary).diagnostics[0].code, 'UNSUPPORTED_AGENT_SELECTION');

  const lifecycle = require('../scripts/lib/dhpk-install-lifecycle');
  const malformed = { skills: [], modules: [], surface_membership: { 'codex-sync': ['missing'] } };
  const request = lifecycle.parseRequest(['codex-sync', 'plan', '--scope', 'project']);
  const result = lifecycle.execute(request, malformed);
  assert.strictEqual(result.lifecycle.verdict, 'BLOCKED');
  assert.strictEqual(result.diagnostics[0].code, 'DANGLING_SURFACE_MEMBERSHIP');
});

test('lifecycle aggregate codes stay separate from EvidenceResult verdicts', () => {
  const lifecycle = require('../scripts/lib/dhpk-install-lifecycle');
  assert.deepStrictEqual(lifecycle.LIFECYCLE_VERDICTS, ['INSTALL_PASS', 'CONSUMER_BLOCKED', 'NOT_RUN', 'BLOCKED']);
  assert.throws(
    () => lifecycle.createLifecycleResult({ lifecycleVerdict: 'PASS' }),
    /lifecycle verdict/i,
  );
});

run('dhpk-install-lifecycle');
