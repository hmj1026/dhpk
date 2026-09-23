'use strict';

// Shared result assertions for the Skill fixture registries. One expectation
// shape is used everywhere:
//   { status, output?: string[], absent?: string[], stdout?: string, stderr?: string }
// `output`/`absent` are substring checks over combined stdout+stderr;
// `stdout`/`stderr` are exact-match checks.
const assert = require('node:assert');

function outputText(result) {
  return `${String((result && result.stdout) || '')}\n${String((result && result.stderr) || '')}`;
}

function assertExpected(result, expected, id = 'fixture') {
  const output = outputText(result);
  assert.strictEqual(
    result && result.status,
    expected.status,
    `${id}: expected status ${expected.status}, got ${result && result.status}\n${output}`,
  );
  if (typeof expected.stdout === 'string') {
    assert.strictEqual(String(result.stdout || ''), expected.stdout, `${id}: unexpected stdout`);
  }
  if (typeof expected.stderr === 'string') {
    assert.strictEqual(String(result.stderr || ''), expected.stderr, `${id}: unexpected stderr`);
  }
  for (const fragment of expected.output || []) {
    assert.ok(output.includes(fragment), `${id}: expected output '${fragment}'\n${output}`);
  }
  for (const fragment of expected.absent || []) {
    assert.ok(!output.includes(fragment), `${id}: unexpected output '${fragment}'\n${output}`);
  }
}

module.exports = { outputText, assertExpected };
