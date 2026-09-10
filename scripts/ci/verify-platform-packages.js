#!/usr/bin/env node
'use strict';

// Regenerate both physical projections in disposable roots and compare their
// complete byte fingerprints with the tracked artifacts.  This is a package
// gate, not a consumer proof: the latter remains NOT_RUN/UNAVAILABLE unless a
// real client is explicitly invoked.

const fs = require('node:fs');
const crypto = require('node:crypto');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  materializeAgentPluginPackage,
  validateAgentPluginPackage,
  fingerprintDir: fingerprintDirectory,
} = require('../lib/agent-plugin-package');
const {
  materializeCursorPackage,
  validateCursorPackage,
  fingerprintDir: fingerprintCursor,
} = require('../lib/cursor-plugin-package');
const {
  materializeNativePackage,
  verifyNativePackage,
  fingerprintDir: fingerprintNative,
} = require('../lib/codex-native-package');
const {
  materializeAgyPluginPackage,
  validateAgyPluginPackage,
} = require('../lib/agy-plugin-package');
const {
  SURFACE_OWNERS,
  validateSurfaceReceipt,
  resolveGeneratedFromTree,
  assertCleanSourceCheckout,
} = require('../lib/platform-provenance');
const { resolveCapabilitySelection, bindSurfaceSelection } = require('../lib/capability-bundle-selection');
const { rewriteCursorHarnessBody, cursorDocumentDestinationName } = require('../lib/cursor-harness-adapt');

const ROOT = path.join(__dirname, '..', '..');
const POLICY_MARKERS = Object.freeze([
  'cross_provider',
  'CLI_UNAVAILABLE',
  'TIMEOUT_OR_INTERRUPTION',
  'partial-writer',
]);

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function sourceCommit(root, fallback) {
  const result = spawnSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : fallback;
}

function profileSelectionFromReceipt({ receipt, surface, inventory, profiles, moduleCatalog }) {
  if (!receipt || !receipt.profileId) return null;
  const required = ['selectedStableIds', 'selectionFingerprint', 'selectionPolicyVersion'];
  for (const field of required) {
    if (receipt[field] === undefined || receipt[field] === null) {
      throw new Error(`${surface} provenance is missing profile selection field '${field}'`);
    }
  }
  // A receipt intentionally contains only the public selection identity.  The
  // compiler plan includes its normalized profile definition and source
  // fingerprints too, so reconstruct the same complete selection used by the
  // distribution command instead of fabricating a partial authority object.
  const resolved = resolveCapabilitySelection({
    inventory,
    profiles,
    moduleCatalog,
    profileId: receipt.profileId,
    skillIds: [],
    surface,
    sourceInputs: { profileId: receipt.profileId, skillIds: [] },
    policyVersion: inventory.profile_policy && inventory.profile_policy.version,
  });
  if (!resolved.ok) throw new Error(`${surface} profile selection cannot be resolved: ${resolved.error.message}`);
  const bound = bindSurfaceSelection({ selection: resolved.value, surface });
  if (!bound.ok) throw new Error(`${surface} profile selection cannot be bound: ${bound.error.message}`);

  const expected = bound.value;
  const receiptEmitted = receipt.emittedStableIds || receipt.selectedStableIds;
  if (JSON.stringify(receipt.selectedStableIds) !== JSON.stringify(expected.selectedStableIds)
    || JSON.stringify(receiptEmitted) !== JSON.stringify(expected.emittedStableIds)
    || receipt.compatibilityMode !== expected.compatibilityMode
    || receipt.selectionPolicyVersion !== expected.selectionPolicyVersion
    || receipt.selectionFingerprint !== expected.selectionFingerprint
    || (receipt.surfaceSelectionFingerprint && receipt.surfaceSelectionFingerprint !== expected.surfaceSelectionFingerprint)) {
    throw new Error(`${surface} provenance profile selection does not match canonical inputs`);
  }
  return expected;
}

