'use strict';

// A release artifact manifest binds the package bytes consumed after publish
// to the exact checkout and provenance that passed the release package gate.
// It is deliberately an identity record, not a cache: every field is checked
// again in the consumer job before any runtime probe is allowed to run.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const {
  SURFACE_OWNERS,
  resolveGeneratedFromTree,
  validateSurfaceReceipt,
} = require('./platform-provenance');

const SCHEMA = 'dhpk.release-artifact-manifest.v1';
const PRODUCER = 'verify-platform-packages';
const COMMIT = /^[a-f0-9]{40}$/i;
const TREE = /^[a-f0-9]{40}$/i;
const PACKAGE_SURFACES = Object.freeze([
  'agent-plugin',
  'cursor-plugin',
  'codex-native',
  'agy-plugin',
]);
const PACKAGE_ROOTS = Object.freeze({
  'agent-plugin': 'plugins/dhpk-agent',
  'cursor-plugin': 'plugins/dhpk-cursor',
  'codex-native': 'plugins/dhpk',
  'agy-plugin': 'plugins/dhpk-agy',
});

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function digest(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function digestJson(value) {
  return `sha256:${digest(JSON.stringify(canonical(value)))}`;
}

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function assertSafePackageRoot(root) {
  const lexical = path.resolve(root);
  const canonicalRoot = fs.realpathSync(root);
  if (lexical !== canonicalRoot) throw new Error(`package root is symlinked: ${root}`);
  const stat = fs.lstatSync(root);
  if (!stat.isDirectory()) throw new Error(`package root is not a directory: ${root}`);
}

function packageFingerprints(root) {
  assertSafePackageRoot(root);
  const content = crypto.createHash('sha256');
  const modes = crypto.createHash('sha256');
  const walk = (directory, relative) => {
    const entries = fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.name === '__pycache__' || entry.name.endsWith('.pyc')) continue;
      const absolute = path.join(directory, entry.name);
      const rel = path.posix.join(relative, entry.name);
      const stat = fs.lstatSync(absolute);
      if (stat.isSymbolicLink()) throw new Error(`package contains a symlink: ${rel}`);
      if (stat.isDirectory()) {
        walk(absolute, rel);
        continue;
      }
      if (!stat.isFile()) throw new Error(`package contains a special entry: ${rel}`);
      const bytes = fs.readFileSync(absolute);
      content.update(rel);
      content.update('\0');
      content.update(bytes);
      modes.update(rel);
      modes.update('\0');
      modes.update(String(stat.mode & 0o7777));
      modes.update('\0');
    }
  };
  walk(root, '');
  const contentFingerprint = `sha256:${content.digest('hex')}`;
  const modeFingerprint = `sha256:${modes.digest('hex')}`;
  return {
    contentFingerprint,
    modeFingerprint,
    artifactFingerprint: digestJson({ contentFingerprint, modeFingerprint }),
  };
}

function normalizedProvenance(provenance) {
  // AGY adds its package schema to the platform receipt. The shared receipt
  // validator intentionally receives the platform schema alias only here.
  return provenance && provenance.provenanceSchema === 'dhpk.platform-provenance.v1'
    ? { ...provenance, schema: 'dhpk.platform-provenance.v1' }
    : provenance;
}

function selectionIdentity(provenance) {
  return {
    profileId: provenance.profileId || null,
    selectionMode: provenance.selectionMode || null,
    selectedStableIds: provenance.selectedStableIds || provenance.selectedSkillIds || [],
    emittedStableIds: provenance.emittedStableIds || provenance.materializedSkillIds || [],
    requestedStableIds: provenance.requestedStableIds || [],
    dependencyClosure: provenance.dependencyClosure || null,
    compatibilityMode: provenance.compatibilityMode || null,
    selectionPolicyVersion: provenance.selectionPolicyVersion || null,
    selectionFingerprint: provenance.selectionFingerprint || null,
    surfaceSelectionFingerprint: provenance.surfaceSelectionFingerprint || null,
  };
}

function compilerIdentity(provenance) {
  return {
    generatorVersion: provenance.generatorVersion || null,
    inventoryDigest: provenance.inventoryDigest || null,
    inventoryRevision: provenance.inventoryRevision || null,
    usageSchema: provenance.usageSchema || null,
    usageFingerprints: provenance.usageFingerprints || null,
    route: provenance.route || null,
  };
}

function adapterIdentity(provenance, surface) {
  return provenance.adapter || {
    id: `${surface}-package-generator`,
    version: provenance.generatorVersion || 'unknown',
  };
}

function buildReleaseArtifactManifest({
  root,
  targetCommit = git(root, ['rev-parse', 'HEAD']),
  targetTree = git(root, ['rev-parse', 'HEAD^{tree}']),
  runId = null,
  version = null,
} = {}) {
  if (!root) throw new Error('release artifact manifest root is required');
  if (!COMMIT.test(targetCommit) || !TREE.test(targetTree)) throw new Error('release artifact manifest target commit/tree is invalid');
  const packages = PACKAGE_SURFACES.map((surface) => {
    const relativeRoot = PACKAGE_ROOTS[surface];
    const packageRoot = path.join(root, relativeRoot);
    const provenancePath = path.join(packageRoot, 'provenance.json');
    const provenance = readJson(provenancePath);
    const checked = validateSurfaceReceipt(normalizedProvenance(provenance), surface, {
      root,
      targetCommit,
      targetTree,
    });
    if (!checked.ok) throw new Error(`${surface} provenance is invalid: ${checked.errors.join('; ')}`);
    const fingerprints = packageFingerprints(packageRoot);
    const entry = {
      surface,
      packageRoot: relativeRoot,
      owner: SURFACE_OWNERS[surface],
      sourceCommit: provenance.sourceCommit,
      sourceTree: resolveGeneratedFromTree(root, provenance.sourceCommit),
      generatedFromCommit: provenance.generatedFromCommit || provenance.sourceCommit,
      generatedFromTree: provenance.generatedFromTree || null,
      sourceVersion: provenance.sourceVersion,
      selection: selectionIdentity(provenance),
      compiler: compilerIdentity(provenance),
      adapter: adapterIdentity(provenance, surface),
      fingerprints,
    };
    return { ...entry, bindingFingerprint: digestJson(entry) };
  });
  const manifest = {
    schema: SCHEMA,
    producer: { id: PRODUCER, trust: 'same-release-workflow' },
    ...(runId ? { runId: String(runId) } : {}),
    ...(version ? { version } : {}),
    target: { commit: targetCommit, tree: targetTree },
    packageSurfaces: PACKAGE_SURFACES,
    packages,
  };
  return {
    ...manifest,
    manifestFingerprint: digestJson(manifest),
  };
}

