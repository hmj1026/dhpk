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
const { validateSurfaceReceipt } = require('../lib/platform-provenance');
const { resolveCapabilitySelection, bindSurfaceSelection } = require('../lib/capability-bundle-selection');

const ROOT = path.join(__dirname, '..', '..');

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

function verifyAgent({ inventory, profiles, moduleCatalog, version, tracked, temp }) {
  const trackedProvenance = readJson(path.join(tracked, 'provenance.json'));
  const generated = materializeAgentPluginPackage({
    inventory,
    root: ROOT,
    outDir: temp,
    version,
    sourceCommit: trackedProvenance.sourceCommit || sourceCommit(ROOT, 'unknown'),
    profileSelection: profileSelectionFromReceipt({ receipt: trackedProvenance, surface: 'agent-plugin', inventory, profiles, moduleCatalog }),
  });
  const structural = validateAgentPluginPackage(temp);
  const receipt = validateSurfaceReceipt(readJson(path.join(tracked, 'provenance.json')), 'agent-plugin');
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

function verifyCursor({ inventory, profiles, moduleCatalog, version, tracked, temp }) {
  const trackedProvenance = readJson(path.join(tracked, 'provenance.json'));
  const generated = materializeCursorPackage({
    inventory,
    root: ROOT,
    outDir: temp,
    version,
    sourceCommit: trackedProvenance.sourceCommit || sourceCommit(ROOT, 'unknown'),
    profileSelection: profileSelectionFromReceipt({ receipt: trackedProvenance, surface: 'cursor-plugin', inventory, profiles, moduleCatalog }),
  });
  const structural = validateCursorPackage({ packageRoot: temp, inventory });
  const receipt = validateSurfaceReceipt(readJson(path.join(tracked, 'provenance.json')), 'cursor-plugin');
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

function reportFromSurfaces(surfaces) {
  const errors = Object.values(surfaces).flatMap((surface) => surface.errors);
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
  return { verdict: errors.length === 0 ? 'PASS' : 'FAIL', surfaces, errors };
}

function main() {
  const inventory = readJson(path.join(ROOT, 'manifests', 'distribution-inventory.json'));
  const profiles = readJson(path.join(ROOT, 'manifests', 'install-profiles.json'));
  const moduleCatalog = readJson(path.join(ROOT, 'manifests', 'module-catalog.json'));
  const version = readJson(path.join(ROOT, '.claude-plugin', 'plugin.json')).version;
  const tempAgent = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-agent-package-verify-'));
  const tempCursor = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-cursor-package-verify-'));
  let report;
  try {
    const surfaces = {
      'agent-plugin': verifyAgent({ inventory, profiles, moduleCatalog, version, tracked: path.join(ROOT, 'plugins/dhpk-agent'), temp: tempAgent }),
      'cursor-plugin': verifyCursor({ inventory, profiles, moduleCatalog, version, tracked: path.join(ROOT, 'plugins/dhpk-cursor'), temp: tempCursor }),
    };
    report = reportFromSurfaces(surfaces);
  } catch (error) {
    report = { verdict: 'FAIL', surfaces: {}, errors: [error.message] };
  } finally {
    fs.rmSync(tempAgent, { recursive: true, force: true });
    fs.rmSync(tempCursor, { recursive: true, force: true });
  }
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.verdict === 'PASS' ? 0 : 1);
}

if (require.main === module) main();

module.exports = { reportFromSurfaces };
