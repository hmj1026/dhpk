'use strict';

// The #1243 refactor must not change any allow/block outcome. The snapshot was
// recorded from the pre-refactor guard over every command the credential tests
// send, replayed against fixed clean and dirty fixture trees.
const { test, run, assert } = require('./_lib/tinytest');
const { ROOT } = require('./_lib/hookharness');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const snapshot = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'credential-decision-snapshot.json'), 'utf8'));

test('credential guard reaches the recorded allow/block outcome for every snapshot case', () => {
  const cases = snapshot.cases.map(({ command, patterns, tree }) => ({ command, patterns, tree }));
  const result = spawnSync('python3', ['-B', path.join(__dirname, '_lib', 'credential_decision_replay.py')], {
    input: JSON.stringify({ cases }),
    env: { ...process.env, PYTHONPATH: path.join(ROOT, 'scripts/hooks/_lib') },
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  assert.strictEqual(result.status, 0, result.stderr);
  const outcomes = JSON.parse(result.stdout);
  assert.strictEqual(outcomes.length, snapshot.cases.length);
  const drift = snapshot.cases
    .map((entry, index) => ({ ...entry, actual: outcomes[index] }))
    .filter((entry) => entry.actual !== entry.blocked)
    .map((entry) => `${entry.tree} ${entry.patterns || '[]'} ${JSON.stringify(entry.command)}: expected ${entry.blocked ? 'block' : 'allow'}`);
  assert.deepStrictEqual(drift, []);
  assert.ok(snapshot.cases.some((entry) => entry.blocked) && snapshot.cases.some((entry) => !entry.blocked));
});

run('credential-decision-snapshot');
