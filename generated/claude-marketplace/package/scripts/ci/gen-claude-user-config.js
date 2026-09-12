#!/usr/bin/env node
'use strict';

// Generate/check the candidate userConfig descriptions independently of the
// existing skills-root generator. The checked-in manifest remains legacy until
// the candidate has passed all structural and consumer gates.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  loadAuthoritativeMetadata,
  generateUserConfigMetadata,
  measureUserConfigMetadata,
  rollbackUserConfigMetadata,
  safeRegularPath,
} = require('../lib/plugin-user-config-metadata');
const { runClaudeUserConfigProbe } = require('../release/claude-user-config-probe');

const ROOT = path.join(__dirname, '..', '..');
const manifestPath = path.join(ROOT, '.claude-plugin', 'plugin.json');
const sourcePath = path.join(ROOT, 'manifests', 'claude-user-config-metadata.json');
const rollbackPath = path.join(ROOT, 'manifests', 'claude-user-config-legacy.json');

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }

function main(argv = process.argv.slice(2)) {
  if (argv.includes('--rollback')) {
    if (!fs.existsSync(rollbackPath)) {
      console.error(`FAIL [gen-claude-user-config]: rollback artifact missing: ${rollbackPath}`);
      return 1;
    }
    const rollback = rollbackUserConfigMetadata({
      root: ROOT,
      manifestPath,
      legacyManifest: readJson(rollbackPath),
    });
    console.log(`${rollback.ok ? 'PASS' : 'FAIL'} [gen-claude-user-config]: rollback`);
    return rollback.ok ? 0 : 1;
  }
  const legacyManifest = readJson(manifestPath);
  const source = loadAuthoritativeMetadata({ root: ROOT, legacyManifest, sourcePath });
  const generated = generateUserConfigMetadata({ root: ROOT, legacyManifest, source });
  if (!generated.ok) {
    for (const error of generated.errors || []) console.error(`FAIL [gen-claude-user-config]: ${error}`);
    return 1;
  }
  const candidate = generated.value.manifest;
  if (argv.includes('--check')) {
    const active = readJson(manifestPath);
    const same = JSON.stringify(active.userConfig) === JSON.stringify(candidate.userConfig);
    console.log(`${same ? 'PASS' : 'INFO'} [gen-claude-user-config]: candidate fingerprint ${generated.value.manifestFingerprint}`);
    return 0;
  }
  const outputIndex = argv.indexOf('--out');
  if (outputIndex !== -1 && argv[outputIndex + 1]) {
    fs.writeFileSync(path.resolve(argv[outputIndex + 1]), `${JSON.stringify(candidate, null, 2)}\n`);
    console.log(`WROTE [gen-claude-user-config]: ${path.resolve(argv[outputIndex + 1])}`);
    return 0;
  }
  if (argv.includes('--activate')) {
    if (process.env.DHPK_ENABLE_COMPACT_USER_CONFIG !== '1') {
      console.error('BLOCKED [gen-claude-user-config]: set DHPK_ENABLE_COMPACT_USER_CONFIG=1 after all gates pass');
      return 1;
    }
    if (!safeRegularPath(ROOT, manifestPath)) {
      console.error('FAIL [gen-claude-user-config]: active manifest path is symlinked or escapes the repository');
      return 1;
    }
    if (!safeRegularPath(ROOT, rollbackPath)) {
      console.error('FAIL [gen-claude-user-config]: rollback artifact path is symlinked or escapes the repository');
      return 1;
    }
    if (!fs.existsSync(rollbackPath)) fs.writeFileSync(rollbackPath, `${JSON.stringify(legacyManifest, null, 2)}\n`);
    fs.writeFileSync(manifestPath, `${JSON.stringify(candidate, null, 2)}\n`);
    console.log(`PASS [gen-claude-user-config]: activated ${generated.value.manifestFingerprint}`);
    return 0;
  }
  if (argv.includes('--evidence')) {
    const evidenceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-user-config-evidence-'));
    const candidatePath = path.join(evidenceRoot, 'plugin.json');
    fs.writeFileSync(candidatePath, `${JSON.stringify(candidate, null, 2)}\n`);
    let evidence;
    try {
      const consumer = runClaudeUserConfigProbe({
        executable: process.env.DHPK_CLAUDE_BIN || 'claude',
        manifestPath: candidatePath,
        manifestFingerprint: generated.value.manifestFingerprint,
        version: process.env.DHPK_CLAUDE_VERSION,
        execute: argv.includes('--execute'),
      });
      evidence = measureUserConfigMetadata({
        beforeManifest: legacyManifest,
        afterManifest: candidate,
        metadataSource: source,
        identity: { artifactFingerprint: generated.value.manifestFingerprint },
        consumer,
      });
    } finally {
      fs.rmSync(evidenceRoot, { recursive: true, force: true });
    }
    const payload = evidence.ok ? evidence.value : evidence;
    const outputIndex = argv.indexOf('--evidence-out');
    if (outputIndex !== -1 && argv[outputIndex + 1]) fs.writeFileSync(path.resolve(argv[outputIndex + 1]), `${JSON.stringify(payload, null, 2)}\n`);
    else console.log(JSON.stringify(payload, null, 2));
    return evidence.ok && payload.structural && payload.structural.verdict === 'PASS' ? 0 : 1;
  }
  console.log('dhpk Claude userConfig metadata candidate:');
  console.log(`  entries:             ${Object.keys(candidate.userConfig || {}).length}`);
  console.log(`  manifest fingerprint: ${generated.value.manifestFingerprint}`);
  console.log('  active path:          legacy (candidate requires --activate and its explicit gate)');
  return 0;
}

if (require.main === module) process.exit(main());
module.exports = { main };
