'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const {
  loadDiscoveryBudgets,
  inspectDiscoveryContext,
  renderBudgetReport,
} = require('../scripts/ci/context-budget');

const ROOT = path.join(__dirname, '..');

test('discovery budgets are declared by lifecycle and host surface', () => {
  const budgets = loadDiscoveryBudgets(ROOT);
  for (const lifecycle of ['promoted', 'optional', 'experimental', 'deprecated']) {
    for (const surface of ['claude-core', 'claude-module', 'codex-sync', 'codex-native']) {
      assert.ok(budgets[lifecycle][surface].words > 0, `${lifecycle}/${surface} words`);
      assert.ok(budgets[lifecycle][surface].tokens > 0, `${lifecycle}/${surface} tokens`);
    }
  }
});

test('optional module entries remain explicitly discovery-visible', () => {
  const inventory = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests', 'distribution-inventory.json'), 'utf8'));
  const report = inspectDiscoveryContext({ root: ROOT, inventory });
  const optional = report.entries.filter((entry) => entry.lifecycle === 'optional');
  assert.ok(optional.length > 0);
  assert.ok(optional.every((entry) => entry.discoveryVisible === true));
  assert.ok(optional.every((entry) => /runtime|activation|optional/i.test(entry.visibilityReason)));
});

test('budget report is deterministic and identifies out-of-budget fixture entries', () => {
  const report = inspectDiscoveryContext({
    root: ROOT,
    inventory: {
      skills: [{
        id: 'fixture', name: 'dhpk-fixture', path: 'skills/dhpk-fixture', lifecycle: 'promoted',
        tier: 'core', profiles: ['core'], surfaces: ['claude-core'],
      }],
      modules: [],
    },
    readDescription: () => Array(200).fill('word').join(' '),
  });
  assert.ok(report.violations.length > 0);
  const output = renderBudgetReport(report);
  assert.match(output, /discovery-visible/);
  assert.match(output, /fixture/);
});

run('context-budget');
