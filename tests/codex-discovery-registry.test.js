'use strict';

const { test, run, assert } = require('./_lib/tinytest');
const { inspectCodexDiscovery } = require('../scripts/lib/codex-discovery-registry');

function provider(overrides = {}) {
  return {
    id: 'dhpk-demo',
    kind: 'skills',
    surface: 'project-local',
    version: '1.0.0',
    fingerprint: 'same',
    sourcePath: 'project/.codex/skills/dhpk-demo',
    current: true,
    owned: true,
    ...overrides,
  };
}

test('same public name and fingerprint merge into one effective entry with providers', () => {
  const result = inspectCodexDiscovery({
    project: [provider()],
    native: [provider({ surface: 'native-experimental', sourcePath: 'native/plugins/dhpk/skills/dhpk-demo', experimental: true })],
    precedence: ['project-local', 'native-experimental'],
  });
  assert.strictEqual(result.ok, true, JSON.stringify(result));
  assert.strictEqual(result.effective.length, 1);
  assert.strictEqual(result.effective[0].status, 'merged');
  assert.strictEqual(result.effective[0].providers.length, 2);
  assert.strictEqual(result.duplicates.length, 1);
  assert.deepStrictEqual(result.conflicts, []);
});

test('different fingerprints block without explicit precedence', () => {
  const result = inspectCodexDiscovery({
    project: [provider({ fingerprint: 'project' })],
    native: [provider({ surface: 'native-experimental', fingerprint: 'native', sourcePath: 'native/plugins/dhpk/skills/dhpk-demo' })],
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.effective.length, 0);
  assert.strictEqual(result.conflicts.length, 1);
  assert.match(result.conflicts[0].reason, /precedence/i);
});

test('explicit precedence selects a current owned provider and preserves conflict evidence', () => {
  const result = inspectCodexDiscovery({
    project: [provider({ fingerprint: 'project' })],
    native: [provider({ surface: 'native-experimental', fingerprint: 'native', sourcePath: 'native/plugins/dhpk/skills/dhpk-demo', experimental: true })],
    precedence: ['project-local', 'native-experimental'],
  });
  assert.strictEqual(result.ok, true, JSON.stringify(result));
  assert.strictEqual(result.effective.length, 1);
  assert.strictEqual(result.effective[0].status, 'selected');
  assert.strictEqual(result.effective[0].provider.surface, 'project-local');
  assert.strictEqual(result.effective[0].providers.length, 2);
  assert.strictEqual(result.conflicts.length, 1);
  assert.strictEqual(result.conflicts[0].resolvedBy, 'project-local');
});

test('same canonical identity is retained as one provider when discovery repeats it', () => {
  const result = inspectCodexDiscovery({
    project: [provider(), provider({ sourcePath: 'project/.codex/skills/dhpk-demo' })],
  });
  assert.strictEqual(result.ok, true, JSON.stringify(result));
  assert.strictEqual(result.effective.length, 1);
  assert.strictEqual(result.effective[0].providers.length, 1);
});

test('kind and public name form the identity and malformed providers are rejected', () => {
  assert.throws(
    () => inspectCodexDiscovery({ project: [provider({ id: '' })] }),
    /public name|id|identity/i
  );
  assert.throws(
    () => inspectCodexDiscovery({ project: [provider({ kind: '' })] }),
    /kind|identity/i
  );
});

test('stable provider id is retained separately from the public name', () => {
  const result = inspectCodexDiscovery({
    project: [provider({ id: 'fastapi-pro', name: 'dhpk-fastapi-pro' })],
    receipt: { schema_version: 3, plugin_version: '1.0.0' },
  });
  assert.strictEqual(result.effective[0].name, 'dhpk-fastapi-pro');
  assert.strictEqual(result.effective[0].provider.id, 'fastapi-pro');
  assert.deepStrictEqual(result.receipt, { schema_version: 3, plugin_version: '1.0.0' });
});

test('default surface labels are applied consistently to the report providers', () => {
  const result = inspectCodexDiscovery({
    project: [{ id: 'demo', kind: 'skills', fingerprint: 'same', current: true, owned: true }],
  });
  assert.strictEqual(result.effective.length, 1);
  assert.strictEqual(result.providers.project[0].surface, 'project-local');
});

run('codex-discovery-registry');
