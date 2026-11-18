'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

test('write-capable agent definitions cite the Edit mechanism rule', () => {
  for (const file of ['fast-worker.md', 'tdd-guide.md', 'docs-writer.md', 'doc-updater.md', 'refactor-cleaner.md', 'e2e-runner.md', 'harness-reviser.md']) {
    assert.ok(read('agents', file).includes('Edit mechanism'), `${file} missing "Edit mechanism"`);
  }
  assert.ok(read('agent-traps', '_common', 'build-resolver-skeleton.md').includes('Edit mechanism'), 'build-resolver-skeleton missing "Edit mechanism"');
});

test('fast-worker forbids sed -i and reports shell-written files', () => {
  const prompt = read('agents', 'fast-worker.md');
  assert.ok(prompt.includes('sed -i'), 'fast-worker missing sed -i prohibition');
  assert.ok(prompt.includes('Shell-written files:'), 'fast-worker missing Shell-written files report line');
});

test('CLI worker variants carry the out-of-band exemption', () => {
  for (const file of ['codex-worker.md', 'agy-worker.md']) {
    const prompt = read('agents', file);
    assert.ok(prompt.includes('Edit mechanism exemption'), `${file} missing exemption`);
    assert.ok(prompt.includes('out-of-band'), `${file} missing out-of-band rationale`);
  }
});

test('execution-policy defines the long-running writer cap', () => {
  assert.ok(read('rules', 'execution-policy.md').includes('Long-running writer cap'));
});

run('agent-edit-mechanism');
