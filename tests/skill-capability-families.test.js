'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { test, run, assert } = require('./_lib/tinytest');
const inventoryApi = require('../scripts/lib/distribution-inventory');

const ROOT = path.join(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const INVENTORY = JSON.parse(read('manifests/distribution-inventory.json'));
const PROFILES = JSON.parse(read('manifests/install-profiles.json'));

const PORTABLE_FAMILIES = Object.freeze([
  'change-verdict', 'code-trace', 'flow-drive', 'flow-guide', 'harness-govern',
  'laravel', 'phpunit', 'skill-forge', 'skill-scope',
]);

// The first family wave remains a closed 0.53.0 ledger.  The 0.54.0
// remaining-wave rows are covered by consolidate-remaining-dhpk-skill-families
// and must not be silently folded into this historical wave assertion.
const FAMILY_MODES = Object.freeze({
  'skill-scope': Object.freeze({
    'skill-health-check': 'health',
    'skill-judge': 'judge',
    'skill-stocktake': 'stocktake',
    'skill-scout': 'scout',
  }),
  'skill-forge': Object.freeze({
    'create-skill': 'create',
    'rules-distill': 'distill-rules',
  }),
  'flow-guide': Object.freeze({
    'adaptive-dev-workflow': 'route',
    'dhpk-execution-policy': 'rules',
    'next-step': 'next',
    'execution-checklist': 'close',
    do: 'route',
  }),
  'flow-drive': Object.freeze({
    implement: undefined,
  }),
  'change-verdict': Object.freeze({
    'codex-code-review': 'code',
    'pr-review': 'pr',
    'security-review': 'security',
    'test-review': 'tests',
    'doc-review': 'docs',
    'risk-assess': 'risk',
  }),
  'code-trace': Object.freeze({
    'code-explore': 'explore',
    'bug-investigation': 'diagnose',
    'git-investigate': 'history',
    'tool-routing': 'select-tool',
  }),
});

const RETIRED_COMMANDS = Object.freeze([
  'check-skill', 'create-dev', 'do', 'codex-review', 'codex-review-fast',
  'codex-review-branch', 'codex-review-doc', 'codex-security',
  'codex-test-review', 'review-spec',
]);

const GITNEXUS_IDS = Object.freeze([
  'gitnexus-cli', 'gitnexus-debugging', 'gitnexus-exploring',
  'gitnexus-guide', 'gitnexus-impact-analysis', 'gitnexus-refactoring',
]);

const GITNEXUS_BASELINE = Object.freeze({
  'gitnexus-cli': '0669acbc46c0bd35d4b8bb14990df859ca9db40eb3ef2497d33b1eadde8426dc',
  'gitnexus-debugging': 'ab9ddf9e646b76e14347e6ceb0ce93db2dc350672d14d0295555bf9c4eeb93c3',
  'gitnexus-exploring': '1dc65f86c91c17a341a345cf8b7e53a8de1a44078d1cc1e2cc954b5cd05d720c',
  'gitnexus-guide': 'f922e0f0873fbf89940da9fb72b9dd7b374b6f0b7b6ec8bac06e57d568f23f40',
  'gitnexus-impact-analysis': 'c3869106e3a4a8b4a1561019a4bcb748bff9b3642b40537f389a13daab5b01de',
  'gitnexus-refactoring': 'd656b378beae97c5d4c9c4a86ccb773078f5d9b61e38be8fb09c0c41f2797c9a',
});

function sha256(relative) {
  return crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, relative))).digest('hex');
}

