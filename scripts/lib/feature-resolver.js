'use strict';

/**
 * feature-resolver.js — canonical "current feature" resolver.
 *
 * Spec: skills/create-request/references/feature-context-resolution.md
 *       skills/tech-spec/references/feature-context-resolution.md
 *
 * Runs a 4-level resolution cascade (explicit key -> git branch -> changed
 * paths -> single feature dir) and, once a feature key is resolved, scans
 * `docs/features/<key>/` to produce a classified doc inventory plus a
 * canonical-doc role map.
 *
 * Pure Node: only node:fs, node:path, node:child_process. No external deps.
 * Fails soft: any git failure is treated as "no signal" rather than throwing.
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

/**
 * Slug validation — must match the spec regex exactly.
 * Rejects path traversal (`../`, `/`) and dotfiles (`.hidden`): the first
 * character is constrained to [a-z0-9], and `/` is never allowed.
 */
const SLUG_RE = /^[a-z0-9][a-z0-9._-]*$/i;

/** Stable role keys used in `canonical_docs`. */
const CANONICAL_ROLES = ['tech_spec', 'architecture', 'feasibility', 'requirements'];

/** Default/expected filename per canonical role (used as a tie-breaker). */
const DEFAULT_NAMES = {
  requirements: '1-requirements.md',
  tech_spec: '2-tech-spec.md',
  architecture: '3-architecture.md',
  feasibility: '0-feasibility.md',
};

const CONFIDENCE_RANK = { high: 3, medium: 2, low: 1 };

function isValidSlug(s) {
  return typeof s === 'string' && SLUG_RE.test(s);
}

function emptyCanonical() {
  return { tech_spec: null, architecture: null, feasibility: null, requirements: null };
}

function emptyResult() {
  return {
    key: null,
    source: null,
    confidence: null,
    docs_path: null,
    doc_inventory: [],
    canonical_docs: emptyCanonical(),
    has_tech_spec: false,
    has_requirements: false,
    has_requests: false,
  };
}

/**
 * Run a git subcommand, returning trimmed stdout or '' on any failure.
 * Git stderr is discarded so callers see a clean "no signal" on errors.
 */
