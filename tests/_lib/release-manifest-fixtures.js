'use strict';

// Writes every version-bearing manifest named by MANIFEST_PATHS, so release
// fixtures follow the parity list instead of hardcoding their own copy.

const fs = require('node:fs');
const path = require('node:path');
const { MANIFEST_PATHS } = require('../../scripts/lib/release-parity');
const { LISTING_METADATA } = require('../../scripts/lib/host-manifests');

function manifestBody(relPath, version) {
  if (relPath.endsWith('.cursor-plugin/marketplace.json')) return { metadata: { version } };
  if (relPath.endsWith('provenance.json')) return { sourceVersion: version };
  if (relPath.startsWith('dist/claude-directory/')) return { name: 'dhpk-lite', version };
  return { name: 'dhpk', version };
}

function writeVersionManifests(root, version, { versions = {}, include = () => true } = {}) {
  for (const relPath of MANIFEST_PATHS.filter(include)) {
    const abs = path.join(root, relPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, JSON.stringify(manifestBody(relPath, versions[relPath] || version)));
  }
  // The OpenAI submission manifest renders from its listing metadata source.
  fs.mkdirSync(path.join(root, 'manifests'), { recursive: true });
  fs.writeFileSync(path.join(root, LISTING_METADATA), JSON.stringify({ name: 'dhpk', description: 'fixture' }));
}

module.exports = { writeVersionManifests };