function verifyAgent({ root, targetCommit, targetTree, inventory, profiles, moduleCatalog, version, tracked, temp }) {
  const trackedProvenance = readJson(path.join(tracked, 'provenance.json'));
  const generated = materializeAgentPluginPackage({
    inventory,
    root,
    outDir: temp,
    version,
    sourceCommit: trackedProvenance.sourceCommit || sourceCommit(root, 'unknown'),
    profileSelection: profileSelectionFromReceipt({ receipt: trackedProvenance, surface: 'agent-plugin', inventory, profiles, moduleCatalog }),
  });
  const structural = validateAgentPluginPackage(temp);
  const receipt = validateSurfaceReceipt(readJson(path.join(tracked, 'provenance.json')), 'agent-plugin', { root, targetCommit, targetTree });
  const fingerprintMatches = fingerprintDirectory(temp) === fingerprintDirectory(tracked);
  return {
    structural: structural.ok ? 'PASS' : 'FAIL',
    receipt: receipt.ok ? 'PASS' : 'FAIL',
    deterministic: fingerprintMatches ? 'PASS' : 'FAIL',
    selectedSkills: generated.skillNames.length,
    selectedSkillIds: generated.skillIds,
    errors: [...structural.errors, ...receipt.errors, ...(fingerprintMatches ? [] : ['tracked Agent Plugin fingerprint drifted'])],
  };
}

function verifyCursor({ root, targetCommit, targetTree, inventory, profiles, moduleCatalog, version, tracked, temp }) {
  const trackedProvenance = readJson(path.join(tracked, 'provenance.json'));
  const generated = materializeCursorPackage({
    inventory,
    root,
    outDir: temp,
    version,
    sourceCommit: trackedProvenance.sourceCommit || sourceCommit(root, 'unknown'),
    profileSelection: profileSelectionFromReceipt({ receipt: trackedProvenance, surface: 'cursor-plugin', inventory, profiles, moduleCatalog }),
  });
  const structural = validateCursorPackage({ packageRoot: temp, inventory });
  const receipt = validateSurfaceReceipt(readJson(path.join(tracked, 'provenance.json')), 'cursor-plugin', { root, targetCommit, targetTree });
  const fingerprintMatches = fingerprintCursor(temp) === fingerprintCursor(tracked);
  return {
    structural: structural.ok ? 'PASS' : 'FAIL',
    receipt: receipt.ok ? 'PASS' : 'FAIL',
    deterministic: fingerprintMatches ? 'PASS' : 'FAIL',
    selectedSkills: generated.skillNames.length,
    selectedSkillIds: generated.skillIds,
    sharedSkillIds: generated.provenance.sharedSkillIds || [],
    runtimeSupportStableIds: generated.provenance.runtimeSupportStableIds || [],
    sharedSkillSurface: generated.provenance.sharedSkillSurface || null,
    sharedSkillSource: generated.provenance.sharedSkillSource || null,
    errors: [...structural.errors, ...receipt.errors, ...(fingerprintMatches ? [] : ['tracked Cursor Plugin fingerprint drifted'])],
  };
}

function verifyCodex({ root, targetCommit, targetTree, inventory, version, tracked, temp }) {
  const trackedProvenance = readJson(path.join(tracked, 'provenance.json'));
  const generated = materializeNativePackage({
    inventory,
    root,
    outDir: temp,
    name: 'dhpk',
    version,
    sourceCommit: trackedProvenance.sourceCommit || sourceCommit(root, 'unknown'),
  });
  const structural = verifyNativePackage({ packageRoot: temp, inventory, stage: 'structural' });
  const receipt = validateSurfaceReceipt(trackedProvenance, 'codex-native', { root, targetCommit, targetTree });
  const fingerprintMatches = fingerprintNative(temp) === fingerprintNative(tracked);
  return {
    structural: structural.ok ? 'PASS' : 'FAIL',
    receipt: receipt.ok ? 'PASS' : 'FAIL',
    deterministic: fingerprintMatches ? 'PASS' : 'FAIL',
    selectedSkills: generated.skillIds.length,
    selectedSkillIds: generated.skillIds,
    errors: [...structural.errors, ...receipt.errors, ...(fingerprintMatches ? [] : ['tracked Codex native package fingerprint drifted'])],
  };
}

