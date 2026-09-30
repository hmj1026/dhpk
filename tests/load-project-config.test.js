'use strict';

// Coverage for scripts/hooks/_lib/load-project-config.sh: overlays project
// pluginConfigs.dhpk@dhpk.options.* onto CLAUDE_PLUGIN_OPTION_* env vars, with
// settings.local.json preferred over settings.json, plus the DHPK_HOOK_PROFILE
// one-shot override.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const LIB = path.join(ROOT, 'scripts', 'hooks', '_lib', 'load-project-config.sh');

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-lpc-'));
}

function writeSettings(root, filename, options) {
  fs.mkdirSync(path.join(root, '.claude'), { recursive: true });
  const cfg = { pluginConfigs: { 'dhpk@dhpk': { options } } };
  fs.writeFileSync(path.join(root, '.claude', filename), JSON.stringify(cfg));
}

function sh(root, cmd, extraEnv) {
  const env = { ...process.env, ROOT: root, ...(extraEnv || {}) };
  delete env.DHPK_HOOK_PROFILE;
  delete env.DHPK_PROJECT_OPTION_HOOK_PROFILE;
  return spawnSync('bash', ['-c', `source "${LIB}"; ${cmd}`], { encoding: 'utf8', timeout: 10000, env });
}

test('exports CLAUDE_PLUGIN_OPTION_* from settings.local.json options', () => {
  const root = tmpRoot();
  writeSettings(root, 'settings.local.json', { hook_profile: 'minimal' });
  const res = sh(root, 'echo "$CLAUDE_PLUGIN_OPTION_HOOK_PROFILE"');
  assert.strictEqual(res.status, 0, res.stderr);
  assert.strictEqual(res.stdout.trim(), 'minimal');
});

test('settings.local.json takes precedence over settings.json', () => {
  const root = tmpRoot();
  writeSettings(root, 'settings.json', { hook_profile: 'full' });
  writeSettings(root, 'settings.local.json', { hook_profile: 'minimal' });
  const res = sh(root, 'echo "$CLAUDE_PLUGIN_OPTION_HOOK_PROFILE"');
  assert.strictEqual(res.status, 0, res.stderr);
  assert.strictEqual(res.stdout.trim(), 'minimal');
});

test('array option is joined with commas', () => {
  const root = tmpRoot();
  writeSettings(root, 'settings.local.json', { modules: ['php', 'laravel'] });
  const res = sh(root, 'echo "$CLAUDE_PLUGIN_OPTION_MODULES"');
  assert.strictEqual(res.status, 0, res.stderr);
  assert.strictEqual(res.stdout.trim(), 'php,laravel');
});

test('boolean option is converted to lowercase true/false string', () => {
  const root = tmpRoot();
  writeSettings(root, 'settings.local.json', { learning_db_enabled: true });
  const res = sh(root, 'echo "$CLAUDE_PLUGIN_OPTION_LEARNING_DB_ENABLED"');
  assert.strictEqual(res.status, 0, res.stderr);
  assert.strictEqual(res.stdout.trim(), 'true');
});

test('no settings file preserves a global option without creating a project marker', () => {
  const root = tmpRoot();
  const res = sh(
    root,
    'echo "OUT:[${CLAUDE_PLUGIN_OPTION_HOOK_PROFILE:-unset}]"; echo "PROJECT:[${DHPK_PROJECT_OPTION_HOOK_PROFILE:-unset}]"',
    { CLAUDE_PLUGIN_OPTION_HOOK_PROFILE: 'global-profile' },
  );
  assert.strictEqual(res.status, 0, res.stderr);
  assert.ok(res.stdout.includes('OUT:[global-profile]'), res.stdout);
  assert.ok(res.stdout.includes('PROJECT:[unset]'), res.stdout);
});

test('CLI-backed fast-worker model/effort keys pass through with standard layering', () => {
  const root = tmpRoot();
  writeSettings(root, 'settings.local.json', {
    codex_fast_worker_model: 'gpt-5.6-sol',
    codex_fast_worker_effort: 'high',
    agy_fast_worker_model: 'Gemini 3.6 Flash (High)',
  });
  const res = sh(
    root,
    'echo "M:$CLAUDE_PLUGIN_OPTION_CODEX_FAST_WORKER_MODEL"; ' +
      'echo "E:$CLAUDE_PLUGIN_OPTION_CODEX_FAST_WORKER_EFFORT"; ' +
      'echo "A:$CLAUDE_PLUGIN_OPTION_AGY_FAST_WORKER_MODEL"'
  );
  assert.strictEqual(res.status, 0, res.stderr);
  assert.ok(res.stdout.includes('M:gpt-5.6-sol'), res.stdout);
  assert.ok(res.stdout.includes('E:high'), res.stdout);
  // A value with spaces must round-trip intact (shlex.quote in the loader).
  assert.ok(res.stdout.includes('A:Gemini 3.6 Flash (High)'), res.stdout);
});

