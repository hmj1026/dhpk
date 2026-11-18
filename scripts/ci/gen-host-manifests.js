#!/usr/bin/env node
'use strict';

// Version-sync generator: package.json is the single version source; this
// writes (or with --check verifies) that version into every manifest declared
// for 'version-sync' in scripts/lib/host-manifests.js. Package manifests are
// written by their own generators and are not touched here.
//   node scripts/ci/gen-host-manifests.js           write
//   node scripts/ci/gen-host-manifests.js --check   exit 1 on drift

const path = require('path');
const { readSourceVersion, readDeclaredVersion, writeDeclaredVersion, versionSyncOutputs } = require('../lib/host-manifests');

const ROOT = path.join(__dirname, '..', '..');

function drift(root, version) {
  return versionSyncOutputs()
    .map((output) => ({ output, observed: readDeclaredVersion(root, output) }))
    .filter(({ observed }) => observed !== version);
}

function run(root, { check }) {
  const version = readSourceVersion(root);
  const stale = drift(root, version);
  if (check) {
    for (const { output, observed } of stale) {
      console.error(`DRIFT [gen-host-manifests]: ${output.path} version '${observed}' does not match package.json '${version}'`);
    }
    if (stale.length === 0) console.log(`PASS [gen-host-manifests]: version-sync manifests match package.json (${version}).`);
    return stale.length === 0 ? 0 : 1;
  }
  for (const { output } of stale) writeDeclaredVersion(root, output, version);
  console.log(`gen-host-manifests: ${stale.length} manifest(s) updated to ${version}.`);
  return 0;
}

if (require.main === module) {
  process.exit(run(ROOT, { check: process.argv.includes('--check') }));
}

module.exports = { run };
