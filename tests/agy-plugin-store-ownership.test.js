'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const { materializeAgyPluginPackage, validateAgyPluginPackage } = require('../scripts/lib/agy-plugin-package');

const COMMIT = 'b'.repeat(40);

function tmp() {
  return fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'agy-store-ownership-'));
}

function writeSource(root) {
  const write = (relative, content, mode) => {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
    if (mode) fs.chmodSync(target, mode);
  };
  write('agents/sample.md', ['---', 'name: sample', 'description: Sample', 'tools: ["view_file"]', 'model: inherit', '---', '', '# Agent', ''].join('\n'));
  write('rules/sample.md', '# Rule\n');
  write('skills/dhpk-sample/SKILL.md', '---\nname: dhpk-sample\ndescription: Sample\n---\n# Skill\n');
  write('skills/dhpk-sample/scripts/run.sh', '#!/bin/sh\necho hi\n', 0o755);
  return {
    schema: 'dhpk.distribution-inventory.v2',
    skills: [{ id: 'sample', path: 'skills/dhpk-sample', surfaces: ['agy-plugin'] }],
    modules: [],
    surface_membership: { 'agy-plugin': ['sample'] },
    agy_plugin: { agents: ['sample.md'], rules: ['rules/sample.md'] },
  };
}

function generate(source, inventory, outDir) {
  return materializeAgyPluginPackage({
    root: source, inventory, outDir, version: '0.39.0', sourceVersion: '0.39.0', sourceCommit: COMMIT,
  });
}

function treeOf(directory) {
  const entries = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else entries.push(`${path.relative(directory, full)}:${(fs.statSync(full).mode & 0o7777).toString(8)}:${fs.readFileSync(full).toString('base64')}`);
    }
  };
  walk(directory);
  return entries;
}

function fixture() {
  const root = tmp();
  const source = path.join(root, 'source');
  const inventory = writeSource(source);
  return { root, source, inventory, output: path.join(root, 'out', 'package') };
}

test('publishes the planned files with their modes and leaves no scratch directory', () => {
  const { root, source, inventory, output } = fixture();
  try {
    const result = generate(source, inventory, output);
    assert.strictEqual(fs.statSync(path.join(output, 'skills/dhpk-sample/scripts/run.sh')).mode & 0o777, 0o755);
    assert.strictEqual(fs.statSync(path.join(output, 'plugin.json')).mode & 0o777, 0o644);
    assert.deepStrictEqual(fs.readdirSync(path.dirname(output)), ['package']);
    assert.ok(!result.files.includes('provenance.json') && !result.files.includes('fingerprints.json'));
    assert.strictEqual(validateAgyPluginPackage(output, { inventory, expectedVersion: '0.39.0' }).ok, true);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('receipts carry the digests the store computed for the staged files', () => {
  const { root, source, inventory, output } = fixture();
  try {
    const result = generate(source, inventory, output);
    const crypto = require('node:crypto');
    for (const [relative, digest] of Object.entries(result.fingerprints)) {
      assert.strictEqual(crypto.createHash('sha256').update(fs.readFileSync(path.join(output, relative))).digest('hex'), digest, relative);
    }
    const fingerprints = JSON.parse(fs.readFileSync(path.join(output, 'fingerprints.json'), 'utf8'));
    assert.deepStrictEqual(fingerprints.files, result.fingerprints);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(output, 'provenance.json'), 'utf8')).fingerprints, result.fingerprints);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('regenerating over an owned unchanged package yields byte-identical output', () => {
  const { root, source, inventory, output } = fixture();
  try {
    generate(source, inventory, output);
    const first = treeOf(output);
    generate(source, inventory, output);
    assert.deepStrictEqual(treeOf(output), first);
    assert.deepStrictEqual(fs.readdirSync(path.dirname(output)), ['package']);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('refuses to replace a hand-edited owned file and keeps the tree', () => {
  const { root, source, inventory, output } = fixture();
  try {
    generate(source, inventory, output);
    fs.appendFileSync(path.join(output, 'agents/sample.md'), 'tamper\n');
    const before = treeOf(output);
    assert.throws(() => generate(source, inventory, output), /refusing to replace changed AGY output: agents\/sample\.md/);
    assert.deepStrictEqual(treeOf(output), before);
    assert.deepStrictEqual(fs.readdirSync(path.dirname(output)), ['package']);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('refuses to replace an undeclared extra file in an owned package', () => {
  const { root, source, inventory, output } = fixture();
  try {
    generate(source, inventory, output);
    fs.writeFileSync(path.join(output, 'extra.txt'), 'x\n');
    assert.throws(() => generate(source, inventory, output), /incomplete or foreign fingerprints/);
    assert.ok(fs.existsSync(path.join(output, 'extra.txt')));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('refuses a foreign directory without an owner receipt', () => {
  const { root, source, inventory, output } = fixture();
  try {
    fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(path.join(output, 'user.txt'), 'keep\n');
    assert.throws(() => generate(source, inventory, output), /without an owner receipt/);
    assert.strictEqual(fs.readFileSync(path.join(output, 'user.txt'), 'utf8'), 'keep\n');
    assert.deepStrictEqual(fs.readdirSync(output), ['user.txt']);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('refuses a foreign provenance owner', () => {
  const { root, source, inventory, output } = fixture();
  try {
    fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(path.join(output, 'provenance.json'), '{"owner":"someone"}\n');
    assert.throws(() => generate(source, inventory, output), /foreign or invalid AGY output/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('refuses a symlinked output root and a file at the output root', () => {
  const { root, source, inventory, output } = fixture();
  try {
    const real = path.join(root, 'real');
    fs.mkdirSync(real);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.symlinkSync(real, output);
    assert.throws(() => generate(source, inventory, output), /physical directory/);
    assert.deepStrictEqual(fs.readdirSync(real), []);
    fs.unlinkSync(output);
    fs.writeFileSync(output, 'x');
    assert.throws(() => generate(source, inventory, output), /physical directory/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a failed generation keeps the previous owned tree and leaves no scratch directory', () => {
  const { root, source, inventory, output } = fixture();
  try {
    generate(source, inventory, output);
    const before = treeOf(output);
    const broken = JSON.parse(JSON.stringify(inventory));
    broken.agy_plugin.agents = ['../x.md'];
    assert.throws(() => generate(source, broken, output), /AGY agent selection/);
    assert.deepStrictEqual(treeOf(output), before);
    assert.deepStrictEqual(fs.readdirSync(path.dirname(output)), ['package']);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

run('agy-plugin-store-ownership');
