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

const ROOT = path.join(__dirname, '..', '..');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function sourceCommit(root, fallback) {
  const result = spawnSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : fallback;
}

function verifyAgent({ inventory, version, tracked, temp }) {
  const trackedProvenance = readJson(path.join(tracked, 'provenance.json'));
  const generated = materializeAgentPluginPackage({
    inventory,
    root: ROOT,
    outDir: temp,
    version,
    sourceCommit: trackedProvenance.sourceCommit || sourceCommit(ROOT, 'unknown'),
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

function verifyCursor({ inventory, version, tracked, temp }) {
  const trackedProvenance = readJson(path.join(tracked, 'provenance.json'));
  const generated = materializeCursorPackage({
    inventory,
    root: ROOT,
    outDir: temp,
    version,
    sourceCommit: trackedProvenance.sourceCommit || sourceCommit(ROOT, 'unknown'),
  });
  const structural = validateCursorPackage({ packageRoot: temp });
  const receipt = validateSurfaceReceipt(readJson(path.join(tracked, 'provenance.json')), 'cursor-plugin');
  const fingerprintMatches = fingerprintCursor(temp) === fingerprintCursor(tracked);
  return {
    structural: structural.ok ? 'PASS' : 'FAIL',
    receipt: receipt.ok ? 'PASS' : 'FAIL',
    deterministic: fingerprintMatches ? 'PASS' : 'FAIL',
    selectedSkills: generated.skillNames.length,
    selectedSkillIds: generated.skillIds,
    sharedSkillIds: generated.provenance.sharedSkillIds || [],
    sharedSkillSurface: generated.provenance.sharedSkillSurface || null,
    sharedSkillSource: generated.provenance.sharedSkillSource || null,
    errors: [...structural.errors, ...receipt.errors, ...(fingerprintMatches ? [] : ['tracked Cursor Plugin fingerprint drifted'])],
  };
}

function main() {
  const inventory = readJson(path.join(ROOT, 'manifests', 'distribution-inventory.json'));
  const version = readJson(path.join(ROOT, '.claude-plugin', 'plugin.json')).version;
  const tempAgent = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-agent-package-verify-'));
  const tempCursor = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-cursor-package-verify-'));
  let report;
  try {
    const surfaces = {
      'agent-plugin': verifyAgent({ inventory, version, tracked: path.join(ROOT, 'plugins/dhpk-agent'), temp: tempAgent }),
      'cursor-plugin': verifyCursor({ inventory, version, tracked: path.join(ROOT, 'plugins/dhpk-cursor'), temp: tempCursor }),
    };
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
      const overlap = (cursor.selectedSkillIds || []).filter((id) => sharedIds.includes(id));
      if (overlap.length > 0) {
        errors.push(`Cursor overlay repeats shared skill IDs without a distinct environment variant: ${overlap.sort().join(', ')}`);
      }
    }
    report = { verdict: errors.length === 0 ? 'PASS' : 'FAIL', surfaces };
  } catch (error) {
    report = { verdict: 'FAIL', surfaces: {}, errors: [error.message] };
  } finally {
    fs.rmSync(tempAgent, { recursive: true, force: true });
    fs.rmSync(tempCursor, { recursive: true, force: true });
  }
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.verdict === 'PASS' ? 0 : 1);
}

main();
