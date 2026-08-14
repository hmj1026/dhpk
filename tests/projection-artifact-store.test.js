'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const { ProjectionArtifactStore } = require('../scripts/lib/projection-artifact-store');

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-projection-store-'));
}

function plan(entries) {
  return { planFingerprint: 'plan-1', entries };
}

test('store stages planned bytes, publishes atomically, and reports fingerprints', () => {
  const root = tempRoot();
  try {
    const store = new ProjectionArtifactStore({ root });
    const session = store.begin(plan([{ stableId: 'one', destination: 'skills/one.md', symlink: { policy: 'forbid' } }]));
    session.write({ stableId: 'one', destination: 'skills/one.md', content: 'hello\n' });
    const published = session.publish();
    assert.strictEqual(published.outputs.length, 1);
    assert.match(published.outputs[0].fingerprint, /^[a-f0-9]{64}$/);
    assert.strictEqual(fs.readFileSync(path.join(root, 'published/skills/one.md'), 'utf8'), 'hello\n');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('store rejects unplanned output and traversal before writing', () => {
  const root = tempRoot();
  try {
    const store = new ProjectionArtifactStore({ root });
    const session = store.begin(plan([{ stableId: 'one', destination: 'skills/one.md' }]));
    assert.throws(() => session.write({ stableId: 'missing', destination: 'skills/missing', content: 'x' }), /absent from the plan/);
    assert.throws(() => session.write({ stableId: 'one', destination: '../outside', content: 'x' }), /does not match the plan/);
    session.abort();
    assert.deepStrictEqual(fs.readdirSync(root), []);

    const windowsTraversal = store.begin(plan([{ stableId: 'windows', destination: '..\\outside' }]));
    assert.throws(() => windowsTraversal.write({ stableId: 'windows', destination: '..\\outside', content: 'x' }), /safe/);
    windowsTraversal.abort();
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('store fails closed for forbidden and escaping links, while allowing contained relative links', () => {
  const root = tempRoot();
  try {
    const store = new ProjectionArtifactStore({ root, sourceRoot: path.join(root, 'source') });
    const forbidden = store.begin(plan([{ stableId: 'one', destination: 'one', symlink: { policy: 'forbid' } }]));
    assert.throws(() => forbidden.link({ stableId: 'one', destination: 'one', target: 'target' }), /forbidden/);
    forbidden.abort();

    const escaping = store.begin(plan([{ stableId: 'two', destination: 'two', symlink: { policy: 'contained-relative' } }]));
    assert.throws(() => escaping.link({ stableId: 'two', destination: 'two', target: '../outside' }), /escapes/);
    assert.throws(() => escaping.link({ stableId: 'two', destination: 'two', target: '..\\outside' }), /relative/);
    escaping.abort();

    const contained = store.begin(plan([{ stableId: 'three', destination: 'dir/three', symlink: { policy: 'contained-relative' } }]));
    contained.link({ stableId: 'three', destination: 'dir/three', target: '../target' });
    const published = contained.publish();
    assert.strictEqual(published.links[0].target, '../target');
    assert.strictEqual(fs.readlinkSync(path.join(root, 'published/dir/three')), '../target');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('failed staged sessions preserve the previously published tree', () => {
  const root = tempRoot();
  try {
    const store = new ProjectionArtifactStore({ root });
    const initial = store.begin(plan([{ stableId: 'one', destination: 'one', symlink: { policy: 'forbid' } }]));
    initial.write({ stableId: 'one', destination: 'one', content: 'old' });
    initial.publish();
    const failed = store.begin(plan([{ stableId: 'one', destination: 'one', symlink: { policy: 'forbid' } }]));
    assert.throws(() => failed.write({ stableId: 'one', destination: 'one', content: { bad: true } }), /requires string or Buffer/);
    failed.abort();
    assert.strictEqual(fs.readFileSync(path.join(root, 'published/one'), 'utf8'), 'old');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

run('projection-artifact-store');
