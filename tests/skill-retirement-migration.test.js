'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const {
  resolveSkillIdentity,
  formatSkillIdentityDiagnostic,
  validateSkillRetirements,
  preserveProjectionContract,
  compileClaudeProjection,
} = require('../scripts/lib/distribution-inventory');

const ROOT = path.join(__dirname, '..');
const INVENTORY = require('../manifests/distribution-inventory.json');
const RETIRED_NAMES = [
  'dhpk-bug-fix',
  'dhpk-feature-dev',
  'dhpk-post-dev-test',
  'dhpk-codex-brainstorm',
  'dhpk-de-ai-flavor',
];

const RETIREMENTS = [
  {
    id: 'bug-fix', name: 'dhpk-bug-fix', canonicalPath: 'skills/dhpk-bug-fix', retiredIn: '0.47.0',
    reasonCode: 'merged-into-adaptive-workflow', priorSurfaces: ['claude-core', 'cursor-sync'],
    replacements: [{ kind: 'skill', id: 'adaptive-dev-workflow', mode: 'bug' }], rollback: { release: '0.46.1' },
  },
  {
    id: 'feature-dev', name: 'dhpk-feature-dev', canonicalPath: 'skills/dhpk-feature-dev', retiredIn: '0.47.0',
    reasonCode: 'merged-into-adaptive-workflow', priorSurfaces: ['claude-core', 'cursor-sync'],
    replacements: [{ kind: 'skill', id: 'adaptive-dev-workflow', mode: 'feature' }], rollback: { release: '0.46.1' },
  },
  {
    id: 'post-dev-test', name: 'dhpk-post-dev-test', canonicalPath: 'skills/dhpk-post-dev-test', retiredIn: '0.47.0',
    reasonCode: 'split-by-test-level', priorSurfaces: ['claude-core', 'cursor-sync'],
    replacements: [{ kind: 'skill', id: 'tdd', mode: 'unit-integration' }, { kind: 'agent', id: 'e2e-runner', mode: 'playwright-journey' }], rollback: { release: '0.46.1' },
  },
  {
    id: 'codex-brainstorm', name: 'dhpk-codex-brainstorm', canonicalPath: 'skills/dhpk-codex-brainstorm', retiredIn: '0.47.0',
    reasonCode: 'merged-into-architect-mode', priorSurfaces: ['claude-core', 'cursor-sync'],
    replacements: [{ kind: 'skill', id: 'codex-architect', mode: 'adversarial' }], rollback: { release: '0.46.1' },
  },
  {
    id: 'de-ai-flavor', name: 'dhpk-de-ai-flavor', canonicalPath: 'skills/dhpk-de-ai-flavor', retiredIn: '0.47.0',
    reasonCode: 'model-default-capability-removal', priorSurfaces: ['claude-core', 'cursor-sync'],
    replacements: [{ kind: 'model-default' }], rollback: { release: '0.46.1' },
  },
];

function fixtureInventory() {
  return {
    ...INVENTORY,
    skills: INVENTORY.skills.filter((entry) => !RETIRED_NAMES.includes(entry.name)),
    retired_skills: RETIREMENTS,
    surface_membership: Object.fromEntries(Object.entries(INVENTORY.surface_membership || {}).map(([surface, ids]) => [
      surface,
      ids.filter((id) => !RETIREMENTS.some((entry) => entry.id === id)),
    ])),
  };
}

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), 'utf8');
}

function walkTextFiles(relative) {
  const absolute = path.join(ROOT, relative);
  const stat = fs.statSync(absolute);
  if (stat.isFile()) return [relative];
  return fs.readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const child = path.join(relative, entry.name);
    return entry.isDirectory() ? walkTextFiles(child) : [child];
  });
}

test('checked-in inventory owns five alias-free 0.47.0 retirement records', () => {
  assert.ok(Array.isArray(INVENTORY.retired_skills), 'checked-in inventory must declare retired_skills');
  assert.deepStrictEqual(validateSkillRetirements({ inventory: INVENTORY }).errors, []);
  assert.deepStrictEqual(
    INVENTORY.retired_skills.map((entry) => entry.name).sort(),
    [...RETIRED_NAMES].sort(),
  );
  assert.ok(INVENTORY.retired_skills.every((entry) => entry.retiredIn === '0.47.0'));
  assert.ok(RETIRED_NAMES.every((name) => !INVENTORY.skills.some((entry) => entry.name === name)));
  assert.ok(RETIRED_NAMES.every((name) => !fs.existsSync(path.join(ROOT, 'skills', name))));
});

