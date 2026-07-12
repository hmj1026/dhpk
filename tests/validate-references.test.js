'use strict';

// CLI-level behavioral guard for scripts/ci/validate-references.js.
//
// tests/reference-integrity.test.js already exercises the exported
// scanRepo()/scanText() functions in-process against the real tree and
// synthetic strings. This file instead proves the script's *process*
// contract: exit code and stdout/stderr formatting when run as `node
// scripts/ci/validate-references.js`, including whitelist-file loading,
// which the in-process tests never spawn a child process for.

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');

function runReal() {
  const res = spawnSync('node', [path.join(ROOT, 'scripts', 'ci', 'validate-references.js')], {
    encoding: 'utf8',
  });
  return { status: res.status, out: (res.stdout || '') + (res.stderr || '') };
}

test('real repo tree passes with exit 0 and a PASS banner', () => {
  const { status, out } = runReal();
  assert.strictEqual(status, 0, `expected real repo to pass, got:\n${out}`);
  assert.match(out, /PASS \[reference-integrity\]/);
});

function makeTempRepo() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-validate-references-'));
  fs.cpSync(path.join(ROOT, 'scripts'), path.join(tmp, 'scripts'), { recursive: true });
  return tmp;
}

function runValidator(tmp) {
  const res = spawnSync('node', [path.join(tmp, 'scripts', 'ci', 'validate-references.js')], {
    encoding: 'utf8',
  });
  return { status: res.status, out: (res.stdout || '') + (res.stderr || '') };
}

test('a dangling @rules ref in skills/ fails with a FAIL [check 1] line', () => {
  const tmp = makeTempRepo();
  try {
    fs.mkdirSync(path.join(tmp, 'skills', 'demo'), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, 'skills', 'demo', 'SKILL.md'),
      'see @rules/nonexistent-rule.md for details\n'
    );
    const { status, out } = runValidator(tmp);
    assert.strictEqual(status, 1, out);
    assert.match(out, /FAIL \[check 1\]/);
    assert.match(out, /does not resolve to rules\//);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('a dangling ${CLAUDE_PLUGIN_ROOT} path ref in commands/ fails with FAIL [check 3]', () => {
  const tmp = makeTempRepo();
  try {
    fs.mkdirSync(path.join(tmp, 'commands'), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, 'commands', 'demo.md'),
      'exec ${CLAUDE_PLUGIN_ROOT}/scripts/does-not-exist.sh\n'
    );
    const { status, out } = runValidator(tmp);
    assert.strictEqual(status, 1, out);
    assert.match(out, /FAIL \[check 3\]/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('an empty harness tree with no markdown passes cleanly', () => {
  const tmp = makeTempRepo();
  try {
    const { status, out } = runValidator(tmp);
    assert.strictEqual(status, 0, out);
    assert.match(out, /PASS \[reference-integrity\]/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('a whitelisted @rules ref is not flagged by the CLI', () => {
  const tmp = makeTempRepo();
  try {
    fs.mkdirSync(path.join(tmp, 'skills', 'demo'), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, 'skills', 'demo', 'SKILL.md'),
      'see @rules/whitelisted-only-elsewhere.md for details\n'
    );
    fs.writeFileSync(
      path.join(tmp, 'scripts', 'ci', 'reference-integrity-whitelist.json'),
      JSON.stringify({
        rules_refs: [
          { file: 'skills/demo/SKILL.md', target: '@rules/whitelisted-only-elsewhere.md' },
        ],
        brand_backcompat: [],
      })
    );
    const { status, out } = runValidator(tmp);
    assert.strictEqual(status, 0, out);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

run('validate-references');
