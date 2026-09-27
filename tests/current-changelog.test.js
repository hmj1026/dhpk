'use strict';

// The current release must have exactly one changelog section. A duplicate
// heading makes extract-notes.sh select only the first body and can silently
// publish incomplete release notes.

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const version = JSON.parse(fs.readFileSync(
  path.join(ROOT, '.claude-plugin', 'plugin.json'),
  'utf8',
)).version;

function currentVersionHeadings(text) {
  const escapedVersion = version.split('.').join('\\.');
  const heading = new RegExp(`^## ${escapedVersion}(?= )`, 'gm');
  return text.match(heading) || [];
}

test('current release has one changelog section', () => {
  const controlled = `## ${version} — exact\n\n## ${version}.1 — longer version\n`;
  assert.deepStrictEqual(currentVersionHeadings(controlled), [`## ${version}`]);

  const changelog = fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8');
  const matches = currentVersionHeadings(changelog);
  assert.strictEqual(matches.length, 1,
    `expected exactly one CHANGELOG.md heading for ${version}, found ${matches.length}`);
});

run('current-changelog');
