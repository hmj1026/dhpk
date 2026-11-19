'use strict';

// Cursor `--plan --json` post-processor (js-projection-journal stage 4).
//
// The Python shell entry (scripts/hooks/install-cursor-harness.sh) re-read the
// plan report and added `cursor_marketplace_hash_cache_drift` warnings for
// every ~/.cursor/plugins/cache/dhpk/dhpk/<hash>/.claude-plugin/plugin.json
// whose version is not one the project trusts: the plugin version in the
// report and the two local Cursor package manifests. This is that step as a
// pure function of the report and the environment; the adapter calls it before
// printing a Cursor plan (codex.js printJsonReport).
//
// Two intentional deviations from the Python program, both on input it could
// not handle: a cache plugin.json with invalid UTF-8 is read with replacement
// characters (Python raised UnicodeDecodeError and lost the report), and one
// holding NaN or Infinity is rejected by pyJsonLoads and so ignored (Python's
// json.load accepted them). Neither occurs in a manifest Cursor writes.

const fs = require('node:fs');
const { isDict, isDirFollow, pyJsonLoads, pySorted } = require('./python-compat');

const DRIFT_MESSAGE = 'Cursor marketplace hash cache is not SSOT; local packages '
  + 'and the project-local receipt are. Disable/remove the '
  + 'marketplace dhpk plugin in Cursor UI. Do not hand-delete '
  + 'the hash cache unless Cursor has already uninstalled that '
  + 'marketplace plugin.';

// posixpath.join: components are joined with "/" and never normalized, so a
// HOME with a trailing slash or dots is reported exactly as given.
function pyJoin(...parts) {
  let result = parts[0];
  for (const part of parts.slice(1)) {
    if (part.startsWith('/')) result = part;
    else if (result === '' || result.endsWith('/')) result += part;
    else result += `/${part}`;
  }
  return result;
}

// The manifest's non-empty string `version`, or null when the file is missing,
// unreadable, not JSON, not an object, or has no such version.
function readVersion(file) {
  try {
    const manifest = pyJsonLoads(fs.readFileSync(file, 'utf8'));
    return isDict(manifest) && typeof manifest.version === 'string' && manifest.version ? manifest.version : null;
  } catch (error) {
    if (error && (error.name === 'ValueError' || error.code)) return null;
    throw error;
  }
}

// glob(<cacheRoot>/*/.claude-plugin/plugin.json): `*` skips dot-names and the
// rest of the path only has to exist (a dangling link counts, as in glob).
function cacheManifests(cacheRoot) {
  let names;
  try {
    names = fs.readdirSync(cacheRoot);
  } catch (error) {
    return [];
  }
  const found = [];
  for (const name of names) {
    if (name.startsWith('.')) continue;
    const manifest = pyJoin(cacheRoot, name, '.claude-plugin', 'plugin.json');
    try {
      fs.lstatSync(manifest);
    } catch (error) {
      continue;
    }
    found.push(manifest);
  }
  return pySorted(found);
}

// Returns a copy of `report` whose `warnings` holds its object warnings plus a
// drift warning per cached marketplace plugin.json with an untrusted version.
function addCursorCacheDriftWarnings(report, env = process.env) {
  const home = env.HOME || '';
  const cacheRoot = pyJoin(home, '.cursor', 'plugins', 'cache', 'dhpk', 'dhpk');
  const localManifests = [
    pyJoin(home, '.cursor', 'plugins', 'local', 'dhpk-agent', 'plugin.json'),
    pyJoin(home, '.cursor', 'plugins', 'local', 'dhpk-cursor', '.cursor-plugin', 'plugin.json'),
  ];
  const ssot = new Set();
  if (typeof report.plugin_version === 'string' && report.plugin_version) ssot.add(report.plugin_version);
  for (const manifest of localManifests) {
    const version = readVersion(manifest);
    if (version) ssot.add(version);
  }
  const warnings = (Array.isArray(report.warnings) ? report.warnings : []).filter(isDict);
  if (ssot.size > 0 && isDirFollow(cacheRoot)) {
    for (const manifest of cacheManifests(cacheRoot)) {
      const cacheVersion = readVersion(manifest);
      if (cacheVersion && !ssot.has(cacheVersion)) {
        warnings.push({
          code: 'cursor_marketplace_hash_cache_drift',
          path: manifest,
          cache_version: cacheVersion,
          ssot_versions: pySorted(ssot),
          message: DRIFT_MESSAGE,
        });
      }
    }
  }
  return { ...report, warnings };
}

module.exports = { addCursorCacheDriftWarnings };
