'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');

test('fast-worker selector has one aggregate test entry and an explicit catalog mapping', () => {
  const wrapper = path.join(ROOT, 'tests', 'fast-worker-selector.test.js');
  assert.strictEqual(fs.existsSync(wrapper), false, 'the forwarding wrapper must not be discovered twice');
  const catalogSource = fs.readFileSync(path.join(ROOT, 'scripts', 'ci', 'catalog.js'), 'utf8');
  assert.match(catalogSource, /['"]scripts\/fast-worker-selector\.js['"]\s*:\s*['"]fast-worker-selection\.test\.js['"]/);
  const result = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'ci', 'catalog.js'), '--check'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /fast-worker-selector\.js/);
});

test('session-start advisories own advise-once and detect-stack-hints without forwarding wrappers', () => {
  const wrappers = ['advise-once.test.js', 'detect-stack-hints.test.js'];
  for (const name of wrappers) {
    assert.strictEqual(
      fs.existsSync(path.join(ROOT, 'tests', name)),
      false,
      `${name} must not re-enter session-start-advisories.test.js`,
    );
  }
  const catalogSource = fs.readFileSync(path.join(ROOT, 'scripts', 'ci', 'catalog.js'), 'utf8');
  assert.match(
    catalogSource,
    /['"]scripts\/hooks\/_lib\/advise-once\.sh['"]\s*:\s*['"]session-start-advisories\.test\.js['"]/,
  );
  assert.match(
    catalogSource,
    /['"]scripts\/hooks\/_lib\/detect-stack-hints\.sh['"]\s*:\s*['"]session-start-advisories\.test\.js['"]/,
  );
  const result = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'ci', 'catalog.js'), '--check'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /advise-once\.sh|detect-stack-hints\.sh/);
});

run('test-entrypoint-dedup');