function git(args, cwd) {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

/** Resolve the git repo root, falling back to process.cwd() when unavailable. */
function resolveRepoRoot() {
  const root = git(['rev-parse', '--show-toplevel'], process.cwd());
  return root || process.cwd();
}

/**
 * Classify a single `.md` filename into a doc-inventory entry.
 * Returns { file, type, namespace, confidence, role } — `role` is the
 * internal canonical-role key (null when unrecognized) and is stripped
 * from the public output.
 */
function classifyDoc(filename) {
  const numericMatch = filename.match(/^(\d+)-(.+)\.md$/i);
  const numbered = Boolean(numericMatch);
  const namespace = numbered ? 'lifecycle' : 'ad-hoc';
  const stem = (numbered ? numericMatch[2] : filename.replace(/\.md$/i, '')).toLowerCase();

  let role = null;
  let type;
  if (stem.includes('requirement')) {
    role = 'requirements';
    type = 'requirements';
  } else if (/tech[-_ ]?spec/.test(stem)) {
    role = 'tech_spec';
    type = 'tech-spec';
  } else if (stem.includes('architecture') || stem === 'arch') {
    role = 'architecture';
    type = 'architecture';
  } else if (stem.includes('feasibility')) {
    role = 'feasibility';
    type = 'feasibility';
  } else {
    role = null;
    type = stem;
  }

  let confidence;
  if (role && numbered) confidence = 'high';
  else if (role) confidence = 'medium';
  else confidence = 'low';

  return { file: filename, type, namespace, confidence, role };
}

/**
 * Pick the canonical file among entries sharing a role.
 * Order: higher confidence -> exact default name -> shorter name -> alpha.
 */
function canonicalCompare(role) {
  const defaultName = DEFAULT_NAMES[role];
  return (a, b) => {
    const rank = (CONFIDENCE_RANK[b.confidence] || 0) - (CONFIDENCE_RANK[a.confidence] || 0);
    if (rank !== 0) return rank;
    const aDefault = a.file === defaultName ? 0 : 1;
    const bDefault = b.file === defaultName ? 0 : 1;
    if (aDefault !== bDefault) return aDefault - bDefault;
    if (a.file.length !== b.file.length) return a.file.length - b.file.length;
    return a.file.localeCompare(b.file);
  };
}

/**
 * Scan a feature directory's top-level `.md` files.
 * Returns { docInventory, canonicalDocs }.
 */
function scanFeatureDir(featureDir) {
  let entries;
  try {
    entries = fs.readdirSync(featureDir, { withFileTypes: true });
  } catch {
    return { docInventory: [], canonicalDocs: emptyCanonical() };
  }

  const classified = entries
    .filter((e) => e.isFile() && /\.md$/i.test(e.name))
    .map((e) => classifyDoc(e.name));

  const canonicalDocs = emptyCanonical();
  const canonicalFileByRole = {};
  for (const role of CANONICAL_ROLES) {
    const group = classified.filter((d) => d.role === role);
    if (group.length === 0) continue;
    group.sort(canonicalCompare(role));
    const winner = group[0].file;
    canonicalFileByRole[role] = winner;
    canonicalDocs[role] = { file: winner, path: winner };
  }

  const docInventory = classified
    .map((d) => ({
      file: d.file,
      type: d.type,
      namespace: d.namespace,
      confidence: d.confidence,
      is_canonical: d.role != null && canonicalFileByRole[d.role] === d.file,
    }))
    .sort((a, b) => a.file.localeCompare(b.file));

  return { docInventory, canonicalDocs };
}

/** True when `<featureDir>/requests/` holds at least one `.md` ticket. */
function scanHasRequests(featureDir) {
  try {
    return fs
      .readdirSync(path.join(featureDir, 'requests'))
      .some((name) => /\.md$/i.test(name));
  } catch {
    return false;
  }
}

/**
 * Resolve the current feature context.
 *
 * @param {object} [opts]
 * @param {string} [opts.feature] Explicit feature key (Level 1).
 * @param {string} [opts.cwd]     Override the resolution root (defaults to git root).
 * @returns {object} Result object matching the feature-context-resolution schema.
 */
function resolveFeature(opts = {}) {
  const { feature } = opts;
  const root = opts.cwd ? path.resolve(opts.cwd) : resolveRepoRoot();

  let key = null;
  let source = null;
  let confidence = null;

  // Level 1 — explicit --feature key.
  if (feature != null && String(feature).length > 0 && isValidSlug(feature)) {
    key = String(feature);
    source = 'explicit';
    confidence = 'high';
  }

  // Level 2 — git branch `feat/<key>`.
  if (!key) {
    const branch = git(['branch', '--show-current'], root);
    const m = branch.match(/^feat\/(.+)$/);
    if (m && isValidSlug(m[1])) {
      key = m[1];
      source = 'branch';
      confidence = 'high';
    }
  }

  // Level 3 — changed paths under docs/features/<key>/ or skills/<key>/.
  if (!key) {
    const diff = git(['diff', '--name-only', 'HEAD'], root);
    const candidates = new Set();
    for (const line of diff.split('\n')) {
      const m = line.match(/^(?:docs\/features|skills)\/([^/]+)\//);
      if (m && isValidSlug(m[1])) candidates.add(m[1]);
    }
    if (candidates.size === 1) {
      key = [...candidates][0];
      source = 'diff';
      confidence = 'medium';
    }
  }

  // Level 4 — single directory under docs/features/.
  if (!key) {
    let dirs = [];
    try {
      dirs = fs
        .readdirSync(path.join(root, 'docs', 'features'), { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name);
    } catch {
      dirs = [];
    }
    const validDirs = dirs.filter(isValidSlug);
    if (validDirs.length === 1) {
      key = validDirs[0];
      source = 'single-dir';
      confidence = 'low';
    }
  }

  // Not found — Gate: Need Human.
  if (!key) {
    return emptyResult();
  }

  const featureDir = path.join(root, 'docs', 'features', key);
  const { docInventory, canonicalDocs } = scanFeatureDir(featureDir);

  return {
    key,
    source,
    confidence,
    docs_path: `docs/features/${key}`,
    doc_inventory: docInventory,
    canonical_docs: canonicalDocs,
    has_tech_spec: canonicalDocs.tech_spec != null,
    has_requirements: canonicalDocs.requirements != null,
    has_requests: scanHasRequests(featureDir),
  };
}

module.exports = {
  resolveFeature,
  isValidSlug,
  classifyDoc,
  SLUG_RE,
};
