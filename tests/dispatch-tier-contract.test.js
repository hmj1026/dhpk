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
  assert.match(rule, /Fable 5\.2 cost 1\.3-3\.7x opus/);
  assert.doesNotMatch(rule, /about 2\.3x opus per run/);
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
  assert.strictEqual(ref.split('**`general-purpose` is prohibited').length - 1, 1);
  // Role reassignment lives here; model/effort per built-in role stays in model-economics.
  assert.match(ref, /rules\/model-economics\.md/);
  assert.doesNotMatch(ref, /effort: "low"/);
  assert.doesNotMatch(ref, /never `?haiku`? for file edits/i);
  const economics = read('rules/model-economics.md');
  assert.match(economics, /explicit `model`/);
  assert.match(economics, /never haiku for file edits/i);
});

test('no document says the fable alias currently resolves to Fable 5.1', () => {
  for (const rel of ['rules/model-economics.md', 'agents/INDEX.md']) {
    assert.doesNotMatch(read(rel), /Fable 5\.1 is the highest|resolves to Fable 5\.1/, rel);
  }
});

// #1298: the architect vs deep-reasoner distinction is owned by model-economics;
// execution-policy carries only the dispatch-time decision and links to it.
test('model-economics owns the architect vs deep-reasoner distinction and the Fable main-session note', () => {
  const rule = read('rules/model-economics.md');
  assert.match(rule, /^## Architect vs deep-reasoner$/m);
  assert.match(rule, /before implementation/i);
  assert.match(rule, /during implementation/i);
  assert.match(rule, /root cause/i);
  assert.match(rule, /Projection Journal/);
  assert.match(rule, /3 or more independently releasable stages/);
  assert.match(rule, /Fable main session/);
});

test('execution-policy carries the dispatch-time decision and links to model-economics without duplicating the distinction', () => {
  const policy = read('rules/execution-policy.md');
  const start = policy.indexOf('## Implementation dispatch');
  assert.ok(start > 0);
  const section = policy.slice(start);
  assert.match(section, /\*\*Dispatch-time decision/);
  assert.match(section, /model-economics\.md` \(§Architect vs deep-reasoner\)/);
  assert.match(section, /rule 7/);
  assert.match(section, /3rd automatic raise|third automatic raise/i);
  assert.doesNotMatch(policy, /Architect vs deep-reasoner\n/);
  assert.doesNotMatch(policy, /Projection Journal/);
});

test('the distinction is not duplicated in the implementation-dispatch reference', () => {
  const ref = read('skills/flow-guide/references/implementation-dispatch.md');
  assert.doesNotMatch(ref, /Projection Journal/);
  assert.doesNotMatch(ref, /^## Architect vs deep-reasoner$/m);
  assert.strictEqual(ref.split('**Dispatch-time decision').length - 1, 1);
  assert.match(ref, /model-economics\.md` \(§Architect vs deep-reasoner\)/);
});

test('flow-drive and flow-guide SKILL.md stay free of dispatch-time decision rules', () => {
  for (const rel of ['skills/flow-drive/SKILL.md', 'skills/flow-guide/SKILL.md']) {
    const text = read(rel);
    assert.doesNotMatch(text, /Dispatch-time decision/i, rel);
    assert.doesNotMatch(text, /Architect vs deep-reasoner/, rel);
    assert.doesNotMatch(text, /3rd automatic raise|third automatic raise/i, rel);
  }
});

test('dispatch-time decision texts carve out built-in roles from the no-parameter default', () => {
  const policy = read('rules/execution-policy.md');
  const policySentence = policy.slice(policy.indexOf('**Dispatch-time decision'));
  assert.match(policySentence.split('\n')[0], /declares a Role Default in its frontmatter[^.]*no call parameters/);
  assert.match(policySentence.split('\n')[0], /Built-in roles[^.]*`Explore`[^.]*`general-purpose`[^.]*tier-map row/);
  const ref = read('skills/flow-guide/references/implementation-dispatch.md');
  const step = ref.split('\n').find((line) => line.startsWith('2. ') && line.includes('omit `model` and `effort`'));
  assert.ok(step, 'step 2 missing');
  assert.match(step, /Role Default in its frontmatter/);
  assert.match(step, /Built-in roles[^.]*frontmatter[^.]*tier-map row/);
});

run('dispatch-tier-contract');
