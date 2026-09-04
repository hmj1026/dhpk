'use strict';

// Surface-scoped provenance is deliberately small and shared by generators
// and release gates.  A receipt identifies who owns the output; it is not a
// cross-platform migration manifest and therefore cannot authorize rollback of
// another surface.

const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const RECEIPT_SCHEMA = 'dhpk.platform-provenance.v1';
const SURFACE_OWNERS = Object.freeze({
  'agent-plugin': 'plugins/dhpk-agent',
  'cursor-plugin': 'plugins/dhpk-cursor',
  'cursor-sync': '.cursor/.dhpk-installed.json',
  'agy-plugin': 'plugins/dhpk-agy',
  'codex-native': 'plugins/dhpk',
  'codex-sync': '.codex/.dhpk-installed.json',
  'claude-core': '.claude-plugin',
});
const SHA256 = /^[a-f0-9]{64}$/i;
const COMMIT = /^[a-f0-9]{40}$/i;
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function digest(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function createSurfaceReceipt({
  surface,
  sourceVersion,
  sourceCommit,
  generatedFromCommit = sourceCommit,
  generatedFromTree = null,
  inventoryDigest,
  fingerprints = {},
  route = null,
  evidence = {},
  generatorVersion = null,
  profileId = null,
  selectedStableIds = null,
  emittedStableIds = null,
  compatibilityMode = null,
  selectionPolicyVersion = null,
  selectionFingerprint = null,
  surfaceSelectionFingerprint = null,
  migration = null,
  activation = null,
  inventoryRevision = null,
  usageSchema = null,
  usageFingerprints = null,
  usage = null,
  skillProvenance = null,
} = {}) {
  if (!Object.prototype.hasOwnProperty.call(SURFACE_OWNERS, surface)) {
    throw new Error(`unknown provenance surface: ${surface}`);
  }
  const normalizedFingerprints = Object.fromEntries(
    Object.keys(fingerprints || {}).sort().map((key) => [key, fingerprints[key]])
  );
  return {
    schema: RECEIPT_SCHEMA,
    surface,
    owner: SURFACE_OWNERS[surface],
    sourceVersion,
    sourceCommit,
    generatedFromCommit,
    ...(generatedFromTree ? { generatedFromTree } : {}),
    inventoryDigest,
    fingerprints: normalizedFingerprints,
    ...(route ? { route } : {}),
    ...(generatorVersion ? { generatorVersion } : {}),
    ...(profileId ? { profileId } : {}),
    ...(Array.isArray(selectedStableIds) ? { selectedStableIds: [...selectedStableIds] } : {}),
    ...(Array.isArray(emittedStableIds) ? { emittedStableIds: [...emittedStableIds] } : {}),
    ...(compatibilityMode ? { compatibilityMode } : {}),
    ...(selectionPolicyVersion ? { selectionPolicyVersion } : {}),
    ...(selectionFingerprint ? { selectionFingerprint } : {}),
    ...(surfaceSelectionFingerprint ? { surfaceSelectionFingerprint } : {}),
    ...(migration ? { migration } : {}),
    ...(activation ? { activation } : {}),
    ...(inventoryRevision ? { inventoryRevision } : {}),
    ...(usageSchema ? { usageSchema } : {}),
    ...(usageFingerprints ? { usageFingerprints } : {}),
    ...(usage ? { usage } : {}),
    ...(skillProvenance ? { skillProvenance } : {}),
    evidence,
  };
}

function assertCleanSourceCheckout(root) {
  if (typeof root !== 'string' || !root) throw new Error('source checkout root is required');
  let status;
  try {
    status = execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch (error) {
    throw new Error(`unable to inspect source checkout cleanliness: ${error.message}`);
  }
  if (status) throw new Error('source checkout must be clean before generating provenance-bound package');
  return true;
}

function validateSurfaceReceipt(receipt, expectedSurface = null, context = {}) {
  const errors = [];
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) {
    return { ok: false, errors: ['provenance receipt must be an object'] };
  }
  if (receipt.schema !== RECEIPT_SCHEMA) errors.push(`provenance schema must be ${RECEIPT_SCHEMA}`);
  if (!Object.prototype.hasOwnProperty.call(SURFACE_OWNERS, receipt.surface)) {
    errors.push(`provenance surface is unknown: ${receipt.surface}`);
  } else {
    if (expectedSurface && receipt.surface !== expectedSurface) {
      errors.push(`provenance surface '${receipt.surface}' does not match expected '${expectedSurface}'`);
    }
    if (receipt.owner !== SURFACE_OWNERS[receipt.surface]) {
      errors.push(`provenance owner '${receipt.owner}' does not own surface '${receipt.surface}'`);
    }
  }
  if (typeof receipt.sourceVersion !== 'string' || !VERSION.test(receipt.sourceVersion)) errors.push('provenance sourceVersion must be SemVer');
  if (typeof receipt.sourceCommit !== 'string' || !COMMIT.test(receipt.sourceCommit)) errors.push('provenance sourceCommit must be a 40-character commit SHA');
  if (receipt.generatedFromCommit !== undefined
    && (typeof receipt.generatedFromCommit !== 'string' || !COMMIT.test(receipt.generatedFromCommit))) {
    errors.push('provenance generatedFromCommit must be a 40-character commit SHA');
  }
  if (receipt.generatedFromTree !== undefined
    && (typeof receipt.generatedFromTree !== 'string' || !COMMIT.test(receipt.generatedFromTree))) {
    errors.push('provenance generatedFromTree must be a 40-character tree SHA');
  }
  if (typeof receipt.inventoryDigest !== 'string' || !SHA256.test(receipt.inventoryDigest)) errors.push('provenance inventoryDigest must be a SHA-256 digest');
  if (!receipt.fingerprints || typeof receipt.fingerprints !== 'object' || Array.isArray(receipt.fingerprints)) {
    errors.push('provenance fingerprints must be an object');
  } else {
    for (const [name, fingerprint] of Object.entries(receipt.fingerprints)) {
      if (!name || typeof fingerprint !== 'string' || !SHA256.test(fingerprint)) errors.push(`provenance fingerprint '${name}' is not a SHA-256 digest`);
    }
  }
  const hasSelectionIdentity = receipt.profileId !== undefined
    || receipt.selectedStableIds !== undefined
    || receipt.selectionFingerprint !== undefined;
  if (hasSelectionIdentity) {
    if (typeof receipt.profileId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(receipt.profileId)) {
      errors.push('provenance profileId must be a safe non-empty profile alias');
    }
    if (!Array.isArray(receipt.selectedStableIds) || receipt.selectedStableIds.length === 0
      || receipt.selectedStableIds.some((id) => typeof id !== 'string' || id.trim() === '')) {
      errors.push('provenance selectedStableIds must be a non-empty string array');
    } else if (new Set(receipt.selectedStableIds).size !== receipt.selectedStableIds.length) {
      errors.push('provenance selectedStableIds must not contain duplicates');
    }
    if (receipt.emittedStableIds !== undefined) {
      if (!Array.isArray(receipt.emittedStableIds) || receipt.emittedStableIds.some((id) => typeof id !== 'string' || id.trim() === '')) {
        errors.push('provenance emittedStableIds must be a string array');
      } else if (Array.isArray(receipt.selectedStableIds) && receipt.emittedStableIds.some((id) => !receipt.selectedStableIds.includes(id))) {
        errors.push('provenance emittedStableIds must be a subset of selectedStableIds');
      }
    }
    if (typeof receipt.compatibilityMode !== 'string' || !['profile', 'compat-v1', 'compatibility'].includes(receipt.compatibilityMode)) {
      errors.push('provenance compatibilityMode must be profile or compat-v1');
    }
    if (typeof receipt.selectionPolicyVersion !== 'string' || receipt.selectionPolicyVersion.trim() === '') {
      errors.push('provenance selectionPolicyVersion must be a non-empty string');
    }
    if (typeof receipt.selectionFingerprint !== 'string' || !SHA256.test(receipt.selectionFingerprint)) {
      errors.push('provenance selectionFingerprint must be a SHA-256 digest');
    }
    if (receipt.surfaceSelectionFingerprint !== undefined
      && (typeof receipt.surfaceSelectionFingerprint !== 'string' || !SHA256.test(receipt.surfaceSelectionFingerprint))) {
      errors.push('provenance surfaceSelectionFingerprint must be a SHA-256 digest');
    }
  }
  if (receipt.migration !== undefined && (!receipt.migration || typeof receipt.migration !== 'object' || Array.isArray(receipt.migration))) {
    errors.push('provenance migration must be an object when present');
  }
  if (receipt.inventoryRevision !== undefined
    && (typeof receipt.inventoryRevision !== 'string' || receipt.inventoryRevision.trim() === '')) {
    errors.push('provenance inventoryRevision must be a non-empty string');
  }
  if (receipt.usageSchema !== undefined && receipt.usageSchema !== 'dhpk.skill-usage.v1') {
    errors.push('provenance usageSchema must be dhpk.skill-usage.v1');
  }
  if (receipt.usageFingerprints !== undefined) {
    if (!receipt.usageFingerprints || typeof receipt.usageFingerprints !== 'object' || Array.isArray(receipt.usageFingerprints)) {
      errors.push('provenance usageFingerprints must be an object');
    } else {
      for (const [stableId, usageFingerprint] of Object.entries(receipt.usageFingerprints)) {
        if (!stableId || typeof usageFingerprint !== 'string' || !SHA256.test(usageFingerprint)) {
          errors.push(`provenance usage fingerprint '${stableId}' is not a SHA-256 digest`);
        }
      }
    }
  }
  if (receipt.skillProvenance !== undefined
    && (!receipt.skillProvenance || typeof receipt.skillProvenance !== 'object' || Array.isArray(receipt.skillProvenance))) {
    errors.push('provenance skillProvenance must be an object when present');
  }

  const validationContext = context && typeof context === 'object' ? context : {};
  const root = validationContext.root;
  const targetCommit = validationContext.targetCommit;
  const targetTree = validationContext.targetTree;
  const generatedFromCommit = receipt.generatedFromCommit || receipt.sourceCommit;

  if (root && typeof generatedFromCommit === 'string' && COMMIT.test(generatedFromCommit)) {
    const resolvedGeneratedTree = resolveGeneratedFromTree(root, generatedFromCommit);
    if (!resolvedGeneratedTree) {
      errors.push('provenance generated-input commit cannot be resolved in target checkout');
    } else if (
      typeof receipt.generatedFromTree === 'string'
      && receipt.generatedFromTree.toLowerCase() !== resolvedGeneratedTree
    ) {
      errors.push('provenance generated-input tree does not match generated-input commit');
    }

    if (typeof targetCommit === 'string' && COMMIT.test(targetCommit)) {
      try {
        execFileSync('git', ['merge-base', '--is-ancestor', generatedFromCommit, targetCommit], {
          cwd: root,
          stdio: 'ignore',
        });
      } catch (error) {
        if (error && error.status === 1) {
          errors.push('provenance generated-input commit is not an ancestor of target checkout');
        } else {
          errors.push('provenance generated-input ancestry cannot be verified in target checkout');
        }
      }
    }
  }

  if (
    root
    && typeof targetCommit === 'string' && COMMIT.test(targetCommit)
    && typeof targetTree === 'string' && COMMIT.test(targetTree)
  ) {
    const resolvedTargetTree = resolveGeneratedFromTree(root, targetCommit);
    if (!resolvedTargetTree) {
      errors.push('provenance target commit cannot be resolved in target checkout');
    } else if (resolvedTargetTree !== targetTree.toLowerCase()) {
      errors.push('provenance target tree does not match target commit');
    }
  }

  return { ok: errors.length === 0, errors };
}

function resolveGeneratedFromTree(root, commit) {
  if (typeof root !== 'string' || !root || typeof commit !== 'string' || !COMMIT.test(commit)) return null;
  try {
    return execFileSync('git', ['rev-parse', '--verify', `${commit}^{tree}`], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim().toLowerCase();
  } catch (_) {
    return null;
  }
}

function assertRollbackOwnership(receipt, targetSurface) {
  const checked = validateSurfaceReceipt(receipt, targetSurface);
  if (!checked.ok) throw new Error(`rollback ownership check failed: ${checked.errors.join('; ')}`);
  return true;
}

module.exports = {
  RECEIPT_SCHEMA,
  SURFACE_OWNERS,
  digest,
  resolveGeneratedFromTree,
  createSurfaceReceipt,
  assertCleanSourceCheckout,
  validateSurfaceReceipt,
  assertRollbackOwnership,
};
