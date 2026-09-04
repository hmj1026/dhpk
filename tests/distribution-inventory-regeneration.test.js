'use strict';

const { test, run, assert } = require('./_lib/tinytest');
const {
  classifyWritePolicy,
  assertCanonicalSkillPath,
} = require('../scripts/lib/distribution-inventory-regeneration');
const { preserveProjectionContract } = require('../scripts/lib/distribution-inventory');

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

test('v2 regeneration preserves external package ownership metadata', () => {
  const ledger = [{
    id: 'gitnexus', owner: 'upstream',
    repository: 'https://github.com/abhigyanpatwari/GitNexus',
    policy: 'protect-existing', license_review: 'open',
    stable_ids: ['gitnexus-cli'],
  }];
  const regenerated = preserveProjectionContract(
    { schema: 'dhpk.distribution-inventory.v2', skills: [], modules: [] },
    { external_skill_packages: ledger },
  );
  assert.deepStrictEqual(regenerated.external_skill_packages, ledger);
});

test('v2 regeneration preserves each skill usage contract by stable id', () => {
  const usage = {
    display_name: 'Demo Skill',
    summary: 'Inspect a demo task with bounded read-only evidence',
    syntax: '$dhpk-demo <task>',
    input_kind: 'free-text',
    invocation_class: 'implicit-eligible',
    effect_authority: 'read-only',
    actions: [],
    options: [],
    examples: [{ prompt: '$dhpk-demo inspect this task', summary: 'Inspect a demo task' }],
  };
  const regenerated = preserveProjectionContract(
    {
      schema: 'dhpk.distribution-inventory.v2',
      skills: [{ id: 'demo', path: 'skills/demo', lifecycle: 'promoted' }],
      modules: [],
    },
    { skills: [{ id: 'demo', usage }], modules: [] },
  );
  assert.deepStrictEqual(regenerated.skills[0].usage, usage);
  assert.notStrictEqual(regenerated.skills[0].usage, usage);
  usage.examples[0].summary = 'caller mutation';
  assert.strictEqual(regenerated.skills[0].usage.examples[0].summary, 'Inspect a demo task');
});

test('v2 regeneration preserves the diagnostic-only public-name rename ledger', () => {
  const renamedSkillNames = [{
    id: 'laravel',
    oldName: 'dhpk-laravel',
    oldPath: 'skills/dhpk-laravel',
    newName: 'laravel',
    newPath: 'skills/laravel',
    rollback: { release: '0.53.0' },
  }];
  const regenerated = preserveProjectionContract(
    { schema: 'dhpk.distribution-inventory.v2', skills: [], modules: [] },
    { renamed_skill_names: renamedSkillNames },
  );
  assert.deepStrictEqual(regenerated.renamed_skill_names, renamedSkillNames);
  assert.notStrictEqual(regenerated.renamed_skill_names, renamedSkillNames);
  renamedSkillNames[0].rollback.release = 'caller-mutation';
  assert.strictEqual(regenerated.renamed_skill_names[0].rollback.release, '0.53.0');
});

run('distribution-inventory-regeneration');
