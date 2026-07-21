'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

test('execution policy documents Repository Discovery Gate and hard-rule deferral limits', () => {
  const text = read('rules/execution-policy.md');
  for (const phrase of [
    'Repository Discovery Gate',
    'new DB, SQL, query-builder, criteria, model-persistence, or repository-like code',
    'human-approved exception',
  ]) {
    assert.ok(text.includes(phrase), `rules/execution-policy.md missing: ${phrase}`);
  }
  assert.ok(/explicit project hard rules cannot be deferred/i.test(text),
    'rules/execution-policy.md missing explicit project hard rules cannot be deferred');
});

test('implementation-dispatch reference includes anti-rationalization and CODEX trigger details', () => {
  const text = read('skills/dhpk-execution-policy/references/implementation-dispatch.md');
  for (const phrase of [
    'Repository Discovery Gate',
    'anti-rationalization',
    'first-seen query/repository patterns',
    'framework-internal hacks',
    'explicit-rule deferrals',
    'human-approved exception',
  ]) {
    assert.ok(text.includes(phrase), `implementation-dispatch reference missing: ${phrase}`);
  }
});

test('tdd-guide forbids shared framework/vendor edits and requires explicit dependency cleanliness proof', () => {
  const text = read('agents/tdd-guide.md');
  for (const phrase of [
    'Do not edit shared framework, vendor, package-manager dependency, or externally mounted framework source',
    'even temporarily',
    'test-local probe',
    'subclass',
    'reflection helper',
    'teardown restoration',
    'non-git dependency paths must be proven clean with explicit evidence',
  ]) {
    assert.ok(text.includes(phrase), `tdd-guide missing: ${phrase}`);
  }
});

test('opsx-load-context surfaces hard-rule escalations before routine resume notes', () => {
  const text = read('skills/opsx-load-context/SKILL.md');
  const hardRule = text.indexOf('.hard-rule-escalation.md');
  const resumeNote = text.indexOf('.resume-note.md');
  assert.ok(hardRule >= 0, 'missing hard-rule escalation check');
  assert.ok(resumeNote >= 0, 'missing resume-note check');
  assert.ok(hardRule < resumeNote, 'hard-rule escalation check must precede routine resume-note handling');
  assert.ok(text.includes('blocking human decision'), 'missing blocking human decision wording');
});

test('CLAUDE_PLUGIN_ROOT guardrail paragraph stays synchronized across policy surfaces', () => {
  const files = [
    'rules/execution-policy.md',
    'skills/dhpk-execution-policy/references/review-gate-mechanics.md',
    'skills/execution-checklist/SKILL.md',
  ];
  // The paragraph is embedded mid-row in a table cell in SKILL.md, so it is
  // extracted by span rather than by line. Both markers are literal fragments
  // of the paragraph's first and last sentences: rewording either end means
  // updating them here too, or all three files report "missing paragraph".
  const marker = '`${CLAUDE_PLUGIN_ROOT}` is a markdown-interpolation token';
  const endMarker = '`find / -iname`.';
  const spans = files.map((rel) => {
    const text = read(rel);
    const start = text.indexOf(marker);
    const end = start === -1 ? -1 : text.indexOf(endMarker, start);
    const span = start >= 0 && end >= start
      ? text.slice(start, end + endMarker.length)
      : '';
    assert.ok(span.length > 0, `${rel} missing CLAUDE_PLUGIN_ROOT guardrail paragraph`);
    return { rel, span };
  });
  const canonical = spans[0].span;
  assert.strictEqual(spans[1].span, canonical,
    'skills/dhpk-execution-policy/references/review-gate-mechanics.md CLAUDE_PLUGIN_ROOT guardrail paragraph diverged from rules/execution-policy.md');
  assert.strictEqual(spans[2].span, canonical,
    'skills/execution-checklist/SKILL.md CLAUDE_PLUGIN_ROOT guardrail paragraph diverged from rules/execution-policy.md');
});

run('policy-static-guardrails');
