'use strict';

const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { findTests } = require('../../tests/run-all');
const { SURFACE_OWNERS } = require('./platform-provenance');

const JOBS = Object.freeze(['preflight', 'tests', 'validate', 'macos-installer', 'release-rehearsal', 'lint']);
const LIGHT_REQUIRED = Object.freeze(['preflight', 'validate', 'lint']);
const FULL_REQUIRED = Object.freeze(['preflight', 'tests', 'validate', 'macos-installer', 'lint']);
const SELECTED_REQUIRED = Object.freeze(['preflight', 'tests', 'validate', 'lint']);
const PACKAGE_SURFACES = Object.freeze(['agent-plugin', 'cursor-plugin', 'codex-native', 'agy-plugin']);
const FULL_GENERATED_CHECKS = Object.freeze(['claude-marketplace', 'claude-profile:minimal', 'claude-profile:full', 'claude-profile:compat-v1']);
const RESOURCE_COMPANIONS = Object.freeze([
  'manifests/skill-resource-copies.json',
  'generated/claude-marketplace/package/manifests/skill-resource-copies.json',
]);
const CANONICAL_PROSE = [
  /^(?:README(?:\.zh-TW)?|AGENTS|CONTEXT|CODING_STANDARDS|RELEASE(?:\.zh-TW)?|CHANGELOG)\.md$/i,
  /^(?:skills|commands|agents|rules|docs|modules|templates|cursor|codex|openspec)\/.*\.md$/i,
  /^\.codex-plugin\/.*\.md$/i,
  /^changelog\.d\/.*\.md$/i,
];

function isCanonicalProse(file) {
  return CANONICAL_PROSE.some((pattern) => pattern.test(file))
    && !/(?:generated|plugins|\.codex(?:-plugin)?\/|\.agents\/|cursor\/generated|symlink)/i.test(file);
}

