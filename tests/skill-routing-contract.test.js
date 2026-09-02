'use strict';

// RED contract for the inventory-owned Laravel/PHPUnit family router. The
// implementation follows in the production routing module; this suite only
// fixes the observable normalized view and selector-resolution boundary.

const { test, run, assert } = require('./_lib/tinytest');
const {
  normalizeSkillRoutingFamilies,
  resolveSkillRoutingReference,
} = require('../scripts/lib/distribution-inventory');

const INVENTORY = {
  schema: 'dhpk.distribution-inventory.v2',
  skills: [
    { id: 'php-runtime-router', path: 'skills/dhpk-php-runtime-router', surfaces: ['claude-module'] },
    {
      id: 'laravel', path: 'skills/dhpk-laravel', lifecycle: 'promoted',
      invocation_class: 'implicit-eligible', surfaces: ['claude-core'],
    },
    {
      id: 'laravel-9-notes', path: 'skills/dhpk-laravel-9-notes', lifecycle: 'deprecated',
      invocation_class: 'implicit-eligible', legacy_names: ['laravel-9-notes'], discoveryVisible: false,
      surfaces: ['claude-module'],
      deprecation: { since: '2026-09-02', compatibilityWindowEnds: '2026-12-02', migrationNote: 'Use the Laravel family selector.' },
    },
    {
      id: 'laravel-10-notes', path: 'skills/dhpk-laravel-10-notes', lifecycle: 'deprecated',
      invocation_class: 'implicit-eligible', legacy_names: ['laravel-10-notes'], discoveryVisible: false,
      surfaces: ['claude-module'],
      deprecation: { since: '2026-09-02', compatibilityWindowEnds: '2026-12-02', migrationNote: 'Use the Laravel family selector.' },
    },
    {
      id: 'phpunit', path: 'skills/dhpk-phpunit', lifecycle: 'promoted',
      invocation_class: 'implicit-eligible', surfaces: ['claude-core'],
    },
    {
      id: 'phpunit-9-modern', path: 'skills/dhpk-phpunit-9-modern', lifecycle: 'deprecated',
      invocation_class: 'implicit-eligible', legacy_names: ['phpunit-9-modern'], discoveryVisible: false,
      surfaces: ['claude-module'],
      deprecation: { since: '2026-09-02', compatibilityWindowEnds: '2026-12-02', migrationNote: 'Use the PHPUnit family selector.' },
    },
  ],
  skill_routing_families: [
    {
      id: 'laravel',
      router_id: 'php-runtime-router',
      invocation_class: 'implicit-eligible',
      surfaces: ['claude-module'],
      selectors: {
        '10': 'skills/dhpk-laravel/references/10.md',
        '9': 'skills/dhpk-laravel/references/9.md',
      },
      aliases: [
        { id: 'laravel-10-notes', selector: '10', invocation_class: 'implicit-eligible', surfaces: ['claude-module'] },
        { id: 'laravel-9-notes', selector: '9', invocation_class: 'implicit-eligible', surfaces: ['claude-module'] },
      ],
    },
    {
      id: 'phpunit',
      router_id: 'php-runtime-router',
      invocation_class: 'implicit-eligible',
      surfaces: ['claude-module'],
      selectors: { '9': 'skills/dhpk-phpunit/references/9.md' },
      aliases: [
        { id: 'phpunit-9-modern', selector: '9', invocation_class: 'implicit-eligible', surfaces: ['claude-module'] },
      ],
    },
  ],
};

function assertFrozenTree(value) {
  if (!value || typeof value !== 'object') return;
  assert.ok(Object.isFrozen(value));
  for (const child of Object.values(value)) assertFrozenTree(child);
}

test('normalizes family records into a deterministic immutable public view', () => {
  const before = JSON.stringify(INVENTORY.skill_routing_families);
  const first = normalizeSkillRoutingFamilies({ inventory: INVENTORY });
  const second = normalizeSkillRoutingFamilies({ inventory: INVENTORY });

  assert.deepStrictEqual(first, [
    {
      id: 'laravel',
      routerId: 'php-runtime-router',
      invocationClass: 'implicit-eligible',
      surfaces: ['claude-module'],
      selectors: {
        '10': 'skills/dhpk-laravel/references/10.md',
        '9': 'skills/dhpk-laravel/references/9.md',
      },
      aliases: [
        { id: 'laravel-10-notes', selector: '10', invocationClass: 'implicit-eligible', surfaces: ['claude-module'] },
        { id: 'laravel-9-notes', selector: '9', invocationClass: 'implicit-eligible', surfaces: ['claude-module'] },
      ],
    },
    {
      id: 'phpunit',
      routerId: 'php-runtime-router',
      invocationClass: 'implicit-eligible',
      surfaces: ['claude-module'],
      selectors: { '9': 'skills/dhpk-phpunit/references/9.md' },
      aliases: [
        { id: 'phpunit-9-modern', selector: '9', invocationClass: 'implicit-eligible', surfaces: ['claude-module'] },
      ],
    },
  ]);
  assert.strictEqual(JSON.stringify(first), JSON.stringify(second));
  assertFrozenTree(first);
  assert.strictEqual(JSON.stringify(INVENTORY.skill_routing_families), before);
});

test('resolves exactly one selector or stable alias and rejects ambiguous requests', () => {
  const families = normalizeSkillRoutingFamilies({ inventory: INVENTORY });

  assert.strictEqual(
    resolveSkillRoutingReference({ inventory: INVENTORY, families, familyId: 'laravel', selector: '10' }),
    'skills/dhpk-laravel/references/10.md',
  );
  assert.strictEqual(
    resolveSkillRoutingReference({ inventory: INVENTORY, families, id: 'laravel-9-notes' }),
    'skills/dhpk-laravel/references/9.md',
  );
  assert.strictEqual(
    resolveSkillRoutingReference({ inventory: INVENTORY, families, familyId: 'phpunit', selector: '9' }),
    'skills/dhpk-phpunit/references/9.md',
  );
  assert.strictEqual(
    resolveSkillRoutingReference({ inventory: INVENTORY, families, id: 'laravel-9-notes', selector: '10' }),
    null,
  );
  assert.strictEqual(
    resolveSkillRoutingReference({ inventory: INVENTORY, families, familyId: 'laravel', selector: '9.0' }),
    null,
  );
  assert.strictEqual(
    resolveSkillRoutingReference({ inventory: INVENTORY, families, familyId: 'missing', selector: '10' }),
    null,
  );
});

run('skill-routing-contract');