function verifyAgy({ root, targetCommit, targetTree, inventory, version, tracked, temp }) {
  const trackedProvenance = readJson(path.join(tracked, 'provenance.json'));
  const generated = materializeAgyPluginPackage({
    inventory,
    root,
    outDir: temp,
    version,
    sourceVersion: version,
    sourceCommit: trackedProvenance.sourceCommit || sourceCommit(root, 'unknown'),
  });
  const structural = validateAgyPluginPackage(temp, { inventory, expectedVersion: version });
  const receipt = validateSurfaceReceipt(
    { ...trackedProvenance, schema: trackedProvenance.provenanceSchema },
    'agy-plugin',
    { root, targetCommit, targetTree },
  );
  const fingerprintMatches = fingerprintDirectory(temp) === fingerprintDirectory(tracked);
  return {
    structural: structural.ok ? 'PASS' : 'FAIL',
    receipt: receipt.ok ? 'PASS' : 'FAIL',
    deterministic: fingerprintMatches ? 'PASS' : 'FAIL',
    selectedSkills: generated.selected.skills.length,
    selectedSkillIds: generated.selected.skills.map((skill) => skill.id),
    errors: [...structural.errors, ...receipt.errors, ...(fingerprintMatches ? [] : ['tracked AGY package fingerprint drifted'])],
  };
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function stripFrontmatter(content) {
  const match = String(content).match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/);
  return match ? String(content).slice(match[0].length) : String(content);
}

function policyProjectionPaths(inventory) {
  const contractSurfaces = inventory.projection_contract && inventory.projection_contract.surfaces || {};
  const codex = (inventory.supporting_assets || []).find((entry) => entry.id === 'codex-supporting-policies-execution-policy-md');
  const agyRule = inventory.agy_plugin && (inventory.agy_plugin.rules || []).find((entry) => path.basename(entry) === 'execution-policy.md');
  const agyContract = contractSurfaces['agy-plugin'];
  const cursorContract = contractSurfaces['cursor-plugin'];
  if (!codex || !codex.canonical_source || !agyRule
    || !agyContract || agyContract.owner !== 'agy-plugin'
    || !cursorContract || cursorContract.owner !== 'cursor-plugin') return null;
  return {
    claude: codex.canonical_source,
    codex: codex.source,
    agy: path.posix.join(SURFACE_OWNERS['agy-plugin'], agyRule),
    cursor: path.posix.join(SURFACE_OWNERS['cursor-plugin'], 'rules', cursorDocumentDestinationName('rules', path.basename(codex.canonical_source))),
    codexEntry: codex,
  };
}

function verifySupportingAssetParity(root, inventory, errors) {
  const assets = Array.isArray(inventory.supporting_assets) ? inventory.supporting_assets : [];
  let checked = 0;
  for (const asset of assets) {
    if (!asset || !asset.canonical_source || !asset.canonical_digest || !asset.projection_digest) continue;
    const canonical = path.join(root, asset.canonical_source);
    const projection = path.join(root, asset.source);
    if (!fs.existsSync(canonical) || !fs.existsSync(projection)) {
      errors.push(`supporting asset is missing for parity check: ${asset.id || asset.source}`);
      continue;
    }
    checked += 1;
    if (sha256(fs.readFileSync(canonical)) !== asset.canonical_digest) {
      errors.push(`supporting asset canonical digest is stale: ${asset.id || asset.source}`);
    }
    if (sha256(fs.readFileSync(projection)) !== asset.projection_digest) {
      errors.push(`supporting asset projection digest is stale: ${asset.id || asset.source}`);
    }
  }
  return checked;
}

