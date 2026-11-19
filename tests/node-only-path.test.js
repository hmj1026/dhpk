'use strict';

// Guard for the node-only PATH shared by the consumer and harness CLI tests:
// globally installed agent CLIs must not leak onto it.

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const { NODE_BASH_ONLY_PATH } = require('./_lib/node-only-path');

function resolveOnPath(name) {
  for (const dir of NODE_BASH_ONLY_PATH.split(path.delimiter)) {
    const candidate = path.join(dir, name);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch (_error) {
      // Not present or not executable in this entry.
    }
  }
  return null;
}

for (const cli of ['claude', 'codex', 'cursor-agent', 'agy']) {
  test(`${cli} does not resolve on the node-only PATH`, () => {
    assert.strictEqual(resolveOnPath(cli), null);
  });
}

test('node resolves on the node-only PATH', () => {
  assert.ok(resolveOnPath('node'));
});

run('node-only-path');
