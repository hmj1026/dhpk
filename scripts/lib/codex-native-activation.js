'use strict';

// Bounded, best-effort probe for whether the native dhpk Codex plugin is
// actually enabled in a running Codex install. Ports the semantics of
// probe_codex_native_plugin() in scripts/hooks/install-codex-skills.sh so
// check-codex-discovery.js can gate the runtime duplicate-provider judgment
// on real activation state instead of on-disk artifact presence (issue #437).

const { spawnSync } = require('node:child_process');
const { hostCliProbeEvidence, runHostCliProbe } = require('./host-cli-probe');
const { redactSensitiveText } = require('./redaction');

const CODEX_NATIVE_PLUGIN_ID = 'dhpk@dhpk';
const QUERY_TIMEOUT_MS = 30000;
const QUERY_OUTPUT_LIMIT_BYTES = 1024 * 1024;

function unavailable(probe = null) {
  const result = { status: 'UNAVAILABLE', source: 'codex-plugin-list' };
  if (probe) result.probe = hostCliProbeEvidence(probe, redactSensitiveText);
  return result;
}

function resolveProbeTimeoutMs(env = {}) {
  const fromMs = Number(env.DHPK_CODEX_PROBE_TIMEOUT_MS);
  if (Number.isSafeInteger(fromMs) && fromMs > 0) return fromMs;
  const fromSeconds = Number(env.DHPK_CODEX_PROBE_TIMEOUT_SECONDS);
  if (Number.isSafeInteger(fromSeconds) && fromSeconds > 0) return fromSeconds * 1000;
  return QUERY_TIMEOUT_MS;
}

function probeCodexNativeActivation({ env = process.env, spawn = spawnSync, timeoutMs = resolveProbeTimeoutMs(env) } = {}) {
  const result = runHostCliProbe('codex', ['plugin', 'list', '--json'], {
    env,
    timeoutMs,
    maxBuffer: QUERY_OUTPUT_LIMIT_BYTES,
    spawn,
  });
  if (result.error && result.error.code === 'ENOENT') return { status: 'NOT_INSTALLED', source: 'codex-plugin-list' };
  if (result.error || result.exitCode !== 0) return unavailable(result);
  let payload;
  try {
    payload = JSON.parse(result.stdout);
  } catch (_) {
    return unavailable(result);
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

// INACTIVE is override-only: it never comes from probeCodexNativeActivation
// (the live probe), only from `--native-activation inactive` in the CLI.
function normalizeActivationOverride(value) {
  if (value === 'auto' || value === 'enabled' || value === 'inactive') return value;
  throw new Error(`invalid --native-activation '${value}' (expected auto|enabled|inactive)`);
}

module.exports = {
  CODEX_NATIVE_PLUGIN_ID,
  probeCodexNativeActivation,
  normalizeActivationOverride,
};
