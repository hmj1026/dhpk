'use strict';

// Surface-scoped provenance is deliberately small and shared by generators
// and release gates.  A receipt identifies who owns the output; it is not a
// cross-platform migration manifest and therefore cannot authorize rollback of
// another surface.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const {
  canonicalJson,
  inventoryDigestInsertionOrder,
  inventoryDigestKeySorted,
  requireTreeMerkle,
} = require('./content-fingerprint');
const { readFileBounded } = require('./bounded-filesystem');

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

function createInstallationReceiptIdentity({
  surface,
  scope,
  sourceVersion,
  inventoryDigest,
  profileId,
  selectedStableIds,
  supportClosure = null,
  ownedRoots = [],
  planFingerprint = null,
} = {}) {
  if (!Object.prototype.hasOwnProperty.call(SURFACE_OWNERS, surface)) throw new Error(`unknown installation surface: ${surface}`);
  if (!Array.isArray(selectedStableIds) || selectedStableIds.length === 0
    || selectedStableIds.some((id) => typeof id !== 'string' || id.trim() === '')) {
    throw new Error('installation selectedStableIds must be a non-empty string array');
  }
  const selection = [...new Set(selectedStableIds || [])].sort();
  const planId = planFingerprint || digest(JSON.stringify({
    schema: 'dhpk.installation-receipt.v1', surface, scope, sourceVersion, inventoryDigest, profileId, selection,
  }));
  return {
    schema: 'dhpk.installation-receipt.v1',
    planId,
    scope,
    profileId,
    selectedStableIds: selection,
    supportClosure: supportClosure || { stableIds: selection },
    ownership: { owner: SURFACE_OWNERS[surface], roots: [...new Set(ownedRoots)].sort() },
    fingerprints: { plan: planId, inventory: inventoryDigest },
    rollbackIdentity: digest(JSON.stringify({ surface, scope, owner: SURFACE_OWNERS[surface], planId })),
  };
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
  selectionMode = null,
  requestedStableIds = null,
  selectedStableIds = null,
  emittedStableIds = null,
  dependencyClosure = null,
  unavailableCapabilities = null,
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
  skillPackageClosure = null,
  installation = null,
  publicationMode = 'formal',
  releaseEligible = true,
  origin = null,
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
    ...(selectionMode ? { selectionMode } : {}),
    ...(Array.isArray(requestedStableIds) ? { requestedStableIds: [...requestedStableIds] } : {}),
    ...(Array.isArray(selectedStableIds) ? { selectedStableIds: [...selectedStableIds] } : {}),
    ...(Array.isArray(emittedStableIds) ? { emittedStableIds: [...emittedStableIds] } : {}),
    ...(dependencyClosure ? { dependencyClosure } : {}),
    ...(Array.isArray(unavailableCapabilities) ? { unavailableCapabilities } : {}),
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
    ...(Array.isArray(skillPackageClosure) ? { skillPackageClosure: skillPackageClosure.map((entry) => ({ ...entry })) } : {}),
    ...(installation ? { installation: JSON.parse(JSON.stringify(installation)) } : {}),
    ...(publicationMode !== 'formal' || releaseEligible !== true || origin
      ? { publicationMode, releaseEligible }
      : {}),
    ...(origin ? { origin: JSON.parse(JSON.stringify(origin)) } : {}),
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
  const validationContext = context && typeof context === 'object' ? context : {};
  if (receipt.publicationMode !== undefined
    && !['formal', 'preview'].includes(receipt.publicationMode)) {
    errors.push('provenance publicationMode must be formal or preview');
  }
  if (receipt.publicationMode === 'preview' && validationContext.allowPreview !== true) {
    errors.push('preview provenance is not accepted by formal validation');
  }
  if (receipt.releaseEligible !== undefined && typeof receipt.releaseEligible !== 'boolean') {
    errors.push('provenance releaseEligible must be boolean');
  }
  if (receipt.publicationMode === 'formal' && receipt.releaseEligible !== undefined && receipt.releaseEligible !== true) {
    errors.push('formal provenance must declare releaseEligible=true');
  }
  if (receipt.publicationMode === 'preview' && receipt.releaseEligible !== false) {
    errors.push('preview provenance must declare releaseEligible=false');
  }
  if (receipt.origin !== undefined
    && (!receipt.origin || typeof receipt.origin !== 'object' || Array.isArray(receipt.origin))) {
    errors.push('provenance origin must be an object when present');
  }
  if (receipt.origin && typeof receipt.origin === 'object' && !Array.isArray(receipt.origin)) {
    for (const field of ['baseCommit', 'baseTree', 'snapshotCommit', 'snapshotTree']) {
      if (typeof receipt.origin[field] !== 'string' || !COMMIT.test(receipt.origin[field])) {
        errors.push(`provenance origin ${field} must be a 40-character SHA`);
      }
    }
    const counts = receipt.origin.changeCounts;
    if (!counts || typeof counts !== 'object' || Array.isArray(counts)) {
      errors.push('provenance origin changeCounts must be an object');
    } else {
      for (const field of ['modified', 'deleted', 'added', 'modeChanged', 'bytes']) {
        if (!Number.isInteger(counts[field]) || counts[field] < 0) errors.push(`provenance origin changeCounts.${field} must be a non-negative integer`);
      }
    }
  }
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
    const standalone = receipt.selectionMode === 'standalone' || receipt.profileId === 'standalone';
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
    if (typeof receipt.compatibilityMode !== 'string' || !['profile', 'compat-v1', 'compatibility', 'standalone'].includes(receipt.compatibilityMode)) {
      errors.push('provenance compatibilityMode must be profile, compat-v1, compatibility, or standalone');
    }
    if (standalone) {
      if (receipt.selectionMode !== 'standalone') errors.push('standalone provenance must declare selectionMode=standalone');
      if (!Array.isArray(receipt.requestedStableIds) || receipt.requestedStableIds.length === 0) {
        errors.push('standalone provenance requestedStableIds must be a non-empty string array');
      }
      if (!receipt.dependencyClosure || typeof receipt.dependencyClosure !== 'object' || Array.isArray(receipt.dependencyClosure)) {
        errors.push('standalone provenance dependencyClosure must be an object');
      }
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
  if (receipt.skillPackageClosure !== undefined) {
    if (!Array.isArray(receipt.skillPackageClosure)) errors.push('provenance skillPackageClosure must be an array when present');
    else {
      const seen = new Set();
      for (const dependency of receipt.skillPackageClosure) {
        if (!dependency || typeof dependency.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(dependency.id)) {
          errors.push('provenance skillPackageClosure entries must have safe ids');
          continue;
        }
        if (seen.has(dependency.id)) errors.push(`provenance skillPackageClosure contains duplicate id '${dependency.id}'`);
        seen.add(dependency.id);
        if (typeof dependency.version !== 'string' || !VERSION.test(dependency.version)) {
          errors.push(`provenance skillPackageClosure version for '${dependency.id}' must be SemVer`);
        }
      }
    }
  }
  if (receipt.installation !== undefined) {
    const installation = receipt.installation;
    if (!installation || typeof installation !== 'object' || Array.isArray(installation)) {
      errors.push('provenance installation must be an object when present');
    } else {
      if (installation.schema !== 'dhpk.installation-receipt.v1') errors.push('provenance installation schema must be dhpk.installation-receipt.v1');
      if (typeof installation.planId !== 'string' || !SHA256.test(installation.planId)) errors.push('provenance installation planId must be a SHA-256 digest');
      if (!['project', 'user', 'local'].includes(installation.scope)) errors.push('provenance installation scope is unsupported');
      if (typeof installation.profileId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(installation.profileId)) errors.push('provenance installation profileId must be a safe non-empty profile alias');
      if (!Array.isArray(installation.selectedStableIds) || installation.selectedStableIds.length === 0
        || installation.selectedStableIds.some((id) => typeof id !== 'string' || id.trim() === '')) {
        errors.push('provenance installation selectedStableIds must be a non-empty string array');
      } else if (new Set(installation.selectedStableIds).size !== installation.selectedStableIds.length) {
        errors.push('provenance installation selectedStableIds must not contain duplicates');
      }
      if (!installation.supportClosure || typeof installation.supportClosure !== 'object' || Array.isArray(installation.supportClosure)) errors.push('provenance installation supportClosure must be an object');
      if (!installation.ownership || typeof installation.ownership.owner !== 'string' || !Array.isArray(installation.ownership.roots)) {
        errors.push('provenance installation ownership must declare owner and roots');
      } else {
        if (installation.ownership.owner !== receipt.owner) errors.push('provenance installation ownership owner must match receipt owner');
        for (const root of installation.ownership.roots) {
        if (typeof root !== 'string' || root.trim() === '' || path.isAbsolute(root)
            || path.posix.isAbsolute(root) || path.win32.isAbsolute(root)
            || root === '.' || root.includes('\\') || path.posix.normalize(root) !== root
            || root.split('/').some((segment) => segment === '..')) {
            errors.push(`provenance installation ownership root is unsafe: ${String(root)}`);
          }
        }
      }
      if (!installation.fingerprints || typeof installation.fingerprints !== 'object' || Array.isArray(installation.fingerprints)) {
        errors.push('provenance installation fingerprints must be an object');
      } else {
        for (const [name, fingerprint] of Object.entries(installation.fingerprints)) {
          if (!name || typeof fingerprint !== 'string' || !SHA256.test(fingerprint)) errors.push(`provenance installation fingerprint '${name}' must be a SHA-256 digest`);
        }
        if (installation.fingerprints.plan !== installation.planId) errors.push('provenance installation fingerprints.plan must match planId');
        if (installation.fingerprints.inventory !== receipt.inventoryDigest) errors.push('provenance installation fingerprints.inventory must match inventoryDigest');
      }
      if (typeof installation.rollbackIdentity !== 'string' || !SHA256.test(installation.rollbackIdentity)) errors.push('provenance installation rollbackIdentity must be a SHA-256 digest');
    }
  }

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

// --- Package Receipt -------------------------------------------------------
// provenance.json + fingerprints.json shipped inside a generated Host package.
// This table is the only place that decides a surface's inventory-digest
// ordering, serialization, and fingerprints.json shape; orderings and shapes
// stay per surface (openspec/specs/content-fingerprint-ownership).

const PACKAGE_RECEIPT_FILES = Object.freeze({ provenance: 'provenance.json', fingerprints: 'fingerprints.json' });

const PACKAGE_RECEIPT_SURFACES = Object.freeze({
  'agent-plugin': Object.freeze({ inventoryOrder: 'key-sorted', serialization: 'insertion', fingerprintsShape: 'skills', requiresFingerprintAlgorithm: true }),
  'cursor-plugin': Object.freeze({ inventoryOrder: 'insertion', serialization: 'insertion', fingerprintsShape: 'flat', requiresFingerprintAlgorithm: true }),
  'codex-native': Object.freeze({ inventoryOrder: 'insertion', serialization: 'insertion', fingerprintsShape: 'flat', requiresFingerprintAlgorithm: true }),
  'agy-plugin': Object.freeze({
    inventoryOrder: 'key-sorted',
    serialization: 'canonical',
    fingerprintsShape: 'files',
    requiresFingerprintAlgorithm: false,
    schema: 'dhpk.agy-plugin.v1',
    packageRoot: 'plugins/dhpk-agy',
  }),
});

function packageReceiptSurface(surface) {
  const config = PACKAGE_RECEIPT_SURFACES[surface];
  if (!config) throw new Error(`unknown Package Receipt surface: ${surface}`);
  return config;
}

function packageInventoryDigest(surface, inventory) {
  return packageReceiptSurface(surface).inventoryOrder === 'key-sorted'
    ? inventoryDigestKeySorted(inventory)
    : inventoryDigestInsertionOrder(inventory);
}

function serializeReceiptJson(config, value) {
  return config.serialization === 'canonical' ? `${canonicalJson(value)}\n` : `${JSON.stringify(value, null, 2)}\n`;
}

function fingerprintsDocument(surface, config, fingerprints, generatorVersion) {
  if (config.fingerprintsShape === 'skills') return { generatorVersion, surface, skills: fingerprints };
  if (config.fingerprintsShape === 'files') return { schema: config.schema, files: fingerprints };
  return fingerprints;
}

// Returns the exact file text; callers hand it to the artifact store, which is
// the only writer of package trees (ADR-0009).
function serializePackageReceipt(surface, { provenance, fingerprints, generatorVersion } = {}) {
  const config = packageReceiptSurface(surface);
  const version = generatorVersion === undefined && provenance ? provenance.generatorVersion : generatorVersion;
  return {
    provenance: serializeReceiptJson(config, provenance),
    fingerprints: serializeReceiptJson(config, fingerprintsDocument(surface, config, fingerprints, version)),
  };
}

function fingerprintMapErrors(map, label) {
  if (!map || typeof map !== 'object' || Array.isArray(map)) return [`${label} must be an object`];
  return Object.entries(map)
    .filter(([name, value]) => !name || typeof value !== 'string' || !SHA256.test(value))
    .map(([name]) => `${label} entry '${name}' is not a SHA-256 digest`);
}

function readReceiptFile(packageRoot, name, errors) {
  let text;
  try {
    text = readFileBounded(path.join(packageRoot, name)).toString('utf8');
  } catch (error) {
    errors.push(`${name} is unreadable: ${error.message}`);
    return null;
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    errors.push(`${name} is not valid JSON: ${error.message}`);
    return null;
  }
}

function sameFingerprintMap(left, right) {
  return canonicalJson(left || {}) === canonicalJson(right || {});
}

function checkPackageProvenance(surface, provenance, { allowPreview = false } = {}) {
  const config = packageReceiptSurface(surface);
  if (!provenance || typeof provenance !== 'object' || Array.isArray(provenance)) {
    return { objectShaped: false, fingerprintAlgorithm: null, errors: ['provenance.json must be an object'] };
  }
  const errors = [];
  let fingerprintAlgorithm = null;
  const shared = config.schema ? { ...provenance, schema: RECEIPT_SCHEMA } : provenance;
  if (config.schema && provenance.schema !== config.schema) errors.push(`provenance schema must be ${config.schema}`);
  errors.push(...validateSurfaceReceipt(shared, surface, { allowPreview }).errors);
  if (config.packageRoot && provenance.packageRoot !== config.packageRoot) errors.push('provenance packageRoot is not owner-scoped');
  if (config.requiresFingerprintAlgorithm) {
    try {
      fingerprintAlgorithm = requireTreeMerkle(provenance.fingerprintAlgorithm, 'fingerprintAlgorithm');
    } catch (error) {
      errors.push(error.message);
    }
  }
  return { objectShaped: true, fingerprintAlgorithm, errors };
}

// Ownership is proven by provenance.json alone; fingerprints.json is metadata
// the owner checks separately (an installed AGY copy with damaged metadata is
// still owned, only changed).
function readPackageProvenance(packageRoot, { surface, allowPreview = false } = {}) {
  const errors = [];
  const provenance = readReceiptFile(packageRoot, PACKAGE_RECEIPT_FILES.provenance, errors);
  if (provenance !== null) errors.push(...checkPackageProvenance(surface, provenance, { allowPreview }).errors);
  return { ok: errors.length === 0, surface, provenance, errors };
}

// Reads and validates both receipt files for one surface. Required fields fail
// closed; unknown fields are ignored. `fingerprints` is the normalized
// path -> digest map whatever the surface's file shape.
function readPackageReceipt(packageRoot, { surface, allowPreview = false } = {}) {
  const config = packageReceiptSurface(surface);
  const errors = [];
  const provenance = readReceiptFile(packageRoot, PACKAGE_RECEIPT_FILES.provenance, errors);
  const document = readReceiptFile(packageRoot, PACKAGE_RECEIPT_FILES.fingerprints, errors);
  let fingerprints = null;
  if (document !== null) {
    if (!document || typeof document !== 'object' || Array.isArray(document)) {
      errors.push('fingerprints.json must be an object');
    } else if (config.fingerprintsShape === 'skills') {
      if (document.surface !== surface) errors.push(`fingerprints.json surface must be ${surface}`);
      if (typeof document.generatorVersion !== 'string' || !document.generatorVersion) errors.push('fingerprints.json generatorVersion must be a non-empty string');
      fingerprints = document.skills;
    } else if (config.fingerprintsShape === 'files') {
      if (document.schema !== config.schema) errors.push(`fingerprints.json must use ${config.schema}`);
      fingerprints = document.files;
    } else {
      fingerprints = document;
    }
    if (document && typeof document === 'object') errors.push(...fingerprintMapErrors(fingerprints, 'fingerprints.json'));
  }
  let fingerprintAlgorithm = null;
  if (provenance !== null) {
    const checked = checkPackageProvenance(surface, provenance, { allowPreview });
    errors.push(...checked.errors);
    fingerprintAlgorithm = checked.fingerprintAlgorithm;
    if (checked.objectShaped && fingerprints && !sameFingerprintMap(provenance.fingerprints, fingerprints)) {
      errors.push('provenance fingerprints do not match fingerprints.json');
    }
  }
  return {
    ok: errors.length === 0,
    surface,
    provenance,
    fingerprints: fingerprints && typeof fingerprints === 'object' && !Array.isArray(fingerprints) ? fingerprints : null,
    fingerprintsDocument: document,
    fingerprintAlgorithm,
    errors,
  };
}

// Compares the receipt's recorded fingerprints with fingerprints the caller
// observed in the package; both directions are checked.
function verifyPackageReceipt(receipt, observedFingerprints) {
  const recorded = (receipt && receipt.fingerprints) || {};
  const observed = observedFingerprints || {};
  const errors = [];
  for (const name of Object.keys(recorded).sort()) {
    if (!Object.prototype.hasOwnProperty.call(observed, name)) errors.push(`receipt-owned entry is missing from the package: ${name}`);
    else if (observed[name] !== recorded[name]) errors.push(`receipt fingerprint does not match package content: ${name}`);
  }
  for (const name of Object.keys(observed).sort()) {
    if (!Object.prototype.hasOwnProperty.call(recorded, name)) errors.push(`package entry is not in the receipt: ${name}`);
  }
  return errors;
}

// Recipe named by the package's provenance.json marker. A package without
// provenance or without the marker fails closed with the version-boundary
// diagnostic; unparseable provenance fails closed as unreadable.
function packageFingerprintAlgorithm(packageRoot) {
  const provenancePath = path.join(packageRoot, PACKAGE_RECEIPT_FILES.provenance);
  let provenance = null;
  if (fs.existsSync(provenancePath)) {
    try { provenance = JSON.parse(readFileBounded(provenancePath).toString('utf8')); } catch (error) {
      return { algorithm: null, error: `provenance.json is unreadable: ${error.message}` };
    }
  }
  try {
    return { algorithm: requireTreeMerkle(provenance ? provenance.fingerprintAlgorithm : undefined, 'fingerprintAlgorithm') };
  } catch (error) { return { algorithm: null, error: error.message }; }
}

module.exports = {
  PACKAGE_RECEIPT_FILES,
  PACKAGE_RECEIPT_SURFACES,
  packageInventoryDigest,
  serializePackageReceipt,
  readPackageReceipt,
  readPackageProvenance,
  verifyPackageReceipt,
  packageFingerprintAlgorithm,
  RECEIPT_SCHEMA,
  SURFACE_OWNERS,
  digest,
  createInstallationReceiptIdentity,
  resolveGeneratedFromTree,
  createSurfaceReceipt,
  assertCleanSourceCheckout,
  validateSurfaceReceipt,
  assertRollbackOwnership,
};
