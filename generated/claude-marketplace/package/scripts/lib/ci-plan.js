'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const { findTests } = require('../../tests/run-all');
const { SURFACE_OWNERS } = require('./platform-provenance');

const JOBS = Object.freeze(['preflight', 'tests', 'validate', 'macos-installer', 'release-rehearsal', 'lint']);
const LIGHT_REQUIRED = Object.freeze(['preflight', 'validate', 'lint']);
const FULL_REQUIRED = Object.freeze(['preflight', 'tests', 'validate', 'macos-installer', 'lint']);
const SELECTED_REQUIRED = Object.freeze(['preflight', 'tests', 'validate', 'lint']);
const PACKAGE_SURFACES = Object.freeze(['agent-plugin', 'cursor-plugin', 'codex-native', 'agy-plugin']);
const FULL_GENERATED_CHECKS = Object.freeze(['claude-marketplace']);
const MACOS_OWNERS = Object.freeze(['hooks', 'installer', 'resource']);
const CLASSIFICATION_KINDS = Object.freeze(['wording', 'behavior', 'shared-core', 'unknown']);
const SHARED_CORE_PATHS = Object.freeze([
  'docs/agent-guidance/plugin-development.md',
  'docs/testing-governance.md',
  'rules/dhpk-project-conventions.md',
  'rules/execution-policy.md',
  'rules/execution-policy-kernel.md',
  'rules/tool-routing.md',
]);
const SHARED_CORE_PREFIXES = Object.freeze([
  '.github/workflows/',
  'tests/_lib/',
  'scripts/hooks/_lib/',
]);
const SHARED_CORE_FILES = Object.freeze([
  'tests/run-all.js',
  'scripts/ci/ci-plan.js',
  'scripts/ci/verify-test-shards.js',
  'scripts/lib/ci-plan.js',
]);
// Light plans skip the full validate job, so they check the retained generated
// Claude marketplace package when canonical docs/content edits may affect it.
const LIGHT_GENERATED_CHECKS = Object.freeze([...FULL_GENERATED_CHECKS].sort());
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
  if (/^changelog\.d\/[a-z0-9]+(?:-[a-z0-9]+)*\.none$/.test(file)) return 'metadata';
  if (/^modules\/[^/]+\/scripts\//i.test(file)) return 'script';
  if (/^(?:skills|commands|agents|rules|docs|modules|templates|cursor|codex)\/.*\.(?:json|ya?ml|toml)$/i.test(file)) return 'metadata';
  if (/^(?:\.github\/actions|scripts\/hooks|scripts\/install|install)/i.test(file)) return 'installer';
  if (/^(?:scripts|bin|tests)\//i.test(file)) return 'script';
  if (/^(?:plugins|generated|manifests|\.claude-plugin|\.codex-plugin)\//i.test(file)) return 'package';
  return 'unknown';
}

// These are intentionally coarse owner groups. They are an allowlist of
// existing public suites, rather than a per-script dependency graph.
const OWNER_GROUPS = Object.freeze([
  { name: 'hooks', paths: [/^scripts\/hooks\/(?!_lib\/)/i], tests: ['hooks-wiring.test.js', 'postcompact-restore.test.js', 'pre-agent-warmstart.test.js', 'pre-bash-guard.test.js', 'pre-edit-guard.test.js', 'pre-route.test.js', 'pretool-branch-safety-dedup.test.js', 'session-end.test.js', 'session-install-health-ask.test.js', 'session-install-health-version.test.js', 'session-start.test.js', 'stop-advisory-dispatch-graduation.test.js', 'subagent-stop-quality.test.js', 'subagent-stop-verify.test.js', 'userpromptsubmit-skill-hint.test.js', 'validate-test-hooks.test.js'] },
  {
    name: 'installer',
    paths: [/^scripts\/install\//i, /^scripts\/install\.sh$/i, /^scripts\/dhpk-install\.js$/i, /^scripts\/hooks\/install-/i, /^scripts\/lib\/dhpk-install-lifecycle\.js$/i],
    behaviorPaths: [/^skills\/harness-setup\/SKILL\.md$/i],
    tests: ['dhpk-install-lifecycle.test.js', 'install.test.js', 'install-assets.test.js', 'install-codex-skills.test.js', 'install-codex-skills-planning.test.js', 'install-codex-skills-reconciliation.test.js', 'install-codex-skills-uninstall.test.js', 'install-codex-sync-shared.test.js', 'install-cursor-harness.test.js', 'install-prompts.test.js', 'macos-installer-darwin.test.js', 'macos-installer-files.test.js', 'native-shared-skill-install.test.js'],
  },
  {
    name: 'skill-scripts',
    // Only entries invoked by the operability suite belong to this owner.
    // Internal modules and new scripts retain the full-verification fallback.
    paths: [
      /^skills\/change-verdict\/scripts\/(?:(?:check-unrelated-changes|review-cli)\.sh|risk-analyze\.js)$/,
      /^skills\/code-trace\/scripts\/diagnose\/(?:analyze-function-calls|check-tools|find-polluter|generate-flow-diagram|search-database-queries|trace-data-flow)\.sh$/,
      /^skills\/deploy-list\/scripts\/(?:check-golden|deploy-list)\.sh$/,
      /^skills\/feature-verify\/scripts\/(?:api-exec|health-probe)\.sh$/,
      /^skills\/project-audit\/scripts\/audit\.js$/,
      /^skills\/repo-intake\/scripts\/(?:intake_cached|scan_delta|scan_repo)\.js$/,
      /^skills\/flow-guide\/scripts\/(?:(?:action-runner|analyze|route-result|usage-card)\.js|(?:openspec_gate_check|prepare_dev_scope|prepare_workflow_profile|workflow_gate_check)\.py|pre-route\.sh)$/,
      /^skills\/git-smart-commit\/scripts\/collect-changes\.js$/,
      /^skills\/harness-setup\/scripts\/(?:install-assets|install-codex-project)\.sh$/,
      /^skills\/js-static-checks\/scripts\/status\.js$/,
      /^skills\/laravel\/scripts\/resolve-version\.js$/,
      /^skills\/opsx-apply-resume\/scripts\/(?:detect-phase|extract-compact|post-obs|set-handoff-state|write-handoff)\.sh$/,
      /^skills\/phpunit\/scripts\/resolve-version\.js$/,
      /^skills\/precommit\/scripts\/precommit-runner\.js$/,
      /^skills\/release-creator\/scripts\/release-runner\.sh$/,
      /^skills\/repo-verify\/scripts\/verify-runner\.js$/,
      /^skills\/swift\/scripts\/(?:generate_icons\.swift|iconify_gen\.sh)$/,
    ],
    tests: ['skill-script-operability.test.js'],
  },
  {
    name: 'resource',
    paths: [
      /^scripts\/lib\/skill-resource-sync\.js$/i,
      /^scripts\/ci\/sync-skill-resources\.js$/i,
      /^scripts\/cli-dispatch\/(?:adapters|transport|dispatch-runtime)\//i,
      /^scripts\/cli-dispatch\/verify-handoff\.js$/i,
      /^modules\/[^/]+\/scripts\//i,
    ],
    tests: [
      'modules.test.js', 'run-agy.test.js', 'run-codex.test.js',
      'run-cli-transport.test.js', 'cli-dispatch-launcher.test.js',
      'cli-role-resolver.test.js', 'verify-handoff.test.js',
      'verification-handoff-isolation.test.js', 'native-agent-support.test.js',
      'skill-resource-sync-security.test.js', 'skill-runtime-path-contract.test.js',
    ],
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

function selectedOwners(files, availableTests, classification, companionRouting) {
  const selected = new Set();
  const owners = new Set();
  let unmapped = false;
  const declarations = new Map(classification.entries.map((entry) => [entry.path, entry]));
  const boundedCompanions = new Set(companionRouting.eligible ? files : []);
  for (const file of files) {
    const declaration = declarations.get(file);
    const category = categoryFor(file);
    if (declaration && declaration.kind === 'wording' && (category === 'content' || category === 'metadata' || boundedCompanions.has(file))) continue;
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
    const groups = OWNER_GROUPS.filter((group) => group.paths.some((pattern) => pattern.test(file)
      || (declaration && declaration.kind === 'behavior' && (group.behaviorPaths || []).some((pattern) => pattern.test(file)))));
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
    if (/^changelog\.d\/[a-z0-9]+(?:-[a-z0-9]+)*\.none$/.test(file)) continue;
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

function isSharedCorePath(file) {
  const normalized = file.toLowerCase();
  return SHARED_CORE_PATHS.includes(file)
    || SHARED_CORE_PREFIXES.some((prefix) => normalized.startsWith(prefix))
    || SHARED_CORE_FILES.includes(normalized);
}

function assessClassification(changes, identities, declaration, declarationError) {
  const missing = (reason) => ({ status: 'unavailable', reason, entries: [] });
  if (declarationError) return missing(declarationError);
  if (declaration === undefined || declaration === null) return missing('classification-missing');
  if (!declaration || typeof declaration !== 'object' || Array.isArray(declaration)) return missing('classification-invalid');
  const keys = Object.keys(declaration).sort();
  if (keys.join(',') !== 'baseSha,entries,headSha' || !Array.isArray(declaration.entries)) return missing('classification-invalid');
  if (typeof declaration.baseSha !== 'string' || typeof declaration.headSha !== 'string'
    || declaration.baseSha.length === 0 || declaration.headSha.length === 0
    || declaration.baseSha !== identities.baseSha || declaration.headSha !== identities.headSha) {
    return missing('classification-identity-mismatch');
  }

  const entries = [];
  const seen = new Set();
  for (const entry of declaration.entries) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)
      || Object.keys(entry).sort().join(',') !== 'kind,path,reason'
      || typeof entry.path !== 'string' || entry.path.length === 0
      || entry.path.includes('\\') || path.posix.isAbsolute(entry.path)
      || entry.path.split('/').some((part) => part === '' || part === '.' || part === '..')
      || !CLASSIFICATION_KINDS.includes(entry.kind)
      || typeof entry.reason !== 'string' || entry.reason.trim().length === 0) {
      return missing('classification-invalid');
    }
    if (seen.has(entry.path)) return missing('classification-invalid');
    seen.add(entry.path);
    entries.push({ path: entry.path, kind: entry.kind, reason: entry.reason.trim() });
  }

  const changedPaths = [...new Set(changes.flatMap((change) => change ? change.files : []))].sort();
  const declaredPaths = entries.map((entry) => entry.path).sort();
  if (JSON.stringify(declaredPaths) !== JSON.stringify(changedPaths)) return missing('classification-paths-mismatch');
  return {
    status: 'accepted', reason: 'classification-accepted',
    baseSha: declaration.baseSha, headSha: declaration.headSha,
    entries: entries.sort((left, right) => left.path.localeCompare(right.path)),
  };
}

function classifyChangedPaths(changes, { baseRef = 'develop', baseSha, headSha, classification, classificationError } = {}) {
  const normalized = Array.isArray(changes) ? changes.map(normalizeChange) : [];
  const categories = [];
  const files = [];
  for (const change of normalized) {
    if (!change) { categories.push('unknown'); continue; }
    for (const file of change.files) { files.push(file); categories.push(categoryFor(file)); }
  }
  const release = baseRef === 'main';
  const assessedClassification = assessClassification(normalized, { baseSha, headSha }, classification, classificationError);
  const declarations = assessedClassification.entries;
  const sharedCore = files.some(isSharedCorePath) || declarations.some((entry) => entry.kind === 'shared-core');
  const unknownImpact = declarations.some((entry) => entry.kind === 'unknown');
  const companionRouting = companionRoutingForFiles(files);
  const wordingOnly = assessedClassification.status === 'accepted' && declarations.every((entry) => entry.kind === 'wording');
  const onlyLight = !release && !sharedCore && !unknownImpact && wordingOnly && files.length > 0
    && (categories.every((category) => category === 'content' || category === 'metadata') || companionRouting.eligible);
  const mode = onlyLight ? 'light' : 'full';
  const requiredJobs = mode === 'light'
    ? [...LIGHT_REQUIRED]
    : [...FULL_REQUIRED, ...(release ? ['release-rehearsal'] : [])];
  const skippedJobs = JOBS.filter((job) => !requiredJobs.includes(job));
  let reason = onlyLight
    ? companionRouting.eligible && categories.some((category) => category === 'package') ? 'canonical-with-bounded-companions' : 'canonical-content-only'
    : release ? 'release-base'
      : sharedCore ? 'shared-core-change'
        : unknownImpact ? 'unknown-impact'
          : assessedClassification.status !== 'accepted' ? assessedClassification.reason : 'full-fallback';
  return {
    schema: 'dhpk.ci-plan.v1', mode, reason,
    changes: normalized.filter(Boolean), categories: [...new Set(categories)], files: files.sort(), requiredJobs, skippedJobs,
    testFiles: [], shardCount: mode === 'light' ? 0 : 4, packageSurfaces: [], generatedChecks: mode === 'light' ? LIGHT_GENERATED_CHECKS.slice() : companionRouting.generatedChecks,
    classification: assessedClassification,
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

function completeFullPlan(classified, root, identities, reason = classified.reason) {
  let testFiles = [];
  try { testFiles = discoveredTestFiles(root); } catch (_) { /* keep a fail-closed plan when test discovery is unavailable */ }
  const release = identities.baseRef === 'main';
  const requiredJobs = [...FULL_REQUIRED, ...(release ? ['release-rehearsal'] : [])];
  return {
    ...classified,
    mode: 'full', reason,
    requiredJobs,
    skippedJobs: JOBS.filter((job) => !requiredJobs.includes(job)),
    testFiles, shardCount: 4,
    packageSurfaces: PACKAGE_SURFACES.slice(),
    generatedChecks: FULL_GENERATED_CHECKS.slice(),
    identities,
  };
}

function createCiPlan({ root = process.cwd(), baseSha, headSha, checkoutSha = headSha, baseRef = 'develop', classification, classificationError } = {}) {
  if (!baseSha || !headSha || !checkoutSha) throw new Error('baseSha, headSha, and checkoutSha are required');
  const identities = { baseSha, headSha, checkoutSha, baseRef };
  try {
    const changes = gitChanges(path.resolve(root), baseSha, headSha);
    const classified = classifyChangedPaths(changes, { baseRef, baseSha, headSha, classification, classificationError });
    const companionRouting = companionRoutingForFiles(classified.files);
    if (baseRef === 'main') return completeFullPlan(classified, root, identities, 'release-base');
    if (classified.classification.status !== 'accepted'
      || classified.reason === 'shared-core-change'
      || classified.reason === 'unknown-impact') {
      return completeFullPlan(classified, root, identities);
    }
    if (classified.mode === 'light') {
      return {
        ...classified,
        mode: 'light',
        reason: classified.reason,
        requiredJobs: [...LIGHT_REQUIRED],
        skippedJobs: JOBS.filter((job) => !LIGHT_REQUIRED.includes(job)),
        testFiles: [], shardCount: 0,
        packageSurfaces: companionRouting.packageSurfaces,
        generatedChecks: LIGHT_GENERATED_CHECKS.slice(),
        identities,
      };
    }
    if (companionRouting.hasOutputSpace && !companionRouting.eligible) {
      return completeFullPlan(classified, root, identities, 'generated-companion-without-canonical');
    }
    const availableTests = discoveredTestFiles(root);
    const selected = selectedOwners(classified.files, availableTests, classified.classification, companionRouting);
    if (selected.unmapped || selected.testFiles.length === 0) {
      return completeFullPlan(classified, root, identities, selected.unmapped ? 'owner-mapping-unavailable' : 'owner-suite-unavailable');
    }
    const needsMacos = selected.owners.some((owner) => MACOS_OWNERS.includes(owner));
    const requiredJobs = [...SELECTED_REQUIRED, ...(needsMacos ? ['macos-installer'] : [])];
    const skippedJobs = JOBS.filter((job) => !requiredJobs.includes(job));
    const hasCanonicalContent = classified.classification.entries.some((entry) =>
      categoryFor(entry.path) === 'content' || categoryFor(entry.path) === 'metadata');
    return {
      ...classified,
      mode: 'selected', reason: 'selected-owner-suites', testFiles: selected.testFiles,
      shardCount: 1, packageSurfaces: packageSurfacesForFiles(classified.files),
      generatedChecks: hasCanonicalContent ? LIGHT_GENERATED_CHECKS.slice() : [], requiredJobs, skippedJobs, identities,
    };
  } catch (error) {
    const fallback = classifyChangedPaths([{ status: 'M', path: '__invalid_diff__' }], {
      baseRef, baseSha, headSha, classification, classificationError: 'diff-unavailable',
    });
    return { ...completeFullPlan(fallback, root, identities, 'diff-unavailable'), diffError: error.message };
  }
}

function loadClassification({ classificationFile, eventPath = process.env.GITHUB_EVENT_PATH } = {}) {
  const unavailable = (reason) => ({ classification: null, classificationError: reason });
  if (classificationFile) {
    try {
      return { classification: JSON.parse(fs.readFileSync(path.resolve(classificationFile), 'utf8')), classificationError: null };
    } catch (_) {
      return unavailable('classification-invalid');
    }
  }
  if (!eventPath) return unavailable('classification-missing');
  try {
    const event = JSON.parse(fs.readFileSync(path.resolve(eventPath), 'utf8'));
    const body = event && event.pull_request && event.pull_request.body;
    if (typeof body !== 'string') return unavailable('classification-missing');
    const blocks = [...body.matchAll(/(?:^|\r?\n)[ \t]*```dhpk-ci-classification[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*```(?=\r?\n|$)/g)];
    if (blocks.length === 0) return unavailable('classification-missing');
    if (blocks.length !== 1) return unavailable('classification-invalid');
    return { classification: JSON.parse(blocks[0][1]), classificationError: null };
  } catch (_) {
    return unavailable('classification-invalid');
  }
}

function validateCiPlan(plan, expected = {}) {
  const errors = [];
  if (!plan || plan.schema !== 'dhpk.ci-plan.v1') errors.push('plan schema is invalid');
  if (!['light', 'selected', 'full'].includes(plan && plan.mode)) errors.push('plan mode is invalid');
  if (!plan || !plan.identities || typeof plan.identities !== 'object') errors.push('plan identities are missing');
  if (!plan || !plan.classification || typeof plan.classification !== 'object') errors.push('plan classification is missing');
  if (!Array.isArray(plan && plan.changes) || !Array.isArray(plan && plan.files) || !Array.isArray(plan && plan.categories)) errors.push('plan change fields are missing');
  if (!Array.isArray(plan && plan.requiredJobs) || !Array.isArray(plan && plan.skippedJobs) || !Number.isInteger(plan && plan.shardCount) || !Array.isArray(plan && plan.testFiles) || !Array.isArray(plan && plan.packageSurfaces) || !Array.isArray(plan && plan.generatedChecks)) errors.push('plan execution fields are missing');
  if (Array.isArray(plan && plan.generatedChecks)) {
    for (const check of plan.generatedChecks) if (!FULL_GENERATED_CHECKS.includes(check)) errors.push(`unknown generated companion check ${check}`);
  }
  if (plan && plan.requiredJobs && plan.skippedJobs && plan.requiredJobs.some((job) => plan.skippedJobs.includes(job))) errors.push('job is both required and skipped');
  if (plan && Array.isArray(plan.changes) && plan.identities) {
    const recomputed = classifyChangedPaths(plan.changes, {
      baseRef: expected.baseRef === undefined ? plan.identities.baseRef : expected.baseRef,
      baseSha: expected.baseSha === undefined ? plan.identities.baseSha : expected.baseSha,
      headSha: expected.headSha === undefined ? plan.identities.headSha : expected.headSha,
      classification: expected.classification,
      classificationError: expected.classificationError,
    });
    if (plan.reason !== 'diff-unavailable' && JSON.stringify(plan.classification) !== JSON.stringify(recomputed.classification)) {
      errors.push('plan classification does not match the independently supplied classification');
    }
    if (plan.reason !== 'diff-unavailable') {
      const mustBeFull = recomputed.classification.status !== 'accepted'
        || ['release-base', 'shared-core-change', 'unknown-impact'].includes(recomputed.reason);
      if (mustBeFull && plan.mode !== 'full') errors.push('plan mode does not match changed paths');
      if (recomputed.mode === 'light' && plan.mode !== 'light') errors.push('plan mode does not match changed paths');
      if (recomputed.mode === 'full' && !['full', 'selected'].includes(plan.mode)) errors.push('plan mode does not match changed paths');
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
      for (const key of ['mode', 'reason', 'categories', 'files', 'requiredJobs', 'skippedJobs', 'testFiles', 'shardCount', 'packageSurfaces', 'generatedChecks', 'changes', 'classification']) {
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

module.exports = { JOBS, classifyChangedPaths, createCiPlan, validateCiPlan, verifyCiResults, loadClassification, categoryFor, packageSurfacesForFiles, companionRoutingForFiles };
