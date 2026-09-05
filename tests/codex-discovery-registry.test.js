'use strict';

const { test, run, assert } = require('./_lib/tinytest');
const {
  inspectCodexActivation,
  inspectCodexDiscovery,
} = require('../scripts/lib/codex-discovery-registry');

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

test('fingerprint failures block activation while retaining the invalid provider and identity evidence', () => {
  const result = inspectCodexActivation({
    project: [provider({
      fingerprint: '',
      fingerprintError: 'ENOENT: no such file or directory, realpath project/.codex/skills/dhpk-demo',
      current: false,
      owned: false,
    })],
  });
  assert.strictEqual(result.ok, false, JSON.stringify(result));
  assert.strictEqual(result.verdict, 'BLOCKED');
  assert.strictEqual(result.integrityVerdict, 'BLOCKED');
  assert.strictEqual(result.reasonCode, 'CODEX_PROVIDER_FINGERPRINT_ERROR');
  assert.strictEqual(result.effective.length, 0);
  assert.strictEqual(result.invalidProviders.length, 1);
  assert.strictEqual(result.invalidProviders[0].id, 'dhpk-demo');
  assert.strictEqual(result.invalidProviders[0].name, 'dhpk-demo');
  assert.strictEqual(result.invalidProviders[0].fingerprint, '');
  assert.strictEqual(result.invalidProviders[0].fingerprintError, 'ENOENT: no such file or directory, realpath project/.codex/skills/dhpk-demo');
});

test('empty fingerprint without fingerprint error remains malformed', () => {
  assert.throws(
    () => inspectCodexActivation({ project: [provider({ fingerprint: '' })] }),
    /missing fingerprint/i,
  );
});

test('fingerprint failure outranks duplicate activation for an invalid project provider', () => {
  const result = inspectCodexActivation({
    project: [provider({
      fingerprint: '',
      fingerprintError: 'ENOENT: no such file or directory, realpath project/.codex/skills/dhpk-demo',
      current: false,
      owned: false,
    })],
    native: [provider({
      surface: 'native-experimental',
      sourcePath: 'native/plugins/dhpk/skills/dhpk-demo',
      fingerprint: 'native-good',
    })],
    precedence: ['project-local'],
  });
  assert.strictEqual(result.ok, false, JSON.stringify(result));
  assert.strictEqual(result.verdict, 'BLOCKED');
  assert.strictEqual(result.integrityVerdict, 'BLOCKED');
  assert.strictEqual(result.reasonCode, 'CODEX_PROVIDER_FINGERPRINT_ERROR');
  assert.deepStrictEqual(result.duplicateInvokableNames, []);
  assert.strictEqual(result.invalidProviders.length, 1);
  assert.strictEqual(result.providers.project.length, 1);
  assert.strictEqual(result.providers.native.length, 1);
  assert.strictEqual(result.providers.project[0].fingerprint, '');
  assert.strictEqual(result.providers.native[0].fingerprint, 'native-good');
  assert.strictEqual(result.conflicts.length, 1);
  assert.deepStrictEqual(
    result.conflicts[0].providers.map((item) => `${item.surface}:${item.fingerprint}`).sort(),
    ['native-experimental:native-good', 'project-local:'],
  );
  assert.strictEqual(result.effective.length, 0);
});

test('fingerprint failure reason remains primary while valid duplicate names stay observable', () => {
  const result = inspectCodexActivation({
    project: [
      provider({
        id: 'dhpk-shared',
        name: 'dhpk-shared',
        sourcePath: 'project/.codex/skills/dhpk-shared',
        fingerprint: 'shared-good',
      }),
      provider({
        id: 'dhpk-broken',
        name: 'dhpk-broken',
        sourcePath: 'project/.codex/skills/dhpk-broken',
        fingerprint: '',
        fingerprintError: 'ENOENT: no such file or directory, realpath project/.codex/skills/dhpk-broken',
        current: false,
        owned: false,
      }),
    ],
    native: [provider({
      id: 'dhpk-shared',
      name: 'dhpk-shared',
      surface: 'native-experimental',
      sourcePath: 'native/plugins/dhpk/skills/dhpk-shared',
      fingerprint: 'shared-good',
    })],
    precedence: ['project-local'],
  });
  assert.strictEqual(result.ok, false, JSON.stringify(result));
  assert.strictEqual(result.verdict, 'BLOCKED');
  assert.strictEqual(result.integrityVerdict, 'BLOCKED');
  assert.strictEqual(result.reasonCode, 'CODEX_PROVIDER_FINGERPRINT_ERROR');
  assert.deepStrictEqual(result.duplicateInvokableNames, ['dhpk-shared']);
  assert.strictEqual(result.invalidProviders.length, 1);
  assert.strictEqual(result.invalidProviders[0].name, 'dhpk-broken');
});

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

test('runtime activation blocks duplicate invokable names even when integrity fingerprints match', () => {
  const result = inspectCodexActivation({
    project: [provider()],
    native: [provider({ surface: 'native-experimental', sourcePath: 'native/plugins/dhpk/skills/dhpk-demo' })],
    precedence: ['project-local'],
  });
  assert.strictEqual(result.ok, false, JSON.stringify(result));
  assert.strictEqual(result.verdict, 'BLOCKED');
  assert.strictEqual(result.integrityVerdict, 'PASS');
  assert.strictEqual(result.reasonCode, 'DUPLICATE_CODEX_PROVIDER');
  assert.deepStrictEqual(result.duplicateInvokableNames, ['dhpk-demo']);
});

test('runtime activation ignores overlapping non-invokable support skills', () => {
  const result = inspectCodexActivation({
    project: [provider()],
    native: [provider({ surface: 'native-experimental', sourcePath: 'native/plugins/dhpk/skills/dhpk-demo' })],
    precedence: ['project-local'],
    nonInvokableSkillNames: ['dhpk-demo'],
  });
  assert.strictEqual(result.ok, true, JSON.stringify(result));
  assert.strictEqual(result.verdict, 'PASS');
  assert.strictEqual(result.integrityVerdict, 'PASS');
  assert.strictEqual(result.reasonCode, null);
  assert.deepStrictEqual(result.duplicateInvokableNames, []);
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
