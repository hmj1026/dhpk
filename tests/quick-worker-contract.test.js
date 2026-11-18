'use strict';

// Contract for the quick-worker tier: the haiku literal-sweep role below
// fast-worker. The admission gate SSOT lives in agents/quick-worker.md;
// model-economics keeps one pointer, not a second per-dispatch haiku path.

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function frontmatter(text) {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
  assert.ok(match, 'frontmatter block missing');
  const fields = {};
  for (const line of match[1].split('\n')) {
    const m = /^([A-Za-z_-]+):\s*(.*)$/.exec(line);
    if (m) fields[m[1]] = m[2].trim();
  }
  return fields;
}

test('quick-worker frontmatter pins haiku at medium effort with write tools', () => {
  const fields = frontmatter(read('agents/quick-worker.md'));
  assert.strictEqual(fields.name, 'quick-worker');
  assert.strictEqual(fields.model, 'haiku');
  assert.strictEqual(fields.effort, 'medium');
  for (const tool of ['Read', 'Edit', 'Write', 'Bash', 'Grep', 'Glob']) {
    assert.ok(fields.tools.split(/,\s*/).includes(tool), `missing tool ${tool}`);
  }
});

test('quick-worker owns the admission gate and the one-shot BLOCKED rule', () => {
  const prompt = read('agents/quick-worker.md');
  for (const gate of [
    'names every target file',
    'mechanical sweep',
    'judgment about behavior',
    'deterministic command verifies',
  ]) {
    assert.ok(prompt.includes(gate), `admission gate missing: ${gate}`);
  }
  assert.ok(prompt.includes('BLOCKED'), 'missing BLOCKED');
  assert.ok(prompt.includes('needs judgment'), 'missing needs judgment reason');
  assert.ok(prompt.includes('rule 6'), 'missing model-economics rule 6 escalation');
  assert.ok(prompt.includes('Edit tool discipline'), 'missing Edit tool discipline citation');
  assert.ok(prompt.includes('agents/fast-worker.md'), 'missing fast-worker shared contract citation');
});

test('model-economics lists quick-worker and drops the per-dispatch haiku override', () => {
  const text = read('rules/model-economics.md');
  assert.match(text, /\| `quick-worker` \| haiku @ medium \|/);
  assert.ok(!text.includes('sonnet vs haiku boundary'), 'old boundary paragraph still present');
  assert.ok(!text.includes('A single dispatch MAY pass the `Agent` call `model: haiku`'), 'per-dispatch haiku override still present');
  assert.match(text, /admission gate[^\n]*`agents\/quick-worker\.md`|`agents\/quick-worker\.md`[^\n]*admission gate/i, 'pointer to the quick-worker admission gate missing');
  assert.ok(text.includes('do not pass `model: haiku` to a `fast-worker` dispatch'), 'explicit ban on the per-dispatch haiku override is missing');
});

test('execution-policy dispatch table routes literal sweeps to quick-worker', () => {
  const text = read('rules/execution-policy.md');
  const row = text.split('\n').find((line) => line.startsWith('|') && line.includes('`dhpk:quick-worker`'));
  assert.ok(row, 'dispatch table row for dhpk:quick-worker missing');
  assert.ok(row.includes('admission gate'), row);
  assert.ok(text.split('\n').some((line) => line.startsWith('|') && line.includes('`fast-worker`')), 'fast-worker row must remain');
});

test('review-fix wave guidance splits literal fixes from interpreted fixes', () => {
  const text = read('skills/flow-guide/references/implementation-dispatch.md');
  assert.ok(text.includes('quick-worker'), 'quick-worker missing from implementation-dispatch');
});

test('provider catalog keeps quick-worker out of dispatch-engine role aliases (native-only tier)', () => {
  const catalog = JSON.parse(read('manifests/provider-model-catalog.json'));
  assert.strictEqual(catalog.role_aliases['quick-worker'], undefined);
  assert.deepStrictEqual(catalog.role_aliases['fast-worker'], { role: 'worker', authority: 'workspace-write' });
});

test('fast-worker description points literal sweeps to quick-worker', () => {
  const fields = frontmatter(read('agents/fast-worker.md'));
  assert.ok(fields.description.includes('quick-worker'), fields.description);
});

test('agents INDEX lists quick-worker under the haiku tier', () => {
  const text = read('agents/INDEX.md');
  assert.ok(text.split('\n').some((line) => line.startsWith('|') && line.includes('quick-worker')), 'INDEX row missing');
});

run('quick-worker-contract');
