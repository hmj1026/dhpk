'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'scripts', 'ci', 'validate-skill-purpose-decisions.js');

function runCli(root) {
  const res = spawnSync('node', [path.join(root, 'scripts', 'ci', 'validate-skill-purpose-decisions.js')], {
    encoding: 'utf8',
  });
  return { status: res.status, out: `${res.stdout || ''}${res.stderr || ''}` };
}

test('real CI validator CLI exits 0 and reports PASS for the checked-in ledger', () => {
  const { status, out } = runCli(ROOT);
  assert.strictEqual(status, 0, out);
  assert.match(out, /PASS \[skill-purpose-decisions\]:/);
});

test('malformed isolated ledger fails through the real CLI with an actionable ledger error', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-skill-purpose-decisions-'));
  try {
    const files = [
      'scripts/ci/validate-skill-purpose-decisions.js',
      'scripts/ci/_lib/report.js',
      'scripts/ci/_lib/frontmatter.js',
      'scripts/lib/skill-purpose-decisions.js',
      'manifests/distribution-inventory.json',
    ];
    for (const rel of files) {
      const destination = path.join(tmp, rel);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(path.join(ROOT, rel), destination);
    }

    const ledgerPath = path.join(tmp, 'manifests', 'skill-purpose-decisions.json');
    fs.writeFileSync(ledgerPath, '{ "schema": ');

    const { status, out } = runCli(tmp);
    assert.strictEqual(status, 1, out);
    assert.match(out, /ERROR \[skill-purpose-decisions\]: manifests\/skill-purpose-decisions\.json cannot be read:/);
    assert.match(out, /JSON|Unexpected end|end of JSON/i);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

run('validate-skill-purpose-decisions');
