#!/usr/bin/env node
'use strict';

// Host manifest sync generator: package.json is the single version source and
// manifests/listing-metadata.json the single listing source. This writes (or
// with --check verifies) the version and the listing fields (description,
// keywords, display names, marketplace entries) into every manifest declared
// for sync in scripts/lib/host-manifests.js. Package manifests are
// written by their own generators and are not touched here.
//   node scripts/ci/gen-host-manifests.js           write
//   node scripts/ci/gen-host-manifests.js --check   exit 1 on drift

const path = require('path');
const { readSourceVersion, syncedManifestDrift, writeSyncedManifest, syncedOutputs } = require('../lib/host-manifests');

const ROOT = path.join(__dirname, '..', '..');

function drift(root, version) {
  return syncedOutputs()
    .map((output) => ({ output, fields: syncedManifestDrift(root, output, version) }))
    .filter(({ fields }) => fields.length > 0);
}

function run(root, { check }) {
  const version = readSourceVersion(root);
  const stale = drift(root, version);
  if (check) {
    for (const { output, fields } of stale) {
      console.error(`DRIFT [gen-host-manifests]: ${output.path} field(s) ${fields.join(', ')} do not match package.json '${version}' and manifests/listing-metadata.json`);
    }
    if (stale.length === 0) console.log(`PASS [gen-host-manifests]: version-sync manifests match package.json (${version}) and the listing metadata.`);
    return stale.length === 0 ? 0 : 1;
  }
  for (const { output } of stale) writeSyncedManifest(root, output, version);
  console.log(`gen-host-manifests: ${stale.length} manifest(s) updated to ${version}.`);
  return 0;
}

if (require.main === module) {
  process.exit(run(ROOT, { check: process.argv.includes('--check') }));
}

module.exports = { run };
