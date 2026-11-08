'use strict';

// A minimal fake Host driven through the Host package pipeline (#1242):
// adapter assembly, the artifact store, late-bound receipts, validation
// failure, and foreign-output refusal, without any real generator.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const { SURFACE_OWNERS } = require('../scripts/lib/platform-provenance');
const pipeline = require('../scripts/lib/host-package-pipeline');

const SURFACE = 'codex-native';
const OWNER = SURFACE_OWNERS[SURFACE];

function tempOut() {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-host-pipeline-'));
  return { parent, outDir: path.join(parent, 'package') };
}

function plan(files) {
  return { planFingerprint: 'fake-plan', entries: files.map((file) => ({ stableId: file.stableId, destination: file.destination, symlinkPolicy: 'forbid' })) };
}

function fakeHost({ validateStage = () => {}, receipt = 'early' } = {}) {
  const files = [
    { stableId: 'fake:a', destination: 'a.txt', content: 'alpha\n' },
    { stableId: 'fake:b', destination: 'nested/b.txt', content: 'beta\n' },
  ];
  const provenance = (fingerprints) => `${JSON.stringify({ owner: OWNER, fingerprints })}\n`;
  const receiptFiles = [
    { stableId: 'fake:provenance', destination: 'provenance.json' },
  ];
  const outputs = receipt === 'early'
    ? [...files, { ...receiptFiles[0], content: provenance({}) }]
    : files;
  const adapter = pipeline.hostPackageAdapter({
    surface: SURFACE,
    version: '1.0.0',
    renderOutputs: () => outputs.slice(),
    metadata: { host: 'fake' },
    ...(receipt === 'late' ? {
      renderDerived: (_plan, { session }) => ({
        outputs: [{ ...receiptFiles[0], content: provenance(Object.fromEntries(files.map((file) => [file.destination, session.fingerprintOf(file.destination)]))) }],
      }),
    } : {}),
    validateStage,
  });
  return { projection: { plan: plan([...files, ...receiptFiles]), adapter }, files };
}

test('a minimal Host publishes its files and receipt through the artifact store', () => {
  const { parent, outDir } = tempOut();
  try {
    const { projection } = fakeHost();
    const artifact = pipeline.publishHostPackage(SURFACE, projection, { sourceRoot: parent, publishRoot: outDir, failurePrefix: 'fake Host' });
    assert.deepStrictEqual(artifact.metadata, { host: 'fake' });
    assert.strictEqual(fs.readFileSync(path.join(outDir, 'nested/b.txt'), 'utf8'), 'beta\n');
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(outDir, 'provenance.json'), 'utf8')).owner, OWNER);
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test('a late-bound receipt is built from the fingerprints the store observed', () => {
  const { parent, outDir } = tempOut();
  try {
    const { projection } = fakeHost({ receipt: 'late' });
    pipeline.publishHostPackage(SURFACE, projection, { sourceRoot: parent, publishRoot: outDir });
    const receipt = JSON.parse(fs.readFileSync(path.join(outDir, 'provenance.json'), 'utf8'));
    assert.deepStrictEqual(Object.keys(receipt.fingerprints).sort(), ['a.txt', 'nested/b.txt']);
    for (const value of Object.values(receipt.fingerprints)) assert.match(value, /^[a-f0-9]{64}$/);
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test('a validation failure keeps the previously published package', () => {
  const { parent, outDir } = tempOut();
  try {
    pipeline.publishHostPackage(SURFACE, fakeHost().projection, { sourceRoot: parent, publishRoot: outDir });
    const before = fs.readFileSync(path.join(outDir, 'a.txt'), 'utf8');
    const failing = fakeHost({ validateStage: (stageRoot) => {
      assert.ok(fs.existsSync(path.join(stageRoot, 'a.txt')), 'validation runs against the staged tree');
      throw new Error('fake validator refused');
    } });
    assert.throws(
      () => pipeline.publishHostPackage(SURFACE, failing.projection, { sourceRoot: parent, publishRoot: outDir, failurePrefix: 'fake Host' }),
      /fake Host: .*fake validator refused/,
    );
    assert.strictEqual(fs.readFileSync(path.join(outDir, 'a.txt'), 'utf8'), before);
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test('an output owned by another surface is refused without changes', () => {
  const { parent, outDir } = tempOut();
  try {
    fs.mkdirSync(outDir);
    fs.writeFileSync(path.join(outDir, 'provenance.json'), `${JSON.stringify({ owner: 'plugins/somebody-else' })}\n`);
    assert.throws(() => pipeline.publishHostPackage(SURFACE, fakeHost().projection, { sourceRoot: parent, publishRoot: outDir }));
    assert.deepStrictEqual(fs.readdirSync(outDir), ['provenance.json']);
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test('a custom ownership verifier replaces the default owner check', () => {
  const { parent, outDir } = tempOut();
  try {
    let asked = 0;
    const verify = () => { asked += 1; return { ok: false, code: 'FAKE_REFUSED', message: 'not ours' }; };
    fs.mkdirSync(outDir);
    assert.throws(() => pipeline.publishHostPackage(SURFACE, fakeHost().projection, { sourceRoot: parent, publishRoot: outDir, verify }));
    assert.strictEqual(asked, 1);
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test('skill entry fields keep their order and are omitted for non-skill files', () => {
  assert.deepStrictEqual(pipeline.skillEntryFields({ destination: 'x' }), {});
  const fields = pipeline.skillEntryFields({ skillId: 's', publicName: 'p', invocationClass: 'i', lifecycle: 'l', usageSchema: 'u', usage: {}, usageFingerprint: 'f', provenance: {}, other: 1 });
  assert.deepStrictEqual(Object.keys(fields), ['skillId', 'publicName', 'invocationClass', 'lifecycle', 'usageSchema', 'usage', 'usageFingerprint', 'provenance']);
});

run('host-package-pipeline');
