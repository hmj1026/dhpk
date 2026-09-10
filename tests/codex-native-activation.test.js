'use strict';

const { test, run, assert } = require('./_lib/tinytest');
const { probeCodexNativeActivation, CODEX_NATIVE_PLUGIN_ID, normalizeActivationOverride } = require('../scripts/lib/codex-native-activation');

function stub(result) {
  return () => result;
}

test('codex missing from PATH reports NOT_INSTALLED', () => {
  const spawn = () => {
    const error = new Error('spawn codex ENOENT');
    error.code = 'ENOENT';
    return { error, status: null, pid: undefined };
  };
  const result = probeCodexNativeActivation({ spawn });
  assert.strictEqual(result.status, 'NOT_INSTALLED');
});

test('enabled native plugin reports ENABLED with version', () => {
  const spawn = stub({
    status: 0,
    stdout: JSON.stringify({ installed: [{ pluginId: CODEX_NATIVE_PLUGIN_ID, enabled: true, version: '0.57.0' }], available: [] }),
    stderr: '',
  });
  const result = probeCodexNativeActivation({ spawn });
  assert.strictEqual(result.status, 'ENABLED');
  assert.strictEqual(result.pluginId, CODEX_NATIVE_PLUGIN_ID);
  assert.strictEqual(result.version, '0.57.0');
});

test('disabled native plugin reports DISABLED', () => {
  const spawn = stub({
    status: 0,
    stdout: JSON.stringify({ installed: [{ pluginId: CODEX_NATIVE_PLUGIN_ID, enabled: false }], available: [] }),
    stderr: '',
  });
  const result = probeCodexNativeActivation({ spawn });
  assert.strictEqual(result.status, 'DISABLED');
});

test('no matching plugin entry reports AVAILABLE', () => {
  const spawn = stub({ status: 0, stdout: JSON.stringify({ installed: [], available: [] }), stderr: '' });
  const result = probeCodexNativeActivation({ spawn });
  assert.strictEqual(result.status, 'AVAILABLE');
});

test('non-zero exit reports UNAVAILABLE', () => {
  const spawn = stub({ status: 1, stdout: '', stderr: 'boom' });
  const result = probeCodexNativeActivation({ spawn });
  assert.strictEqual(result.status, 'UNAVAILABLE');
});

test('timeout reports UNAVAILABLE', () => {
  const spawn = stub({
    status: null,
    stdout: '',
    stderr: '',
    error: Object.assign(new Error('ETIMEDOUT'), { code: 'ETIMEDOUT' }),
    pid: 4242,
  });
  const result = probeCodexNativeActivation({ spawn });
  assert.strictEqual(result.status, 'UNAVAILABLE');
});

test('non-JSON stdout reports UNAVAILABLE', () => {
  const spawn = stub({ status: 0, stdout: 'not json', stderr: '' });
  const result = probeCodexNativeActivation({ spawn });
  assert.strictEqual(result.status, 'UNAVAILABLE');
});

test('missing installed array reports UNAVAILABLE', () => {
  const spawn = stub({ status: 0, stdout: JSON.stringify({ available: [] }), stderr: '' });
  const result = probeCodexNativeActivation({ spawn });
  assert.strictEqual(result.status, 'UNAVAILABLE');
});

test('non-boolean enabled field reports UNAVAILABLE', () => {
  const spawn = stub({
    status: 0,
    stdout: JSON.stringify({ installed: [{ pluginId: CODEX_NATIVE_PLUGIN_ID, enabled: 'yes' }], available: [] }),
    stderr: '',
  });
  const result = probeCodexNativeActivation({ spawn });
  assert.strictEqual(result.status, 'UNAVAILABLE');
});

test('normalizeActivationOverride accepts auto/enabled/inactive and rejects anything else', () => {
  assert.strictEqual(normalizeActivationOverride('auto'), 'auto');
  assert.strictEqual(normalizeActivationOverride('enabled'), 'enabled');
  assert.strictEqual(normalizeActivationOverride('inactive'), 'inactive');
  assert.throws(() => normalizeActivationOverride('bogus'), /native-activation/);
});

run('codex-native-activation');
