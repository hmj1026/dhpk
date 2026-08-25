'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const {
  materializeAgyPluginPackage,
  validateAgyPluginPackage,
} = require('../scripts/lib/agy-plugin-package');

const COMMIT = 'a'.repeat(40);

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agy-package-test-'));
}

function writeFixture(root, { includeHarnessReference = false } = {}) {
  fs.mkdirSync(path.join(root, 'agents'), { recursive: true });
  fs.mkdirSync(path.join(root, 'rules'), { recursive: true });
  fs.mkdirSync(path.join(root, 'skills', 'dhpk-sample'), { recursive: true });
  fs.mkdirSync(path.join(root, 'skills', 'dhpk-sample', 'references'), { recursive: true });
  fs.writeFileSync(path.join(root, 'agents', 'sample.md'), [
    '---',
    'name: sample',
    'description: Sample agent',
    'tools: Read, Bash',
    'model: sonnet',
    'color: blue',
    '---',
    '',
    '# Sample',
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(root, 'rules', 'sample.md'), '# Rule\n');
  fs.writeFileSync(path.join(root, 'skills', 'dhpk-sample', 'references', 'guide.md'), '# Guide\n');
  const skillLines = [
    '---',
    'name: dhpk-sample',
    'description: Sample skill',
    '---',
    '',
    '# Skill',
    '',
  ];
  if (includeHarnessReference) {
    fs.mkdirSync(path.join(root, 'skills', 'dhpk-harness-revise'), { recursive: true });
    fs.writeFileSync(path.join(root, 'skills', 'dhpk-harness-revise', 'SKILL.md'), [
      '---',
      'name: dhpk-harness-revise',
      'description: Harness revision skill',
      '---',
      '',
      '# Harness Revise',
      '',
    ].join('\n'));
    skillLines.push('Use @skills/dhpk-harness-revise/references/harness-directory-contract.md when resolving a harness.');
  }
  fs.writeFileSync(path.join(root, 'skills', 'dhpk-sample', 'SKILL.md'), `${skillLines.join('\n')}\n`);
  return {
    schema: 'dhpk.distribution-inventory.v2',
    surfaces: ['agy-plugin'],
    skills: [
      { id: 'sample', path: 'skills/dhpk-sample', surfaces: ['agy-plugin'] },
      ...(includeHarnessReference
        ? [{ id: 'harness-revise', path: 'skills/dhpk-harness-revise', surfaces: ['agy-plugin'] }]
        : []),
    ],
    modules: [],
    surface_membership: { 'agy-plugin': ['sample', ...(includeHarnessReference ? ['harness-revise'] : [])] },
    agy_plugin: {
      agents: ['sample.md'],
      rules: ['rules/sample.md'],
    },
  };
}

function materializeFixture(root, outDir, options) {
  return materializeAgyPluginPackage({
    root,
    inventory: writeFixture(root, options),
    outDir,
    version: '0.39.0',
    sourceVersion: '0.39.0',
    sourceCommit: COMMIT,
  });
}

test('materializes and validates a contained AGY package', () => {
  const root = tempRoot();
  const outDir = path.join(root, 'package');
  try {
    const result = materializeFixture(root, outDir);
    const checked = validateAgyPluginPackage(outDir, { inventory: writeFixture(root), expectedVersion: '0.39.0' });
    assert.strictEqual(checked.ok, true, checked.errors.join('; '));
    assert.ok(result.files.includes('agents/sample.md'));
    assert.ok(result.files.includes('skills/dhpk-sample/SKILL.md'));
    assert.ok(!fs.readFileSync(path.join(root, 'agents', 'sample.md'), 'utf8').includes('model: pro'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rewrites source-tree harness references to an AGY skill target', () => {
  const root = tempRoot();
  const outDir = path.join(root, 'package');
  try {
    materializeFixture(root, outDir, { includeHarnessReference: true });
    const projected = fs.readFileSync(path.join(outDir, 'skills', 'dhpk-sample', 'SKILL.md'), 'utf8');
    assert.ok(projected.includes('dhpk-harness-revise'));
    assert.ok(!projected.includes('@skills/dhpk-harness-revise/references/harness-directory-contract.md'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('copies selected skill reference assets so relative links stay reachable', () => {
  const root = tempRoot();
  const outDir = path.join(root, 'package');
  try {
    const result = materializeFixture(root, outDir);
    assert.ok(result.files.includes('skills/dhpk-sample/references/guide.md'));
    assert.strictEqual(
      fs.readFileSync(path.join(outDir, 'skills', 'dhpk-sample', 'references', 'guide.md'), 'utf8'),
      '# Guide\n',
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rejects a rewritten reference when its target skill is not selected', () => {
  const root = tempRoot();
  const outDir = path.join(root, 'package');
  try {
    const inventory = writeFixture(root);
    fs.appendFileSync(
      path.join(root, 'skills', 'dhpk-sample', 'SKILL.md'),
      '\nUse @skills/dhpk-harness-revise/references/harness-directory-contract.md when resolving a harness.\n',
    );
    assert.throws(() => materializeAgyPluginPackage({
      root,
      inventory,
      outDir,
      version: '0.39.0',
      sourceVersion: '0.39.0',
      sourceCommit: COMMIT,
    }), /AGY skill reference target is not selected: harness-revise/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('equivalent inputs produce byte-identical package files', () => {
  const root = tempRoot();
  const first = path.join(root, 'first');
  const second = path.join(root, 'second');
  try {
    const firstResult = materializeFixture(root, first);
    const secondResult = materializeFixture(root, second);
    for (const file of firstResult.files.concat(['provenance.json', 'fingerprints.json']).sort()) {
      assert.strictEqual(
        fs.readFileSync(path.join(first, file), 'utf8'),
        fs.readFileSync(path.join(second, file), 'utf8'),
        `output drift: ${file}`,
      );
    }
    assert.strictEqual(
      fs.readFileSync(path.join(first, 'agents', 'sample.md'), 'utf8'),
      fs.readFileSync(path.join(second, 'agents', 'sample.md'), 'utf8'),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rejects foreign receipt, undeclared files, and secrets', () => {
  const root = tempRoot();
  const outDir = path.join(root, 'package');
  try {
    materializeFixture(root, outDir);
    const provenancePath = path.join(outDir, 'provenance.json');
    const provenance = JSON.parse(fs.readFileSync(provenancePath, 'utf8'));
    provenance.owner = 'plugins/dhpk-cursor';
    provenance.surface = 'cursor-plugin';
    fs.writeFileSync(provenancePath, `${JSON.stringify(provenance)}\n`);
    fs.writeFileSync(path.join(outDir, 'foreign.txt'), 'foreign\n');
    fs.writeFileSync(path.join(outDir, 'agents', 'foreign.txt'), 'foreign agent payload\n');
    fs.appendFileSync(path.join(outDir, 'skills', 'dhpk-sample', 'SKILL.md'), '\napi_key=sk_12345678901234567890\n');
    const checked = validateAgyPluginPackage(outDir, { inventory: writeFixture(root) });
    assert.strictEqual(checked.ok, false);
    assert.ok(checked.errors.some((error) => error.includes('foreign.txt')));
    assert.ok(checked.errors.some((error) => error.includes('undeclared AGY package file: agents/foreign.txt')));
    assert.ok(checked.errors.some((error) => error.includes('surface')));
    assert.ok(checked.errors.some((error) => error.includes('secret')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('fails closed on traversal and source symlinks', () => {
  const root = tempRoot();
  try {
    const inventory = writeFixture(root);
    inventory.agy_plugin.agents = ['../outside.md'];
    assert.throws(() => materializeAgyPluginPackage({
      root,
      inventory,
      outDir: path.join(root, 'package'),
      version: '0.39.0',
      sourceVersion: '0.39.0',
      sourceCommit: COMMIT,
    }), /AGY agent selection|escapes/);

    const symlinkRoot = tempRoot();
    try {
      writeFixture(symlinkRoot);
      fs.symlinkSync(path.join(symlinkRoot, 'rules', 'sample.md'), path.join(symlinkRoot, 'rules', 'link.md'));
      const symlinkInventory = writeFixture(symlinkRoot);
      symlinkInventory.agy_plugin.rules = ['rules/link.md'];
      assert.throws(() => materializeAgyPluginPackage({
        root: symlinkRoot,
        inventory: symlinkInventory,
        outDir: path.join(symlinkRoot, 'package'),
        version: '0.39.0',
        sourceVersion: '0.39.0',
        sourceCommit: COMMIT,
      }), /symlink/);
    } finally {
      fs.rmSync(symlinkRoot, { recursive: true, force: true });
    }

    const symlinkAgentRoot = tempRoot();
    try {
      writeFixture(symlinkAgentRoot);
      const outside = path.join(symlinkAgentRoot, 'outside.md');
      fs.writeFileSync(outside, [
        '---', 'name: outside', 'description: Outside', 'tools: ["read_file"]', 'model: inherit', '---', '',
      ].join('\n'));
      fs.unlinkSync(path.join(symlinkAgentRoot, 'agents', 'sample.md'));
      fs.symlinkSync(outside, path.join(symlinkAgentRoot, 'agents', 'sample.md'));
      const symlinkAgentInventory = writeFixture(symlinkAgentRoot);
      assert.throws(() => materializeAgyPluginPackage({
        root: symlinkAgentRoot,
        inventory: symlinkAgentInventory,
        outDir: path.join(symlinkAgentRoot, 'package'),
        version: '0.39.0',
        sourceVersion: '0.39.0',
        sourceCommit: COMMIT,
      }), /symlink/);
    } finally {
      fs.rmSync(symlinkAgentRoot, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('invalid generation never removes an existing output root', () => {
  const root = tempRoot();
  const outDir = path.join(root, 'package');
  try {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'user-owned.txt'), 'keep\n');
    assert.throws(() => materializeAgyPluginPackage({
      root,
      inventory: { schema: 'dhpk.distribution-inventory.v2' },
      outDir,
      version: '0.39.0',
      sourceVersion: '0.39.0',
      sourceCommit: COMMIT,
    }), /inventory\.agy_plugin/);
    assert.strictEqual(fs.readFileSync(path.join(outDir, 'user-owned.txt'), 'utf8'), 'keep\n');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rejects manifest escapes and provenance fingerprint drift', () => {
  const root = tempRoot();
  const outDir = path.join(root, 'package');
  try {
    materializeFixture(root, outDir);
    const manifestPath = path.join(outDir, 'plugin.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.agents = ['../../outside/'];
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`);
    let checked = validateAgyPluginPackage(outDir, { inventory: writeFixture(root) });
    assert.strictEqual(checked.ok, false);
    assert.ok(checked.errors.some((error) => error.includes('plugin.json agents')));

    const secondOutDir = path.join(root, 'second-package');
    materializeFixture(root, secondOutDir);
    const provenancePath = path.join(secondOutDir, 'provenance.json');
    const provenance = JSON.parse(fs.readFileSync(provenancePath, 'utf8'));
    provenance.fingerprints = {};
    fs.writeFileSync(provenancePath, `${JSON.stringify(provenance)}\n`);
    checked = validateAgyPluginPackage(secondOutDir, { inventory: writeFixture(root) });
    assert.strictEqual(checked.ok, false);
    assert.ok(checked.errors.some((error) => error.includes('provenance fingerprints')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

run('agy-plugin-package');