test('inventory exposes nine portable capability families and the exact 22 retirement mappings', () => {
  assert.strictEqual(INVENTORY.skills.length, 65);
  assert.deepStrictEqual(
    INVENTORY.skills.filter((entry) => entry.name_style === 'portable-family').map((entry) => entry.id).sort(),
    [...PORTABLE_FAMILIES].sort(),
  );
  const retirements = new Map(INVENTORY.retired_skills.map((entry) => [entry.id, entry]));
  for (const [family, predecessors] of Object.entries(FAMILY_MODES)) {
    const skill = INVENTORY.skills.find((entry) => entry.id === family);
    assert.ok(skill, `missing family ${family}`);
    assert.strictEqual(skill.name, family);
    assert.strictEqual(skill.name_style, 'portable-family');
    assert.strictEqual(skill.path, `skills/${family}`);
    for (const [predecessor, mode] of Object.entries(predecessors)) {
      const retired = retirements.get(predecessor);
      assert.ok(retired, `missing retirement ${predecessor}`);
      assert.strictEqual(retired.retiredIn, '0.53.0');
      assert.deepStrictEqual(retired.rollback, { release: '0.52.0' });
      const replacement = { kind: 'skill', id: family };
      if (mode !== undefined) replacement.mode = mode;
      assert.deepStrictEqual(retired.replacements, [replacement]);
      assert.ok(!INVENTORY.skills.some((entry) => entry.id === predecessor));
    }
  }
});

test('capability-family retirement is closed and rejects missing, duplicate, or remapped predecessors', () => {
  const expected = Object.entries(FAMILY_MODES).flatMap(([family, predecessors]) => (
    Object.entries(predecessors).map(([id, mode]) => ({ id, family, mode }))
  ));
  const actual = INVENTORY.retired_skills
    .filter((entry) => entry.retiredIn === '0.53.0')
    .map((entry) => {
      const replacement = entry.replacements && entry.replacements[0];
      return { id: entry.id, family: replacement && replacement.id, mode: replacement && replacement.mode };
    })
    .sort((left, right) => left.id.localeCompare(right.id));
  assert.deepStrictEqual(actual, expected.sort((left, right) => left.id.localeCompare(right.id)));

  const missing = JSON.parse(JSON.stringify(INVENTORY));
  missing.retired_skills = missing.retired_skills.filter((entry) => entry.id !== 'tool-routing');
  assert.match(
    inventoryApi.validateSkillRetirements({ inventory: missing }).errors.join('\n'),
    /tool-routing.*capability-family|capability-family.*tool-routing/i,
  );

  const duplicate = JSON.parse(JSON.stringify(INVENTORY));
  duplicate.retired_skills.push(JSON.parse(JSON.stringify(
    duplicate.retired_skills.find((entry) => entry.id === 'tool-routing'),
  )));
  assert.match(
    inventoryApi.validateSkillRetirements({ inventory: duplicate }).errors.join('\n'),
    /duplicate retired stable id.*tool-routing/i,
  );

  const remapped = JSON.parse(JSON.stringify(INVENTORY));
  remapped.retired_skills.find((entry) => entry.id === 'tool-routing').replacements = [
    { kind: 'skill', id: 'code-trace', mode: 'explore' },
  ];
  assert.match(
    inventoryApi.validateSkillRetirements({ inventory: remapped }).errors.join('\n'),
    /tool-routing.*select-tool|select-tool.*tool-routing/i,
  );

  const externalPredecessor = JSON.parse(JSON.stringify(INVENTORY));
  externalPredecessor.retired_skills.push({
    id: 'gitnexus-cli', name: 'dhpk-gitnexus-cli', canonicalPath: 'skills/dhpk-gitnexus-cli',
    priorSurfaces: ['claude-core'], retiredIn: '0.53.0', reasonCode: 'capability-family-consolidation',
    replacements: [{ kind: 'skill', id: 'code-trace', mode: 'select-tool' }], rollback: { release: '0.52.0' },
  });
  assert.match(
    inventoryApi.validateSkillRetirements({ inventory: externalPredecessor }).errors.join('\n'),
    /gitnexus-cli.*external-package|external-package.*gitnexus-cli/i,
  );
});

