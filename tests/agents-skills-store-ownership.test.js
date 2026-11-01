'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { test, run, assert } = require('./_lib/tinytest');
const {
  materializeAgentsSkillsProjection,
  validateAgentsSkillsProjection,
} = require('../scripts/lib/agents-skills-package');

const INVENTORY = Object.freeze({
  schema: 'dhpk.distribution-inventory.v2',
  skills: [{ id: 'sample', name: 'dhpk-sample', path: 'skills/dhpk-sample', lifecycle: 'promoted', surfaces: ['agent-plugin'] }],
  surface_membership: { 'agent-plugin': ['sample'] },
});

// Observed from the pre-change in-checkout writer for the fixture below.
const GOLDEN = Object.freeze([
  ['.dhpk-projection.json', '644', 'e86fbf713aac909193c1a0ba346e8f420dc092ce00d94fd14950bad0acddc714'],
  ['dhpk-sample.md', '644', 'd2a4acb7b734746e69c41ddd52d0ada32ca4141459b933903255a30a4d9568b1'],
  ['dhpk-sample/SKILL.md', '644', 'e3468725b8222a9c841d9b9de8c5013b36da94b2f74fabd101d3978b37004e2b'],
  ['dhpk-sample/references/guide.md', '644', 'bc553ffe57e544498b12a9865dbf3abc2004c474e349c52c378eaa402287424b'],
  ['dhpk-sample/scripts/check.sh', '755', 'a8076d3d28d21e02012b20eaf7dbf75409a6277134439025f282e368e3305abf'],
]);

function write(file, content, mode) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, mode === undefined ? undefined : { mode });
}

function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-agents-store-'));
  write(path.join(root, 'skills/dhpk-sample/SKILL.md'), ['---', 'name: dhpk-sample', "description: 'A portable sample skill.'", '---', '# Sample skill', '', 'Use the reference at [guide](references/guide.md).', ''].join('\n'));
  write(path.join(root, 'skills/dhpk-sample/references/guide.md'), '# Guide\n');
  write(path.join(root, 'skills/dhpk-sample/scripts/check.sh'), '#!/bin/sh\n', 0o755);
  fs.chmodSync(path.join(root, 'skills/dhpk-sample/scripts/check.sh'), 0o755);
  return root;
}

function tree(directory) {
  const rows = [];
  const walk = (current, prefix) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(full, relative);
      else rows.push([relative, (fs.statSync(full).mode & 0o7777).toString(8), crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex')]);
    }
  };
  walk(directory, '');
  return rows.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

function materialize(root, outDir) {
  return materializeAgentsSkillsProjection({ root, inventory: INVENTORY, outDir });
}

test('in-checkout publication is byte- and mode-identical to the characterized output', () => {
  const root = makeRoot();
  try {
    const outDir = path.join(root, '.agents', 'skills');
    materialize(root, outDir);
    assert.deepStrictEqual(tree(outDir), GOLDEN.map((row) => [...row]));
    assert.deepStrictEqual(fs.readdirSync(path.join(root, '.agents')), ['skills'], 'no stage, backup, or journal may remain');
    assert.strictEqual(validateAgentsSkillsProjection({ root, inventory: INVENTORY, outDir }).ok, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('republishing replaces the whole tree and stays identical', () => {
  const root = makeRoot();
  try {
    const outDir = path.join(root, '.agents', 'skills');
    materialize(root, outDir);
    materialize(root, outDir);
    assert.deepStrictEqual(tree(outDir), GOLDEN.map((row) => [...row]));
    assert.deepStrictEqual(fs.readdirSync(path.join(root, '.agents')), ['skills']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('an unlisted file in the existing tree is refused with OWNERSHIP_REFUSED and the tree is unchanged', () => {
  const root = makeRoot();
  try {
    const outDir = path.join(root, '.agents', 'skills');
    materialize(root, outDir);
    write(path.join(outDir, 'user-notes.md'), '# mine\n');
    const before = tree(outDir);
    assert.throws(() => materialize(root, outDir), /OWNERSHIP_REFUSED/);
    assert.deepStrictEqual(tree(outDir), before);
    assert.deepStrictEqual(fs.readdirSync(path.join(root, '.agents')), ['skills']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a non-empty tree without a receipt is refused and left untouched', () => {
  const root = makeRoot();
  try {
    const outDir = path.join(root, '.agents', 'skills');
    write(path.join(outDir, 'foreign.md'), '# foreign\n');
    assert.throws(() => materialize(root, outDir), /OWNERSHIP_REFUSED/);
    assert.deepStrictEqual(fs.readdirSync(outDir), ['foreign.md']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a pre-created empty output directory publishes normally', () => {
  const root = makeRoot();
  try {
    const outDir = path.join(root, '.agents', 'skills');
    fs.mkdirSync(outDir, { recursive: true });
    materialize(root, outDir);
    assert.deepStrictEqual(tree(outDir), GOLDEN.map((row) => [...row]));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the writer carries no private journal, backup, or atomic-json helper', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'lib', 'agents-skills-package.js'), 'utf8');
  for (const pattern of [/writeAtomicJson/, /transactionPathFor/, /recoverProjectionTransaction/, /agents-skills-backup-/, /agents-skills-build-/, /dhpk\.agents-skills-transaction/]) {
    assert.ok(!pattern.test(source), `legacy private transaction remnant: ${pattern}`);
  }
});

run('agents-skills-store-ownership');