function verifySharedSkillParity(root, inventory, errors) {
  const flowGuide = (inventory.skills || []).find((entry) => entry && entry.id === 'flow-guide');
  if (!flowGuide || typeof flowGuide.path !== 'string') {
    errors.push('inventory is missing the canonical flow-guide skill for fallback parity');
    return [];
  }
  const reference = path.posix.join(flowGuide.path, 'references', 'implementation-dispatch.md');
  const canonical = path.join(root, reference);
  if (!fs.existsSync(canonical)) {
    errors.push(`canonical fallback reference is missing: ${reference}`);
    return [];
  }
  const canonicalContent = fs.readFileSync(canonical);
  const roots = {
    'agent-plugin': SURFACE_OWNERS['agent-plugin'],
    'codex-native': SURFACE_OWNERS['codex-native'],
    'agy-plugin': SURFACE_OWNERS['agy-plugin'],
    // Cursor intentionally consumes the Agent Plugin-owned shared skill tree.
    'cursor-plugin': SURFACE_OWNERS['agent-plugin'],
  };
  const checked = [];
  for (const [surface, owner] of Object.entries(roots)) {
    const target = path.join(root, owner, reference);
    if (!fs.existsSync(target)) {
      errors.push(`${surface} fallback reference is missing: ${path.relative(root, target)}`);
      continue;
    }
    const targetContent = fs.readFileSync(target);
    if (!targetContent.equals(canonicalContent)) errors.push(`${surface} fallback reference drifted from the canonical skill`);
    checked.push({ surface, source: path.relative(root, target), canonicalSource: reference, digest: sha256(targetContent) });
  }
  return checked;
}

function verifyPolicyParity(root, inventory) {
  const paths = policyProjectionPaths(inventory);
  const errors = [];
  if (!paths) return { verdict: 'FAIL', errors: ['inventory is missing canonical policy projection metadata'] };
  const canonicalPath = path.join(root, paths.claude);
  const canonical = fs.existsSync(canonicalPath) ? fs.readFileSync(canonicalPath, 'utf8') : '';
  if (!canonical) errors.push(`canonical policy is missing: ${paths.claude}`);
  const missingCanonicalMarkers = POLICY_MARKERS.filter((marker) => !canonical.includes(marker));
  if (missingCanonicalMarkers.length > 0) {
    errors.push(`canonical policy is missing required markers: ${missingCanonicalMarkers.join(', ')}`);
  }
  const projections = {};
  const supportingAssetCount = verifySupportingAssetParity(root, inventory, errors);
  const sharedSkillProjections = verifySharedSkillParity(root, inventory, errors);
  for (const [platform, relative] of Object.entries({ claude: paths.claude, codex: paths.codex, agy: paths.agy, cursor: paths.cursor })) {
    const file = path.join(root, relative);
    const content = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    const missing = POLICY_MARKERS.filter((marker) => !content.includes(marker));
    if (!content) errors.push(`${platform} policy projection is missing: ${relative}`);
    if (missing.length > 0) errors.push(`${platform} policy projection is missing required markers: ${missing.join(', ')}`);
    const canonicalDigest = sha256(canonical);
    const projectionDigest = sha256(content);
    if (platform === 'codex') {
      if (paths.codexEntry.canonical_digest !== canonicalDigest) errors.push('Codex policy canonical digest is stale');
      if (paths.codexEntry.projection_digest !== projectionDigest) errors.push('Codex policy projection digest is stale');
    } else if (platform === 'agy' && content !== canonical) {
      errors.push('AGY policy projection drifted from the canonical policy');
    } else if (platform === 'cursor') {
      const expectedBody = rewriteCursorHarnessBody(canonical).trim();
      if (stripFrontmatter(content).trim() !== expectedBody) errors.push('Cursor policy projection drifted from the canonical transform');
    }
    projections[platform] = {
      source: relative,
      canonicalSource: paths.claude,
      canonicalDigest,
      projectionDigest,
      requiredMarkers: POLICY_MARKERS.slice(),
      missingMarkers: missing,
    };
  }
  return {
    verdict: errors.length === 0 ? 'PASS' : 'FAIL',
    canonicalSource: paths.claude,
    requiredMarkers: POLICY_MARKERS.slice(),
    projections,
    supportingAssetCount,
    sharedSkillProjections,
    errors,
  };
}

