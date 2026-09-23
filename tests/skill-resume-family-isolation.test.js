'use strict';

// Raw-directory behavior tests for the resume helper migration. Canonical
// owner Skills and the synchronized resume copies are relocated into a fresh
// fixture project; no root helper path or peer Skill fallback is allowed.

const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const { withIsolatedSkill } = require('./_lib/skill-directory-isolation');
const { registerResumeFamilyFixtures } = require('./_lib/skill-resume-family-fixtures');

const ROOT = path.join(__dirname, '..');
const FIXTURES = registerResumeFamilyFixtures();

function runResumeFixture(id) {
  const fixture = FIXTURES[id];
  assert.ok(fixture, `unknown resume-family fixture: ${id}`);
  const source = path.join(ROOT, 'skills', fixture.skill);
  return withIsolatedSkill({ source, stubs: fixture.stubs }, (context) => {
    fixture.prepare(context);
    try {
      const result = context.run(fixture.entry, fixture.args, { input: fixture.input });
      fixture.assert(result, context);
      return result;
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        assert.fail(`skill-local resume entry is missing: ${fixture.skill}/${fixture.entry}`);
      }
      throw error;
    }
  });
}

test('resume-family registry exposes canonical owners and synchronized local entries', () => {
  const ids = Object.keys(FIXTURES).sort();
  assert.deepStrictEqual(ids, [
    'resume-detect-missing-handoff-save',
    'resume-detect-saved-old-resume',
    'resume-extract-compact-copy',
    'resume-extract-compact-owner',
    'resume-post-observation-copy-unavailable',
    'resume-post-observation-owner-unavailable',
    'resume-set-state-consuming',
    'resume-write-create-explicit',
    'resume-write-missing-leaf-claude-symlink',
    'resume-write-missing-leaf-dhpk-symlink',
    'resume-write-missing-leaf-explicit-symlink',
  ]);
  const expectedEntries = {
    'resume-detect-missing-handoff-save': ['opsx-apply-resume', 'scripts/detect-phase.sh'],
    'resume-detect-saved-old-resume': ['opsx-apply-resume', 'scripts/detect-phase.sh'],
    'resume-set-state-consuming': ['opsx-apply-resume', 'scripts/set-handoff-state.sh'],
    'resume-write-create-explicit': ['opsx-apply-resume', 'scripts/write-handoff.sh'],
    'resume-write-missing-leaf-claude-symlink': ['opsx-apply-resume', 'scripts/write-handoff.sh'],
    'resume-write-missing-leaf-dhpk-symlink': ['opsx-apply-resume', 'scripts/write-handoff.sh'],
    'resume-write-missing-leaf-explicit-symlink': ['opsx-apply-resume', 'scripts/write-handoff.sh'],
    'resume-extract-compact-owner': ['dhpk-opsx-load-context', 'scripts/extract-compact.sh'],
    'resume-extract-compact-copy': ['opsx-apply-resume', 'scripts/extract-compact.sh'],
    'resume-post-observation-owner-unavailable': ['dhpk-opsx-post-observation', 'scripts/post-obs.sh'],
    'resume-post-observation-copy-unavailable': ['opsx-apply-resume', 'scripts/post-obs.sh'],
  };
  for (const [id, fixture] of Object.entries(FIXTURES)) {
    assert.deepStrictEqual([fixture.skill, fixture.entry], expectedEntries[id], id);
    assert.ok(Number.isInteger(fixture.expected.status), id);
    assert.ok(Array.isArray(fixture.expected.output) && fixture.expected.output.length > 0, id);
    assert.ok(fixture.expected.output.every((fragment) => typeof fragment === 'string' && fragment.length > 0), id);
    assert.strictEqual(fixture.evidenceKind, 'fixture', id);
  }
});

test('local detect-phase reports Save for a missing handoff', () => {
  runResumeFixture('resume-detect-missing-handoff-save');
});

test('local detect-phase reports Resume for an old saved handoff', () => {
  runResumeFixture('resume-detect-saved-old-resume');
});

test('local set-handoff-state updates the explicit state field', () => {
  runResumeFixture('resume-set-state-consuming');
});

test('local write-handoff preserves the complete explicit payload', () => {
  runResumeFixture('resume-write-create-explicit');
});

test('local write-handoff rejects a missing leaf below a symlinked .dhpk parent', () => {
  runResumeFixture('resume-write-missing-leaf-dhpk-symlink');
});

test('local write-handoff rejects a missing leaf below a symlinked .claude parent', () => {
  runResumeFixture('resume-write-missing-leaf-claude-symlink');
});

test('local write-handoff rejects a missing leaf below an explicit symlinked parent', () => {
  runResumeFixture('resume-write-missing-leaf-explicit-symlink');
});

test('canonical load-context extractor emits compact JSON fields', () => {
  runResumeFixture('resume-extract-compact-owner');
});

test('resume Skill receives the synchronized compact extractor copy', () => {
  runResumeFixture('resume-extract-compact-copy');
});

test('canonical post-observation helper handles denied memory service safely', () => {
  runResumeFixture('resume-post-observation-owner-unavailable');
});

test('resume Skill receives the synchronized post-observation copy', () => {
  runResumeFixture('resume-post-observation-copy-unavailable');
});

run('skill-resume-family-isolation');
