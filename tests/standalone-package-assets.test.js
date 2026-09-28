'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const { collectStandalonePackageAssets } = require('../scripts/lib/standalone-package-assets');

function withFixture(callback) {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'dhpk-standalone-assets-'));
  try {
    const source = path.join(root, 'rules', 'policy.md');
    fs.mkdirSync(path.dirname(source), { recursive: true });
    fs.writeFileSync(source, 'policy\n');
    fs.chmodSync(source, 0o640);
    return callback({ root, source, content: Buffer.from('policy\n'), mode: fs.statSync(source).mode & 0o7777 });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function selection(files, supportingAssetIds = []) {
  return {
    selectionMode: 'standalone',
    dependencyClosure: { files, supportingAssetIds },
  };
}

test('collects complete declared dependency and supporting-asset records', () => {
  withFixture(({ root, source, content, mode }) => {
    const inventory = {
      supporting_assets: [{ id: 'policy-bundle', source: 'rules/policy.md', destination: 'assets/policy.md' }],
    };
    const assets = collectStandalonePackageAssets({
      root,
      inventory,
      profileSelection: selection(
        [{ source: 'rules/policy.md', destination: 'rules/policy.md' }],
        ['policy-bundle'],
      ),
    });
    assert.deepStrictEqual(assets, [
      {
        stableId: 'standalone:supporting-asset:policy-bundle',
        source: 'rules/policy.md',
        destination: 'assets/policy.md',
        path: source,
        content,
        mode,
      },
      {
        stableId: 'standalone:dependency:rules/policy.md',
        source: 'rules/policy.md',
        destination: 'rules/policy.md',
        path: source,
        content,
        mode,
      },
    ]);
  });
});

test('rejects unsafe standalone source paths', () => {
  withFixture(({ root }) => {
    assert.throws(
      () => collectStandalonePackageAssets({
        root,
        profileSelection: selection([{ source: '../outside.md', destination: 'outside.md' }]),
      }),
      /dependency path is unsafe/,
    );
  });
});

test('rejects unsafe standalone destinations', () => {
  withFixture(({ root }) => {
    assert.throws(
      () => collectStandalonePackageAssets({
        root,
        profileSelection: selection([{ source: 'rules/policy.md', destination: '../outside.md' }]),
      }),
      /destination is unsafe/,
    );
  });
});

test('rejects destinations shared by declared files and supporting assets', () => {
  withFixture(({ root }) => {
    assert.throws(
      () => collectStandalonePackageAssets({
        root,
        inventory: {
          supporting_assets: [{ id: 'same-destination', source: 'rules/policy.md', destination: 'rules/policy.md' }],
        },
        profileSelection: selection(
          [{ source: 'rules/policy.md', destination: 'rules/policy.md' }],
          ['same-destination'],
        ),
      }),
      /destinations collide/,
    );
  });
});

test('rejects supporting asset IDs absent from the inventory', () => {
  withFixture(({ root }) => {
    assert.throws(
      () => collectStandalonePackageAssets({
        root,
        inventory: { supporting_assets: [] },
        profileSelection: selection([], ['missing-asset']),
      }),
      /supporting asset is not present in inventory: missing-asset/,
    );
  });
});

test('rejects symlinked source files', () => {
  withFixture(({ root }) => {
    fs.symlinkSync('rules/policy.md', path.join(root, 'policy-link.md'));
    assert.throws(
      () => collectStandalonePackageAssets({
        root,
        profileSelection: selection([{ source: 'policy-link.md', destination: 'policy-link.md' }]),
      }),
      /path contains a symlink/,
    );
  });
});

test('rejects symlinked source directory ancestors', () => {
  withFixture(({ root }) => {
    fs.symlinkSync('rules', path.join(root, 'rules-link'));
    assert.throws(
      () => collectStandalonePackageAssets({
        root,
        profileSelection: selection([{ source: 'rules-link/policy.md', destination: 'policy.md' }]),
      }),
      /path contains a symlink/,
    );
  });
});

run('standalone-package-assets');
