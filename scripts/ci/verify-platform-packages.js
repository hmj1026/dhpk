#!/usr/bin/env node
'use strict';

// Regenerate both physical projections in disposable roots and compare their
// complete byte fingerprints with the tracked artifacts.  This is a package
// gate, not a consumer proof: the latter remains NOT_RUN/UNAVAILABLE unless a
// real client is explicitly invoked.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  materializeAgentPluginPackage,
  validateAgentPluginPackage,
  fingerprintDir: fingerprintAgent,
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
const { validateSurfaceReceipt, resolveGeneratedFromTree } = require('../lib/platform-provenance');
const { resolveCapabilitySelection, bindSurfaceSelection } = require('../lib/capability-bundle-selection');

const ROOT = path.join(__dirname, '..', '..');
const POLICY_PROJECTIONS = Object.freeze({
  claude: 'rules/execution-policy.md',
  codex: 'codex/supporting/policies/execution-policy.md',
  agy: 'plugins/dhpk-agy/rules/execution-policy.md',
  cursor: 'plugins/dhpk-cursor/rules/execution-policy.mdc',
});
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
  const fingerprintMatches = fingerprintAgent(temp) === fingerprintAgent(tracked);
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
  const fingerprintMatches = fingerprintAgent(temp) === fingerprintAgent(tracked);
  return {
    structural: structural.ok ? 'PASS' : 'FAIL',
    receipt: receipt.ok ? 'PASS' : 'FAIL',
    deterministic: fingerprintMatches ? 'PASS' : 'FAIL',
    selectedSkills: generated.selected.skills.length,
    selectedSkillIds: generated.selected.skills.map((skill) => skill.id),
    errors: [...structural.errors, ...receipt.errors, ...(fingerprintMatches ? [] : ['tracked AGY package fingerprint drifted'])],
  };
}

function verifyPolicyParity(root) {
  const canonicalPath = path.join(root, POLICY_PROJECTIONS.claude);
  const errors = [];
  const canonical = fs.existsSync(canonicalPath) ? fs.readFileSync(canonicalPath, 'utf8') : '';
  if (!canonical) errors.push(`canonical policy is missing: ${POLICY_PROJECTIONS.claude}`);
  const missingCanonicalMarkers = POLICY_MARKERS.filter((marker) => !canonical.includes(marker));
  if (missingCanonicalMarkers.length > 0) {
    errors.push(`canonical policy is missing required markers: ${missingCanonicalMarkers.join(', ')}`);
  }
  const projections = {};
  for (const [platform, relative] of Object.entries(POLICY_PROJECTIONS)) {
    const file = path.join(root, relative);
    const content = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    const missing = POLICY_MARKERS.filter((marker) => !content.includes(marker));
    if (!content) errors.push(`${platform} policy projection is missing: ${relative}`);
    if (missing.length > 0) errors.push(`${platform} policy projection is missing required markers: ${missing.join(', ')}`);
    projections[platform] = {
      source: relative,
      canonicalSource: POLICY_PROJECTIONS.claude,
      requiredMarkers: POLICY_MARKERS.slice(),
      missingMarkers: missing,
    };
  }
  return {
    verdict: errors.length === 0 ? 'PASS' : 'FAIL',
    canonicalSource: POLICY_PROJECTIONS.claude,
    requiredMarkers: POLICY_MARKERS.slice(),
    projections,
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
    report = reportFromSurfaces(surfaces, verifyPolicyParity(ROOT));
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