test('retirement validation rejects a skill replacement that is not active', () => {
  const inventory = fixtureInventory();
  inventory.retired_skills = inventory.retired_skills.map((entry, index) => index === 0
    ? { ...entry, replacements: [{ kind: 'skill', id: 'missing-successor', mode: 'bug' }] }
    : entry);
  const result = validateSkillRetirements({ inventory });
  assert.ok(result.errors.some((error) => /must reference an active skill.*missing-successor/.test(error)), result.errors.join('\n'));
});

test('retirement validation rejects agent replacements outside the inventory-owned roster', () => {
  const inventory = fixtureInventory();
  inventory.retired_skills = inventory.retired_skills.map((entry, index) => index === 2
    ? { ...entry, replacements: [{ kind: 'agent', id: 'not-an-agent', mode: 'playwright-journey' }] }
    : entry);
  const result = validateSkillRetirements({ inventory });
  assert.ok(result.errors.some((error) => /inventory-owned active agent.*not-an-agent/.test(error)), result.errors.join('\n'));
});

test('retirement validation rejects surfaces outside the canonical surface enum', () => {
  const inventory = fixtureInventory();
  inventory.retired_skills = inventory.retired_skills.map((entry, index) => index === 0
    ? { ...entry, priorSurfaces: ['claude-core', 'made-up-surface'] }
    : entry);
  const result = validateSkillRetirements({ inventory });
  assert.ok(result.errors.some((error) => /invalid surface.*made-up-surface/.test(error)), result.errors.join('\n'));
});

test('retirement validation rejects unsafe stable ids before diagnostics', () => {
  const inventory = fixtureInventory();
  inventory.retired_skills = [{
    ...inventory.retired_skills[0],
    id: '../retired-helper',
  }, ...inventory.retired_skills.slice(1)];
  const result = validateSkillRetirements({ inventory });
  assert.ok(result.errors.some((error) => /id.*safe|id.*format|id.*identifier/i.test(error)), result.errors.join('\n'));
  assert.deepStrictEqual(resolveSkillIdentity({ inventory, identifier: '../retired-helper' }), {
    state: 'unknown', identifier: '../retired-helper',
  });
});

test('retirement rows reject compatibility aliases and active identity wins on collision', () => {
  const aliased = fixtureInventory();
  aliased.retired_skills = [{ ...aliased.retired_skills[0], legacy_names: ['old-bug-fix'] }, ...aliased.retired_skills.slice(1)];
  const validation = validateSkillRetirements({ inventory: aliased });
  assert.ok(validation.errors.some((error) => /legacy_names.*alias-free/.test(error)), validation.errors.join('\n'));
  assert.deepStrictEqual(resolveSkillIdentity({ inventory: aliased, identifier: 'old-bug-fix' }), {
    state: 'unknown', identifier: 'old-bug-fix',
  });

  const collision = fixtureInventory();
  collision.retired_skills = [{
    ...collision.retired_skills[0], id: 'tdd', name: 'dhpk-tdd-workflow', legacy_names: ['tdd'],
  }, ...collision.retired_skills.slice(1)];
  assert.deepStrictEqual(resolveSkillIdentity({ inventory: collision, identifier: 'tdd' }), {
    state: 'active', stableId: 'tdd', publicName: 'dhpk-tdd-workflow',
  });
});

test('inventory regeneration and normalized projection evidence preserve retirement identity', () => {
  const inventory = fixtureInventory();
  const generated = { schema: inventory.schema, skills: inventory.skills, modules: inventory.modules };
  const preserved = preserveProjectionContract(generated, inventory);
  assert.deepStrictEqual(preserved.retired_skills, inventory.retired_skills);
  const compiled = compileClaudeProjection({ inventory });
  assert.strictEqual(compiled.ok, true, compiled.error && compiled.error.message);
  assert.deepStrictEqual(
    compiled.inventoryView.retiredSkills.map((entry) => entry.id).sort(),
    inventory.retired_skills.map((entry) => entry.id).sort(),
  );
  assert.ok(compiled.generated.generatedSkillIds.every((id) => !inventory.retired_skills.some((entry) => entry.id === id)));
});

test('migration documentation mirrors all five retirement rows and host limits', () => {
  const documents = [read('docs/skill-platform-migration.md'), read('docs/skill-platform-migration.zh-TW.md')];
  const escaped = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  for (const text of documents) {
    assert.match(text, /retired_skills/);
    assert.match(text, /0\.46\.1/);
    assert.match(text, /unknown-skill/);
    assert.match(text, /(?:direct invocation|直接呼叫)/i);
    assert.match(text, /(?:bypass|繞過)/i);
    assert.match(text, /(?:discovery alias|discovery 或 compatibility alias)/i);
    for (const entry of RETIREMENTS) {
      assert.match(text, new RegExp(escaped(entry.id)));
      assert.match(text, new RegExp(escaped(entry.name)));
      assert.match(text, new RegExp(escaped(entry.reasonCode)));
      assert.match(text, new RegExp(escaped(entry.rollback.release)));
      for (const replacement of entry.replacements) {
        assert.match(text, new RegExp(escaped(replacement.kind)));
        if (replacement.id) assert.match(text, new RegExp(escaped(replacement.id)));
        if (replacement.mode) assert.match(text, new RegExp(escaped(replacement.mode)));
      }
    }
  }
});

