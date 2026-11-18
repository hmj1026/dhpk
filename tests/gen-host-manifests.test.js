'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const { run: syncVersions } = require('../scripts/ci/gen-host-manifests');
const { versionSyncOutputs } = require('../scripts/lib/host-manifests');

function mkRepo(version, manifestVersion) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-host-manifests-'));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'dhpk', version }));
  for (const output of versionSyncOutputs()) {
    const abs = path.join(root, output.path);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    const body = { name: 'dhpk', version: manifestVersion, keep: true };
    fs.writeFileSync(abs, JSON.stringify(body));
  }
  return root;
}

function quietly(fn) {
  const log = console.log;
  const error = console.error;
  console.log = () => {};
  console.error = () => {};
  try { return fn(); } finally { console.log = log; console.error = error; }
}

test('--check fails when a version-sync manifest lags package.json', () => {
  const root = mkRepo('2.0.0', '1.0.0');
  try {
    assert.strictEqual(quietly(() => syncVersions(root, { check: true })), 1);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('write brings every version-sync manifest to package.json and keeps other fields', () => {
  const root = mkRepo('2.0.0', '1.0.0');
  try {
    quietly(() => syncVersions(root, { check: false }));
    assert.strictEqual(quietly(() => syncVersions(root, { check: true })), 0);
    const claude = JSON.parse(fs.readFileSync(path.join(root, '.claude-plugin/plugin.json'), 'utf8'));
    assert.strictEqual(claude.version, '2.0.0');
    assert.strictEqual(claude.keep, true);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

run('gen-host-manifests');
