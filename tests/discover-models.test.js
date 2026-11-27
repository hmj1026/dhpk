'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const {
  SCHEMA,
  discoverModels,
  loadObservation,
  parseModelIds,
  statusForObservation,
} = require('../scripts/ci/discover-models');

test('model list parser keeps exact ids and removes headings/duplicates', () => {
  assert.deepStrictEqual(parseModelIds('Available models\nfoo-1 - Foo\nfoo-1\nbar_2\nTip: use --model'), ['foo-1', 'bar_2']);
});

test('discovery records source, version, time, ids, and explicit status', () => {
  const calls = [];
  const result = discoverModels({
    agent: 'cursor', executable: 'cursor-agent', listArgs: ['models'], versionArgs: ['--version'], now: new Date('2026-09-16T00:00:00.000Z'),
    runner(command, args) {
      calls.push([command, args]);
      return args[0] === 'models'
        ? { status: 0, stdout: 'Available models\nfoo-1 - Foo\nbar-2\n', stderr: '' }
        : { status: 0, stdout: 'cursor-agent 1.0.0\n', stderr: '' };
    },
  });
  assert.strictEqual(result.schema, SCHEMA);
  assert.strictEqual(result.status, 'AVAILABLE');
  assert.strictEqual(result.agent, 'cursor');
  assert.strictEqual(result.executable, 'cursor-agent');
  assert.strictEqual(result.source, 'cursor-agent models');
  assert.strictEqual(result.observed_at, '2026-09-16T00:00:00.000Z');
  assert.deepStrictEqual(result.model_ids, ['foo-1', 'bar-2']);
  assert.strictEqual(result.client_version, 'cursor-agent 1.0.0');
  assert.deepStrictEqual(calls, [
    ['cursor-agent', ['models']],
    ['cursor-agent', ['--version']],
  ]);
});

test('missing observation is NOT_RUN and denied client is BLOCKED', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-model-observation-'));
  try {
    const missing = loadObservation(path.join(root, 'missing.json'));
    assert.strictEqual(missing.status, 'NOT_RUN');
    assert.strictEqual(statusForObservation({ executableFound: true, exitCode: 1, stderr: 'login required' }), 'BLOCKED');
    assert.strictEqual(statusForObservation({ executableFound: false, exitCode: 127 }), 'UNAVAILABLE');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a real client exit 124 is recorded as a timeout, never as an available model list', () => {
  const bin = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-model-discovery-124-')));
  try {
    const agy = path.join(bin, 'agy');
    fs.writeFileSync(agy, '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "agy 1.2.3"; exit 0; fi\necho "fixture-model - partial"\nexit 124\n', { mode: 0o755 });
    const result = discoverModels({ agent: 'agy', executable: agy, listArgs: ['models'], versionArgs: ['--version'] });
    assert.strictEqual(result.status, 'UNAVAILABLE');
    assert.deepStrictEqual(result.model_ids, []);
    assert.strictEqual(result.client_version, 'agy 1.2.3');
    assert.match(result.evidence, /timed out \(exit 124\)/);
  } finally {
    fs.rmSync(bin, { recursive: true, force: true });
  }
});

run('discover-models');
