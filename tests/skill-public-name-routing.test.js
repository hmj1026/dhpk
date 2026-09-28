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

function legacyNamesToPublic(skills) {
  const legacyToPublic = new Map();
  for (const skill of skills) {
    for (const legacy of skill.legacy_names || []) {
      if (legacy !== skill.name && !AMBIGUOUS_TERMS.has(legacy)) {
        legacyToPublic.set(legacy, skill.name);
      }
    }
  }
  return legacyToPublic;
}

function skillDescription(source, label) {
  const frontmatter = source.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  assert.ok(frontmatter, `${label} must have YAML frontmatter`);
  const lines = frontmatter[1].split(/\r?\n/);
  const descriptionIndex = lines.findIndex((line) => /^description:\s*/.test(line));
  assert.notStrictEqual(descriptionIndex, -1, `${label} must declare a description`);

  const rawValue = lines[descriptionIndex].replace(/^description:\s*/, '').trim();
  let description = rawValue;
  if (/^[>|][+-]?$/.test(rawValue)) {
    const content = [];
    for (const line of lines.slice(descriptionIndex + 1)) {
      if (line.trim() && !/^\s+/.test(line)) break;
      if (line.trim()) content.push(line.trim());
    }
    description = content.join(' ');
  } else if ((rawValue.startsWith('"') && rawValue.endsWith('"'))
    || (rawValue.startsWith("'") && rawValue.endsWith("'"))) {
    description = rawValue.slice(1, -1).trim();
  }

  assert.ok(description, `${label} must have a nonempty parsed description`);
  return description;
}

function legacyRouteFindings(description, legacyToPublic) {
  const findings = [];
  for (const [legacy, publicName] of legacyToPublic) {
    const routingDescription = AGENT_ROLE_TERMS.has(legacy)
      ? description.replace(new RegExp(`${escapeRegExp(legacy)}\\s+subagent`, 'ig'), '')
      : description;
    const bareLegacy = new RegExp(
      `(?<![a-z0-9-])${escapeRegExp(legacy)}(?![a-z0-9-])`,
      'i',
    );
    if (bareLegacy.test(routingDescription)) {
      findings.push(`${legacy} -> ${publicName}`);
    }
  }
  return findings;
}

test('legacy-name detector catches aliases and preserves documented exemptions', () => {
  const legacyToPublic = legacyNamesToPublic([{
    name: 'flow-guide',
    legacy_names: ['old-flow-guide', 'deploy-list', 'tdd', 'agy-fast-worker'],
  }]);

  assert.deepStrictEqual(
    legacyRouteFindings('Route through old-flow-guide for this task.', legacyToPublic),
    ['old-flow-guide -> flow-guide'],
  );
  assert.deepStrictEqual(
    legacyRouteFindings('deploy-list and tdd are ordinary terms; use the agy-fast-worker subagent.', legacyToPublic),
    [],
  );
  assert.deepStrictEqual(
    legacyRouteFindings('Invoke agy-fast-worker directly.', legacyToPublic),
    ['agy-fast-worker -> flow-guide'],
  );
  assert.throws(() => skillDescription('---\nname: empty\n---\n', 'empty fixture'), /description/);
  assert.throws(() => skillDescription(
    '---\nname: empty-block\ndescription: >\n---\n',
    'empty block fixture',
  ), /nonempty parsed description/);
});

test('skill routing descriptions use public dhpk names, never legacy aliases', () => {
  const findings = [];
  const legacyToPublic = legacyNamesToPublic(inventory.skills);

  for (const skill of inventory.skills) {
    const skillFile = path.join(ROOT, skill.path, 'SKILL.md');
    const source = fs.readFileSync(skillFile, 'utf8');
    const description = skillDescription(source, path.relative(ROOT, skillFile));
    for (const finding of legacyRouteFindings(description, legacyToPublic)) {
      findings.push(`${path.relative(ROOT, skillFile)}: ${finding}`);
    }
  }

  assert.deepStrictEqual(findings, [], `legacy routing names remain:\n${findings.join('\n')}`);
});

run('skill-public-name-routing');
