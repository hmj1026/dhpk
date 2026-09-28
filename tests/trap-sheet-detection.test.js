'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const loader = fs.readFileSync(
  path.join(ROOT, 'agent-traps', '_common', 'trap-sheet-loader.md'),
  'utf8'
);
test('DHPK_ACTIVE_MODULES overrides fallback detection', () => {
  assert.ok(loader.includes('read `$DHPK_ACTIVE_MODULES` (comma list) if set; it takes precedence over everything else'));
});

test('fallback detection is limited to project-root manifests and files', () => {
  assert.ok(loader.includes('detect only from PROJECT-ROOT manifests/files via Bash'));
});

test('root package.json emits generic js and Vue dependency keys additionally emit vue', () => {
  assert.ok(loader.includes('a root `package.json` emits the generic `js` signal'));
  assert.ok(loader.includes('a `vue` key present in its `dependencies`, `devDependencies`, or `peerDependencies` additionally emits `vue`'));
});

test('root composer.json or PHP files directly under the root emit php', () => {
  assert.ok(loader.includes('A root `composer.json` or PHP files directly under the repository root (`./*.php`) emits `php`'));
});

test('root xcode project or Swift manifest emits swift and pyproject.toml emits python', () => {
  assert.ok(loader.includes('`*.xcodeproj` / `Package.swift` emits `swift`; `pyproject.toml` emits `python`'));
});

test('next and react remain covered by generic js', () => {
  assert.ok(loader.includes('`next` and `react` keys remain covered by generic `js`'));
});

test('fallback detection does not recurse into vendored trees', () => {
  assert.ok(loader.includes('Detection MUST NOT recurse into `node_modules/`, `vendor/`, or other vendored trees'));
});

test('SessionStart activation is a separate, unchanged mechanism', () => {
  assert.ok(loader.includes("SessionStart's configured/versioned-module activation (`scripts/hooks/session-start.sh`) is a separate, unrelated mechanism and is unchanged by this fallback contract"));
});

run('trap-sheet-detection');
