'use strict';

const path = require('node:path');
const { execFileSync } = require('node:child_process');

const JOBS = Object.freeze(['preflight', 'tests', 'validate', 'macos-installer', 'release-rehearsal', 'lint']);
const LIGHT_REQUIRED = Object.freeze(['preflight', 'lint']);
const FULL_REQUIRED = Object.freeze(['preflight', 'tests', 'validate', 'macos-installer', 'lint']);
const CANONICAL_PROSE = [
  /^(?:skills|commands|agents|rules|docs|modules|templates|cursor|codex|openspec)\/.*\.md$/i,
  /^\.codex-plugin\/.*\.md$/i,
  /^changelog\.d\/.*\.md$/i,
];

function isCanonicalProse(file) {
  return CANONICAL_PROSE.some((pattern) => pattern.test(file))
    && !/(?:generated|plugins|\.codex\/(?:agents|skills|dhpk))\//i.test(file);
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
    if (status.startsWith('R') || status.startsWith('C')) changes.push({ status: status[0], oldPath: fields[index++], path: fields[index++] });
    else changes.push({ status: status[0], path: fields[index++] });
  }
  return changes;
}

function createCiPlan({ root = process.cwd(), baseSha, headSha, checkoutSha = headSha, baseRef = 'develop' } = {}) {
  if (!baseSha || !headSha || !checkoutSha) throw new Error('baseSha, headSha, and checkoutSha are required');
  const changes = gitChanges(path.resolve(root), baseSha, headSha);
  return { ...classifyChangedPaths(changes, { baseRef }), identities: { baseSha, headSha, checkoutSha, baseRef } };
}

function validateCiPlan(plan, expected = {}) {
  const errors = [];
  if (!plan || plan.schema !== 'dhpk.ci-plan.v1') errors.push('plan schema is invalid');
  if (!['light', 'full'].includes(plan && plan.mode)) errors.push('plan mode is invalid');
  if (!Array.isArray(plan && plan.requiredJobs) || !Array.isArray(plan && plan.skippedJobs)) errors.push('plan jobs are missing');
  if (plan && plan.requiredJobs && plan.skippedJobs && plan.requiredJobs.some((job) => plan.skippedJobs.includes(job))) errors.push('job is both required and skipped');
  if (plan && Array.isArray(plan.changes) && plan.identities) {
    const recomputed = classifyChangedPaths(plan.changes, { baseRef: plan.identities.baseRef });
    for (const key of ['mode', 'reason']) if (plan[key] !== recomputed[key]) errors.push(`plan ${key} does not match changed paths`);
    for (const key of ['files', 'requiredJobs', 'skippedJobs']) if (JSON.stringify(plan[key]) !== JSON.stringify(recomputed[key])) errors.push(`plan ${key} does not match changed paths`);
  }
  for (const key of ['baseSha', 'headSha', 'checkoutSha', 'baseRef']) {
    if (expected[key] !== undefined && (!plan.identities || plan.identities[key] !== expected[key])) errors.push(`plan identity ${key} does not match`);
  }
  return { ok: errors.length === 0, errors };
}

function verifyCiResults(plan, results) {
  const errors = [];
  if (!validateCiPlan(plan).ok) return { ok: false, errors: ['invalid CI plan'] };
  const statuses = results && typeof results === 'object' ? results : {};
  for (const job of plan.requiredJobs) if (statuses[job] !== 'success') errors.push(`required job ${job} is ${statuses[job] || 'missing'}`);
  for (const job of plan.skippedJobs) if (statuses[job] !== 'skipped') errors.push(`skipped job ${job} must report skipped`);
  for (const job of Object.keys(statuses)) if (!JOBS.includes(job)) errors.push(`unknown job result ${job}`);
  return { ok: errors.length === 0, errors };
}

module.exports = { JOBS, classifyChangedPaths, createCiPlan, validateCiPlan, verifyCiResults, categoryFor };