function validateReleaseArtifactManifest(manifest, {
  root,
  targetCommit = git(root, ['rev-parse', 'HEAD']),
  targetTree = git(root, ['rev-parse', 'HEAD^{tree}']),
  expectedRunId = null,
  expectedVersion = null,
} = {}) {
  const errors = [];
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return { ok: false, errors: ['release artifact manifest must be an object'] };
  }
  if (manifest.schema !== SCHEMA) errors.push(`manifest schema must be ${SCHEMA}`);
  if (!manifest.producer || manifest.producer.id !== PRODUCER || manifest.producer.trust !== 'same-release-workflow') {
    errors.push('manifest producer is not the trusted release package gate');
  }
  if (expectedRunId !== null && String(manifest.runId || '') !== String(expectedRunId)) errors.push('manifest belongs to a different workflow run');
  if (expectedVersion !== null && manifest.version !== expectedVersion) errors.push('manifest version does not match the release version');
  if (!manifest.target || manifest.target.commit !== targetCommit || manifest.target.tree !== targetTree) {
    errors.push('manifest target commit/tree is stale or foreign to this checkout');
  }
  if (JSON.stringify(manifest.packageSurfaces) !== JSON.stringify(PACKAGE_SURFACES)) errors.push('manifest package surface list is not canonical');
  if (!Array.isArray(manifest.packages) || manifest.packages.length !== PACKAGE_SURFACES.length) {
    errors.push('manifest must contain exactly one entry for each package surface');
    return { ok: false, errors };
  }
  const seen = new Set();
  for (const entry of manifest.packages) {
    if (!entry || !PACKAGE_SURFACES.includes(entry.surface)) {
      errors.push('manifest contains an unknown package surface');
      continue;
    }
    if (seen.has(entry.surface)) {
      errors.push(`manifest contains duplicate surface '${entry.surface}'`);
      continue;
    }
    seen.add(entry.surface);
    if (entry.packageRoot !== PACKAGE_ROOTS[entry.surface] || entry.owner !== SURFACE_OWNERS[entry.surface]) {
      errors.push(`manifest package ownership is invalid for '${entry.surface}'`);
      continue;
    }
    try {
      const packageRoot = path.join(root, entry.packageRoot);
      const provenance = readJson(path.join(packageRoot, 'provenance.json'));
      const checked = validateSurfaceReceipt(normalizedProvenance(provenance), entry.surface, { root, targetCommit, targetTree });
      if (!checked.ok) errors.push(`${entry.surface} provenance no longer validates: ${checked.errors.join('; ')}`);
      const current = {
        surface: entry.surface,
        packageRoot: entry.packageRoot,
        owner: entry.owner,
        sourceCommit: provenance.sourceCommit,
        sourceTree: resolveGeneratedFromTree(root, provenance.sourceCommit),
        generatedFromCommit: provenance.generatedFromCommit || provenance.sourceCommit,
        generatedFromTree: provenance.generatedFromTree || null,
        sourceVersion: provenance.sourceVersion,
        selection: selectionIdentity(provenance),
        compiler: compilerIdentity(provenance),
        adapter: adapterIdentity(provenance, entry.surface),
        fingerprints: packageFingerprints(packageRoot),
      };
      const currentBinding = digestJson(current);
      if (currentBinding !== entry.bindingFingerprint) errors.push(`${entry.surface} artifact identity or bytes/modes drifted after package verification`);
      if (JSON.stringify(current) !== JSON.stringify({
        surface: entry.surface,
        packageRoot: entry.packageRoot,
        owner: entry.owner,
        sourceCommit: entry.sourceCommit,
        sourceTree: entry.sourceTree,
        generatedFromCommit: entry.generatedFromCommit,
        generatedFromTree: entry.generatedFromTree,
        sourceVersion: entry.sourceVersion,
        selection: entry.selection,
        compiler: entry.compiler,
        adapter: entry.adapter,
        fingerprints: entry.fingerprints,
      })) errors.push(`${entry.surface} manifest identity does not match current provenance`);
    } catch (error) {
      errors.push(`${entry.surface} artifact is missing, unreadable, or unsafe: ${error.message}`);
    }
  }
  if (seen.size !== PACKAGE_SURFACES.length) errors.push('manifest is missing one or more canonical package surfaces');
  const { manifestFingerprint, ...withoutFingerprint } = manifest;
  if (manifestFingerprint !== digestJson(withoutFingerprint)) errors.push('manifest fingerprint is malformed or stale');
  return { ok: errors.length === 0, errors, manifest };
}

module.exports = {
  SCHEMA,
  PRODUCER,
  PACKAGE_SURFACES,
  PACKAGE_ROOTS,
  buildReleaseArtifactManifest,
  validateReleaseArtifactManifest,
  packageFingerprints,
};
