'use strict';

// Dedicated scanner seam exercises deterministic clock and filesystem errors;
// real hook integration belongs to credential-read-policy.test.js.
const { test, run, assert } = require('./_lib/tinytest');
const { ROOT } = require('./_lib/hookharness');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

function python(source) {
  const result = spawnSync('python3', ['-c', source], {
    env: {...process.env, PYTHONPATH: path.join(ROOT, 'scripts/hooks/_lib')}, encoding: 'utf8',
  });
  assert.strictEqual(result.status, 0, result.stderr);
}

test('scanner fails closed when the clock expires or enumeration fails', () => {
  python(`
import tempfile
from credential_scan import scan_roots
with tempfile.TemporaryDirectory() as root:
    times = iter([0, 1])
    result = scan_roots([root], lambda path: set(), set(), False, clock=lambda: next(times))
    assert result[0] == 'time limit', result
    times = iter([0] + [0.300] * 100)
    result = scan_roots([root], lambda path: set(), set(), False, clock=lambda: next(times))
    assert result[0] is None, result
    def denied(path):
        raise PermissionError('private details')
    result = scan_roots([root], lambda path: set(), set(), False, scandir=denied)
    assert result[0] == 'unreadable or unsafe path', result
    assert 'private details' not in str(result), result
`);
});

test('scanner counts entries across all roots and stops after 20000', () => {
  python(`
import os, tempfile
from credential_scan import scan_roots
with tempfile.TemporaryDirectory() as root:
    for directory in ('a', 'b'):
        os.mkdir(os.path.join(root, directory))
    for i in range(20000):
        open(os.path.join(root, 'a' if i < 10000 else 'b', str(i)), 'w').close()
    roots = [os.path.join(root, 'a'), os.path.join(root, 'b')]
    args = (roots, lambda path: set(), set(), False)
    assert scan_roots(*args, clock=lambda: 0)[0] is None
    open(os.path.join(root, 'b', 'extra'), 'w').close()
    assert scan_roots(*args, clock=lambda: 0)[0] == 'entry limit'
`);
});

run('credential-scan');