test('project settings.local.json overrides global settings.json for a CLI-worker key', () => {
  const root = tmpRoot();
  writeSettings(root, 'settings.json', { codex_fast_worker_model: 'gpt-5.6-luna' });
  writeSettings(root, 'settings.local.json', { codex_fast_worker_model: 'gpt-5.6-sol' });
  const res = sh(root, 'echo "$CLAUDE_PLUGIN_OPTION_CODEX_FAST_WORKER_MODEL"');
  assert.strictEqual(res.status, 0, res.stderr);
  assert.strictEqual(res.stdout.trim(), 'gpt-5.6-sol');
});

test('cross_provider keeps the project-scope marker for precedence resolution', () => {
  const root = tmpRoot();
  writeSettings(root, 'settings.json', { cross_provider: false });
  writeSettings(root, 'settings.local.json', { cross_provider: true });
  const res = sh(root, 'echo "$CLAUDE_PLUGIN_OPTION_CROSS_PROVIDER|$DHPK_PROJECT_OPTION_CROSS_PROVIDER"');
  assert.strictEqual(res.status, 0, res.stderr);
  assert.strictEqual(res.stdout.trim(), 'true|true');
});

test('DHPK_HOOK_PROFILE env one-shot override wins over settings file', () => {
  const root = tmpRoot();
  writeSettings(root, 'settings.local.json', { hook_profile: 'full' });
  const env = { ...process.env, ROOT: root, DHPK_HOOK_PROFILE: 'minimal' };
  const res = spawnSync('bash', ['-c', `source "${LIB}"; echo "$CLAUDE_PLUGIN_OPTION_HOOK_PROFILE"`], {
    encoding: 'utf8',
    timeout: 10000,
    env,
  });
  assert.strictEqual(res.status, 0, res.stderr);
  assert.strictEqual(res.stdout.trim(), 'minimal');
});

