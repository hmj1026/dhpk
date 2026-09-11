'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const { collectStandalonePackageAssets } = require('../scripts/lib/standalone-package-assets');

test('collects only the declared standalone files and rejects unsafe sources', () => {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'dhpk-standalone-assets-'));
  try {
    fs.mkdirSync(path.join(root, 'rules'), { recursive: true });
    fs.writeFileSync(path.join(root, 'rules', 'policy.md'), 'policy\n');
    const selection = {
      selectionMode: 'standalone',
      dependencyClosure: {
        files: [{ source: 'rules/policy.md', destination: 'rules/policy.md' }],
        supportingAssetIds: [],
      },
    };
    const assets = collectStandalonePackageAssets({ root, profileSelection: selection });
    assert.deepStrictEqual(assets.map((asset) => asset.destination), ['rules/policy.md']);
    assert.strictEqual(assets[0].content.toString('utf8'), 'policy\n');

    assert.throws(
      () => collectStandalonePackageAssets({
        root,
        profileSelection: {
          ...selection,
          dependencyClosure: { files: [{ source: '../outside.md', destination: 'outside.md' }] },
        },
      }),
      /unsafe/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

run('standalone-package-assets');
