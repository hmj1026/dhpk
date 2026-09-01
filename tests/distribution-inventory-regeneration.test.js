'use strict';

const { test, run, assert } = require('./_lib/tinytest');
const {
  classifyWritePolicy,
  assertCanonicalSkillPath,
} = require('../scripts/lib/distribution-inventory-regeneration');

test('missing policy bootstraps', () => {
  assert.deepStrictEqual(classifyWritePolicy(false, undefined), { action: 'bootstrap' });
});

test('exact v1 policy allows legacy write', () => {
  assert.deepStrictEqual(classifyWritePolicy(true, { schema: 'dhpk.distribution-inventory.v1' }), { action: 'legacy-write' });
});

test('exact v2 policy rejects with refresh diagnostic', () => {
  assert.deepStrictEqual(classifyWritePolicy(true, { schema: 'dhpk.distribution-inventory.v2' }), {
    action: 'reject', diagnostic: 'inventory is unchanged; use --refresh-supporting-digests',
  });
});

test('object missing schema rejects literally', () => {
  assert.deepStrictEqual(classifyWritePolicy(true, {}), {
    action: 'reject', diagnostic: "unsupported schema '<missing>'; expected dhpk.distribution-inventory.v1 or dhpk.distribution-inventory.v2",
  });
});

test('scalar null array and falsey values reject', () => {
  for (const parsed of [null, false, 0, '', [], 'text']) {
    assert.deepStrictEqual(classifyWritePolicy(true, parsed), {
      action: 'reject', diagnostic: 'unsupported/invalid schema; expected an inventory object',
    });
  }
});

test('root skill path is classified exactly', () => {
  assert.deepStrictEqual(assertCanonicalSkillPath('skills/demo/SKILL.md'), {
    classification: 'root', id: 'demo', path: 'skills/demo',
  });
});

test('module skill path is classified exactly', () => {
  assert.deepStrictEqual(assertCanonicalSkillPath('modules/foo/skills/demo/SKILL.md'), {
    classification: 'module', module: 'foo', id: 'demo', path: 'modules/foo/skills/demo',
  });
});

test('nested path throws with identity', () => {
  assert.throws(() => assertCanonicalSkillPath('skills/group/demo/SKILL.md'), /unclassified canonical entry: skills\/group\/demo\/SKILL\.md/);
});

test('non-string path throws with identity', () => {
  assert.throws(() => assertCanonicalSkillPath(null), /unclassified canonical entry: null/);
  assert.throws(() => assertCanonicalSkillPath(42), /unclassified canonical entry: 42/);
});

run('distribution-inventory-regeneration');
