'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const { inspectDiscoveryContext } = require('../scripts/ci/context-budget');
const { resolveSkillRoutingReference } = require('../scripts/lib/distribution-inventory');

const ROUTING_INVENTORY = {
  skill_routing_families: [{
    id: 'laravel',
    router_id: 'php-runtime-router',
    invocation_class: 'implicit-eligible',
    surfaces: ['claude-module'],
    selectors: {
      '9': 'skills/dhpk-laravel/references/9.md',
      '10': 'skills/dhpk-laravel/references/10.md',
    },
    aliases: [
      {
        id: 'laravel-9-notes',
        selector: '9',
        invocation_class: 'implicit-eligible',
        surfaces: ['claude-module'],
      },
      {
        id: 'laravel-10-notes',
        selector: '10',
        invocation_class: 'implicit-eligible',
        surfaces: ['claude-module'],
      },
    ],
  }],
  skills: [
    {
      id: 'php-runtime-router',
      name: 'dhpk-php-runtime-router',
      path: 'skills/dhpk-php-runtime-router',
      lifecycle: 'promoted',
      surfaces: ['claude-module'],
    },
    {
      id: 'laravel',
      name: 'dhpk-laravel',
      path: 'skills/dhpk-laravel',
      lifecycle: 'promoted',
      invocation_class: 'implicit-eligible',
      discoveryVisible: true,
      surfaces: ['claude-module'],
    },
    {
      id: 'laravel-9-notes',
      name: 'dhpk-laravel-9-notes',
      path: 'skills/dhpk-laravel-9-notes',
      lifecycle: 'deprecated',
      invocation_class: 'implicit-eligible',
      discoveryVisible: false,
      legacy_names: ['laravel-9-notes'],
      surfaces: ['claude-module'],
      deprecation: {
        since: '2026-09-02',
        compatibilityWindowEnds: '2026-12-02',
        migrationNote: 'Use the Laravel family selector.',
      },
    },
    {
      id: 'laravel-10-notes',
      name: 'dhpk-laravel-10-notes',
      path: 'skills/dhpk-laravel-10-notes',
      lifecycle: 'deprecated',
      invocation_class: 'implicit-eligible',
      discoveryVisible: false,
      legacy_names: ['laravel-10-notes'],
      surfaces: ['claude-module'],
      deprecation: {
        since: '2026-09-02',
        compatibilityWindowEnds: '2026-12-02',
        migrationNote: 'Use the Laravel family selector.',
      },
    },
  ],
};

test('progressive routing resolves only the selected conditional reference', () => {
  const selected = resolveSkillRoutingReference({
    inventory: ROUTING_INVENTORY,
    families: ROUTING_INVENTORY.skill_routing_families,
    familyId: 'laravel',
    selector: '10',
  });

  assert.strictEqual(selected, 'skills/dhpk-laravel/references/10.md');
  assert.notStrictEqual(selected, 'skills/dhpk-laravel/references/9.md');
});

test('canonical family descriptions stay discovery-visible while legacy aliases remain hidden', () => {
  const report = inspectDiscoveryContext({
    root: process.cwd(),
    inventory: ROUTING_INVENTORY,
    readDescription: (entry) => entry.lifecycle === 'optional'
      ? 'Use for Laravel 10 compatibility decisions.'
      : 'Route PHP runtime work to the matching family reference.',
    budgets: {
      promoted: { 'claude-module': { words: 12, tokens: 48 } },
      optional: { 'claude-module': { words: 8, tokens: 32 } },
    },
  });

  const family = report.entries.find((entry) => entry.id === 'laravel');
  const legacy = report.entries.find((entry) => entry.id === 'laravel-10-notes');
  assert.strictEqual(family.discoveryVisible, true);
  assert.strictEqual(legacy.discoveryVisible, false);
  assert.match(legacy.visibilityReason, /host-invisible/);
});

test('initial discovery budget counts frontmatter description, not conditional reference bodies', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-progressive-loading-'));
  try {
    const skillDir = path.join(root, 'skills', 'dhpk-laravel');
    fs.mkdirSync(path.join(skillDir, 'references'), { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      [
        '---',
        'name: dhpk-laravel',
        'description: Use for Laravel 10 compatibility decisions.',
        '---',
        '',
        'Load references/10.md only after selecting Laravel 10.',
      ].join('\n'),
    );
    fs.writeFileSync(
      path.join(skillDir, 'references', '10.md'),
      `${'migration detail '.repeat(500)}\n`,
    );

    const report = inspectDiscoveryContext({
      root,
      inventory: {
        skills: [{
          id: 'laravel',
          name: 'dhpk-laravel',
          path: 'skills/dhpk-laravel',
          lifecycle: 'promoted',
          discoveryVisible: true,
          surfaces: ['claude-module'],
        }],
      },
      budgets: { promoted: { 'claude-module': { words: 8, tokens: 32 } } },
    });

    assert.strictEqual(report.entries[0].words, 6);
    assert.strictEqual(report.entries[0].tokens, 11);
    assert.deepStrictEqual(report.violations, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

run('skill-routing-progressive-loading');
