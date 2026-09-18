'use strict';

// macOS resolves os.tmpdir() to /var/folders/... and /var is a symlink to
// /private/var. Package generators deliberately refuse symlinked ancestors
// (fail-closed provenance binding), so a symlinked temp root made 17 package
// and consumer test files fail on macOS while passing on Linux CI. The test
// harness must therefore hand every test process a physical temp root instead
// of relaxing that guard.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');

function symlinkedAncestor(dir) {
  let current = path.resolve(dir);
  for (;;) {
    if (fs.lstatSync(current).isSymbolicLink()) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

test('the test harness exposes a temp root with no symlinked ancestor', () => {
  const tmp = os.tmpdir();
  assert.strictEqual(symlinkedAncestor(tmp), null,
    `os.tmpdir() '${tmp}' still resolves through a symlink; package generators refuse it`);
});

test('the normalized temp root is usable for mkdtemp', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-physical-tmpdir-'));
  try {
    assert.strictEqual(symlinkedAncestor(dir), null,
      `mkdtemp under '${os.tmpdir()}' produced a symlinked path`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

run('physical-tmpdir');
