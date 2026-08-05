'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const inventory = JSON.parse(fs.readFileSync(
  path.join(ROOT, 'manifests', 'distribution-inventory.json'),
  'utf8',
));

// These legacy IDs are also ordinary domain vocabulary in descriptions. Their
// occurrences are not reliable routing signals; canonical handoffs that use
// them are covered by the exact-name integrity checks elsewhere.
const AMBIGUOUS_TERMS = new Set(['deploy-list', 'tdd']);
const AGENT_ROLE_TERMS = new Set(['agy-fast-worker']);

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

test('skill routing descriptions use public dhpk names, never legacy aliases', () => {
  const findings = [];
  const legacyToPublic = new Map();

  for (const skill of inventory.skills) {
    for (const legacy of skill.legacy_names || []) {
      if (legacy !== skill.name && !AMBIGUOUS_TERMS.has(legacy)) {
        legacyToPublic.set(legacy, skill.name);
      }
    }
  }

  for (const skill of inventory.skills) {
    const skillFile = path.join(ROOT, skill.path, 'SKILL.md');
    const source = fs.readFileSync(skillFile, 'utf8');
    const frontmatter = source.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    const description = frontmatter
      ? (frontmatter[1].match(/^description:\s*(.*)$/m) || [])[1] || ''
      : '';

    for (const [legacy, publicName] of legacyToPublic) {
      const routingDescription = AGENT_ROLE_TERMS.has(legacy)
        ? description.replace(new RegExp(`${escapeRegExp(legacy)}\\s+subagent`, 'ig'), '')
        : description;
      const bareLegacy = new RegExp(
        `(?<![a-z0-9-])${escapeRegExp(legacy)}(?![a-z0-9-])`,
        'i',
      );
      if (bareLegacy.test(routingDescription)) {
        findings.push(`${path.relative(ROOT, skillFile)}: ${legacy} -> ${publicName}`);
      }
    }
  }

  assert.deepStrictEqual(findings, [], `legacy routing names remain:\n${findings.join('\n')}`);
});

run('skill-public-name-routing');
