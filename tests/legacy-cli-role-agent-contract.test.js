'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const DISPATCH_SKILL = 'skills/dhpk-cli-dispatch-context/SKILL.md';
const TIMEOUT_GUIDANCE = 'skills/flow-guide/references/implementation-dispatch.md';
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

function readCursorAgent(file) {
  return fs.readFileSync(path.join(ROOT, 'cursor', 'agents', file), 'utf8');
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

test('legacy role aliases forward explicit identity and mode through the dispatch skill', () => {
  for (const contract of CONTRACTS) {
    const alias = readAgent(contract.alias);
    for (const expected of [
      DISPATCH_SKILL,
      `requested_role=${contract.requestedRole}`,
      `effective_role=${contract.effectiveRole}`,
      contract.provider,
      contract.mode,
    ]) {
      assert.ok(alias.includes(expected), `${contract.alias} missing launcher contract: ${expected}`);
    }
    assert.doesNotMatch(
      alias,
      /launch-cli-dispatch\.js \\\s*\n\s*--dispatching-agent/,
      `${contract.alias} must not paste the launcher flag block`,
    );
    const cursorCopy = readCursorAgent(contract.alias);
    assert.ok(
      cursorCopy.includes(DISPATCH_SKILL),
      `cursor/agents/${contract.alias} dropped the dispatch-skill pointer`,
    );
    assert.doesNotMatch(
      cursorCopy,
      /launch the provider, follow\nDo not paste/i,
      `cursor/agents/${contract.alias} must not leave an orphan follow line`,
    );
  }
});

test('AGY compatibility keeps the dispatching agent distinct from the execution provider', () => {
  const alias = readAgent('agy-fast-worker.md');
  assert.match(alias, /dispatching agent may be Codex/i);
  assert.match(alias, /does not change the execution provider\s+from AGY/i);
  assert.match(alias, /bind provider `agy`/);
  assert.ok(alias.includes(DISPATCH_SKILL), 'agy-fast-worker.md missing dispatch-skill pointer');
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

test('CLI worker and alias roles point at mid-batch timeout guidance', () => {
  for (const file of [
    'codex-fast-worker.md',
    'agy-fast-worker.md',
    'codex-worker.md',
    'agy-worker.md',
  ]) {
    const text = readAgent(file);
    assert.ok(
      text.includes(TIMEOUT_GUIDANCE),
      `${file} missing implementation-dispatch timeout pointer`,
    );
    assert.match(
      text,
      /CLI worker mid-batch timeout recovery/,
      `${file} must name the timeout-recovery section`,
    );
  }
});

run('legacy-cli-role-agent-contract');
