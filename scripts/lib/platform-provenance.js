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
    evidence,
  };
}

function validateSurfaceReceipt(receipt, expectedSurface = null) {
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
  validateSurfaceReceipt,
  assertRollbackOwnership,
};
