'use strict';

// Contract tests for the normalized runtime configuration seam. The loader
// still exports CLAUDE_PLUGIN_OPTION_* for compatibility; these helpers define
// the precedence and value normalization consumed by hooks.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const LOADER = path.join(ROOT, 'scripts', 'hooks', '_lib', 'load-project-config.sh');
const RUNTIME = path.join(ROOT, 'scripts', 'hooks', '_lib', 'runtime-config.sh');

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-runtime-config-'));
}

function settings(root, options) {
  fs.mkdirSync(path.join(root, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude', 'settings.local.json'), JSON.stringify({
    pluginConfigs: { 'dhpk@dhpk': { options } },
  }));
}

function sh(root, command, extraEnv = {}) {
  const env = { ...process.env, ROOT: root, ...extraEnv };
  return spawnSync('bash', ['-c', `source "${LOADER}"; source "${RUNTIME}"; ${command}`], {
    env,
    encoding: 'utf8',
    timeout: 10000,
  });
}

test('config_get applies project-loaded values while preserving a default', () => {
  const root = tmpRoot();
  settings(root, { hook_profile: 'strict' });
  const res = sh(root, 'printf "%s|%s" "$(dhpk_config_get hook_profile standard)" "$(dhpk_config_get missing fallback)"');
  assert.strictEqual(res.status, 0, res.stderr);
  assert.strictEqual(res.stdout, 'strict|fallback');
});

test('config_profile gives one normalized value and honors the one-shot override', () => {
  const root = tmpRoot();
  settings(root, { hook_profile: 'strict' });
  const res = sh(root, 'dhpk_config_profile', { DHPK_HOOK_PROFILE: 'minimal' });
  assert.strictEqual(res.status, 0, res.stderr);
  assert.strictEqual(res.stdout.trim(), 'minimal');
});

test('config_bool accepts common spellings and falls back for invalid input', () => {
  const root = tmpRoot();
  const res = sh(root, [
    'printf "%s|" "$(dhpk_config_bool feature true)"',
    'export CLAUDE_PLUGIN_OPTION_FEATURE=off; printf "%s|" "$(dhpk_config_bool feature true)"',
    'export CLAUDE_PLUGIN_OPTION_FEATURE=maybe; printf "%s" "$(dhpk_config_bool feature false)"',
  ].join('; '));
  assert.strictEqual(res.status, 0, res.stderr);
  assert.strictEqual(res.stdout, 'true|false|false');
});

test('config_csv trims blanks and emits a stable comma-separated value', () => {
  const root = tmpRoot();
  settings(root, { modules: [' php ', 'laravel', ''] });
  const res = sh(root, 'dhpk_config_csv modules fallback');
  assert.strictEqual(res.status, 0, res.stderr);
  assert.strictEqual(res.stdout.trim(), 'php,laravel');
});

test('runtime config is safe when no project settings or Python are available', () => {
  const root = tmpRoot();
  const res = sh(root, 'dhpk_config_profile; printf "\\n"; dhpk_config_bool absent false; printf "\\n"; dhpk_config_csv absent fallback; printf "\\n"');
  assert.strictEqual(res.status, 0, res.stderr);
  assert.deepStrictEqual(res.stdout.trim().split('\n'), ['standard', 'false', 'fallback']);
});

test('codex timeout selection is scope-first and role-specific within a scope', () => {
  const root = tmpRoot();
  settings(root, { codex_timeout_secs: '900', codex_worker_timeout_secs: '1200', codex_fast_worker_timeout_secs: '30' });
  const res = sh(root,
    'dhpk_codex_timeout_export codex-worker; printf "%s|%s|%s" "$DHPK_CODEX_TIMEOUT_SECS" "$DHPK_CODEX_TIMEOUT_SOURCE" "$DHPK_CODEX_ROLE"',
    {
      CLAUDE_PLUGIN_OPTION_CODEX_TIMEOUT_SECS: '1800',
      CLAUDE_PLUGIN_OPTION_CODEX_WORKER_TIMEOUT_SECS: '2400',
    });
  assert.strictEqual(res.status, 0, res.stderr);
  assert.strictEqual(res.stdout, '1200|project:codex_worker_timeout_secs|codex-worker');
});