test('external package ledger is preserved and rejects protected retirement', () => {
  assert.strictEqual(typeof inventoryApi.validateExternalSkillPackages, 'function');
  assert.deepStrictEqual(inventoryApi.validateExternalSkillPackages({ inventory: INVENTORY }).errors, []);
  const generated = { schema: INVENTORY.schema, skills: INVENTORY.skills, modules: INVENTORY.modules };
  const preserved = inventoryApi.preserveProjectionContract(generated, INVENTORY);
  assert.deepStrictEqual(preserved.external_skill_packages, INVENTORY.external_skill_packages);

  const invalid = JSON.parse(JSON.stringify(INVENTORY));
  invalid.retired_skills.push({
    id: 'gitnexus-cli', name: 'dhpk-gitnexus-cli', canonicalPath: 'skills/dhpk-gitnexus-cli',
    priorSurfaces: ['claude-core'], retiredIn: '0.53.0', reasonCode: 'invalid-external-retirement',
    replacements: [{ kind: 'skill', id: 'code-trace', mode: 'select-tool' }], rollback: { release: '0.52.0' },
  });
  assert.match(inventoryApi.validateExternalSkillPackages({ inventory: invalid }).errors.join('\n'), /gitnexus-cli.*retired|retired.*gitnexus-cli/i);
});

test('GitNexus packages remain byte-identical and active', () => {
  for (const id of GITNEXUS_IDS) {
    const entry = INVENTORY.skills.find((skill) => skill.id === id);
    assert.ok(entry, `missing protected ${id}`);
    assert.ok(!INVENTORY.retired_skills.some((retired) => retired.id === id));
    assert.strictEqual(sha256(`${entry.path}/SKILL.md`), GITNEXUS_BASELINE[id], id);
  }
});

test('profiles, shared surfaces, and command retirement match the approved cutover', () => {
  assert.strictEqual(PROFILES.profiles.minimal.skillIds.length, 8);
  assert.strictEqual(PROFILES.profiles.full.skillIds.length, 55);
  assert.strictEqual(PROFILES.profiles['compat-v1'].skillIds.length, 62);
  assert.strictEqual(INVENTORY.surface_membership['agent-plugin'].length, 37);
  assert.strictEqual(INVENTORY.surface_membership['cursor-plugin'].length, 37);
  assert.strictEqual(INVENTORY.surface_membership['agy-plugin'].length, 37);
  assert.strictEqual(INVENTORY.surface_membership['cursor-sync'].length, 37);
  for (const command of RETIRED_COMMANDS) {
    assert.ok(!fs.existsSync(path.join(ROOT, 'commands', `${command}.md`)), `${command} must be retired`);
  }
});

test('reborn skills expose exact modes and invocation metadata', () => {
  for (const [family, predecessors] of Object.entries(FAMILY_MODES)) {
    const body = read(`skills/${family}/SKILL.md`);
    const metadata = read(`skills/${family}/agents/openai.yaml`);
    for (const mode of Object.values(predecessors)) {
      if (mode !== undefined) assert.match(body, new RegExp(`\\b${mode}\\b`), `${family}:${mode}`);
    }
    assert.match(metadata, new RegExp(`\\$${family}\\b`));
    const explicit = family === 'skill-forge' || family === 'flow-drive';
    if (explicit) assert.match(metadata, /allow_implicit_invocation:\s*false/);
    else assert.doesNotMatch(metadata, /allow_implicit_invocation:\s*false/);
  }
  assert.match(read('skills/change-verdict/SKILL.md'), /read-only|read only/i);
});

test('harness-govern retains the five consolidated governance modes', () => {
  const body = read('skills/harness-govern/SKILL.md');
  const metadata = read('skills/harness-govern/agents/openai.yaml');
  for (const mode of ['health', 'budget', 'fill', 'revise', 'sync']) {
    assert.match(body, new RegExp(`\\b${mode}\\b`), `harness-govern:${mode}`);
  }
  assert.ok(metadata.includes('$harness-govern'));
  assert.match(metadata, /allow_implicit_invocation:\s*false/);
});

run('skill-capability-families');