{
  // F45 source block: runtime-config.test.js
  'use strict';

  // Contract tests for the normalized runtime configuration seam. The loader
  // still exports CLAUDE_PLUGIN_OPTION_* for compatibility; these helpers define
  // the precedence and value normalization consumed by hooks.

  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { spawnSync } = require('node:child_process');
  const { test, assert } = require('./_lib/tinytest');

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
    return spawnSync('/bin/bash', ['-c', `source "${LOADER}"; source "${RUNTIME}"; ${command}`], {
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

  test('runtime config falls back safely when project settings exist but Python is unavailable', () => {
    const root = tmpRoot();
    const noPythonBin = tmpRoot();
    settings(root, { hook_profile: 'strict', modules: ['php'] });
    fs.symlinkSync(fs.realpathSync('/usr/bin/tr'), path.join(noPythonBin, 'tr'));
    fs.symlinkSync(fs.realpathSync('/usr/bin/awk'), path.join(noPythonBin, 'awk'));
    try {
      assert.ok(!fs.existsSync(path.join(noPythonBin, 'python3')));
      const res = sh(root,
        'dhpk_config_profile; printf "\\n"; dhpk_config_bool absent false; printf "\\n"; dhpk_config_csv absent fallback; printf "\\n"',
        { PATH: noPythonBin });
      assert.strictEqual(res.status, 0, res.stderr);
      assert.deepStrictEqual(res.stdout.trim().split('\n'), ['standard', 'false', 'fallback']);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(noPythonBin, { recursive: true, force: true });
    }
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
}

{
  // F45 source block: session-env.test.js
  'use strict';

  // Coverage for scripts/hooks/_lib/session-env.sh: the canonical project-root /
  // sessions-dir / payload-read resolution every hook sources, replacing three
  // divergent inline fallback chains.

  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { spawnSync } = require('node:child_process');
  const { test, assert } = require('./_lib/tinytest');

  const ROOT = path.join(__dirname, '..');
  const LIB = path.join(ROOT, 'scripts', 'hooks', '_lib', 'session-env.sh');

  function tmpDir(prefix) {
    return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  }

  function sh(cmd, { cwd, projectDir, input, sourceLib = true, extraEnv = {} } = {}) {
    const env = { ...process.env, ...extraEnv };
    delete env.GIT_DIR;
    delete env.GIT_WORK_TREE;
    if (projectDir === undefined) delete env.CLAUDE_PROJECT_DIR;
    else env.CLAUDE_PROJECT_DIR = projectDir;
    const source = sourceLib ? `source "${LIB}"; ` : '';
    return spawnSync('/bin/bash', ['-c', `set -euo pipefail; ${source}${cmd}`], {
      encoding: 'utf8',
      timeout: 10000,
      cwd: cwd || ROOT,
      env,
      input: input === undefined ? '' : input,
    });
  }

  test('dhpk_root prefers CLAUDE_PROJECT_DIR over git toplevel', () => {
    const project = tmpDir('dhpk-senv-proj-');
    // cwd is this repo (a git toplevel) — env must still win.
    const res = sh('dhpk_root', { projectDir: project });
    assert.strictEqual(res.status, 0, res.stderr);
    assert.strictEqual(res.stdout, project);
  });

  test('dhpk_root falls back to git toplevel from a repo subdirectory', () => {
    const repo = tmpDir('dhpk-senv-repo-');
    spawnSync('git', ['init', '-q'], { cwd: repo });
    const sub = path.join(repo, 'a', 'b');
    fs.mkdirSync(sub, { recursive: true });
    const res = sh('dhpk_root', { cwd: sub });
    assert.strictEqual(res.status, 0, res.stderr);
    assert.strictEqual(res.stdout, repo);
  });

  test('dhpk_root falls back to pwd outside any repo', () => {
    const dir = tmpDir('dhpk-senv-norepo-');
    const res = sh('dhpk_root', { cwd: dir });
    assert.strictEqual(res.status, 0, res.stderr);
    assert.strictEqual(res.stdout, dir);
  });

  test('dhpk_sessions_dir appends the sessions path to an explicit root', () => {
    const res = sh('dhpk_sessions_dir /some/root', {});
    assert.strictEqual(res.status, 0, res.stderr);
    assert.strictEqual(res.stdout, '/some/root/.claude/artifacts/sessions');
  });

  test('dhpk_sessions_dir resolves the root itself when no arg is given', () => {
    const project = tmpDir('dhpk-senv-sess-');
    const res = sh('dhpk_sessions_dir', { projectDir: project });
    assert.strictEqual(res.status, 0, res.stderr);
    assert.strictEqual(res.stdout, path.join(project, '.claude', 'artifacts', 'sessions'));
  });

  test('dhpk_read_payload echoes stdin and never fails', () => {
    const res = sh('PAYLOAD="$(dhpk_read_payload)"; printf "%s" "$PAYLOAD"', {
      input: '{"tool_input":{"file_path":"a.php"}}',
    });
    assert.strictEqual(res.status, 0, res.stderr);
    assert.strictEqual(res.stdout, '{"tool_input":{"file_path":"a.php"}}');
  });

  test('sidecar basename registry constants are defined', () => {
    const res = sh(
      'printf "%s\\n%s" "$DHPK_SIDECAR_MODULE_FINDINGS" "$DHPK_SIDECAR_FAST_WORKER_ACTIVE"',
      {}
    );
    assert.strictEqual(res.status, 0, res.stderr);
    assert.deepStrictEqual(res.stdout.split('\n'), [
      '.module-findings',
      '.active-fast-worker',
    ]);
  });

  test('sourcing twice leaves exported environment and project files unchanged', () => {
    const scratch = tmpDir('dhpk-senv-source-');
    try {
      const res = sh([
        'before_env="$(export -p)"',
        'before_files="$(find . -mindepth 1 -print | LC_ALL=C sort)"',
        'before_pwd="$PWD"',
        `source "${LIB}"`,
        `source "${LIB}"`,
        'after_env="$(export -p)"',
        'after_files="$(find . -mindepth 1 -print | LC_ALL=C sort)"',
        'test "$before_env" = "$after_env"',
        'test "$before_files" = "$after_files"',
        'test "$before_pwd" = "$PWD"',
        'test "$DHPK_SIDECAR_MODULE_FINDINGS" = ".module-findings"',
        'test "$DHPK_SIDECAR_FAST_WORKER_ACTIVE" = ".active-fast-worker"',
        'printf ok',
      ].join('; '), { cwd: scratch, projectDir: scratch, sourceLib: false });
      assert.strictEqual(res.status, 0, res.stderr);
      assert.strictEqual(res.stdout, 'ok');
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  });

  test('current session identity prefers the canonical value, falls back, and stays empty when absent', () => {
    const canonical = sh('dhpk_current_session_id', {
      extraEnv: { CLAUDE_CODE_SESSION_ID: 'canonical-session', CLAUDE_SESSION_ID: 'legacy-session' },
    });
    assert.strictEqual(canonical.status, 0, canonical.stderr);
    assert.strictEqual(canonical.stdout, 'canonical-session');

    const fallback = sh('dhpk_current_session_id', {
      extraEnv: { CLAUDE_CODE_SESSION_ID: '', CLAUDE_SESSION_ID: 'legacy-session' },
    });
    assert.strictEqual(fallback.status, 0, fallback.stderr);
    assert.strictEqual(fallback.stdout, 'legacy-session');

    const empty = sh('dhpk_current_session_id', {
      extraEnv: { CLAUDE_CODE_SESSION_ID: '', CLAUDE_SESSION_ID: '' },
    });
    assert.strictEqual(empty.status, 0, empty.stderr);
    assert.strictEqual(empty.stdout, '');
  });
}

run('load-project-config');
