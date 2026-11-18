'use strict';

// Publication conformance rules for a built Published Package.  Pure: takes the
// package as a Map of relative path to Buffer so the same rules run on a
// compiled tree, an extracted ZIP, or a directory read.  Later tickets add rules.

const MANIFEST_PATHS = Object.freeze(['plugin.json', '.codex-plugin/plugin.json']);

function readManifest(files, manifestPath, errors) {
  if (!files.has(manifestPath)) return null;
  try {
    return JSON.parse(files.get(manifestPath).toString('utf8'));
  } catch {
    errors.push(`${manifestPath} is not valid JSON`);
    return null;
  }
}

function hookPaths(files) {
  return [...files.keys()].filter((file) => file.split('/').includes('hooks') || /(^|\/)hooks\.json$/.test(file));
}

// Public Plugin: OpenAI skills-only package. No hooks; version equals package.json.
function checkPublicPlugin(files, { version } = {}) {
  if (!(files instanceof Map)) return ['Public Plugin files must be a Map of path to Buffer'];
  const errors = [];
  if (!files.has('plugin.json')) errors.push('Public Plugin is missing plugin.json');

  for (const file of hookPaths(files)) errors.push(`Public Plugin must not contain hooks: ${file}`);

  for (const manifestPath of MANIFEST_PATHS) {
    const manifest = readManifest(files, manifestPath, errors);
    if (!manifest || typeof manifest !== 'object') continue;
    if (Object.prototype.hasOwnProperty.call(manifest, 'hooks')) {
      errors.push(`Public Plugin must not declare hooks in ${manifestPath}`);
    }
    if (manifest.version !== version) {
      errors.push(`${manifestPath} version ${manifest.version} must equal package.json version ${version}`);
    }
  }
  return errors;
}

module.exports = { checkPublicPlugin };
