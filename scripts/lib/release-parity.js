'use strict';

// Version-parity checks for one release target across every version-bearing
// surface: the Claude plugin manifest, root Codex manifest, thin Codex
// wrapper manifest, standard Agent Plugin, native AGY plugin, and Cursor
// Plugin manifests plus owner-scoped receipts, marketplace descriptor, the
// CHANGELOG.md release heading, and the bilingual AGY generator pin in
// platform-installation SSOT. Composes (does not replace) the pairwise
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

const AGY_GENERATOR_DOC_PATHS = [
  'docs/platform-installation.md',
  'docs/platform-installation.zh-TW.md',
];

const AGY_GENERATOR_PIN_RE = /gen-agy-plugin-package\.js plugins\/dhpk-agy --version=(\d+\.\d+\.\d+)/g;

function agyGeneratorCommand(version) {
  return `gen-agy-plugin-package.js plugins/dhpk-agy --version=${version}`;
}

function findAgyGeneratorPins(text) {
  return [...text.matchAll(new RegExp(AGY_GENERATOR_PIN_RE))].map((match) => ({ pin: match[0], version: match[1] }));
}

function readAgyGeneratorPin(root, relPath) {
  const abs = path.join(root, relPath);
  let text;
  try {
    text = fs.readFileSync(abs, 'utf8');
  } catch (error) {
    throw new Error(`${relPath}: could not read AGY generator pin (${error.message})`);
  }
  const pins = findAgyGeneratorPins(text);
  if (pins.length === 0) {
    throw new Error(`${relPath}: missing AGY generator pin (expected ${agyGeneratorCommand('<X.Y.Z>')})`);
  }
  if (pins.length > 1) {
    throw new Error(`${relPath}: expected exactly one AGY generator pin, found ${pins.length}`);
  }
  return { text, pin: pins[0].pin, version: pins[0].version };
}

function checkAgyGeneratorDocPins(root, targetVersion) {
  const errors = [];
  for (const relPath of AGY_GENERATOR_DOC_PATHS) {
    try {
      const { version } = readAgyGeneratorPin(root, relPath);
      if (version !== targetVersion) {
        errors.push(`${relPath}: AGY generator pin version '${version}' does not match target '${targetVersion}'`);
      }
    } catch (error) {
      errors.push(error.message);
    }
  }
  return errors;
}

function writeAgyGeneratorDocPins(root, version) {
  const replacement = agyGeneratorCommand(version);
  for (const relPath of AGY_GENERATOR_DOC_PATHS) {
    const { text, pin } = readAgyGeneratorPin(root, relPath);
    fs.writeFileSync(path.join(root, relPath), text.replace(pin, replacement));
  }
}

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

  errors.push(...checkAgyGeneratorDocPins(root, targetVersion));

  return { ok: errors.length === 0, errors };
}

module.exports = {
  MANIFEST_PATHS,
  AGY_GENERATOR_DOC_PATHS,
  SEMVER_PATTERN,
  agyGeneratorCommand,
  checkParity,
  writeAgyGeneratorDocPins,
};
