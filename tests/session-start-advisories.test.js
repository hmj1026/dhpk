'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

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
  try { assert.strictEqual(detect(repo, 'php-5.6').stdout.trim(), ''); }
  finally { fs.rmSync(repo, { recursive: true, force: true }); }
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

test('session-start mismatch advisory dedups within session and re-advises in a new session', () => {
  const repo = tempRepo();
  try {
    fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ dependencies: { next: '^16', react: '^19' } }));
    const first = sessionStart(repo, 'one');
    const second = sessionStart(repo, 'one');
    const next = sessionStart(repo, 'two');
    assert.ok(first.stderr.includes('WARN module/manifest mismatch'), first.stderr);
    assert.ok(!second.stderr.includes('WARN module/manifest mismatch'), second.stderr);
    assert.ok(next.stderr.includes('WARN module/manifest mismatch'), next.stderr);
  } finally { fs.rmSync(repo, { recursive: true, force: true }); }
});

run('session-start-advisories');
