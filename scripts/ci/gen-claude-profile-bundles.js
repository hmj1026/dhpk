#!/usr/bin/env node
'use strict';

// Generate a finite-alias Claude profile package. The materialized `minimal`
// profile is the default discovery artifact; `full` and `compat-v1` remain
// explicit opt-in compatibility profiles.
//
// --plan prints the compiled selection plan without writing anything.
// --check regenerates into a temporary directory and compares it file by file
// with the committed package, so a stale copy fails instead of passing.

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
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
  console.error('usage: node scripts/ci/gen-claude-profile-bundles.js (--profile <alias> [--skill <stable-id>] | --standalone <skill-id-or-public-name>) [--out <directory>] [--plan | --check]');
}

function parseArgs(argv) {
  const result = { profile: null, skillIds: [], standaloneSkillIds: [], out: null, plan: false, check: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--check') result.check = true;
    else if (arg === '--plan') result.plan = true;
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
    else if (arg === '--standalone') {
      const value = argv[++i];
      if (!value || value.startsWith('--')) return { error: '--standalone requires a value' };
      if (!result.standaloneSkillIds.includes(value)) result.standaloneSkillIds.push(value);
    }
    else if (arg.startsWith('--standalone=')) {
      const value = arg.slice('--standalone='.length);
      if (!value) return { error: '--standalone requires a value' };
      if (!result.standaloneSkillIds.includes(value)) result.standaloneSkillIds.push(value);
    }
    else if (arg === '--out' || arg === '-o') result.out = argv[++i] || null;
    else if (arg === '--help' || arg === '-h') return { help: true };
    else return { error: `unknown argument '${arg}'` };
  }
  if (result.plan && result.check) return { error: '--plan and --check are mutually exclusive' };
  if (result.standaloneSkillIds.length > 0 && (result.profile || result.skillIds.length > 0)) {
    return { error: '--standalone cannot be combined with --profile or --skill' };
  }
  if (!result.profile && result.standaloneSkillIds.length === 0) return { error: '--profile or --standalone is required' };
  return result;
}

function materialize(compiled, outputRoot) {
  const store = new ProjectionArtifactStore({
    root: outputRoot,
    sourceRoot: ROOT,
    publishRoot: path.join(outputRoot, 'package'),
  });
  return materializeClaudeCapabilityBundle({
    compiled,
    artifactStore: store,
    root: ROOT,
  });
}

// Map of package-relative POSIX path -> sha256 for every regular file.
function hashTree(directory) {
  const files = new Map();
  const walk = (current, relative) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const child = path.join(current, entry.name);
      const childRelative = relative ? path.posix.join(relative, entry.name) : entry.name;
      if (entry.isDirectory()) walk(child, childRelative);
      else if (entry.isFile()) files.set(childRelative, crypto.createHash('sha256').update(fs.readFileSync(child)).digest('hex'));
      else throw new Error(`profile package contains an unsupported entry (symlink or special file): ${childRelative}`);
    }
  };
  walk(directory, '');
  return files;
}

function diffTrees(expectedRoot, actualRoot) {
  const expected = hashTree(expectedRoot);
  const actual = hashTree(actualRoot);
  const differences = [];
  for (const [file, hash] of expected) {
    if (!actual.has(file)) differences.push(`missing: ${file}`);
    else if (actual.get(file) !== hash) differences.push(`changed: ${file}`);
  }
  for (const file of actual.keys()) {
    if (!expected.has(file)) differences.push(`extra: ${file}`);
  }
  return differences.sort();
}

const MAX_REPORTED_DIFFERENCES = 20;

function check(compiled, outputRoot, regenerateCommand) {
  const baseline = path.join(outputRoot, 'package');
  if (!fs.existsSync(baseline)) {
    console.error(`FAIL [gen-claude-profile-bundles]: baseline package is missing: ${baseline} (use --plan to preview a selection without a committed package)`);
    return 1;
  }
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-claude-profile-check-'));
  try {
    const artifact = materialize(compiled, temporary);
    if (!artifact.ok) {
      console.error(`FAIL [gen-claude-profile-bundles]: ${artifact.error.message}`);
      return 1;
    }
    const differences = diffTrees(path.join(temporary, 'package'), baseline);
    if (differences.length === 0) {
      console.log(`PASS [gen-claude-profile-bundles]: ${baseline}`);
      return 0;
    }
    const shown = differences.slice(0, MAX_REPORTED_DIFFERENCES);
    const more = differences.length - shown.length;
    console.error([
      `FAIL [gen-claude-profile-bundles]: profile package is out of date: ${baseline} (${differences.length} difference(s))`,
      ...shown.map((line) => `  ${line}`),
      ...(more > 0 ? [`  ... and ${more} more`] : []),
      `Regenerate with: ${regenerateCommand}`,
    ].join('\n'));
    return 1;
  } catch (error) {
    console.error(`FAIL [gen-claude-profile-bundles]: ${error.message}`);
    return 1;
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
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
    ...(args.standaloneSkillIds.length > 0 ? { standaloneSkillIds: args.standaloneSkillIds } : {}),
  });
  if (!compiled.ok) {
    console.error(`FAIL [gen-claude-profile-bundles]: ${compiled.error.message}`);
    return 1;
  }
  if (args.plan) {
    console.log(JSON.stringify({
      profile: compiled.value.plan.profile,
      selectedStableIds: compiled.value.plan.selectedStableIds,
      planFingerprint: compiled.value.plan.planFingerprint,
      compatibilityMode: compiled.value.plan.compatibilityMode,
    }, null, 2));
    return 0;
  }
  const outputName = args.profile || `standalone-${args.standaloneSkillIds.join('-')}`;
  const outputRoot = path.resolve(args.out || path.join(ROOT, 'generated', 'claude-profiles', outputName));
  const resumeCommand = `node scripts/ci/gen-claude-profile-bundles.js ${args.profile ? `--profile ${args.profile} ${args.skillIds.map((id) => `--skill ${id}`).join(' ')}` : args.standaloneSkillIds.map((id) => `--standalone ${id}`).join(' ')} --out ${outputRoot}`.replace(/  +/g, ' ').trim();
  if (args.check) return check(compiled.value, outputRoot, resumeCommand);
  const artifact = materialize(compiled.value, outputRoot);
  if (!artifact.ok) {
    console.error(`FAIL [gen-claude-profile-bundles]: ${artifact.error.message}`);
    return 1;
  }
  console.log(JSON.stringify({
    profile: args.profile,
    selectionMode: compiled.value.selection.selectionMode,
    requestedStableIds: compiled.value.selection.requestedStableIds || [],
    outputRoot: path.join(outputRoot, 'package'),
    planFingerprint: artifact.value.planFingerprint,
    artifactFingerprint: artifact.value.artifactFingerprint,
    selectedStableIds: compiled.value.plan.selectedStableIds,
    selectedCount: compiled.value.plan.selectedStableIds.length,
    compatibilityMode: compiled.value.plan.compatibilityMode,
    consumerRuntime: 'NOT_CONFIGURED',
    resumeCommand,
  }, null, 2));
  return 0;
}

if (require.main === module) process.exit(main());

module.exports = { main, parseArgs };