function reportFromSurfaces(surfaces, policyParity = null) {
  const errors = Object.values(surfaces).flatMap((surface) => surface.errors);
  if (policyParity) errors.push(...policyParity.errors);
  const agentIds = surfaces['agent-plugin'].selectedSkillIds || [];
  const cursor = surfaces['cursor-plugin'];
  if (cursor.sharedSkillSurface === 'agent-plugin') {
    const ownerIds = new Set(agentIds);
    const sharedIds = cursor.sharedSkillIds || [];
    const missingFromOwner = sharedIds.filter((id) => !ownerIds.has(id));
    if (missingFromOwner.length > 0) {
      errors.push(`Cursor shared skill IDs are not owned by Agent Plugin: ${missingFromOwner.sort().join(', ')}`);
    }
    if (cursor.sharedSkillSource !== 'plugins/dhpk-agent/skills/') {
      errors.push('Cursor shared skills do not identify plugins/dhpk-agent/skills/ as their physical source');
    }
    const allowedRuntimeSupportIds = new Set(cursor.runtimeSupportStableIds || []);
    const overlap = (cursor.selectedSkillIds || []).filter((id) => sharedIds.includes(id) && !allowedRuntimeSupportIds.has(id));
    if (overlap.length > 0) {
      errors.push(`Cursor overlay repeats shared skill IDs without a declared runtime-support exception: ${overlap.sort().join(', ')}`);
    }
  }
  return {
    verdict: errors.length === 0 ? 'PASS' : 'FAIL',
    surfaces,
    ...(policyParity ? { policyParity } : {}),
    errors,
  };
}

function main() {
  assertCleanSourceCheckout(ROOT);
  const inventory = readJson(path.join(ROOT, 'manifests', 'distribution-inventory.json'));
  const profiles = readJson(path.join(ROOT, 'manifests', 'install-profiles.json'));
  const moduleCatalog = readJson(path.join(ROOT, 'manifests', 'module-catalog.json'));
  const version = readJson(path.join(ROOT, '.claude-plugin', 'plugin.json')).version;
  const targetCommit = sourceCommit(ROOT, 'unknown');
  const targetTree = resolveGeneratedFromTree(ROOT, targetCommit);
  const tempRoot = fs.realpathSync(os.tmpdir());
  const tempAgent = fs.mkdtempSync(path.join(tempRoot, 'dhpk-agent-package-verify-'));
  const tempCursor = fs.mkdtempSync(path.join(tempRoot, 'dhpk-cursor-package-verify-'));
  const tempCodex = fs.mkdtempSync(path.join(tempRoot, 'dhpk-codex-package-verify-'));
  const tempAgy = fs.mkdtempSync(path.join(tempRoot, 'dhpk-agy-package-verify-'));
  // AGY's atomic publisher accepts a missing destination or an owned package,
  // not an empty pre-created directory.
  fs.rmSync(tempAgy, { recursive: true, force: true });
  let report;
  try {
    const surfaces = {
      'agent-plugin': verifyAgent({ root: ROOT, targetCommit, targetTree, inventory, profiles, moduleCatalog, version, tracked: path.join(ROOT, 'plugins/dhpk-agent'), temp: tempAgent }),
      'cursor-plugin': verifyCursor({ root: ROOT, targetCommit, targetTree, inventory, profiles, moduleCatalog, version, tracked: path.join(ROOT, 'plugins/dhpk-cursor'), temp: tempCursor }),
      'codex-native': verifyCodex({ root: ROOT, targetCommit, targetTree, inventory, version, tracked: path.join(ROOT, 'plugins/dhpk'), temp: tempCodex }),
      'agy-plugin': verifyAgy({ root: ROOT, targetCommit, targetTree, inventory, version, tracked: path.join(ROOT, 'plugins/dhpk-agy'), temp: tempAgy }),
    };
    report = reportFromSurfaces(surfaces, verifyPolicyParity(ROOT, inventory));
  } catch (error) {
    report = { verdict: 'FAIL', surfaces: {}, errors: [error.message] };
  } finally {
    fs.rmSync(tempAgent, { recursive: true, force: true });
    fs.rmSync(tempCursor, { recursive: true, force: true });
    fs.rmSync(tempCodex, { recursive: true, force: true });
    fs.rmSync(tempAgy, { recursive: true, force: true });
  }
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.verdict === 'PASS' ? 0 : 1);
}

if (require.main === module) main();

module.exports = { reportFromSurfaces };