function categoryFor(file) {
  if (isCanonicalProse(file)) return 'content';
  if (/^(?:skills\/(?:dhpk-agy-fast-worker|dhpk-cli-transport|dhpk-session-usage-audit)\/scripts|modules\/[^/]+\/scripts)\//i.test(file)) return 'script';
  if (/^(?:skills|commands|agents|rules|docs|modules|templates|cursor|codex)\/.*\.(?:json|ya?ml|toml)$/i.test(file)) return 'metadata';
  if (/^(?:\.github\/actions|scripts\/hooks|scripts\/install|install)/i.test(file)) return 'installer';
  if (/^(?:scripts|bin|tests)\//i.test(file)) return 'script';
  if (/^(?:plugins|generated|manifests|\.claude-plugin|\.codex-plugin)\//i.test(file)) return 'package';
  return 'unknown';
}

// These are intentionally coarse owner groups. They are an allowlist of
// existing public suites, rather than a per-script dependency graph.
const OWNER_GROUPS = Object.freeze([
  { name: 'hooks', paths: [/^scripts\/hooks\/(?!_lib\/)/i], tests: ['hooks-wiring.test.js', 'postcompact-restore.test.js', 'pre-agent-warmstart.test.js', 'pre-bash-guard.test.js', 'pre-edit-guard.test.js', 'pre-route.test.js', 'pretool-branch-safety-dedup.test.js', 'session-audit-integrity-fixtures.test.js', 'session-end.test.js', 'session-install-health-ask.test.js', 'session-install-health-version.test.js', 'session-start.test.js', 'session-usage-audit.test.js', 'stop-advisory-dispatch-graduation.test.js', 'subagent-stop-quality.test.js', 'subagent-stop-verify.test.js', 'userpromptsubmit-skill-hint.test.js', 'validate-test-hooks.test.js'] },
  {
    name: 'installer',
    paths: [/^scripts\/install\//i, /^scripts\/install\.sh$/i, /^scripts\/dhpk-install\.js$/i, /^scripts\/hooks\/install-/i, /^scripts\/lib\/dhpk-install-lifecycle\.js$/i],
    tests: ['dhpk-install-lifecycle.test.js', 'install.test.js', 'install-assets.test.js', 'install-codex-skills.test.js', 'install-codex-skills-planning.test.js', 'install-codex-skills-reconciliation.test.js', 'install-codex-skills-uninstall.test.js', 'install-codex-sync-shared.test.js', 'install-cursor-harness.test.js', 'install-prompts.test.js', 'native-shared-skill-install.test.js', 'skill-pilot-install-migration.test.js', 'skill-pilot-isolation.test.js', 'skill-remaining-entry-isolation.test.js'],
  },
  {
    name: 'resource',
    paths: [/^scripts\/lib\/skill-resource-sync\.js$/i, /^scripts\/ci\/sync-skill-resources\.js$/i, /^skills\/(?:dhpk-agy-fast-worker|dhpk-cli-transport|dhpk-session-usage-audit)\/scripts\//i, /^modules\/[^/]+\/scripts\//i],
    tests: ['modules.test.js', 'run-agy.test.js', 'run-cli-transport.test.js', 'session-usage-audit.test.js', 'skill-resource-sync-security.test.js', 'skill-runtime-path-contract.test.js'],
  },
  {
    name: 'manifest',
    paths: [/^manifests\//i, /^scripts\/ci\/validate-(?:plugin|agents-skills|distribution|openai-metadata)\.js$/i],
    tests: ['validate-plugin.test.js', 'validate-distribution.test.js', 'agent-skill-integrity.test.js'],
  },
  {
    name: 'adapter-package',
    paths: [/^scripts\/lib\/(?:agy|agent|agents|claude|codex|cursor|marketplace|standalone|workflow)-.*(?:package|adapter|publication)\.js$/i, /^scripts\/ci\/(?:gen-(?:.*package|.*manifest|cursor-sync)|validate-agent-plugin-package)\.js$/i, /^plugins\//i],
    tests: ['agy-adapt-agents.test.js', 'agy-plugin-install.test.js', 'agents-skills-package.test.js', 'codex-native-package-validate.test.js', 'cursor-plugin-package.test.js', 'gen-agent-plugin-package.test.js', 'gen-claude-marketplace-package.test.js', 'gen-claude-manifest.test.js', 'gen-cursor-plugin-package.test.js'],
  },
]);

function discoveredTestFiles(root) {
  return findTests(path.join(path.resolve(root), 'tests'))
    .map((file) => path.relative(path.resolve(root, 'tests'), file).split(path.sep).join('/'))
    .sort();
}

function selectedOwners(files, availableTests) {
  const selected = new Set();
  const owners = new Set();
  let unmapped = false;
  for (const file of files) {
    if (/^(?:tests\/run-all\.js|tests\/_lib\/|scripts\/hooks\/_lib\/|scripts\/ci\/verify-test-shards\.js|scripts\/lib\/ci-plan\.js|scripts\/lib\/(?:provider-adapter|dispatch(?:\.js|-)|runner-utils|marketplace-host-publication|standalone-package-assets|workflow-package-closure)\.js|scripts\/ci\/ci-plan\.js|\.github\/workflows\/)/i.test(file)) {
      unmapped = true;
      continue;
    }
    const suite = file.match(/^tests\/(.+\.test\.js)$/i);
    if (suite) {
      if (!availableTests.includes(suite[1])) unmapped = true;
      else selected.add(suite[1]);
      continue;
    }
    const groups = OWNER_GROUPS.filter((group) => group.paths.some((pattern) => pattern.test(file)));
    if (groups.length === 0) { unmapped = true; continue; }
    groups.forEach((group) => {
      owners.add(group.name);
      group.tests.forEach((testFile) => {
        if (!availableTests.includes(testFile)) unmapped = true;
        else selected.add(testFile);
      });
    });
  }
  return { testFiles: [...selected].sort(), owners: [...owners].sort(), unmapped };
}

function packageSurfacesForFiles(files) {
  const surfaces = new Set();
  for (const file of files) {
    if (/^(?:generated\/|manifests\/|\.claude-plugin\/|scripts\/ci\/verify-platform-packages\.js$)/i.test(file)) {
      PACKAGE_SURFACES.forEach((surface) => surfaces.add(surface));
      continue;
    }
    if (/^(?:plugins\/dhpk-agent\/|scripts\/lib\/agent(?:s)?-.*package|scripts\/ci\/(?:gen-agent-plugin-package|validate-agent-plugin-package)\.js$)/i.test(file)) surfaces.add('agent-plugin');
    if (/^(?:plugins\/dhpk-cursor\/|scripts\/lib\/cursor-.*package|scripts\/ci\/gen-cursor-plugin-package\.js$)/i.test(file)) surfaces.add('cursor-plugin');
    if (/^(?:plugins\/dhpk\/|scripts\/lib\/codex-native-.*package|scripts\/ci\/(?:gen|verify)-codex-native-package\.js$)/i.test(file)) surfaces.add('codex-native');
    if (/^(?:plugins\/dhpk-agy\/|scripts\/lib\/agy-.*package|scripts\/ci\/(?:gen|validate)-agy-plugin-package\.js$)/i.test(file)) surfaces.add('agy-plugin');
  }
  return PACKAGE_SURFACES.filter((surface) => surfaces.has(surface));
}

function companionRoutingForFiles(files) {
  let canonical = false;
  let eligible = true;
  let hasCompanion = false;
  let hasOutputSpace = false;
  const surfaces = new Set();
  const generatedChecks = new Set();
  for (const file of files) {
    if (/^(?:plugins|generated)\//i.test(file)) hasOutputSpace = true;
    if (isCanonicalProse(file)) {
      canonical = true;
      continue;
    }
    let companion = false;
    for (const surface of PACKAGE_SURFACES) {
      const root = SURFACE_OWNERS[surface];
      if (file === `${root}/provenance.json` || file === `${root}/fingerprints.json` || (file.startsWith(`${root}/`) && file.endsWith('.md'))) {
        surfaces.add(surface);
        hasCompanion = true;
        companion = true;
      }
    }
    if (file === 'generated/claude-marketplace/package/provenance.json' || (file.startsWith('generated/claude-marketplace/package/') && file.endsWith('.md'))) {
      generatedChecks.add('claude-marketplace');
      hasCompanion = true;
      companion = true;
    }
    for (const profile of ['minimal', 'full', 'compat-v1']) {
      const root = `generated/claude-profiles/${profile}/package`;
      if (file === `${root}/bundle-receipt.json` || (file.startsWith(`${root}/`) && file.endsWith('.md'))) {
        generatedChecks.add(`claude-profile:${profile}`);
        hasCompanion = true;
        companion = true;
      }
    }
    if (RESOURCE_COMPANIONS.includes(file)) {
      companion = true;
      hasCompanion = true;
      if (file.startsWith('generated/claude-marketplace/')) generatedChecks.add('claude-marketplace');
    }
    if (!companion) eligible = false;
  }
  return {
    eligible: eligible && canonical,
    canonical,
    hasCompanion,
    hasOutputSpace,
    packageSurfaces: PACKAGE_SURFACES.filter((surface) => surfaces.has(surface)),
    generatedChecks: [...generatedChecks].sort(),
  };
}

function normalizeChange(change) {
  if (!change || typeof change !== 'object' || typeof change.status !== 'string') return null;
  const files = Array.isArray(change.files) ? change.files.filter((file) => typeof file === 'string') : [];
  if (typeof change.path === 'string') files.push(change.path);
  if (typeof change.oldPath === 'string') files.push(change.oldPath);
  return files.length ? { status: change.status, files } : null;
}

function classifyChangedPaths(changes, { baseRef = 'develop' } = {}) {
  const normalized = Array.isArray(changes) ? changes.map(normalizeChange) : [];
  const categories = [];
  const files = [];
  for (const change of normalized) {
    if (!change) { categories.push('unknown'); continue; }
    for (const file of change.files) { files.push(file); categories.push(categoryFor(file)); }
  }
  const release = baseRef === 'main';
  const companionRouting = companionRoutingForFiles(files);
  const onlyLight = !release && files.length > 0 && (categories.every((category) => category === 'content' || category === 'metadata') || companionRouting.eligible);
  const mode = onlyLight ? 'light' : 'full';
  const requiredJobs = mode === 'light'
    ? [...LIGHT_REQUIRED]
    : [...FULL_REQUIRED, ...(release ? ['release-rehearsal'] : [])];
  const skippedJobs = JOBS.filter((job) => !requiredJobs.includes(job));
  return {
    schema: 'dhpk.ci-plan.v1', mode, reason: onlyLight ? companionRouting.eligible && categories.some((category) => category === 'package') ? 'canonical-with-bounded-companions' : 'canonical-content-only' : release ? 'release-base' : 'full-fallback',
    changes: normalized.filter(Boolean), categories: [...new Set(categories)], files: files.sort(), requiredJobs, skippedJobs,
    testFiles: [], shardCount: mode === 'light' ? 0 : 4, packageSurfaces: [], generatedChecks: companionRouting.generatedChecks,
  };
}

function gitChanges(root, baseSha, headSha) {
  const output = execFileSync('git', ['-C', root, 'diff', '--name-status', '-z', '--find-renames', `${baseSha}...${headSha}`], { encoding: 'utf8' });
  const fields = output.split('\0').filter(Boolean);
  const changes = [];
  for (let index = 0; index < fields.length;) {
    const status = fields[index++];
    if (!/^(?:[MADRCU]|[MADRCU][0-9]{1,3})$/.test(status)) throw new Error('invalid git diff status');
    if (status.startsWith('R') || status.startsWith('C')) {
      const oldPath = fields[index++]; const newPath = fields[index++];
      if (!oldPath || !newPath) throw new Error('incomplete git rename record');
      changes.push({ status: status[0], oldPath, path: newPath });
    } else {
      const file = fields[index++];
      if (!file) throw new Error('incomplete git diff record');
      changes.push({ status: status[0], path: file });
    }
  }
  return changes;
}

function createCiPlan({ root = process.cwd(), baseSha, headSha, checkoutSha = headSha, baseRef = 'develop' } = {}) {
  if (!baseSha || !headSha || !checkoutSha) throw new Error('baseSha, headSha, and checkoutSha are required');
  const identities = { baseSha, headSha, checkoutSha, baseRef };
  try {
    const changes = gitChanges(path.resolve(root), baseSha, headSha);
    const classified = classifyChangedPaths(changes, { baseRef });
    const companionRouting = companionRoutingForFiles(classified.files);
    if (classified.mode === 'light' || (companionRouting.eligible && baseRef !== 'main')) {
      return {
        ...classified,
        mode: 'light',
        reason: companionRouting.eligible && classified.mode !== 'light' ? 'canonical-with-bounded-companions' : classified.reason,
        requiredJobs: [...LIGHT_REQUIRED],
        skippedJobs: JOBS.filter((job) => !LIGHT_REQUIRED.includes(job)),
        testFiles: [], shardCount: 0,
        packageSurfaces: companionRouting.packageSurfaces,
        generatedChecks: companionRouting.generatedChecks,
        identities,
      };
    }
    if (baseRef === 'main') {
      return {
        ...classified,
        testFiles: discoveredTestFiles(root),
        packageSurfaces: PACKAGE_SURFACES.slice(),
        generatedChecks: FULL_GENERATED_CHECKS.slice(),
        identities,
      };
    }
    if (companionRouting.hasOutputSpace && !companionRouting.eligible) {
      return {
        ...classified,
        mode: 'full', reason: 'generated-companion-without-canonical',
        requiredJobs: [...FULL_REQUIRED],
        skippedJobs: JOBS.filter((job) => !FULL_REQUIRED.includes(job)),
        testFiles: discoveredTestFiles(root), shardCount: 4,
        packageSurfaces: PACKAGE_SURFACES.slice(), generatedChecks: FULL_GENERATED_CHECKS.slice(), identities,
      };
    }
    const availableTests = discoveredTestFiles(root);
    const selected = selectedOwners(classified.files, availableTests);
    if (selected.unmapped || selected.testFiles.length === 0) {
      return {
        ...classified,
        mode: 'full', reason: selected.unmapped ? 'owner-mapping-unavailable' : 'owner-suite-unavailable',
        requiredJobs: [...FULL_REQUIRED, ...(baseRef === 'main' ? ['release-rehearsal'] : [])],
        skippedJobs: JOBS.filter((job) => !FULL_REQUIRED.includes(job) && !(baseRef === 'main' && job === 'release-rehearsal')),
        testFiles: discoveredTestFiles(root), shardCount: 4, packageSurfaces: PACKAGE_SURFACES.slice(), generatedChecks: FULL_GENERATED_CHECKS.slice(), identities,
      };
    }
    const installer = selected.owners.includes('installer');
    const requiredJobs = [...SELECTED_REQUIRED, ...(installer ? ['macos-installer'] : [])];
    const skippedJobs = JOBS.filter((job) => !requiredJobs.includes(job));
    return {
      ...classified,
      mode: 'selected', reason: 'selected-owner-suites', testFiles: selected.testFiles,
      shardCount: 1, packageSurfaces: packageSurfacesForFiles(classified.files), generatedChecks: [], requiredJobs, skippedJobs, identities,
    };
  } catch (error) {
    let testFiles = [];
    try { testFiles = discoveredTestFiles(root); } catch (_) { /* preserve diff-unavailable fallback */ }
    return {
      ...classifyChangedPaths([{ status: 'M', path: '__invalid_diff__' }], { baseRef }),
      reason: 'diff-unavailable', diffError: error.message, testFiles,
      packageSurfaces: PACKAGE_SURFACES.slice(), generatedChecks: FULL_GENERATED_CHECKS.slice(), identities,
    };
  }
}

function validateCiPlan(plan, expected = {}) {
  const errors = [];
  if (!plan || plan.schema !== 'dhpk.ci-plan.v1') errors.push('plan schema is invalid');
  if (!['light', 'selected', 'full'].includes(plan && plan.mode)) errors.push('plan mode is invalid');
  if (!plan || !plan.identities || typeof plan.identities !== 'object') errors.push('plan identities are missing');
  if (!Array.isArray(plan && plan.changes) || !Array.isArray(plan && plan.files) || !Array.isArray(plan && plan.categories)) errors.push('plan change fields are missing');
  if (!Array.isArray(plan && plan.requiredJobs) || !Array.isArray(plan && plan.skippedJobs) || !Number.isInteger(plan && plan.shardCount) || !Array.isArray(plan && plan.testFiles) || !Array.isArray(plan && plan.packageSurfaces) || !Array.isArray(plan && plan.generatedChecks)) errors.push('plan execution fields are missing');
  if (Array.isArray(plan && plan.generatedChecks)) {
    for (const check of plan.generatedChecks) if (!FULL_GENERATED_CHECKS.includes(check)) errors.push(`unknown generated companion check ${check}`);
  }
  if (plan && plan.requiredJobs && plan.skippedJobs && plan.requiredJobs.some((job) => plan.skippedJobs.includes(job))) errors.push('job is both required and skipped');
  if (plan && Array.isArray(plan.changes) && plan.identities) {
    const recomputed = classifyChangedPaths(plan.changes, { baseRef: plan.identities.baseRef });
    if (plan.reason !== 'diff-unavailable') {
      if (recomputed.mode === 'light' && plan.mode !== 'light') errors.push('plan mode does not match changed paths');
      if (recomputed.mode === 'full' && !['full', 'selected'].includes(plan.mode) && plan.reason !== 'owner-mapping-unavailable' && plan.reason !== 'owner-suite-unavailable') errors.push('plan mode does not match changed paths');
    } else if (recomputed.mode !== 'full') errors.push('unavailable diff must produce a full plan');
    for (const key of ['files', 'categories']) if (JSON.stringify(plan[key]) !== JSON.stringify(recomputed[key])) errors.push(`plan ${key} does not match changed paths`);
  }
  for (const key of ['baseSha', 'headSha', 'checkoutSha', 'baseRef']) {
    if (!plan || !plan.identities || typeof plan.identities[key] !== 'string' || plan.identities[key].length === 0) errors.push(`plan identity ${key} is missing`);
    else if (expected[key] !== undefined && plan.identities[key] !== expected[key]) errors.push(`plan identity ${key} does not match`);
  }
  if (expected.root && expected.baseSha && expected.headSha) {
    try {
      const actualPlan = createCiPlan(expected);
      for (const key of ['mode', 'reason', 'categories', 'files', 'requiredJobs', 'skippedJobs', 'testFiles', 'shardCount', 'packageSurfaces', 'generatedChecks', 'changes']) {
        if (JSON.stringify(plan[key]) !== JSON.stringify(actualPlan[key])) errors.push(`plan ${key} does not match the authoritative plan`);
      }
    } catch (error) { errors.push(`authoritative git diff unavailable: ${error.message}`); }
    try {
      const checkout = execFileSync('git', ['-C', path.resolve(expected.root), 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
      if (checkout !== expected.checkoutSha) errors.push('checkout identity does not match git HEAD');
    } catch (error) { errors.push(`checkout identity unavailable: ${error.message}`); }
  }
  return { ok: errors.length === 0, errors };
}

function verifyCiResults(plan, results, expected = {}) {
  const errors = [];
  const planValidation = validateCiPlan(plan, expected);
  if (!planValidation.ok) return { ok: false, errors: planValidation.errors };
  const statuses = results && typeof results === 'object' ? results : {};
  for (const job of plan.requiredJobs) if (statuses[job] !== 'success') errors.push(`required job ${job} is ${statuses[job] || 'missing'}`);
  for (const job of plan.skippedJobs) if (statuses[job] !== 'skipped') errors.push(`skipped job ${job} must report skipped`);
  for (const job of Object.keys(statuses)) if (!JOBS.includes(job)) errors.push(`unknown job result ${job}`);
  return { ok: errors.length === 0, errors };
}

module.exports = { JOBS, classifyChangedPaths, createCiPlan, validateCiPlan, verifyCiResults, categoryFor, packageSurfacesForFiles, companionRoutingForFiles };
