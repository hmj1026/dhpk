'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');

const { compareHarnesses } = require('../scripts/lib/cross-cli-parity');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-cross-cli-parity-'));
  fs.mkdirSync(path.join(root, '.claude', 'skills'), { recursive: true });
  fs.mkdirSync(path.join(root, '.codex', 'skills'), { recursive: true });
  return root;
}

test('reports content differences and source-only files', () => {
  const root = fixture();
  try {
    fs.writeFileSync(path.join(root, '.claude', 'skills', 'same.md'), 'canonical\n');
    fs.writeFileSync(path.join(root, '.codex', 'skills', 'same.md'), 'stale\n');
    fs.writeFileSync(path.join(root, '.claude', 'skills', 'missing.md'), 'new\n');
    const result = compareHarnesses(root);
    assert.deepStrictEqual(result.different, ['skills/same.md']);
    assert.deepStrictEqual(result.missing, ['skills/missing.md']);
    assert.strictEqual(result.drift, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('target-only files and explicit allowlist entries do not create false drift', () => {
  const root = fixture();
  try {
    fs.writeFileSync(path.join(root, '.claude', 'skills', 'shared.md'), 'canonical\n');
    fs.writeFileSync(path.join(root, '.codex', 'skills', 'shared.md'), 'stale\n');
    fs.writeFileSync(path.join(root, '.codex', 'skills', 'native.md'), 'native\n');

    const unallowlisted = compareHarnesses(root);
    assert.deepStrictEqual(unallowlisted.different, ['skills/shared.md']);
    assert.deepStrictEqual(unallowlisted.missing, []);
    assert.strictEqual(unallowlisted.drift, true);

    fs.writeFileSync(path.join(root, '.cross-cli-allowlist.json'), JSON.stringify({ '.codex': ['skills/shared.md'] }));
    const result = compareHarnesses(root);
    assert.deepStrictEqual(result.different, []);
    assert.deepStrictEqual(result.missing, []);
    assert.strictEqual(result.source_files, 1);
    assert.strictEqual(result.target_files, 2);
    assert.strictEqual(result.drift, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

run('cross-cli-parity');
