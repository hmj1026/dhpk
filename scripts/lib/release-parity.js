'use strict';

// Version-parity checks for one release target across every version-bearing
// surface: the Claude plugin manifest, root Codex manifest, thin Codex
// wrapper manifest, standard Agent Plugin, native AGY plugin, and Cursor
// Plugin manifests plus owner-scoped receipts, marketplace descriptor, and
// the CHANGELOG.md release heading. Composes (does not replace) the pairwise
// manifest parity already covered by tests/codex-plugin-manifest.test.js.

const fs = require('fs');
const path = require('path');

const SEMVER_PATTERN = /^\d+\.\d+\.\d+$/;

const MANIFEST_PATHS = [
  '.claude-plugin/plugin.json',
  '.codex-plugin/plugin.json',
  'plugins/dhpk/.codex-plugin/plugin.json',
  '.agents/plugins/marketplace.json',
  'plugins/dhpk/provenance.json',
  'plugins/dhpk-agent/plugin.json',
  'plugins/dhpk-agent/provenance.json',
  'plugins/dhpk-agy/plugin.json',
  'plugins/dhpk-agy/provenance.json',
  'plugins/dhpk-cursor/.cursor-plugin/plugin.json',
  'plugins/dhpk-cursor/provenance.json',
];

function readManifestVersion(root, relPath) {
  const abs = path.join(root, relPath);
  const data = JSON.parse(fs.readFileSync(abs, 'utf8'));
  if (relPath.endsWith('marketplace.json')) {
    const entry = (data.plugins || []).find((p) => p.name === 'dhpk');
    return entry ? entry.version : undefined;
  }
  if (relPath.endsWith('provenance.json')) {
    return data.sourceVersion;
  }
  return data.version;
}

function readChangelogHeadingVersion(root, targetVersion) {
  const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
  const pattern = new RegExp(`^## ${targetVersion.replace(/\./g, '\\.')} `, 'm');
  return pattern.test(changelog);
}

function checkParity(root, targetVersion) {
  const errors = [];

  if (!SEMVER_PATTERN.test(targetVersion)) {
    return { ok: false, errors: [`target version '${targetVersion}' is not valid semver (X.Y.Z)`] };
  }

  for (const relPath of MANIFEST_PATHS) {
    let observed;
    try {
      observed = readManifestVersion(root, relPath);
    } catch (e) {
      errors.push(`${relPath}: could not read version (${e.message})`);
      continue;
    }
    if (observed !== targetVersion) {
      errors.push(`${relPath}: version '${observed}' does not match target '${targetVersion}'`);
    }
  }

  if (!readChangelogHeadingVersion(root, targetVersion)) {
    errors.push(`CHANGELOG.md: no '## ${targetVersion} ' release heading found`);
  }

  return { ok: errors.length === 0, errors };
}

module.exports = { MANIFEST_PATHS, SEMVER_PATTERN, checkParity };