test('legacy role labels translate before timeout lookup while canonical keys retain precedence', () => {
  const root = tmpRoot();
  settings(root, {
    codex_worker_timeout_secs: '1200', codex_fast_worker_timeout_secs: '30',
    codex_reviewer_timeout_secs: '600', codex_bridge_timeout_secs: '15',
  });
  const worker = sh(root,
    'dhpk_codex_timeout_export codex-fast-worker; printf "%s|%s|%s" "$DHPK_CODEX_TIMEOUT_SECS" "$DHPK_CODEX_TIMEOUT_SOURCE" "$DHPK_CODEX_ROLE"');
  assert.strictEqual(worker.status, 0, worker.stderr);
  assert.strictEqual(worker.stdout, '1200|project:codex_worker_timeout_secs|codex-worker');

  const reviewer = sh(root,
    'dhpk_codex_timeout_export codex-bridge read-only; printf "%s|%s|%s" "$DHPK_CODEX_TIMEOUT_SECS" "$DHPK_CODEX_TIMEOUT_SOURCE" "$DHPK_CODEX_ROLE"');
  assert.strictEqual(reviewer.status, 0, reviewer.stderr);
  assert.strictEqual(reviewer.stdout, '600|project:codex_reviewer_timeout_secs|codex-reviewer');

  const bridgeWorker = sh(root,
    'dhpk_codex_timeout_export codex-bridge workspace-write; printf "%s|%s|%s" "$DHPK_CODEX_TIMEOUT_SECS" "$DHPK_CODEX_TIMEOUT_SOURCE" "$DHPK_CODEX_ROLE"');
  assert.strictEqual(bridgeWorker.status, 0, bridgeWorker.stderr);
  assert.strictEqual(bridgeWorker.stdout, '1200|project:codex_worker_timeout_secs|codex-worker');

  const missingMode = sh(root, 'dhpk_codex_timeout_export codex-bridge');
  assert.notStrictEqual(missingMode.status, 0);
  assert.ok(missingMode.stderr.includes('explicit mode'), missingMode.stderr);
});

test('propagated timeout identity cannot retain a prior alias identity', () => {
  const res = sh(tmpRoot(), [
    'dhpk_codex_timeout_export codex-fast-worker',
    'dhpk_codex_timeout_export_resolved codex-reviewer 600 upstream',
    'printf "%s|%s|%s" "${DHPK_CODEX_REQUESTED_ROLE-unset}" "$DHPK_CODEX_EFFECTIVE_ROLE" "$DHPK_CODEX_ROLE"',
  ].join('; '));
  assert.strictEqual(res.status, 0, res.stderr);
  assert.strictEqual(res.stdout, 'unset|codex-reviewer|codex-reviewer');
});

test('project shared timeout wins over a more specific global role timeout', () => {
  const root = tmpRoot();
  settings(root, { codex_timeout_secs: '900' });
  const res = sh(root,
    'dhpk_codex_timeout_export codex-worker; printf "%s|%s" "$DHPK_CODEX_TIMEOUT_SECS" "$DHPK_CODEX_TIMEOUT_SOURCE"',
    { CLAUDE_PLUGIN_OPTION_CODEX_WORKER_TIMEOUT_SECS: '1800' });
  assert.strictEqual(res.status, 0, res.stderr);
  assert.strictEqual(res.stdout, '900|project:codex_timeout_secs');
});

