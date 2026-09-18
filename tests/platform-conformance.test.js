'use strict';

// Thin platform conformance only: each row checks the platform's projected
// manifest shape and the one consumer invocation owned by that adapter. The
// shared fallback behavior and runtime proof belong to separate suites; this
// table intentionally has no host/worker/model matrix.

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const { createHostProjectionConformance } = require('./_lib/host-projection-conformance');

const ROOT = path.join(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const manifest = (relative) => JSON.parse(read(relative));
const PLATFORM_CONFORMANCE = createHostProjectionConformance({ root: ROOT, assert });

test('four platforms have thin table-driven format and invocation conformance', () => {
  assert.deepStrictEqual(PLATFORM_CONFORMANCE.map((entry) => entry.platform), ['claude', 'codex', 'agy', 'cursor']);
  for (const entry of PLATFORM_CONFORMANCE) {
    const value = manifest(entry.manifest);
    entry.assertFormat(value);
    assert.match(read(entry.invocationSource), entry.invocation, `${entry.platform} invocation contract`);
  }
});

run('platform-conformance');
