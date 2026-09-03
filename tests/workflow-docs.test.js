'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.resolve(__dirname, '..');

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), 'utf8');
}

test('workflow guides expose the route-first user contract in both locales', () => {
  const required = [
    'inspect → verify surface → route → plan/classify → implement → review → verify → handoff',
    '--route-only',
    'Route only:',
    'MATCH',
    'NO_MATCH',
    'NO_QUERY',
    'implicit-eligible',
    'explicit-only',
    '--worker=',
    '--reasoner=',
    'CODEX=on',
    'TDD',
    'impact',
    'wayfinder',
    'openspec/changes/',
    'archive',
    'NOT_RUN',
    'NO_SHIP',
    'harness-workflow',
    'machine-readable',
  ];
  for (const relative of ['docs/basic-operations.md', 'docs/basic-operations.zh-TW.md']) {
    const text = read(relative);
    for (const token of required) {
      assert.ok(text.includes(token), `${relative} missing workflow token: ${token}`);
    }
  }
});

test('update-docs command and doc-updater agent follow the writing contract', () => {
  const command = read('commands/update-docs.md');
  const agent = read('agents/doc-updater.md');
  for (const [label, text] of [['commands/update-docs.md', command], ['agents/doc-updater.md', agent]]) {
    assert.match(text, /writing-for-agents/i, `${label} must point to writing-for-agents`);
    assert.match(text, /Need Human|BLOCKED/i, `${label} must define an escalation boundary`);
    assert.match(text, /NOT_RUN|PASS/i, `${label} must define observable validation`);
    for (const stale of ['src/service', 'src/provider', 'src/entity', 'docs/features']) {
      assert.strictEqual(text.includes(stale), false, `${label} contains stale placeholder path ${stale}`);
    }
  }
  assert.match(command, /dhpk-invocation-class:\s*implicit-eligible/);
  assert.match(agent, /^model:\s*(?:haiku|sonnet|opus)$/m);
  assert.strictEqual(/\n\/update-docs\b/.test(command), false, 'command examples must keep the dhpk namespace');
  assert.match(command, /manifests\/distribution-inventory\.json/);
  assert.match(command, /rules\/execution-policy\.md/);
  assert.match(agent, /cx overview/);
  assert.match(agent, /GitNexus/i);
});

test('README and command index point users to the capability-family route entry', () => {
  for (const relative of ['README.md', 'README.zh-TW.md']) {
    const text = read(relative);
    assert.match(text, /flow-drive[^\n]*route-only|flow-drive[\s\S]*--route-only/);
    assert.match(text, /explicit-only/);
    assert.match(text, /basic-operations(?:\.zh-TW)?\.md/);
    assert.doesNotMatch(text, /\/dhpk:do --route-only/);
  }
  const index = read('commands/INDEX.md');
  assert.match(index, /flow-drive.*route\/implement mode/i);
  assert.match(index, /former review aliases are retired/i);
  assert.doesNotMatch(index, /create-dev.*alias/i);
});

run('workflow-docs');
