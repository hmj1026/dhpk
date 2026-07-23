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

test('CLAUDE_PLUGIN_ROOT guardrail caveat has one SSOT home with pointers elsewhere', () => {
  // rules-ssot-dedup: the interpolation-token caveat was deduped. The full
  // paragraph lives ONCE in review-gate-mechanics.md; execution-policy.md and
  // execution-checklist/SKILL.md carry a one-line pointer to it instead, and the
  // old keep-in-sync mirror markers are removed. Markers are literal fragments of
  // the paragraph's first and last sentences.
  const SSOT = 'skills/dhpk-execution-policy/references/review-gate-mechanics.md';
  const pointers = [
    'rules/execution-policy.md',
    'skills/execution-checklist/SKILL.md',
  ];
  const marker = '`${CLAUDE_PLUGIN_ROOT}` is a markdown-interpolation token';
  const endMarker = '`find / -iname`.';
  const carriesFullParagraph = (rel) => {
    const text = read(rel);
    const start = text.indexOf(marker);
    return start >= 0 && text.indexOf(endMarker, start) >= start;
  };
  // The full paragraph must live in exactly one file — the SSOT.
  const carriers = [SSOT, ...pointers].filter(carriesFullParagraph);
  assert.deepStrictEqual(carriers, [SSOT],
    `the full CLAUDE_PLUGIN_ROOT guardrail paragraph must live only in ${SSOT}, found in: ${carriers.join(', ') || 'none'}`);
  // Each former mirror now points at the SSOT reference file.
  for (const rel of pointers) {
    assert.ok(read(rel).includes('review-gate-mechanics.md'),
      `${rel} must point to the review-gate-mechanics.md SSOT for the CLAUDE_PLUGIN_ROOT caveat`);
  }
  // The removed keep-in-sync mirror markers must not resurface.
  for (const rel of [SSOT, ...pointers]) {
    assert.ok(!read(rel).includes('— keep in sync -->'),
      `${rel} must not carry the removed keep-in-sync mirror marker`);
  }
});

run('policy-static-guardrails');
