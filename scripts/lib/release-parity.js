'use strict';

// Version-parity checks for one release target across every retained
// version-bearing surface: the Claude plugin manifest, root Codex manifest, thin
// Codex wrapper manifest, standard Agent Plugin, native AGY plugin, Cursor
// Plugin manifests plus owner-scoped receipts, marketplace descriptor, the
// tracked generated Claude marketplace package manifest, the CHANGELOG.md
// release heading, and the bilingual AGY generator pin in platform-installation
// SSOT. Composes (does not replace)
// the pairwise manifest parity already covered by
// tests/codex-native-package-validate.test.js.

const fs = require('fs');
const path = require('path');

const {
  declaredOutputs,
  readDeclaredVersion,
  readSourceVersion,
  renderOpenaiSubmissionManifest,
  undeclaredManifests,
  versionBearingPaths,
} = require('./host-manifests');

const SEMVER_PATTERN = /^\d+\.\d+\.\d+$/;

const MANIFEST_PATHS = versionBearingPaths();

const AGY_GENERATOR_DOC_PATHS = [
  'docs/platform-installation.md',
  'docs/platform-installation.zh-TW.md',
];

const AGY_GENERATOR_PIN_RE = /bin\/dhpk distribution agy-plugin generate --output plugins\/dhpk-agy --version=(\d+\.\d+\.\d+) --json/g;

// Directories that `prepare-release.js write` regenerates wholesale, and the
// fragment directory whose promoted entries it deletes. Together with the
// field-patched manifests, doc pins, and CHANGELOG.md they form the complete
// set of paths a release-preparation commit may touch.
const REGENERATED_RELEASE_DIRS = [
  'plugins/dhpk/',
  'plugins/dhpk-agent/',
  'plugins/dhpk-cursor/',
  'plugins/dhpk-agy/',
  'generated/claude-marketplace/package/',
];

const CHANGELOG_FRAGMENT_DIR = 'changelog.d/';

// Release scope as ordered {kind, path} entries: `file` is an exact path,
// `dir` a prefix any change under which is permitted, and `deleted` a prefix
// under which only deletions are permitted.
function releaseScope() {
  const files = ['CHANGELOG.md', ...MANIFEST_PATHS, ...AGY_GENERATOR_DOC_PATHS]
    .filter((relPath) => !REGENERATED_RELEASE_DIRS.some((dir) => relPath.startsWith(dir)));
  return [
    ...files.map((relPath) => ({ kind: 'file', path: relPath })),
    ...REGENERATED_RELEASE_DIRS.map((dir) => ({ kind: 'dir', path: dir })),
    { kind: 'deleted', path: CHANGELOG_FRAGMENT_DIR },
  ];
}

function agyGeneratorCommand(version) {
  return `bin/dhpk distribution agy-plugin generate --output plugins/dhpk-agy --version=${version} --json`;
}

function findAgyGeneratorPins(text) {
  return [...text.matchAll(new RegExp(AGY_GENERATOR_PIN_RE))].map((match) => ({ pin: match[0], version: match[1] }));
}

function readAgyGeneratorPins(root, relPath) {
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
  return { text, pins };
}

function checkAgyGeneratorDocPins(root, targetVersion) {
  const errors = [];
  for (const relPath of AGY_GENERATOR_DOC_PATHS) {
    try {
      const { pins } = readAgyGeneratorPins(root, relPath);
      for (const { version } of pins) {
        if (version !== targetVersion) {
          errors.push(`${relPath}: AGY generator pin version '${version}' does not match target '${targetVersion}'`);
        }
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
    const { text, pins } = readAgyGeneratorPins(root, relPath);
    let updated = text;
    for (const { pin } of pins) {
      updated = updated.split(pin).join(replacement);
    }
    fs.writeFileSync(path.join(root, relPath), updated);
  }
}

function readManifestVersion(root, relPath) {
  if (relPath === 'package.json') return readSourceVersion(root);
  const output = declaredOutputs().find((o) => o.path === relPath);
  return readDeclaredVersion(root, output);
}

function readChangelogHeadingVersion(root, targetVersion) {
  const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
  const pattern = new RegExp(`^## ${targetVersion.replace(/\./g, '\\.')} `, 'm');
  return pattern.test(changelog);
}

// The OpenAI submission manifest has no committed file: it is rendered from the
// listing metadata source and package.json, so its version is the source's.
function checkOpenaiSubmissionManifest(root, targetVersion) {
  try {
    const rendered = renderOpenaiSubmissionManifest(root);
    return rendered.version === targetVersion
      ? []
      : [`openai-submission manifest (rendered): version '${rendered.version}' does not match target '${targetVersion}'`];
  } catch (error) {
    return [`openai-submission manifest (rendered): could not render (${error.message})`];
  }
}

function checkUndeclaredManifests(root) {
  return undeclaredManifests(root).map((rel) => `${rel}: manifest is not declared by any generator (add it to scripts/lib/host-manifests.js)`);
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

  errors.push(...checkOpenaiSubmissionManifest(root, targetVersion));
  errors.push(...checkUndeclaredManifests(root));

  if (!readChangelogHeadingVersion(root, targetVersion)) {
    errors.push(`CHANGELOG.md: no '## ${targetVersion} ' release heading found`);
  }

  errors.push(...checkAgyGeneratorDocPins(root, targetVersion));

  return { ok: errors.length === 0, errors };
}

module.exports = {
  MANIFEST_PATHS,
  REGENERATED_RELEASE_DIRS,
  releaseScope,
  AGY_GENERATOR_DOC_PATHS,
  SEMVER_PATTERN,
  agyGeneratorCommand,
  checkParity,
  writeAgyGeneratorDocPins,
};
