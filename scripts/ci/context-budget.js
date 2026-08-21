#!/usr/bin/env node
'use strict';

// Discovery-context budget validator. It measures only always-visible
// frontmatter descriptions, not conditional reference bodies. Optional module
// entries are intentionally reported as discovery-visible because the host
// publishes their descriptions even when activation is disabled.

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_MANIFEST = path.join(__dirname, '..', '..', 'manifests', 'discovery-budgets.json');

function loadDiscoveryBudgets(root) {
  const file = path.join(root, 'manifests', 'discovery-budgets.json');
  return JSON.parse(fs.readFileSync(file, 'utf8')).budgets;
}

function frontmatterDescription(text) {
  const match = String(text || '').match(/^description:\s*(?:["']([\s\S]*?)["']|([^\n]+))/m);
  return (match && (match[1] || match[2]) || '').trim();
}

function defaultReadDescription(root, entry) {
  const file = path.join(root, entry.path, 'SKILL.md');
  if (fs.existsSync(file)) return frontmatterDescription(fs.readFileSync(file, 'utf8'));
  const command = path.join(root, entry.path);
  if (fs.existsSync(command)) return frontmatterDescription(fs.readFileSync(command, 'utf8'));
  return '';
}

function counts(text) {
  const value = String(text || '').trim();
  return {
    words: value ? value.split(/\s+/u).length : 0,
    tokens: value ? Math.ceil(Array.from(value).length / 4) : 0,
  };
}

function budgetFor(budgets, lifecycle, surface) {
  return (budgets[lifecycle] && budgets[lifecycle][surface])
    || (budgets.promoted && budgets.promoted[surface])
    || { words: 0, tokens: 0 };
}

function inspectDiscoveryContext({ root, inventory, readDescription = null, budgets = null, profileSelection = null, artifactIdentity = null, profileId = null, selectedStableIds = null, surface = null } = {}) {
  const effectiveProfile = profileSelection || (profileId ? { id: profileId, selectedStableIds: selectedStableIds || [] } : null);
  const effectiveBudgets = budgets || loadDiscoveryBudgets(root);
  const reader = readDescription || ((entry) => defaultReadDescription(root, entry));
  const entries = [];
  const violations = [];
  const selectedIds = effectiveProfile && Array.isArray(effectiveProfile.selectedStableIds)
    ? new Set(effectiveProfile.selectedStableIds)
    : null;
  const configurationErrors = [];
  if (effectiveProfile && (!effectiveProfile.id || !Array.isArray(effectiveProfile.selectedStableIds)
    || !artifactIdentity || !artifactIdentity.planFingerprint || !artifactIdentity.artifactFingerprint)) {
    configurationErrors.push('profile budget scope requires profile id, selected stable IDs, plan fingerprint, and artifact fingerprint');
  }
  const skills = ((inventory && inventory.skills) || []).filter((skill) => !selectedIds || selectedIds.has(skill.id));
  for (const skill of skills) {
    const description = reader(skill) || '';
    const measured = counts(description);
    for (const entrySurface of skill.surfaces || []) {
      if (surface && entrySurface !== surface) continue;
      const limit = budgetFor(effectiveBudgets, skill.lifecycle, entrySurface);
      const discoveryVisible = true;
      const entry = {
        id: skill.id || skill.name,
        name: skill.name || skill.id,
        lifecycle: skill.lifecycle,
        surface: entrySurface,
        description,
        words: measured.words,
        tokens: measured.tokens,
        wordBudget: limit.words,
        tokenBudget: limit.tokens,
        discoveryVisible,
        visibilityReason: skill.lifecycle === 'optional'
          ? 'discovery-visible; runtime/activation optional'
          : 'discovery-visible core metadata',
      };
      if (effectiveProfile) {
        entry.profile = effectiveProfile.id;
        entry.planFingerprint = artifactIdentity && artifactIdentity.planFingerprint || null;
        entry.artifactFingerprint = artifactIdentity && artifactIdentity.artifactFingerprint || null;
      }
      entries.push(entry);
      if (measured.words > limit.words || measured.tokens > limit.tokens) {
        violations.push({ ...entry, reason: 'description exceeds discovery budget' });
      }
    }
  }
  const report = {
    schema: 'dhpk.discovery-report.v1',
    entries,
    violations,
    totals: {
      entries: entries.length,
      discoveryVisible: entries.filter((entry) => entry.discoveryVisible).length,
      optionalDiscoveryVisible: entries.filter((entry) => entry.discoveryVisible && entry.lifecycle === 'optional').length,
      violations: violations.length,
    },
  };
  if (effectiveProfile) {
    report.scope = 'claude-profile';
    report.profileId = effectiveProfile.id || null;
    report.scopeDetails = {
      kind: 'claude-profile',
      profile: effectiveProfile.id || null,
      planFingerprint: artifactIdentity && artifactIdentity.planFingerprint || null,
      artifactFingerprint: artifactIdentity && artifactIdentity.artifactFingerprint || null,
    };
    report.configurationErrors = configurationErrors;
    report.compatibilityCatalog = inspectDiscoveryContext({ root, inventory, readDescription, budgets, surface });
    report.ok = configurationErrors.length === 0 && violations.length === 0;
  } else {
    report.scope = 'claude-compatibility';
    report.profileId = null;
  }
  return report;
}

function renderBudgetReport(report) {
  const lines = [
    `discovery-visible entries: ${report.totals.discoveryVisible}`,
    `optional discovery-visible entries: ${report.totals.optionalDiscoveryVisible}`,
    `budget violations: ${report.totals.violations}`,
  ];
  if (report.configurationErrors && report.configurationErrors.length) {
    for (const error of report.configurationErrors) lines.push(`FAIL configuration: ${error}`);
  }
  for (const entry of report.violations) {
    lines.push(`FAIL ${entry.id} [${entry.lifecycle}/${entry.surface}] discovery-visible ${entry.words}/${entry.wordBudget} words, ${entry.tokens}/${entry.tokenBudget} tokens`);
  }
  return `${lines.join('\n')}\n`;
}

function main() {
  const root = path.join(__dirname, '..', '..');
  const inventory = JSON.parse(fs.readFileSync(path.join(root, 'manifests', 'distribution-inventory.json'), 'utf8'));
  const report = inspectDiscoveryContext({ root, inventory });
  process.stdout.write(renderBudgetReport(report));
  if (process.argv.includes('--json')) process.stdout.write(`${JSON.stringify(report)}\n`);
  return report.violations.length ? 1 : 0;
}

if (require.main === module) process.exit(main());

module.exports = {
  DEFAULT_MANIFEST,
  loadDiscoveryBudgets,
  inspectDiscoveryContext,
  renderBudgetReport,
  counts,
};
