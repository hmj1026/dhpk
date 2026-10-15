'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test, run } = require('./_lib/tinytest');

const root = path.resolve(__dirname, '..');
const read = name => JSON.parse(fs.readFileSync(path.join(root, 'manifests', `${name}.json`), 'utf8'));
const removed = [
  'opsx-load-context', 'opsx-post-obs', 'react-18-notes', 'react-19-notes',
  'nextjs-15-5-notes', 'nextjs-16-notes', 'swift-language', 'swiftui-architecture',
  'swift-test-strategy', 'ios-platform', 'xcode-build-tooling', 'ios-icon-gen',
  'python-pro', 'python-static-checks', 'pytest-async', 'fastapi-pro',
  'js-lint-config', 'js-static-check-strategy', 'php-pro', 'php-modern-pro',
  'php-8x-features', 'php56-yii-dev', 'yii1-security-audit', 'review-pending', 'dep-audit',
];
const families = ['opsx-apply-resume', 'react', 'nextjs', 'swift', 'python', 'js-static-checks', 'php', 'yii1', 'change-verdict'];

test('SCFREQ001: 25 predecessor entries become nine family identities without aliases', () => {
  const inventory = read('distribution-inventory');
  const ids = inventory.skills.map(skill => skill.id);
  assert.equal(ids.length, 46);
  for (const id of removed) assert.ok(!ids.includes(id), `public predecessor remains: ${id}`);
  for (const id of families) {
    const entry = inventory.skills.find(skill => skill.id === id);
    assert.ok(entry, `family missing: ${id}`);
    assert.equal(entry.name, id);
    assert.equal(entry.path, `skills/${id}`);
    assert.deepEqual(entry.legacy_names || [], []);
  }
  for (const id of ['flow-drive', 'laravel', 'phpunit', 'composer-package-hygiene']) {
    assert.ok(ids.includes(id), `excluded neighboring owner changed: ${id}`);
  }
});

test('SCFREQ002: install and discovery selections contain only current identities', () => {
  const ids = new Set(read('distribution-inventory').skills.map(skill => skill.id));
  const installs = read('install-profiles');
  const selection = read('marketplace-selection').skills;
  assert.equal(selection.length, ids.size);
  for (const entry of selection) assert.ok(ids.has(entry.id), `stale selection: ${entry.id}`);
  for (const [name, profile] of Object.entries({ ...installs.profiles, ...installs.legacy_profiles })) {
    for (const id of profile.skillIds || []) assert.ok(!removed.includes(id), `${name}: predecessor profile ID ${id}`);
  }
  const verdict = selection.find(entry => entry.id === 'change-verdict');
  assert.equal(verdict.authority, 'workspace-write');
  assert.equal(verdict.owner, 'change-verdict');
  const usage = read('distribution-inventory').skills.find(entry => entry.id === 'change-verdict').usage;
  assert.equal(usage.effect_authority, 'workspace-write');
  assert.equal(usage.actions.find(action => action.id === 'deps').effect_authority, 'read-only');
  assert.equal(usage.actions.find(action => action.id === 'deps-fix').effect_authority, 'workspace-write');
});

test('SCFREQ006: resource declarations and isolation coverage match family identities', () => {
  const ids = new Set(read('distribution-inventory').skills.map(skill => skill.id));
  const coverage = read('skill-directory-coverage').skills;
  const resources = read('skill-resources').skills;
  assert.deepEqual(Object.keys(coverage).sort(), [...ids].sort());
  for (const id of Object.keys(resources)) assert.ok(ids.has(id), `stale resource owner: ${id}`);
  for (const id of families) {
    assert.ok(coverage[id], `family coverage missing: ${id}`);
    assert.equal(coverage[id].entry, 'SKILL.md');
  }
});

run('self-contained-family-catalog');
