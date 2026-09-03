'use strict';

// Description-migration regression tests
// (openspec/changes/clarify-dhpk-skill-invocation-policy tasks 4.1-4.3).
// design.md: "Explicit-only descriptions prioritize concise purpose and
// explicit effects. Implicit-eligible descriptions retain Use when, Not for,
// and Output routing cues." Explicit-only skills carry
// disable-model-invocation, so a lingering "Use when" trigger phrase is dead
// routing bait, not a functional cue — this test enforces the migration in
// both directions across all canonical (root + module) skills.

const fs = require('fs');
const path = require('path');
const { test, run, assert } = require('./_lib/tinytest');
const { collectInventory, relativePosix } = require('../scripts/lib/asset-inventory');
const { extract, extractInvocationClass } = require('../scripts/ci/_lib/frontmatter');

const ROOT = path.join(__dirname, '..');

const TRIGGER_RE = /Use (when|after|for)/i;
const NOT_FOR_RE = /Not for/i;
const OUTPUT_RE = /Output[:：]|output is/i;

function loadSkills() {
  const inv = collectInventory(ROOT);
  return inv.paths.skills.map((f) => {
    const rel = relativePosix(ROOT, f);
    const content = fs.readFileSync(f, 'utf8');
    const fm = extract(content);
    const ic = extractInvocationClass(content);
    return { rel, description: fm.values.description || '', ic };
  }).filter((s) => s.ic.present && !s.ic.unknownValue);
}

const skills = loadSkills();

test('every implicit-eligible skill description retains Use-when/Not-for/Output routing cues', () => {
  const missing = skills
    .filter((s) => s.ic.value === 'implicit-eligible')
    .filter((s) => !(TRIGGER_RE.test(s.description) && NOT_FOR_RE.test(s.description) && OUTPUT_RE.test(s.description)))
    .map((s) => s.rel);
  assert.deepStrictEqual(missing, [], `implicit-eligible skills missing a routing cue: ${missing.join(', ')}`);
});

test('every explicit-only skill description drops the Use-when trigger phrase (dead routing bait)', () => {
  const stale = skills
    .filter((s) => s.ic.value === 'explicit-only')
    .filter((s) => TRIGGER_RE.test(s.description))
    .map((s) => s.rel);
  assert.deepStrictEqual(stale, [], `explicit-only skills still carry a Use-when trigger phrase: ${stale.join(', ')}`);
});

test('every explicit-only skill description is non-empty and states an effect', () => {
  const empty = skills
    .filter((s) => s.ic.value === 'explicit-only')
    .filter((s) => s.description.trim().length < 20)
    .map((s) => s.rel);
  assert.deepStrictEqual(empty, [], `explicit-only skills with a too-short description: ${empty.join(', ')}`);
});

test('sanity: classified skill counts match the known inventory shape', () => {
  const implicitCount = skills.filter((s) => s.ic.value === 'implicit-eligible').length;
  const explicitCount = skills.filter((s) => s.ic.value === 'explicit-only').length;
  assert.strictEqual(implicitCount, 66, `expected 66 implicit-eligible skills after capability-family consolidation, found ${implicitCount}`);
  assert.strictEqual(explicitCount, 19, `expected 19 explicit-only skills after capability-family consolidation, found ${explicitCount}`);
});

run('description-invocation-cues');