test('global role timeout wins over global shared timeout and default is 360', () => {
  const root = tmpRoot();
  const globalRole = sh(root,
    'dhpk_codex_timeout_export codex-reasoner; printf "%s|%s" "$DHPK_CODEX_TIMEOUT_SECS" "$DHPK_CODEX_TIMEOUT_SOURCE"',
    {
      CLAUDE_PLUGIN_OPTION_CODEX_TIMEOUT_SECS: '900',
      CLAUDE_PLUGIN_OPTION_CODEX_REASONER_TIMEOUT_SECS: '1200',
    });
  assert.strictEqual(globalRole.status, 0, globalRole.stderr);
  assert.strictEqual(globalRole.stdout, '1200|global:codex_reasoner_timeout_secs');

  const shipped = sh(root,
    'dhpk_codex_timeout_export codex-reviewer; printf "%s|%s" "$DHPK_CODEX_TIMEOUT_SECS" "$DHPK_CODEX_TIMEOUT_SOURCE"');
  assert.strictEqual(shipped.status, 0, shipped.stderr);
  assert.strictEqual(shipped.stdout, '360|default');
});

test('legacy CODEX_WRAP_TIMEOUT_SECS override is highest precedence and zero disables', () => {
  const root = tmpRoot();
  settings(root, { codex_timeout_secs: '900', codex_worker_timeout_secs: '1200' });
  const override = sh(root,
    'dhpk_codex_timeout_export codex-worker; printf "%s|%s|%s" "$DHPK_CODEX_TIMEOUT_SECS" "$DHPK_CODEX_TIMEOUT_SOURCE" "$DHPK_CODEX_TIMEOUT_DISABLED"',
    { CODEX_WRAP_TIMEOUT_SECS: '42' });
  assert.strictEqual(override.status, 0, override.stderr);
  assert.strictEqual(override.stdout, '42|env:CODEX_WRAP_TIMEOUT_SECS|false');

  const disabled = sh(root,
    'dhpk_codex_timeout_export codex-worker; printf "%s|%s" "$DHPK_CODEX_TIMEOUT_SECS" "$DHPK_CODEX_TIMEOUT_DISABLED"',
    { CODEX_WRAP_TIMEOUT_SECS: '0' });
  assert.strictEqual(disabled.status, 0, disabled.stderr);
  assert.strictEqual(disabled.stdout, '0|true');
});

test('malformed and unknown Codex timeout inputs fail closed with a clear error', () => {
  for (const value of ['', '-1', '1.5', 'nope']) {
    const res = sh(tmpRoot(), 'dhpk_codex_timeout_export codex-worker', {
      CODEX_WRAP_TIMEOUT_SECS: value,
    });
    assert.notStrictEqual(res.status, 0, `expected invalid value to fail: ${JSON.stringify(value)}`);
    assert.ok(res.stderr.includes('invalid Codex timeout'), `missing invalid-value error for ${JSON.stringify(value)}: ${res.stderr}`);
  }

  const unknown = sh(tmpRoot(), 'dhpk_codex_timeout_export unknown-role');
  assert.notStrictEqual(unknown.status, 0);
  assert.ok(unknown.stderr.includes('unknown Codex role'), unknown.stderr);
});

test('outer budget diagnostics are explicit when absent or too short', () => {
  const unknown = sh(tmpRoot(),
    'dhpk_codex_timeout_export codex-reviewer; printf "%s" "$DHPK_CODEX_OUTER_BUDGET_STATUS"');
  assert.strictEqual(unknown.status, 0, unknown.stderr);
  assert.strictEqual(unknown.stdout, 'outer_budget=unknown');

  const warning = sh(tmpRoot(),
    'dhpk_codex_timeout_export codex-reviewer; printf "%s" "$DHPK_CODEX_OUTER_BUDGET_STATUS"',
    { CODEX_WRAP_TIMEOUT_SECS: '10', DHPK_OUTER_BUDGET_SECS: '10' });
  assert.strictEqual(warning.status, 0, warning.stderr);
  assert.strictEqual(warning.stdout, 'outer_budget=10 warning=outer_budget_not_longer_than_inner');
});

run('runtime-config');
