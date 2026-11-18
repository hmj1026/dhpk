'use strict';

// command-inspect.sh is split into sourced modules so each source file stays
// under the 256 KiB directory-review limit (#1501).

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');

const LIB = path.join(__dirname, '..', 'scripts', 'hooks', '_lib');
const LIMIT = 256 * 1024;
const entry = fs.readFileSync(path.join(LIB, 'command-inspect.sh'), 'utf8');
const sourced = [...entry.matchAll(/^\. "\$_dhpk_ci_mod_dir\/(command-inspect-[a-z]+\.sh)"$/gm)].map((m) => m[1]);

test('command-inspect.sh sources its sibling modules', () => {
  assert.ok(sourced.length >= 2, 'expected sibling module sources');
  for (const name of sourced) assert.ok(fs.existsSync(path.join(LIB, name)), `missing ${name}`);
});

test('every command-inspect source file is under 256 KiB', () => {
  for (const name of ['command-inspect.sh', ...sourced]) {
    const size = fs.statSync(path.join(LIB, name)).size;
    assert.ok(size < LIMIT, `${name} is ${size} bytes`);
  }
});

run('command-inspect-modules');
