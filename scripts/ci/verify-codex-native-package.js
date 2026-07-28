#!/usr/bin/env node
'use strict';

// Deterministic-generation gate (task 2.3): regenerates a fresh codex-native
// candidate from the current distribution inventory and canonical sources,
// then diffs it against the TRACKED plugins/dhpk/ artifact. A mismatch means
// the tracked package was not regenerated after a canonical-source or
// inventory-membership change and must be regenerated in the release PR
// (spec.md: "Generated output diverges from canonical sources").
//
// Deliberately does not compare provenance.sourceCommit — every run of this
// check happens at a later commit than the one the tracked package recorded,
// so sourceCommit is expected to differ and is not a drift signal. It DOES
// compare fingerprints (content), selectedSkillIds (membership), the
// manifest skills field, inventoryDigest, and generatorVersion.
//
// Usage: node scripts/ci/verify-codex-native-package.js [--repo-root <path>]

const fs = require('fs');
const os = require('os');
const path = require('path');
const { materializeNativePackage, validateNativeCandidate, validateNativeMembership } = require('../lib/codex-native-package');

function parseArgs(argv) {
  const args = { root: path.join(__dirname, '..', '..') };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--repo-root') args.root = argv[++i];
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const ROOT = args.root;
const pkgDir = path.join(ROOT, 'plugins', 'dhpk');
const trackedManifestPath = path.join(pkgDir, '.codex-plugin', 'plugin.json');
const trackedFingerprintsPath = path.join(pkgDir, 'fingerprints.json');
const trackedProvenancePath = path.join(pkgDir, 'provenance.json');

for (const p of [trackedManifestPath, trackedFingerprintsPath, trackedProvenancePath]) {
  if (!fs.existsSync(p)) {
    console.error(`verify-codex-native-package: tracked artifact file missing: ${p}`);
    process.exit(1);
  }
}

const trackedManifest = JSON.parse(fs.readFileSync(trackedManifestPath, 'utf8'));
const trackedFingerprints = JSON.parse(fs.readFileSync(trackedFingerprintsPath, 'utf8'));
const trackedProvenance = JSON.parse(fs.readFileSync(trackedProvenancePath, 'utf8'));

const inventory = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests', 'distribution-inventory.json'), 'utf8'));
const tmpOut = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-native-drift-check-'));

let fresh;
try {
  fresh = materializeNativePackage({
    inventory,
    root: ROOT,
    outDir: tmpOut,
    name: trackedManifest.name,
    version: trackedManifest.version,
    sourceCommit: trackedProvenance.sourceCommit,
  });
} finally {
  fs.rmSync(tmpOut, { recursive: true, force: true });
}

const errors = [];

// Structural validation of the TRACKED artifact itself — a hand-edit could
// reintroduce a symlink or a parent-relative manifest escape without
// changing skill content, which the fingerprint/membership diff below would
// not catch on its own.
const structural = validateNativeCandidate({ manifestSkillsField: trackedManifest.skills, packageRoot: pkgDir });
errors.push(...structural.errors);
const trackedMembership = validateNativeMembership({
  candidateSkillIds: fs.existsSync(path.join(pkgDir, 'skills')) ? fs.readdirSync(path.join(pkgDir, 'skills')) : [],
  inventory,
});
errors.push(...trackedMembership.errors);

if (fresh.manifestSkillsField !== trackedManifest.skills) {
  errors.push(`manifest skills field drifted: tracked='${trackedManifest.skills}' fresh='${fresh.manifestSkillsField}'`);
}

const trackedIds = trackedProvenance.selectedSkillIds || [];
const freshIds = fresh.skillIds;
if (JSON.stringify(trackedIds) !== JSON.stringify(freshIds)) {
  const missing = freshIds.filter((id) => !trackedIds.includes(id));
  const extra = trackedIds.filter((id) => !freshIds.includes(id));
  errors.push(`selected skill membership drifted: missing=[${missing.join(', ')}] extra=[${extra.join(', ')}]`);
}

for (const id of freshIds) {
  if (trackedFingerprints[id] !== fresh.fingerprints[id]) {
    errors.push(`fingerprint drifted for '${id}': tracked='${trackedFingerprints[id] || '(absent)'}' fresh='${fresh.fingerprints[id]}'`);
  }
}

if (trackedProvenance.inventoryDigest !== fresh.provenance.inventoryDigest) {
  errors.push(`inventoryDigest drifted: tracked='${trackedProvenance.inventoryDigest}' fresh='${fresh.provenance.inventoryDigest}'`);
}

if (trackedProvenance.generatorVersion !== fresh.provenance.generatorVersion) {
  errors.push(`generatorVersion drifted: tracked='${trackedProvenance.generatorVersion}' fresh='${fresh.provenance.generatorVersion}'`);
}

if (errors.length > 0) {
  for (const e of errors) console.error(`ERROR [verify-codex-native-package]: ${e}`);
  console.error('FAIL [verify-codex-native-package]: tracked plugins/dhpk/ diverges from a fresh inventory-controlled generation — regenerate it (node scripts/ci/gen-codex-native-package.js plugins/dhpk --version=<X.Y.Z>) in the release PR.');
  process.exit(1);
}

console.log(`PASS [verify-codex-native-package]: tracked package matches a fresh generation (${freshIds.length} codex-native skills).`);
