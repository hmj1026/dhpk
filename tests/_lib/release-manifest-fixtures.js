'use strict';

// Writes every version-bearing manifest named by MANIFEST_PATHS, so release
// fixtures follow the parity list instead of hardcoding their own copy.

const fs = require('node:fs');
const path = require('node:path');
const { MANIFEST_PATHS } = require('../../scripts/lib/release-parity');

function manifestBody(relPath, version) {
  if (relPath.endsWith('marketplace.json')) return { plugins: [{ name: 'dhpk', version }] };
  if (relPath.endsWith('provenance.json')) return { sourceVersion: version };
  return { name: 'dhpk', version };
}

function writeVersionManifests(root, version, { versions = {}, include = () => true } = {}) {
  for (const relPath of MANIFEST_PATHS.filter(include)) {
    const abs = path.join(root, relPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, JSON.stringify(manifestBody(relPath, versions[relPath] || version)));
  }
}

module.exports = { writeVersionManifests };
