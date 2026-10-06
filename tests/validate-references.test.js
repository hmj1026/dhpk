'use strict';

// CLI-level behavioral guard for scripts/ci/validate-references.js.
//
// The in-process block below exercises exported scanRepo()/scanText() behavior
// against the real tree and synthetic references. The owner cases also prove the
// script's process contract: exit code and stdout/stderr formatting, including
// whitelist-file loading.

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
      })
    );
    const { status, out } = runValidator(tmp);
    assert.strictEqual(status, 0, out);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});


// Consolidated from tests/reference-integrity.test.js; test registrations remain isolated in this lexical block.
{
  // Reference-integrity guard test. Proves the checker both (a) passes clean on
  // the real repo tree — every dangling ref found by the harness-consistency-audit
  // is fixed — and (b) actually catches the defect classes it exists to prevent
  // (dangling @rules refs, unresolvable /dhpk: refs, dangling ${CLAUDE_PLUGIN_ROOT}
  // paths, and unresolved natural-language capability references). The assertions
  // stand in for running against a tree with those defects.

  const { scanRepo, scanText } = require('../scripts/ci/validate-references');
  const { test, assert } = require('./_lib/tinytest');

  // (1) GREEN on the real tree.
  test('real tree has zero reference-integrity findings', () => {
    const findings = scanRepo();
    const detail = findings
      .map((f) => `  [check ${f.check}] ${f.file}: ${f.detail}`)
      .join('\n');
    assert.strictEqual(findings.length, 0, `expected 0 findings, got ${findings.length}:\n${detail}`);
  });

  // (2) RED-capable: each resource-integrity check flags its defect class.
  function checksHit(text) {
    return new Set(scanText('synthetic/fixture.md', text).map((f) => f.check));
  }

  test('check 1 flags a dangling @rules ref', () => {
    assert.ok(checksHit('see @rules/nonexistent-rule.md for details').has(1));
  });

  test('check 2 flags an unresolvable /dhpk command ref', () => {
    assert.ok(checksHit('run /dhpk:totally-not-a-command now').has(2));
  });

  test('check 3 flags a dangling ${CLAUDE_PLUGIN_ROOT} path ref', () => {
    assert.ok(checksHit('exec ${CLAUDE_PLUGIN_ROOT}/scripts/does-not-exist.sh').has(3));
  });

  // (3) No false positives on legitimate / intentional refs.
  test('resolvable and intentional refs are not flagged', () => {
    const text = [
      'rule @rules/execution-policy.md',                       // resolves to rules/
      'consumer override @rules/dev-workflow-project.md',      // *-project.md convention
      'command /dhpk:setup',                           // resolves to commands/
      'path ${CLAUDE_PLUGIN_ROOT}/rules/execution-policy.md',  // resolves
      'placeholder ${CLAUDE_PLUGIN_ROOT}/rules/<file>.md',     // placeholder, skipped
    ].join('\n');
    const findings = scanText('synthetic/clean.md', text);
    const detail = findings.map((f) => `  [check ${f.check}] ${f.detail}`).join('\n');
    assert.strictEqual(findings.length, 0, `expected 0 findings, got:\n${detail}`);
  });
}

run('validate-references');
