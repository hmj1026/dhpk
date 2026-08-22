'use strict';

// RED-first guard for the migration boundary: CI/release invoke the public
// facade while retaining the legacy distribution compatibility checks.

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), 'utf8');
}

test('CI invokes the harness facade and keeps compatibility adapters', () => {
  const workflow = read('.github/workflows/ci.yml');
  assert.match(workflow, /bin\/dhpk harness/);
  assert.match(workflow, /bin\/dhpk distribution/);
});

test('release invokes the harness facade before publish and retains consumer gate', () => {
  const workflow = read('.github/workflows/release.yml');
  assert.match(workflow, /bin\/dhpk harness/);
  assert.match(workflow, /consumer-gate\.js/);
});

run('harness-workflow-config');
