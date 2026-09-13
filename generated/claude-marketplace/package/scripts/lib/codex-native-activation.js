'use strict';

// Bounded, best-effort probe for whether the native dhpk Codex plugin is
// actually enabled in a running Codex install. Ports the semantics of
// probe_codex_native_plugin() in scripts/hooks/install-codex-skills.sh so
// check-codex-discovery.js can gate the runtime duplicate-provider judgment
// on real activation state instead of on-disk artifact presence (issue #437).

const { spawnSync } = require('node:child_process');
const { terminateProcessGroup } = require('./bounded-child-process');

const CODEX_NATIVE_PLUGIN_ID = 'dhpk@dhpk';
const ACTIVATION_STATUSES = Object.freeze([
  'NOT_INSTALLED',
  'UNAVAILABLE',
  'AVAILABLE',
  'DISABLED',
  'ENABLED',
  // INACTIVE is override-only: it never comes from probeCodexNativeActivation
  // (the live probe), only from `--native-activation inactive` in the CLI.
  'INACTIVE',
]);
const QUERY_TIMEOUT_MS = 3000;
const QUERY_OUTPUT_LIMIT_BYTES = 1024 * 1024;

function unavailable() {
  return { status: 'UNAVAILABLE', source: 'codex-plugin-list' };
}

function probeCodexNativeActivation({ env = process.env, spawn = spawnSync, timeoutMs = QUERY_TIMEOUT_MS } = {}) {
  let result;
  try {
    result = spawn('codex', ['plugin', 'list', '--json'], {
      encoding: 'utf8',
      timeout: timeoutMs,
      killSignal: 'SIGKILL',
      maxBuffer: QUERY_OUTPUT_LIMIT_BYTES,
      detached: process.platform !== 'win32',
      env,
    });
  } catch (error) {
    if (error && error.code === 'ENOENT') return { status: 'NOT_INSTALLED', source: 'codex-plugin-list' };
    return unavailable();
  }
  if (result && result.error) {
    if (result.error.code === 'ENOENT') return { status: 'NOT_INSTALLED', source: 'codex-plugin-list' };
    if (Number.isInteger(result.pid)) {
      terminateProcessGroup(result.pid, 'SIGTERM');
      terminateProcessGroup(result.pid, 'SIGKILL');
    }
    return unavailable();
  }
  if (!result || result.status !== 0) return unavailable();
  let payload;
  try {
    payload = JSON.parse(result.stdout);
  } catch (_) {
    return unavailable();
  }
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.installed)) return unavailable();

  let disabledMatch = null;
  let malformedMatch = false;
  for (const entry of payload.installed) {
    if (!entry || typeof entry !== 'object' || entry.pluginId !== CODEX_NATIVE_PLUGIN_ID) continue;
    if (typeof entry.enabled !== 'boolean') {
      malformedMatch = true;
      continue;
    }
    if (entry.enabled) {
      const enabled = { status: 'ENABLED', pluginId: CODEX_NATIVE_PLUGIN_ID, source: 'codex-plugin-list' };
      if (typeof entry.version === 'string' && entry.version) enabled.version = entry.version;
      return enabled;
    }
    disabledMatch = entry;
  }
  // A malformed entry outranks a disabled match found elsewhere in the same
  // payload (e.g. a duplicate pluginId with a non-boolean `enabled`): this is
  // the conservative direction, since UNAVAILABLE only ever downgrades to a
  // non-blocking WARN, never a silent PASS.
  if (malformedMatch) return unavailable();
  if (!disabledMatch) return { status: 'AVAILABLE', source: 'codex-plugin-list' };
  const disabled = { status: 'DISABLED', pluginId: CODEX_NATIVE_PLUGIN_ID, source: 'codex-plugin-list' };
  if (typeof disabledMatch.version === 'string' && disabledMatch.version) disabled.version = disabledMatch.version;
  return disabled;
}

function normalizeActivationOverride(value) {
  if (value === 'auto' || value === 'enabled' || value === 'inactive') return value;
  throw new Error(`invalid --native-activation '${value}' (expected auto|enabled|inactive)`);
}

module.exports = {
  CODEX_NATIVE_PLUGIN_ID,
  ACTIVATION_STATUSES,
  probeCodexNativeActivation,
  normalizeActivationOverride,
};