test('identity resolution distinguishes active, retired skill, retired model-default, and unknown', () => {
  const inventory = fixtureInventory();
  assert.deepStrictEqual(resolveSkillIdentity({ inventory, identifier: 'tdd' }), {
    state: 'active', stableId: 'tdd', publicName: 'dhpk-tdd-workflow',
  });
  assert.deepStrictEqual(resolveSkillIdentity({ inventory, identifier: 'dhpk-bug-fix' }), {
    state: 'retired', stableId: 'bug-fix', publicName: 'dhpk-bug-fix', retiredIn: '0.47.0',
    reasonCode: 'merged-into-adaptive-workflow',
    replacements: [{ kind: 'skill', id: 'adaptive-dev-workflow', mode: 'bug' }],
  });
  assert.deepStrictEqual(resolveSkillIdentity({ inventory, identifier: 'de-ai-flavor' }), {
    state: 'retired', stableId: 'de-ai-flavor', publicName: 'dhpk-de-ai-flavor', retiredIn: '0.47.0',
    reasonCode: 'model-default-capability-removal',
    replacements: [{ kind: 'model-default' }],
  });
  assert.deepStrictEqual(resolveSkillIdentity({ inventory, identifier: 'missing-skill' }), {
    state: 'unknown', identifier: 'missing-skill',
  });
});

test('malformed retirement rows fail closed before identity diagnostics', () => {
  const inventory = fixtureInventory();
  inventory.retired_skills = [{
    id: 'retired-helper',
    name: 'dhpk-retired-helper',
    canonicalPath: 'skills/dhpk-retired-helper',
    retiredIn: '0.47.0',
    reasonCode: 'test',
    priorSurfaces: ['claude-core'],
    replacements: [{ kind: 'skill', id: 'missing-successor' }, { kind: 'model-default', id: 'forbidden' }],
    rollback: { release: '0.46.1' },
  }];
  const validation = validateSkillRetirements({ inventory });
  assert.ok(validation.errors.some((error) => /must reference an active skill.*missing-successor/.test(error)), validation.errors.join('\n'));
  assert.ok(validation.errors.some((error) => /model-default replacement must not declare id/.test(error)), validation.errors.join('\n'));
  assert.deepStrictEqual(resolveSkillIdentity({ inventory, identifier: 'dhpk-retired-helper' }), {
    state: 'unknown', identifier: 'dhpk-retired-helper',
  });
  assert.strictEqual(formatSkillIdentityDiagnostic({
    inventory,
    resolution: { state: 'retired', stableId: 'retired-helper', publicName: 'dhpk-retired-helper' },
  }), '');
});

test('run-skill reports retired guidance separately from unknown scripts', () => {
  const script = path.join(ROOT, 'scripts', 'run-skill.sh');
  const inventory = fixtureInventory();
  const retired = spawnSync('bash', [script, 'dhpk-bug-fix', 'anything.js'], { cwd: ROOT, encoding: 'utf8' });
  assert.strictEqual(retired.status, 2);
  assert.match(retired.stderr, /retired in 0\.47\.0/i);
  assert.match(retired.stderr, /reason:\s*merged-into-adaptive-workflow/i);
  assert.match(retired.stderr, /dhpk-adaptive-dev-workflow.*bug/i);

  const modelDefault = spawnSync('bash', [script, 'dhpk-de-ai-flavor', 'anything.js'], { cwd: ROOT, encoding: 'utf8' });
  assert.strictEqual(modelDefault.status, 2);
  assert.match(modelDefault.stderr, /reason:\s*model-default-capability-removal/i);
  assert.match(modelDefault.stderr, /model-default/i);

  const diagnostic = formatSkillIdentityDiagnostic({
    inventory,
    resolution: resolveSkillIdentity({ inventory, identifier: 'dhpk-bug-fix' }),
  });
  assert.match(diagnostic, /retired in 0\.47\.0/);
  assert.match(diagnostic, /reason:\s*merged-into-adaptive-workflow/);

  const unknown = spawnSync('bash', [script, 'not-in-inventory', 'anything.js'], { cwd: ROOT, encoding: 'utf8' });
  assert.strictEqual(unknown.status, 2);
  assert.match(unknown.stderr, /script not found/i);
  assert.doesNotMatch(unknown.stderr, /retired/i);
});

