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
      '9': 'skills/dhpk-laravel-9-notes/SKILL.md',
      '10': 'skills/dhpk-laravel-10-notes/SKILL.md',
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
      id: 'laravel-10-notes',
      name: 'dhpk-laravel-10-notes',
      path: 'skills/dhpk-laravel-10-notes',
      lifecycle: 'optional',
      surfaces: ['claude-module'],
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

  assert.strictEqual(selected, 'skills/dhpk-laravel-10-notes/SKILL.md');
  assert.notStrictEqual(selected, 'skills/dhpk-laravel-9-notes/SKILL.md');
});

test('optional family descriptions stay discovery-visible while activation remains conditional', () => {
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

  const optional = report.entries.filter((entry) => entry.lifecycle === 'optional');
  assert.strictEqual(optional.length, 1);
  assert.strictEqual(optional[0].discoveryVisible, true);
  assert.match(optional[0].visibilityReason, /runtime\/activation optional/);
});

test('initial discovery budget counts frontmatter description, not conditional reference bodies', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-progressive-loading-'));
  try {
    const skillDir = path.join(root, 'skills', 'dhpk-laravel-10-notes');
    fs.mkdirSync(path.join(skillDir, 'references'), { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      [
        '---',
        'name: dhpk-laravel-10-notes',
        'description: Use for Laravel 10 compatibility decisions.',
        '---',
        '',
        'Load references/laravel-10-migrations.md only after selecting Laravel 10.',
      ].join('\n'),
    );
    fs.writeFileSync(
      path.join(skillDir, 'references', 'laravel-10-migrations.md'),
      `${'migration detail '.repeat(500)}\n`,
    );

    const report = inspectDiscoveryContext({
      root,
      inventory: {
        skills: [{
          id: 'laravel-10-notes',
          name: 'dhpk-laravel-10-notes',
          path: 'skills/dhpk-laravel-10-notes',
          lifecycle: 'optional',
          surfaces: ['claude-module'],
        }],
      },
      budgets: { optional: { 'claude-module': { words: 8, tokens: 32 } } },
    });

    assert.strictEqual(report.entries[0].words, 6);
    assert.strictEqual(report.entries[0].tokens, 11);
    assert.deepStrictEqual(report.violations, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

run('skill-routing-progressive-loading');
