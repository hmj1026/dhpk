'use strict';

// SessionStart has one deterministic responsibility: activate configured
// modules. It must not create lifecycle artifacts or run health/orchestration
// diagnostics.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const HOOK = path.join(ROOT, 'scripts', 'hooks', 'session-start.sh');

function runInScratch(modules) {
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-ss-')));
  spawnSync('git', ['init', '-q'], { cwd: scratch });
  try {
    const env = {
      ...process.env,
      CLAUDE_PLUGIN_ROOT: ROOT,
      CLAUDE_PROJECT_DIR: scratch,
      CLAUDE_PLUGIN_OPTION_MODULES: modules || '',
    };
    const res = spawnSync('bash', ['-c', 'printf %s "$P" | bash "$1"', '_', HOOK], {
      cwd: scratch,
      env: { ...env, P: JSON.stringify({ source: 'startup' }) },
      encoding: 'utf8',
      timeout: 10000,
    });
    return { scratch, res };
  } catch (error) {
    fs.rmSync(scratch, { recursive: true, force: true });
    throw error;
  }
}

test('bash -n syntax check passes', () => {
  const res = spawnSync('bash', ['-n', HOOK], { encoding: 'utf8' });
  assert.strictEqual(res.status, 0, `syntax error: ${res.stderr}`);
});

test('no configured modules is a silent no-op with no lifecycle artifacts', () => {
  const { scratch, res } = runInScratch('');
  try {
    assert.strictEqual(res.status, 0, res.stderr);
    assert.strictEqual(res.stdout, '', `unexpected SessionStart output: ${res.stdout}`);
    assert.ok(!fs.existsSync(path.join(scratch, '.claude', 'artifacts')),
      'module activation must not create session snapshots or lifecycle artifacts');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('explicit canonical dispatch targets are reported without runtime probing', () => {
  const { scratch, res } = runInScratch('');
  try {
    const env = {
      ...process.env,
      CLAUDE_PLUGIN_ROOT: ROOT,
      CLAUDE_PROJECT_DIR: scratch,
      CLAUDE_PLUGIN_OPTION_WORKER_TARGET: 'codex-cli/sol5.6:high',
    };
    const report = spawnSync('bash', ['-c', 'bash "$1"', '_', HOOK], {
      cwd: scratch,
      env,
      encoding: 'utf8',
      timeout: 10000,
    });
    assert.strictEqual(report.status, 0, report.stderr);
    const prefix = '[session-start] dispatch config: ';
    const reportLines = report.stdout.split(/\r?\n/).filter((line) => line.startsWith(prefix));
    assert.strictEqual(reportLines.length, 1, report.stdout);
    const config = JSON.parse(reportLines[0].slice(prefix.length));
    assert.strictEqual(config.schema, 'dhpk.dispatch.config-report.v1');
    assert.deepStrictEqual(config.targets.worker, {
      target_agent: 'codex-cli',
      model_id: 'sol5.6',
      effort: 'high',
    });
    assert.strictEqual(config.sources.worker_target, 'environment.worker_target');
    assert.deepStrictEqual(config.status, {
      catalog_support: 'NOT_RUN',
      host_access: 'NOT_RUN',
      runtime: 'NOT_RUN',
      fallback: 'allowed',
    });
    assert.strictEqual(res.status, 0);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('configured modules are validated and reported without lifecycle diagnostics', () => {
  const { scratch, res } = runInScratch('php-5.6,not-a-module,php-5.6');
  try {
    assert.strictEqual(res.status, 0, res.stderr);
    assert.match(res.stdout, /module enabled: php-5\.6/);
    assert.match(res.stderr, /module 'not-a-module' not found/);
    assert.ok(!res.stdout.includes('snapshot') && !res.stdout.includes('orchestration'), res.stdout);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});


// Begin merged tests from tests/session-start-advisories.test.js.
{
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const DETECT = path.join(ROOT, 'scripts', 'hooks', '_lib', 'detect-stack-hints.sh');
const ADVISE = path.join(ROOT, 'scripts', 'hooks', '_lib', 'advise-once.sh');
const SESSION_START = path.join(ROOT, 'scripts', 'hooks', 'session-start.sh');

function tempRepo() {
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-stack-hints-')));
  spawnSync('git', ['init', '-q'], { cwd: repo });
  return repo;
}

function detect(repo, modules) {
  return spawnSync('bash', ['-c', '. "$1"; dhpk_detect_stack_mismatch "$2" "$3"', '_', DETECT, repo, modules], {
    encoding: 'utf8',
  });
}

test('PHP modules on a Next+React repo produce one actionable mismatch', () => {
  const repo = tempRepo();
  try {
    fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ dependencies: { next: '^16', react: '^19' } }));
    const res = detect(repo, 'php-5.6,laravel-5.4');
    assert.strictEqual(res.status, 0, res.stderr);
    assert.ok(res.stdout.includes('configured=php-5.6,laravel-5.4'), res.stdout);
    assert.ok(res.stdout.includes('detected=nextjs,react'), res.stdout);
  } finally { fs.rmSync(repo, { recursive: true, force: true }); }
});

test('polyglot manifests with configured PHP and JS families stay silent', () => {
  const repo = tempRepo();
  try {
    fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ dependencies: { next: '^16', react: '^19' } }));
    fs.writeFileSync(path.join(repo, 'composer.json'), JSON.stringify({ require: { php: '^8.2' } }));
    const res = detect(repo, 'php-8.x,nextjs-16,react-19');
    assert.strictEqual(res.status, 0, res.stderr);
    assert.strictEqual(res.stdout.trim(), '');
  } finally { fs.rmSync(repo, { recursive: true, force: true }); }
});

test('missing manifests stay silent', () => {
  const repo = tempRepo();
  try {
    const result = detect(repo, 'php-5.6');
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);
    assert.strictEqual(result.stdout, '');
  } finally { fs.rmSync(repo, { recursive: true, force: true }); }
});

test('dhpk_advise_once emits once per key/session and re-emits for a new session', () => {
  const repo = tempRepo();
  try {
    const script = '. "$1"; if dhpk_advise_once plugin-version; then echo EMIT; fi';
    const invoke = (session) => spawnSync('bash', ['-c', script, '_', ADVISE], {
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_PROJECT_DIR: repo, DHPK_ADVISE_SESSION_ID: session },
    });
    assert.strictEqual(invoke('one').stdout.trim(), 'EMIT');
    assert.strictEqual(invoke('one').stdout.trim(), '');
    assert.strictEqual(invoke('two').stdout.trim(), 'EMIT');
  } finally { fs.rmSync(repo, { recursive: true, force: true }); }
});