test('adaptive workflow owns complete bug and feature delivery behavior', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'skills/dhpk-execution-policy/references/delivery-loop-gate.md')), 'delivery-loop-gate successor reference must exist');
  const adaptive = read('skills/dhpk-adaptive-dev-workflow/SKILL.md');
  const gate = read('skills/dhpk-execution-policy/references/delivery-loop-gate.md');
  assert.match(adaptive, /Bug branch[\s\S]*root cause[\s\S]*regression test/i);
  assert.match(adaptive, /Feature branch[\s\S]*requirements[\s\S]*design[\s\S]*implement/i);
  assert.match(adaptive, /dhpk-tdd-workflow/);
  assert.match(adaptive, /dhpk-change-review/);
  assert.match(gate, /test adequacy/i);
  assert.match(gate, /freshness/i);
  assert.doesNotMatch(adaptive, /dhpk-(bug-fix|feature-dev)/);
});

test('post-development testing routes unit/integration to TDD and Playwright journeys to e2e-runner', () => {
  const routeTable = JSON.parse(read('scripts/lib/route-table.json'));
  const e2eRoute = routeTable.rules.find((entry) => /playwright/i.test(entry.pattern));
  assert.strictEqual(e2eRoute.skill, 'agent:e2e-runner');
  assert.match(e2eRoute.label, /UNAVAILABLE/);
  const gate = read('skills/dhpk-execution-policy/references/delivery-loop-gate.md');
  assert.match(gate, /unit|integration/i);
  assert.match(gate, /dhpk-tdd-workflow/);
  assert.match(gate, /e2e-runner/);
  assert.match(gate, /UNAVAILABLE/);
});

test('architect adversarial mode preserves independent proposals and bounded convergence', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'skills/dhpk-codex-architect/references/adversarial-option-convergence.md')), 'adversarial successor reference must exist');
  const architect = read('skills/dhpk-codex-architect/SKILL.md');
  const adversarial = read('skills/dhpk-codex-architect/references/adversarial-option-convergence.md');
  assert.match(architect, /--mode design\|review\|compare\|adversarial/);
  assert.match(architect, /\$\{MODE\} \(design\/review\/compare\/adversarial\)/);
  assert.match(architect, /When `\$\{MODE\}` is `adversarial`, produce an independent Proposal B/i);
  assert.match(architect, /three critique rounds by default and never\s+more\s+than five/i);
  assert.match(architect, /references\/adversarial-option-convergence\.md/);
  assert.doesNotMatch(architect, /dhpk-codex-brainstorm/);
  assert.match(adversarial, /# Adversarial Architecture Report/i);
  assert.match(adversarial, /Use three rounds by default and never\s+more\s+than five/i);
  assert.match(adversarial, /## Convergence status/i);
  assert.match(adversarial, /independent proposal/i);
  assert.match(adversarial, /critique round/i);
  assert.match(adversarial, /decision criteria/i);
  assert.match(adversarial, /unresolved disagreement/i);
  assert.match(adversarial, /final recommendation/i);
  assert.doesNotMatch(adversarial, /guarantee.*Nash|Nash.*guarantee/i);
});

test('canonical source has no live delegation to retiring identities', () => {
  const roots = [
    'skills', 'commands', 'agents', 'rules', 'scripts/lib', 'tests', 'docs',
    'README.md', 'AGENTS.md',
  ];
  const historicalOnly = new Map([
    ['docs/agent-guidance/skill-disposition.md', 'historical disposition snapshot'],
    ['docs/skill-platform-migration.md', 'retirement migration guidance'],
    ['docs/skill-platform-migration.zh-TW.md', 'retirement migration guidance'],
    ['tests/skill-retirement-migration.test.js', 'retirement contract test'],
    ['tests/opsx-apply-goal-guardrails.test.js', 'negative route guard'],
    ['tests/userpromptsubmit-skill-hint.test.js', 'negative route guard'],
    ['tests/fixtures/invocation-inventory-baseline.json', 'historical fixture'],
    ['tests/fixtures/distribution-surface-baseline.json', 'historical fixture'],
    ['scripts/ci/skill-size-allowlist.json', 'size baseline'],
  ]);
  const retiringPackageRoots = RETIRED_NAMES.map((name) => `skills/${name}/`);
  const findings = [];
  for (const relative of roots.flatMap(walkTextFiles)) {
    if (retiringPackageRoots.some((prefix) => relative.startsWith(prefix))) continue;
    if (historicalOnly.has(relative)) continue;
    const source = read(relative);
    for (const name of RETIRED_NAMES) {
      if (source.includes(name)) findings.push(`${relative}: ${name}`);
    }
  }
  assert.deepStrictEqual(findings, [], `live retiring delegations remain:\n${findings.join('\n')}`);
});

run('skill-retirement-migration');
