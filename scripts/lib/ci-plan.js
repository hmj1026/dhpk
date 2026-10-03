'use strict';

const path = require('node:path');
const { execFileSync } = require('node:child_process');

const JOBS = Object.freeze(['preflight', 'tests', 'validate', 'macos-installer', 'release-rehearsal', 'lint']);
const LIGHT_REQUIRED = Object.freeze(['preflight', 'validate', 'lint']);
const FULL_REQUIRED = Object.freeze(['preflight', 'tests', 'validate', 'macos-installer', 'lint']);
const CANONICAL_PROSE = [
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
  if (/^(?:skills|commands|agents|rules|docs|modules|templates|cursor|codex)\/.*\.(?:json|ya?ml|toml)$/i.test(file)) return 'metadata';
  if (/^(?:\.github\/actions|scripts\/hooks|scripts\/install|install)/i.test(file)) return 'installer';
  if (/^(?:scripts|bin|tests)\//i.test(file)) return 'script';
  if (/^(?:plugins|generated|manifests|\.claude-plugin|\.codex-plugin)\//i.test(file)) return 'package';
  return 'unknown';
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
  const onlyLight = !release && files.length > 0 && categories.every((category) => category === 'content' || category === 'metadata');
  const mode = onlyLight ? 'light' : 'full';
  const requiredJobs = mode === 'light'
    ? [...LIGHT_REQUIRED]
    : [...FULL_REQUIRED, ...(release ? ['release-rehearsal'] : [])];
  const skippedJobs = JOBS.filter((job) => !requiredJobs.includes(job));
  return {
    schema: 'dhpk.ci-plan.v1', mode, reason: onlyLight ? 'canonical-content-only' : release ? 'release-base' : 'full-fallback',
    changes: normalized.filter(Boolean), categories: [...new Set(categories)], files: files.sort(), requiredJobs, skippedJobs,
    testFiles: [], shardCount: mode === 'light' ? 0 : 4, packageSurfaces: [],
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
    return { ...classifyChangedPaths(changes, { baseRef }), identities };
  } catch (error) {
    return {
      ...classifyChangedPaths([{ status: 'M', path: '__invalid_diff__' }], { baseRef }),
      reason: 'diff-unavailable', diffError: error.message, identities,
    };
  }
}

function validateCiPlan(plan, expected = {}) {
  const errors = [];
  if (!plan || plan.schema !== 'dhpk.ci-plan.v1') errors.push('plan schema is invalid');
  if (!['light', 'full'].includes(plan && plan.mode)) errors.push('plan mode is invalid');
  if (!plan || !plan.identities || typeof plan.identities !== 'object') errors.push('plan identities are missing');
  if (!Array.isArray(plan && plan.changes) || !Array.isArray(plan && plan.files) || !Array.isArray(plan && plan.categories)) errors.push('plan change fields are missing');
  if (!Array.isArray(plan && plan.requiredJobs) || !Array.isArray(plan && plan.skippedJobs) || !Number.isInteger(plan && plan.shardCount) || !Array.isArray(plan && plan.testFiles) || !Array.isArray(plan && plan.packageSurfaces)) errors.push('plan execution fields are missing');
  if (plan && plan.requiredJobs && plan.skippedJobs && plan.requiredJobs.some((job) => plan.skippedJobs.includes(job))) errors.push('job is both required and skipped');
  if (plan && Array.isArray(plan.changes) && plan.identities) {
    const recomputed = classifyChangedPaths(plan.changes, { baseRef: plan.identities.baseRef });
    for (const key of ['mode', 'reason']) if (plan[key] !== recomputed[key]) errors.push(`plan ${key} does not match changed paths`);
    for (const key of ['files', 'requiredJobs', 'skippedJobs']) if (JSON.stringify(plan[key]) !== JSON.stringify(recomputed[key])) errors.push(`plan ${key} does not match changed paths`);
    if (plan.reason === 'diff-unavailable') errors.push('plan was generated from an unavailable diff');
  }
  for (const key of ['baseSha', 'headSha', 'checkoutSha', 'baseRef']) {
    if (!plan || !plan.identities || typeof plan.identities[key] !== 'string' || plan.identities[key].length === 0) errors.push(`plan identity ${key} is missing`);
    else if (expected[key] !== undefined && plan.identities[key] !== expected[key]) errors.push(`plan identity ${key} does not match`);
  }
  if (expected.root && expected.baseSha && expected.headSha) {
    try {
      const actual = gitChanges(path.resolve(expected.root), expected.baseSha, expected.headSha);
      const actualPlan = classifyChangedPaths(actual, { baseRef: expected.baseRef });
      if (JSON.stringify(plan.changes) !== JSON.stringify(actualPlan.changes)) errors.push('plan changes do not match the authoritative git diff');
      if (plan.mode !== actualPlan.mode || plan.reason !== actualPlan.reason) errors.push('plan classification does not match the authoritative git diff');
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

module.exports = { JOBS, classifyChangedPaths, createCiPlan, validateCiPlan, verifyCiResults, categoryFor };
