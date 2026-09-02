#!/usr/bin/env node
'use strict';

// Generate a finite-alias Claude profile package. The materialized `minimal`
// profile is the default discovery artifact; `full` and `compat-v1` remain
// explicit opt-in compatibility profiles.

const fs = require('node:fs');
const path = require('node:path');
const {
  compileClaudeCapabilityBundle,
  materializeClaudeCapabilityBundle,
} = require('../lib/claude-capability-bundle');
const { ProjectionArtifactStore } = require('../lib/projection-artifact-store');

const ROOT = path.join(__dirname, '..', '..');

function readJson(relative) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relative), 'utf8'));
}

function usage() {
  console.error('usage: node scripts/ci/gen-claude-profile-bundles.js --profile <alias> [--skill <stable-id>] [--out <directory>] [--check]');
}

function parseArgs(argv) {
  const result = { profile: null, skillIds: [], out: null, check: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--check') result.check = true;
    else if (arg === '--profile' || arg === '-p') result.profile = argv[++i] || null;
    else if (arg === '--skill') {
      const value = argv[++i];
      if (!value || value.startsWith('--')) return { error: '--skill requires a value' };
      result.skillIds.push(value);
    }
    else if (arg.startsWith('--skill=')) {
      const value = arg.slice('--skill='.length);
      if (!value) return { error: '--skill requires a value' };
      result.skillIds.push(value);
    }
    else if (arg === '--out' || arg === '-o') result.out = argv[++i] || null;
    else if (arg === '--help' || arg === '-h') return { help: true };
    else return { error: `unknown argument '${arg}'` };
  }
  if (!result.profile) return { error: '--profile is required' };
  return result;
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) { usage(); return 0; }
  if (args.error) { console.error(`FAIL [gen-claude-profile-bundles]: ${args.error}`); usage(); return 2; }
  const compiled = compileClaudeCapabilityBundle({
    root: ROOT,
    inventory: readJson('manifests/distribution-inventory.json'),
    profiles: readJson('manifests/install-profiles.json'),
    moduleCatalog: readJson('manifests/module-catalog.json'),
    profileId: args.profile,
    skillIds: args.skillIds,
  });
  if (!compiled.ok) {
    console.error(`FAIL [gen-claude-profile-bundles]: ${compiled.error.message}`);
    return 1;
  }
  if (args.check) {
    console.log(JSON.stringify({
      profile: compiled.value.plan.profile,
      selectedStableIds: compiled.value.plan.selectedStableIds,
      planFingerprint: compiled.value.plan.planFingerprint,
      compatibilityMode: compiled.value.plan.compatibilityMode,
    }, null, 2));
    return 0;
  }
  const outputRoot = path.resolve(args.out || path.join(ROOT, 'generated', 'claude-profiles', args.profile));
  const store = new ProjectionArtifactStore({
    root: outputRoot,
    sourceRoot: ROOT,
    publishRoot: path.join(outputRoot, 'package'),
  });
  const artifact = materializeClaudeCapabilityBundle({
    compiled: compiled.value,
    artifactStore: store,
    root: ROOT,
  });
  if (!artifact.ok) {
    console.error(`FAIL [gen-claude-profile-bundles]: ${artifact.error.message}`);
    return 1;
  }
  console.log(JSON.stringify({
    profile: args.profile,
    outputRoot: path.join(outputRoot, 'package'),
    planFingerprint: artifact.value.planFingerprint,
    artifactFingerprint: artifact.value.artifactFingerprint,
    selectedStableIds: compiled.value.plan.selectedStableIds,
    selectedCount: compiled.value.plan.selectedStableIds.length,
    compatibilityMode: compiled.value.plan.compatibilityMode,
    consumerRuntime: 'NOT_CONFIGURED',
    resumeCommand: `node scripts/ci/gen-claude-profile-bundles.js --profile ${args.profile} ${args.skillIds.map((id) => `--skill ${id}`).join(' ')} --out ${outputRoot}`.replace(/  +/g, ' ').trim(),
  }, null, 2));
  return 0;
}

if (require.main === module) process.exit(main());

module.exports = { main, parseArgs };