test('dhpk_advise_once falls back to emitting when marker directory creation fails', () => {
  const repo = tempRepo();
  try {
    fs.mkdirSync(path.join(repo, '.claude', 'artifacts'), { recursive: true });
    fs.writeFileSync(path.join(repo, '.claude', 'artifacts', 'sessions'), 'blocked');
    const res = spawnSync('bash', ['-c', '. "$1"; dhpk_advise_once fallback && echo EMIT', '_', ADVISE], {
      encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: repo, DHPK_ADVISE_SESSION_ID: 'one' },
    });
    assert.strictEqual(res.stdout.trim(), 'EMIT');
  } finally { fs.rmSync(repo, { recursive: true, force: true }); }
});

function sessionStart(repo, session) {
  return spawnSync('bash', ['-c', 'printf %s "$P" | bash "$1"', '_', SESSION_START], {
    cwd: repo,
    encoding: 'utf8',
    env: {
      ...process.env,
      CLAUDE_PLUGIN_ROOT: ROOT,
      CLAUDE_PROJECT_DIR: repo,
      CLAUDE_PLUGIN_OPTION_MODULES: 'php-5.6,laravel-5.4',
      CLAUDE_PLUGIN_OPTION_HOOK_PROFILE: 'standard',
      P: JSON.stringify({ source: 'startup', session_id: session }),
    },
    timeout: 10000,
  });
}

test('session-start does not run module/manifest advisory inference', () => {
  const repo = tempRepo();
  try {
    fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ dependencies: { next: '^16', react: '^19' } }));
    const result = sessionStart(repo, 'one');
    assert.strictEqual(result.status, 0, result.stderr);
    assert.ok(!result.stderr.includes('WARN module/manifest mismatch'), result.stderr);
  } finally { fs.rmSync(repo, { recursive: true, force: true }); }
});
}
// End merged tests from tests/session-start-advisories.test.js.


// Begin merged tests from tests/trap-sheet-detection.test.js.
{
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const loader = fs.readFileSync(
  path.join(ROOT, 'agent-traps', '_common', 'trap-sheet-loader.md'),
  'utf8'
);
test('DHPK_ACTIVE_MODULES overrides fallback detection', () => {
  assert.ok(loader.includes('read `$DHPK_ACTIVE_MODULES` (comma list) if set; it takes precedence over everything else'));
});

test('fallback detection is limited to project-root manifests and files', () => {
  assert.ok(loader.includes('detect only from PROJECT-ROOT manifests/files via Bash'));
});

test('root package.json emits generic js and Vue dependency keys additionally emit vue', () => {
  assert.ok(loader.includes('a root `package.json` emits the generic `js` signal'));
  assert.ok(loader.includes('a `vue` key present in its `dependencies`, `devDependencies`, or `peerDependencies` additionally emits `vue`'));
});

test('root composer.json or PHP files directly under the root emit php', () => {
  assert.ok(loader.includes('A root `composer.json` or PHP files directly under the repository root (`./*.php`) emits `php`'));
});

test('root xcode project or Swift manifest emits swift and pyproject.toml emits python', () => {
  assert.ok(loader.includes('`*.xcodeproj` / `Package.swift` emits `swift`; `pyproject.toml` emits `python`'));
});

test('next and react remain covered by generic js', () => {
  assert.ok(loader.includes('`next` and `react` keys remain covered by generic `js`'));
});

test('fallback detection does not recurse into vendored trees', () => {
  assert.ok(loader.includes('Detection MUST NOT recurse into `node_modules/`, `vendor/`, or other vendored trees'));
});

test('SessionStart activation is a separate, unchanged mechanism', () => {
  assert.ok(loader.includes("SessionStart's configured/versioned-module activation (`scripts/hooks/session-start.sh`) is a separate, unrelated mechanism and is unchanged by this fallback contract"));
});
}
// End merged tests from tests/trap-sheet-detection.test.js.

run('session-start');
