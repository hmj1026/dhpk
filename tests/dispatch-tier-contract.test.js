'use strict';

// #1297: doc-updater edits files and qa-executor issues verdicts, so both run
// on sonnet in the canonical source and every generated projection that ships
// them; the agent index and tier map must say the same thing.

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const modelOf = (rel) => (/^model:\s*(\S+)/m.exec(read(rel)) || [])[1];

// Cursor and Codex projections map models onto their own catalogs, so only the
// Claude-model projections are compared here.
const PROJECTIONS = [
  'agents',
  'generated/claude-marketplace/package/agents',
];

for (const agent of ['doc-updater', 'qa-executor']) {
  for (const dir of PROJECTIONS) {
    const rel = `${dir}/${agent}.md`;
    if (!fs.existsSync(path.join(ROOT, rel))) continue;
    test(`${rel} runs on sonnet`, () => {
      assert.strictEqual(modelOf(rel), 'sonnet');
    });
  }
  test(`canonical ${agent} exists`, () => {
    assert.ok(fs.existsSync(path.join(ROOT, 'agents', `${agent}.md`)));
  });
}

test('agent index lists doc-updater and qa-executor as sonnet, not haiku', () => {
  const index = read('agents/INDEX.md');
  assert.match(index, /\| \[doc-updater\]\(doc-updater\.md\) \| sonnet \|/);
  assert.match(index, /\| \[qa-executor\]\(qa-executor\.md\) \| sonnet \|/);
  const haikuLine = index.split('\n').find((line) => line.startsWith('- **haiku**'));
  assert.ok(haikuLine && !/doc-updater|qa-executor/.test(haikuLine), haikuLine);
  const sonnetLine = index.split('\n').find((line) => line.startsWith('- **sonnet**'));
  assert.ok(/doc-updater/.test(sonnetLine) && /qa-executor/.test(sonnetLine), sonnetLine);
});

test('model-economics states Fable 5.2 at $8/$40 and no longer resolves fable to 5.1', () => {
  const rule = read('rules/model-economics.md');
  assert.match(rule, /claude-fable-5-2/);
  assert.match(rule, /\$8\/\$40/);
  assert.match(rule, /2026-11-10/);
  assert.doesNotMatch(rule, /resolves to Fable 5\.1/);
  assert.match(rule, /Fable 5\.1 measurement[^.]*re-measur/i);
});

test('model-economics owns escalation order, low-first, Explore and general-purpose rows', () => {
  const rule = read('rules/model-economics.md');
  assert.match(rule, /Escalation order/);
  assert.match(rule, /Low-first/);
  assert.match(rule, /\| Built-in `Explore`[^|]*\| haiku @ low \|/);
  assert.match(rule, /\| Built-in `general-purpose`/);
  assert.match(rule, /Review and judgment never go through `Explore`/);
});

test('general-purpose prohibition is extended in place in the flow-guide reference, once', () => {
  const ref = read('skills/flow-guide/references/implementation-dispatch.md');
  assert.match(ref, /code-reviewer/);
  assert.match(ref, /explicit `model`/);
  assert.match(ref, /never `?haiku`? for file edits/i);
  assert.strictEqual(ref.split('**`general-purpose` is prohibited').length - 1, 1);
});

test('no document says the fable alias currently resolves to Fable 5.1', () => {
  for (const rel of ['rules/model-economics.md', 'agents/INDEX.md']) {
    assert.doesNotMatch(read(rel), /Fable 5\.1 is the highest|resolves to Fable 5\.1/, rel);
  }
});

run('dispatch-tier-contract');
