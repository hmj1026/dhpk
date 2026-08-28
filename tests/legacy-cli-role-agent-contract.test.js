'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const LAUNCHER = 'skills/dhpk-cli-dispatch-context/scripts/launch-cli-dispatch.js';
const CONTRACTS = Object.freeze([
  Object.freeze({
    alias: 'codex-fast-worker.md',
    canonical: 'codex-worker.md',
    requestedRole: 'codex-fast-worker',
    effectiveRole: 'codex-worker',
    provider: 'codex',
    mode: 'workspace-write',
  }),
  Object.freeze({
    alias: 'agy-fast-worker.md',
    canonical: 'agy-worker.md',
    requestedRole: 'agy-fast-worker',
    effectiveRole: 'agy-worker',
    provider: 'agy',
    mode: 'workspace-write',
  }),
  Object.freeze({
    alias: 'codex-deep-reasoner.md',
    canonical: 'codex-reasoner.md',
    requestedRole: 'codex-deep-reasoner',
    effectiveRole: 'codex-reasoner',
    provider: 'codex',
    mode: 'read-only',
  }),
]);

function readAgent(file) {
  return fs.readFileSync(path.join(ROOT, 'agents', file), 'utf8');
}

function metadata(prompt, field) {
  const match = prompt.match(new RegExp(`^${field}: (.+)$`, 'm'));
  assert.ok(match, `${field} metadata missing`);
  return match[1];
}

test('legacy role aliases retain the host capabilities of their canonical roles', () => {
  for (const contract of CONTRACTS) {
    const alias = readAgent(contract.alias);
    const canonical = readAgent(contract.canonical);
    assert.strictEqual(
      metadata(alias, 'tools'),
      metadata(canonical, 'tools'),
      `${contract.alias} must preserve canonical executable tools`,
    );
    if (/^skills:/m.test(canonical)) {
      assert.strictEqual(
        metadata(alias, 'skills'),
        metadata(canonical, 'skills'),
        `${contract.alias} must preserve canonical workflow skills`,
      );
    }
  }
});

test('legacy role aliases forward explicit identity and mode through the canonical launcher', () => {
  for (const contract of CONTRACTS) {
    const alias = readAgent(contract.alias);
    for (const expected of [
      LAUNCHER,
      '--dispatching-agent "<dispatcher-role>"',
      `--execution-provider ${contract.provider}`,
      `--requested-role ${contract.requestedRole}`,
      `--mode ${contract.mode}`,
      `requested_role=${contract.requestedRole}`,
      `effective_role=${contract.effectiveRole}`,
      'DHPK_CLI_TRANSPORT_CONTEXT',
      'READY',
      'BLOCKED',
    ]) {
      assert.ok(alias.includes(expected), `${contract.alias} missing launcher contract: ${expected}`);
    }
  }
});

test('AGY compatibility keeps the dispatching agent distinct from the execution provider', () => {
  const alias = readAgent('agy-fast-worker.md');
  assert.match(alias, /dispatching agent may be Codex/i);
  assert.match(alias, /does not change the execution provider\s+from AGY/i);
  assert.ok(alias.includes('--dispatching-agent "<dispatcher-role>"'));
  assert.ok(alias.includes('--execution-provider agy'));
});

test('legacy worker aliases retain independent verification after backend execution', () => {
  for (const file of ['codex-fast-worker.md', 'agy-fast-worker.md']) {
    const alias = readAgent(file);
    assert.match(alias, /selected backend is not completion evidence/i);
    assert.match(alias, /independently run the assigned verification command/i);
  }
  assert.match(
    readAgent('codex-deep-reasoner.md'),
    /independently verify every cited\s+file:line against the working tree/i,
  );
});

run('legacy-cli-role-agent-contract');
