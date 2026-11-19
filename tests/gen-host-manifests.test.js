'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const { run: syncVersions } = require('../scripts/ci/gen-host-manifests');
const { syncedOutputs, LISTING_METADATA } = require('../scripts/lib/host-manifests');

const LISTING = {
  name: 'dhpk',
  author: { name: 'someone' },
  homepage: 'https://example.test',
  license: 'MIT',
  packages: {
    'claude-core': { displayName: 'Core', description: 'core text', keywords: ['one'] },
    'claude-stacks': { displayName: 'Stacks', description: 'stacks text', keywords: ['two'] },
    'claude-marketplace': {
      description: 'market text',
      plugins: { dhpk: 'core entry', 'dhpk-stacks': 'stacks entry' },
    },
  },
};

function body(output, manifestVersion) {
  if (output.listing === 'claude-marketplace') {
    return { name: 'dhpk', description: 'old', plugins: [{ name: 'dhpk', source: './a', description: 'old' }, { name: 'dhpk-stacks', source: './b', description: 'old' }] };
  }
  return { name: 'dhpk', version: manifestVersion, description: 'old', keywords: ['old'], keep: true };
}

function mkRepo(version, manifestVersion) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-host-manifests-'));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'dhpk', version }));
  fs.mkdirSync(path.join(root, path.dirname(LISTING_METADATA)), { recursive: true });
  fs.writeFileSync(path.join(root, LISTING_METADATA), JSON.stringify(LISTING));
  for (const output of syncedOutputs()) {
    const abs = path.join(root, output.path);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, JSON.stringify(body(output, manifestVersion)));
  }
  return root;
}

function readJson(root, rel) {
  return JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
}

function quietly(fn) {
  const log = console.log;
  const error = console.error;
  console.log = () => {};
  console.error = () => {};
  try { return fn(); } finally { console.log = log; console.error = error; }
}

function inSyncRepo() {
  const root = mkRepo('2.0.0', '1.0.0');
  quietly(() => syncVersions(root, { check: false }));
  return root;
}

test('--check fails when a version-sync manifest lags package.json', () => {
  const root = mkRepo('2.0.0', '1.0.0');
  try {
    assert.strictEqual(quietly(() => syncVersions(root, { check: true })), 1);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('write brings every version-sync manifest to package.json and keeps other fields', () => {
  const root = inSyncRepo();
  try {
    assert.strictEqual(quietly(() => syncVersions(root, { check: true })), 0);
    const claude = readJson(root, '.claude-plugin/plugin.json');
    assert.strictEqual(claude.version, '2.0.0');
    assert.strictEqual(claude.keep, true);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('write fills description and listing fields for core, stacks, and the marketplace entries from the listing metadata', () => {
  const root = inSyncRepo();
  try {
    const core = readJson(root, '.claude-plugin/plugin.json');
    assert.strictEqual(core.description, 'core text');
    assert.strictEqual(core.displayName, 'Core');
    assert.deepStrictEqual(core.keywords, ['one']);
    assert.strictEqual(core.homepage, 'https://example.test');
    assert.strictEqual(readJson(root, 'distribution/stacks-plugin/plugin.json').description, 'stacks text');
    const market = readJson(root, '.claude-plugin/marketplace.json');
    assert.strictEqual(market.description, 'market text');
    assert.deepStrictEqual(market.owner, { name: 'someone' });
    assert.deepStrictEqual(market.plugins.map((p) => p.description), ['core entry', 'stacks entry']);
    assert.strictEqual(market.plugins[0].source, './a');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('--check catches a hand-edited description in a Host manifest', () => {
  for (const rel of ['.claude-plugin/plugin.json', 'distribution/stacks-plugin/plugin.json']) {
    const root = inSyncRepo();
    try {
      const manifest = readJson(root, rel);
      fs.writeFileSync(path.join(root, rel), JSON.stringify({ ...manifest, description: 'routed commands' }));
      assert.strictEqual(quietly(() => syncVersions(root, { check: true })), 1, rel);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  }
});

test('--check catches a hand-edited marketplace plugin entry and top-level description', () => {
  const root = inSyncRepo();
  try {
    const market = readJson(root, '.claude-plugin/marketplace.json');
    const edited = { ...market, plugins: market.plugins.map((p, i) => (i === 1 ? { ...p, description: 'drifted' } : p)) };
    fs.writeFileSync(path.join(root, '.claude-plugin/marketplace.json'), JSON.stringify(edited));
    assert.strictEqual(quietly(() => syncVersions(root, { check: true })), 1);
    quietly(() => syncVersions(root, { check: false }));
    assert.strictEqual(quietly(() => syncVersions(root, { check: true })), 0);
    fs.writeFileSync(path.join(root, '.claude-plugin/marketplace.json'), JSON.stringify({ ...market, description: 'drifted' }));
    assert.strictEqual(quietly(() => syncVersions(root, { check: true })), 1);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a listing file without a package entry fails loudly instead of leaving stale text', () => {
  const root = inSyncRepo();
  try {
    fs.writeFileSync(path.join(root, LISTING_METADATA), JSON.stringify({ name: 'dhpk' }));
    assert.throws(() => quietly(() => syncVersions(root, { check: true })), /packages\.claude-core is missing/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

run('gen-host-manifests');
