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
  'dist/claude-marketplace/package/agents',
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

run('dispatch-tier-contract');
