'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const { ProjectionArtifactStore } = require('../scripts/lib/projection-artifact-store');
const { activateStagedCandidate } = require('../scripts/lib/capability-bundle-activation');

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-capability-activation-'));
}

function plan(fingerprint) {
  return {
    planFingerprint: fingerprint,
    entries: [{ stableId: 'manifest', destination: 'manifest.json', symlink: { policy: 'forbid' } }],
  };
}

test('staging is observable separately and a required non-pass leaves the active root unchanged', () => {
  const root = tempRoot();
  try {
    const publishRoot = path.join(root, 'active');
    const store = new ProjectionArtifactStore({ root, publishRoot });
    const initial = store.begin(plan('old'));
    initial.write({ stableId: 'manifest', destination: 'manifest.json', content: '{"profile":"compat-v1"}\n' });
    initial.publish();
    const before = fs.readFileSync(path.join(publishRoot, 'manifest.json'));

    const candidate = store.begin(plan('new'));
    candidate.write({ stableId: 'manifest', destination: 'manifest.json', content: '{"profile":"minimal"}\n' });
    const staged = candidate.stage();
    assert.ok(staged.artifactFingerprint);
    const blocked = activateStagedCandidate({
      session: candidate,
      requiredRuntimeSurfaces: ['claude-core'],
      evidence: [{ surface: 'claude-core', verdict: 'UNAVAILABLE' }],
    });
    assert.strictEqual(blocked.ok, false);
    assert.deepStrictEqual(fs.readFileSync(path.join(publishRoot, 'manifest.json')), before);
    assert.strictEqual(fs.existsSync(path.join(publishRoot, 'manifest.json')), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a required PASS is the only path that activates a staged candidate', () => {
  const root = tempRoot();
  try {
    const publishRoot = path.join(root, 'active');
    const store = new ProjectionArtifactStore({ root, publishRoot });
    const candidate = store.begin(plan('pass'));
    candidate.write({ stableId: 'manifest', destination: 'manifest.json', content: '{"profile":"minimal"}\n' });
    candidate.stage();
    const activated = activateStagedCandidate({
      session: candidate,
      requiredRuntimeSurfaces: ['claude-core'],
      evidence: [{ surface: 'claude-core', verdict: 'PASS' }],
    });
    assert.strictEqual(activated.ok, true);
    assert.strictEqual(fs.readFileSync(path.join(publishRoot, 'manifest.json'), 'utf8'), '{"profile":"minimal"}\n');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

run('capability-bundle-activation');
