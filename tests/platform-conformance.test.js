'use strict';

// Thin platform format conformance only. Consumer command behavior is covered
// by the executable consumer-probe suites.

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const { createHostProjectionConformance } = require('./_lib/host-projection-conformance');

const ROOT = path.join(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const manifest = (relative) => JSON.parse(read(relative));
const PLATFORM_CONFORMANCE = createHostProjectionConformance({ root: ROOT, assert });

test('four platforms retain their projected manifest format contracts', () => {
  assert.deepStrictEqual(PLATFORM_CONFORMANCE.map((entry) => entry.platform), ['claude', 'codex', 'agy', 'cursor']);
  for (const entry of PLATFORM_CONFORMANCE) {
    const value = manifest(entry.manifest);
    entry.assertFormat(value);
  }
});

run('platform-conformance');
