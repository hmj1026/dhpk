'use strict';

// Coverage for scripts/check-portability.sh — static portability gate:
// bash -n syntax check + grep for bash4/GNU-only idioms across
// scripts/**/*.sh and modules/**/*.sh.

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'check-portability.sh');

test('bash -n syntax check passes', () => {
  const res = spawnSync('bash', ['-n', SCRIPT], { encoding: 'utf8' });
  assert.strictEqual(res.status, 0, res.stderr);
});

test('current repo scripts pass the portability gate (exit 0)', () => {
  const res = spawnSync('bash', [SCRIPT], { cwd: ROOT, encoding: 'utf8', timeout: 60000 });
  assert.strictEqual(res.status, 0, `expected clean pass, got status ${res.status}\n${res.stderr}`);
  assert.ok(res.stdout.includes('OK'), res.stdout);
});

test('flags a non-portable idiom (declare -A) in a fixture plugin tree', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'check-portability-'));
  try {
    fs.mkdirSync(path.join(tmp, 'scripts'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'modules'), { recursive: true });
    fs.copyFileSync(SCRIPT, path.join(tmp, 'scripts', 'check-portability.sh'));
    fs.writeFileSync(
      path.join(tmp, 'scripts', 'bad.sh'),
      '#!/usr/bin/env bash\ndeclare -A foo\necho "${foo[bar]}"\n'
    );
    const res = spawnSync('bash', [path.join(tmp, 'scripts', 'check-portability.sh')], {
      cwd: tmp,
      encoding: 'utf8',
      timeout: 10000,
    });
    assert.strictEqual(res.status, 1, res.stdout + res.stderr);
    assert.ok(res.stderr.includes("NON-PORTABLE IDIOM 'declare -A'"), res.stderr);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('flags a bash syntax error in a fixture plugin tree', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'check-portability-'));
  try {
    fs.mkdirSync(path.join(tmp, 'scripts'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'modules'), { recursive: true });
    fs.copyFileSync(SCRIPT, path.join(tmp, 'scripts', 'check-portability.sh'));
    fs.writeFileSync(path.join(tmp, 'scripts', 'broken.sh'), '#!/usr/bin/env bash\nif [ 1 -eq 1 ]; then\necho "no fi"\n');
    const res = spawnSync('bash', [path.join(tmp, 'scripts', 'check-portability.sh')], {
      cwd: tmp,
      encoding: 'utf8',
      timeout: 10000,
    });
    assert.strictEqual(res.status, 1, res.stdout + res.stderr);
    assert.ok(res.stderr.includes('SYNTAX FAIL'), res.stderr);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('reports "no scripts found" and exits 1 when run outside scripts/modules trees', () => {
  // PLUGIN_ROOT is derived from dirname($0)/.., so placing the copy outside a
  // scripts/ dir means the "$PLUGIN_ROOT/scripts" and "$PLUGIN_ROOT/modules"
  // find roots exist-but-empty (or don't exist) — no .sh files found at all,
  // including no self-match, so the empty-result branch fires.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'check-portability-'));
  try {
    fs.mkdirSync(path.join(tmp, 'other'), { recursive: true });
    fs.copyFileSync(SCRIPT, path.join(tmp, 'other', 'check-portability.sh'));
    const res = spawnSync('bash', [path.join(tmp, 'other', 'check-portability.sh')], {
      cwd: tmp,
      encoding: 'utf8',
      timeout: 10000,
    });
    assert.strictEqual(res.status, 1, res.stdout + res.stderr);
    assert.ok(res.stdout.includes('no scripts found'), res.stdout);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

function gateOnFixture(scriptBody) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'check-portability-'));
  try {
    fs.mkdirSync(path.join(tmp, 'scripts'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'modules'), { recursive: true });
    fs.copyFileSync(SCRIPT, path.join(tmp, 'scripts', 'check-portability.sh'));
    fs.writeFileSync(path.join(tmp, 'scripts', 'fixture.sh'), scriptBody);
    return spawnSync('bash', [path.join(tmp, 'scripts', 'check-portability.sh')], {
      cwd: tmp,
      encoding: 'utf8',
      timeout: 30000,
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

test('flags a large file whose idiom sits early (no SIGPIPE false negative)', () => {
  // grep -q exits at the first hit; a pipe from printf would then fail under
  // pipefail and hide the idiom once the text exceeds the pipe buffer.
  const padding = 'echo padding line to push the file past the pipe buffer size\n'.repeat(8000);
  const res = gateOnFixture(`#!/usr/bin/env bash\ndeclare -A early\n${padding}`);
  assert.strictEqual(res.status, 1, res.stdout + res.stderr);
  assert.ok(res.stderr.includes("NON-PORTABLE IDIOM 'declare -A'"), res.stderr);
});

test('flags mapfile and readarray used as commands', () => {
  for (const line of ['mapfile -t rows < input.txt', 'if true; then readarray -t rows < input.txt; fi']) {
    const res = gateOnFixture(`#!/usr/bin/env bash\n${line}\n`);
    assert.strictEqual(res.status, 1, `${line}\n${res.stdout}${res.stderr}`);
    assert.ok(res.stderr.includes("NON-PORTABLE IDIOM 'mapfile/readarray'"), res.stderr);
  }
});

test('treats builtin names in case patterns and regexes as data', () => {
  const res = gateOnFixture([
    '#!/usr/bin/env bash',
    'case "$1" in',
    '    mapfile|readarray) echo builtin ;;',
    'esac',
    "re_kw='(^|[^A-Za-z0-9_])(declare|readarray|mapfile|compgen)([^A-Za-z0-9_]|$)'",
    '',
  ].join('\n'));
  assert.strictEqual(res.status, 0, res.stdout + res.stderr);
});

test('flags positional and indirect case-conversion expansions', () => {
  for (const expansion of ['${1,,}', '${!name^^}']) {
    const res = gateOnFixture(`#!/usr/bin/env bash\nx="${expansion}"\n`);
    assert.strictEqual(res.status, 1, `${expansion}\n${res.stdout}${res.stderr}`);
    assert.ok(res.stderr.includes('NON-PORTABLE IDIOM'), res.stderr);
  }
});

run('check-portability');
