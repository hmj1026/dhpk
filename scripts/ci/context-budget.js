#!/usr/bin/env node
'use strict';

// Discovery-context budget validator. It measures only always-visible
// frontmatter descriptions, not conditional reference bodies. Optional module
// entries are intentionally reported as discovery-visible because the host
// publishes their descriptions even when activation is disabled.

const fs = require('node:fs');
const path = require('node:path');
const {
  CATEGORIES,
  ESTIMATOR,
  evaluateDiscoveryBudget,
} = require('../lib/discovery-budget');

const DEFAULT_MANIFEST = path.join(__dirname, '..', '..', 'manifests', 'discovery-budgets.json');

function loadDiscoveryBudgets(root) {
  return loadDiscoveryBudgetManifest(root).budgets;
}

function loadDiscoveryBudgetManifest(root) {
  const file = path.join(root, 'manifests', 'discovery-budgets.json');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function frontmatterDescription(text) {
  const match = String(text || '').match(/^description:\s*(?:["']([\s\S]*?)["']|([^\n]+))/m);
  return (match && (match[1] || match[2]) || '').trim();
}

function defaultReadDescription(root, entry) {
  const safePath = (relativePath) => {
    if (typeof relativePath !== 'string' || relativePath.trim() === '' || path.isAbsolute(relativePath)) return null;
    const rootPath = path.resolve(root);
    try {
      if (fs.lstatSync(rootPath).isSymbolicLink()) return null;
    } catch (_) {
      return null;
    }
    const candidate = path.resolve(rootPath, relativePath);
    if (candidate !== rootPath && !candidate.startsWith(`${rootPath}${path.sep}`)) return null;
    let current = rootPath;
    for (const component of path.relative(rootPath, candidate).split(path.sep).filter(Boolean)) {
      current = path.join(current, component);
      try {
        if (fs.lstatSync(current).isSymbolicLink()) return null;
      } catch (_) {
        return null;
      }
    }
    return candidate;
  };
  const file = safePath(path.join(entry.path || '', 'SKILL.md'));
  if (file && fs.existsSync(file)) return frontmatterDescription(fs.readFileSync(file, 'utf8'));
  const command = safePath(entry.path);
  if (command && fs.existsSync(command)) return frontmatterDescription(fs.readFileSync(command, 'utf8'));
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
    || null;
}

function visibilityFor(skill, entrySurface, manifest, legacyCli) {
  if (legacyCli) return { value: true, reason: 'legacy CLI compatibility: discovery-visible surface' };
  if (typeof skill.discoveryVisible === 'boolean') {
    return {
      value: skill.discoveryVisible,
      reason: skill.discoveryVisible
        ? (skill.lifecycle === 'optional' ? 'discovery-visible; runtime/activation optional' : 'declared discovery-visible metadata')
        : 'declared host-invisible metadata',
    };
  }
  if (typeof skill.discovery_visible === 'boolean') {
    return { value: skill.discovery_visible, reason: 'declared discovery visibility metadata' };
  }
  const declared = manifest && manifest.visibility;
  if (declared && declared[skill.lifecycle] && typeof declared[skill.lifecycle][entrySurface] === 'boolean') {
    const value = declared[skill.lifecycle][entrySurface];
    return {
      value,
      reason: value
        ? (skill.lifecycle === 'optional' ? 'discovery-visible; runtime/activation optional (manifest-declared)' : 'manifest-declared discovery visibility')
        : 'manifest-declared host-invisible metadata',
    };
  }
  // Optional references were historically host-visible. Keep this narrow
  // compatibility path for progressive-loading callers while requiring all
  // promoted/scoped records to declare their visibility explicitly.
  if (skill.lifecycle === 'optional' && !skill.profiles) {
    return { value: true, reason: 'discovery-visible; runtime/activation optional (legacy compatibility)' };
  }
  return { value: null, reason: 'discovery visibility is not declared' };
}

function categoryFor(skill, entrySurface, effectiveProfile) {
  if (skill.category && CATEGORIES.includes(skill.category)) return skill.category;
  if (entrySurface === 'claude-user-config') return 'claude-user-config';
  if (effectiveProfile) return 'claude-profile-bundle';
  return 'claude-skill-description';
}

function inspectDiscoveryContext({ root, inventory, readDescription = null, budgets = null, profileSelection = null, artifactIdentity = null, profileId = null, selectedStableIds = null, surface = null, legacyCli = false, estimator = null, category: requestedCategory = null } = {}) {
  const effectiveProfile = profileSelection || (profileId ? { id: profileId, selectedStableIds: selectedStableIds || [] } : null);
  const manifest = budgets ? { budgets } : loadDiscoveryBudgetManifest(root);
  const effectiveBudgets = manifest.budgets || {};
  const reader = readDescription || ((entry) => defaultReadDescription(root, entry));
  const selectedIds = effectiveProfile && Array.isArray(effectiveProfile.selectedStableIds)
    ? new Set(effectiveProfile.selectedStableIds)
    : null;
  const scope = effectiveProfile ? { kind: 'claude-profile', profile: effectiveProfile.id || null } : null;
  const identity = artifactIdentity && typeof artifactIdentity === 'object'
    ? { planFingerprint: artifactIdentity.planFingerprint || null, artifactFingerprint: artifactIdentity.artifactFingerprint || null }
    : null;
  const skills = ((inventory && inventory.skills) || []).filter((skill) => !selectedIds || selectedIds.has(skill.id));
  const items = [];
  for (const skill of skills) {
    const description = reader(skill) || '';
    const measured = counts(description);
    for (const entrySurface of skill.surfaces || []) {
      if (surface && entrySurface !== surface) continue;
      const limit = budgetFor(effectiveBudgets, skill.lifecycle, entrySurface);
      const visibility = visibilityFor(skill, entrySurface, manifest, legacyCli);
      const category = categoryFor(skill, entrySurface, effectiveProfile);
      items.push({
        id: skill.id || skill.name,
        stableId: skill.id || skill.name,
        name: skill.name || skill.id,
        lifecycle: skill.lifecycle,
        surface: entrySurface,
        publicationSurface: entrySurface,
        category,
        description,
        words: measured.words,
        tokens: measured.tokens,
        wordBudget: limit && limit.words,
        tokenBudget: limit && limit.tokens,
        limits: limit,
        discoveryVisible: visibility.value,
        visibilityReason: visibility.reason,
        profile: effectiveProfile && effectiveProfile.id || null,
      });
    }
  }
  const discoveredCategories = [...new Set(items.map((item) => item.category).filter(Boolean))];
  const reportCategory = requestedCategory
    || (effectiveProfile ? 'claude-profile-bundle' : discoveredCategories.length === 1 ? discoveredCategories[0] : 'claude-skill-description');
  const reportScope = reportCategory === 'claude-user-config'
    ? { kind: 'claude-plugin.userConfig' }
    : scope;
  const result = evaluateDiscoveryBudget({
    items,
    category: reportCategory,
    scope: reportScope,
    estimator: estimator || manifest.estimator || ESTIMATOR,
    identity,
    stage: 'structural',
    adapter: { id: 'context-budget', version: '2' },
  });
  const entries = result.entries.map((entry) => ({
    ...entry,
    id: entry.id || entry.stableId,
    wordBudget: entry.limits && entry.limits.words,
    tokenBudget: entry.limits && entry.limits.tokens,
  }));
  const report = {
    schema: 'dhpk.discovery-report.v1',
    category: reportCategory,
    categoryContracts: manifest.categories || {},
    entries,
    violations: result.violations,
    totals: result.totals,
    configurationErrors: result.configurationErrors,
    categories: result.categories,
    estimator: result.estimator,
    receipt: result.evidence,
    legacyCompatibilityViolations: legacyCli
      ? result.configurationErrors.filter((error) => error.code === 'MISSING_BUDGET_CONFIGURATION').length
      : undefined,
    ok: result.ok,
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
    report.compatibilityCatalog = inspectDiscoveryContext({ root, inventory, readDescription, budgets, surface, estimator, legacyCli });
  } else {
    report.scope = reportCategory === 'claude-user-config' ? 'claude-plugin.userConfig' : 'claude-compatibility';
    report.profileId = null;
  }
  return report;
}

function renderBudgetReport(report) {
  const lines = [
    `discovery-visible entries: ${report.totals.discoveryVisible}`,
    `optional discovery-visible entries: ${report.totals.optionalDiscoveryVisible}`,
    `budget violations: ${report.legacyCompatibilityViolations === undefined ? report.totals.violations : report.legacyCompatibilityViolations}`,
  ];
  if (report.configurationErrors && report.configurationErrors.length) {
    for (const error of report.configurationErrors) {
      const code = error && error.code ? `${error.code}: ` : '';
      const message = error && error.message ? error.message : String(error);
      lines.push(`FAIL configuration: ${code}${message}`);
    }
  }
  for (const entry of report.violations) {
    lines.push(`FAIL ${entry.id} [${entry.lifecycle}/${entry.surface}] discovery-visible ${entry.words}/${entry.wordBudget} words, ${entry.tokens}/${entry.tokenBudget} tokens`);
  }
  return `${lines.join('\n')}\n`;
}

function main() {
  const root = path.join(__dirname, '..', '..');
  const inventory = JSON.parse(fs.readFileSync(path.join(root, 'manifests', 'distribution-inventory.json'), 'utf8'));
  const report = inspectDiscoveryContext({ root, inventory, legacyCli: true });
  process.stdout.write(renderBudgetReport(report));
  if (process.argv.includes('--json')) process.stdout.write(`${JSON.stringify(report)}\n`);
  return report.violations.length || (report.configurationErrors && report.configurationErrors.length) ? 1 : 0;
}

if (require.main === module) process.exit(main());

module.exports = {
  DEFAULT_MANIFEST,
  loadDiscoveryBudgets,
  loadDiscoveryBudgetManifest,
  inspectDiscoveryContext,
  renderBudgetReport,
  counts,
};
