'use strict';

// Ask composition, state-keyed suppression, remediation contract and
// SessionStart wiring for the install-health gate (change:
// add-session-install-health-gate, tasks 5.1-5.4, 6.1).

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const LIB = path.join(ROOT, 'scripts', 'hooks', '_lib', 'install-health.sh');
const SESSION_START = path.join(ROOT, 'scripts', 'hooks', 'session-start.sh');

const CONTRADICTED = 'php-5.6,laravel-5.4';

function writeJson(fp, obj) {
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, JSON.stringify(obj, null, 2));
}

function daysAgo(n) {
  return new Date(Date.now() - n * 86400 * 1000).toISOString();
}

function mkPluginsDir({ installed = '0.28.17', available = '0.29.0' } = {}) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-ask-plugins-')));
  const mkt = path.join(dir, 'marketplaces', 'dhpk');
  writeJson(path.join(dir, 'installed_plugins.json'), {
    version: 2,
    plugins: { 'dhpk@dhpk': [{ scope: 'user', version: installed }] },
  });
  writeJson(path.join(dir, 'known_marketplaces.json'), {
    dhpk: {
      source: { source: 'github', repo: 'hmj1026/dhpk' },
      installLocation: mkt,
      lastUpdated: daysAgo(9),
    },
  });
  writeJson(path.join(mkt, '.claude-plugin', 'marketplace.json'), {
    name: 'dhpk',
    plugins: [{ name: 'dhpk', source: './' }],
  });
  writeJson(path.join(mkt, '.claude-plugin', 'plugin.json'), { name: 'dhpk', version: available });
  return dir;
}

// A project with js evidence and no manifests — the dhpk shape.
function mkProject() {
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-ask-proj-')));
  spawnSync('git', ['init', '-q'], { cwd: repo });
  fs.mkdirSync(path.join(repo, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'scripts', 'thing.js'), 'module.exports = 1;\n');
  return repo;
}

function report(repo, modules, { pluginsDir = '', env = {} } = {}) {
  const res = spawnSync(
    'bash',
    ['-c', '. "$1"; dhpk_install_health_report "$2" "$3"', '_', LIB, repo, modules],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        DHPK_PLUGINS_DIR: pluginsDir,
        CLAUDE_PROJECT_DIR: repo,
        ...env,
      },
      timeout: 10000,
    }
  );
  assert.strictEqual(res.status, 0, res.stderr);
  return res.stdout;
}

function rm(...dirs) {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
}

function countOccurrences(haystack, needle) {
  return haystack.split(needle).length - 1;
}

// ---- 5.1 single-question guarantee ----

test('both checks firing produce exactly one question-raising instruction', () => {
  const repo = mkProject();
  const plugins = mkPluginsDir();
  try {
    const out = report(repo, CONTRADICTED, { pluginsDir: plugins });
    assert.ok(out.trim().length > 0, 'both checks fired but nothing was emitted');
    assert.strictEqual(
      countOccurrences(out, 'AskUserQuestion'),
      1,
      `expected exactly one AskUserQuestion instruction:\n${out}`
    );
    // Both findings are covered by that one question.
    assert.ok(out.includes('0.29.0'), `version finding missing:\n${out}`);
    assert.ok(out.includes('php-5.6'), `module finding missing:\n${out}`);
    // The instruction must itself say one question covering all findings.
    assert.ok(/\bone\b/i.test(out) && /\bsingle\b|\bexactly one\b/i.test(out), `single-question wording missing:\n${out}`);
  } finally {
    rm(repo, plugins);
  }
});

test('no findings produce no instruction at all', () => {
  const repo = mkProject();
  const plugins = mkPluginsDir({ installed: '0.29.0', available: '0.29.0' });
  try {
    // `js` matches the project's evidence and versions are equal.
    assert.strictEqual(report(repo, 'js', { pluginsDir: plugins }).trim(), '');
  } finally {
    rm(repo, plugins);
  }
});

test('a module finding alone still produces exactly one question', () => {
  const repo = mkProject();
  const plugins = mkPluginsDir({ installed: '0.29.0', available: '0.29.0' });
  try {
    const out = report(repo, CONTRADICTED, { pluginsDir: plugins });
    assert.strictEqual(countOccurrences(out, 'AskUserQuestion'), 1, out);
    assert.ok(!out.includes('0.29.0 available'), `version should not be a finding here:\n${out}`);
  } finally {
    rm(repo, plugins);
  }
});

test('a version finding alone still produces exactly one question', () => {
  const repo = mkProject();
  const plugins = mkPluginsDir();
  try {
    const out = report(repo, 'js', { pluginsDir: plugins });
    assert.strictEqual(countOccurrences(out, 'AskUserQuestion'), 1, out);
    assert.ok(!out.includes('php-5.6'), out);
  } finally {
    rm(repo, plugins);
  }
});

// ---- Patch drift is advisory, not silent (design D6 / spec "Patch gap is
// advisory only"). Advisory-only means unasked, NOT unsaid. Both reviewers
// found the gate emitting nothing at all for a patch gap. ----

test('a patch gap is reported in the advisory output with no question raised', () => {
  const repo = mkProject();
  const plugins = mkPluginsDir({ installed: '0.28.17', available: '0.28.18' });
  try {
    const out = report(repo, 'js', { pluginsDir: plugins });
    assert.ok(out.trim().length > 0, 'patch drift produced no advisory output at all');
    assert.ok(out.includes('0.28.18'), `available patch version missing:\n${out}`);
    assert.strictEqual(
      countOccurrences(out, 'AskUserQuestion'),
      0,
      `a patch gap must not raise a question:\n${out}`
    );
  } finally {
    rm(repo, plugins);
  }
});

test('a patch gap reaches the session-start output', () => {
  const repo = mkProject();
  const plugins = mkPluginsDir({ installed: '0.28.17', available: '0.28.18' });
  try {
    const res = sessionStart(repo, { pluginsDir: plugins, modules: 'js', session: 'patch-e2e' });
    assert.strictEqual(res.status, 0, res.stderr);
    assert.ok(res.stdout.includes('0.28.18'), `patch drift never reached session output:\n${res.stdout}`);
  } finally {
    rm(repo, plugins);
  }
});

test('an install ahead of the marketplace stays entirely silent', () => {
  const repo = mkProject();
  const plugins = mkPluginsDir({ installed: '0.30.0', available: '0.29.0' });
  try {
    // Distinct from the patch case: nothing to advise, so nothing is said.
    assert.strictEqual(report(repo, 'js', { pluginsDir: plugins }).trim(), '');
  } finally {
    rm(repo, plugins);
  }
});

test('equal versions alone stay silent but carry fetch age when the gate speaks anyway', () => {
  const repo = mkProject();
  const plugins = mkPluginsDir({ installed: '0.29.0', available: '0.29.0' });
  try {
    // Alone: silent. A healthy install is not told it is healthy.
    assert.strictEqual(report(repo, 'js', { pluginsDir: plugins }).trim(), '');
    // Speaking for a module finding: the currency claim appears, and D5
    // requires it to be bounded by the marketplace fetch age.
    const out = report(repo, CONTRADICTED, { pluginsDir: plugins });
    assert.ok(/9 days ago/.test(out), `currency claim missing its fetch age:\n${out}`);
    for (const phrase of ['up to date', 'up-to-date']) {
      assert.ok(!out.toLowerCase().includes(phrase), `bare-currency phrase "${phrase}" in:\n${out}`);
    }
    // No upgrade to recommend when there is no newer version.
    assert.ok(
      !out.includes('claude plugin update'),
      `an upgrade was recommended with no newer version available:\n${out}`
    );
  } finally {
    rm(repo, plugins);
  }
});

// ---- The precomputed-mismatch argument (avoids a second source census) ----

test('a precomputed mismatch argument is used instead of recomputing', () => {
  const repo = mkProject();
  const plugins = mkPluginsDir({ installed: '0.29.0', available: '0.29.0' });
  try {
    // Pass a mismatch string the detector would never produce for this repo.
    const res = spawnSync(
      'bash',
      [
        '-c',
        '. "$1"; dhpk_install_health_report "$2" "$3" "$4"',
        '_',
        LIB,
        repo,
        'js',
        'configured=sentinel-module detected=js',
      ],
      {
        encoding: 'utf8',
        env: { ...process.env, DHPK_PLUGINS_DIR: plugins, CLAUDE_PROJECT_DIR: repo },
        timeout: 10000,
      }
    );
    assert.strictEqual(res.status, 0, res.stderr);
    assert.ok(res.stdout.includes('sentinel-module'), `precomputed mismatch was ignored:\n${res.stdout}`);
  } finally {
    rm(repo, plugins);
  }
});

test('an empty precomputed mismatch means no mismatch, not "recompute"', () => {
  const repo = mkProject();
  const plugins = mkPluginsDir({ installed: '0.29.0', available: '0.29.0' });
  try {
    // CONTRADICTED would produce a finding if recomputed; the explicit empty
    // third argument must suppress it.
    const res = spawnSync(
      'bash',
      ['-c', '. "$1"; dhpk_install_health_report "$2" "$3" "$4"', '_', LIB, repo, CONTRADICTED, ''],
      {
        encoding: 'utf8',
        env: { ...process.env, DHPK_PLUGINS_DIR: plugins, CLAUDE_PROJECT_DIR: repo },
        timeout: 10000,
      }
    );
    assert.strictEqual(res.status, 0, res.stderr);
    assert.strictEqual(res.stdout.trim(), '', `empty third arg was treated as unset:\n${res.stdout}`);
  } finally {
    rm(repo, plugins);
  }
});

// ---- 5.2 state-keyed suppression (design D8) ----

test('an unchanged dismissed finding stays quiet on the next session', () => {
  const repo = mkProject();
  const plugins = mkPluginsDir();
  try {
    const first = report(repo, CONTRADICTED, { pluginsDir: plugins });
    const second = report(repo, CONTRADICTED, { pluginsDir: plugins });
    assert.ok(first.trim().length > 0, 'first run said nothing');
    assert.strictEqual(second.trim(), '', `unchanged state asked twice:\n${second}`);
  } finally {
    rm(repo, plugins);
  }
});

test('a newer available version re-opens the question', () => {
  const repo = mkProject();
  const plugins = mkPluginsDir();
  const newer = mkPluginsDir({ installed: '0.28.17', available: '0.30.0' });
  try {
    assert.ok(report(repo, CONTRADICTED, { pluginsDir: plugins }).trim().length > 0);
    const after = report(repo, CONTRADICTED, { pluginsDir: newer });
    assert.ok(after.trim().length > 0, 'a newer release did not re-open the question');
    assert.ok(after.includes('0.30.0'), after);
  } finally {
    rm(repo, plugins, newer);
  }
});

test('a changed enabled module set re-opens the question', () => {
  const repo = mkProject();
  const plugins = mkPluginsDir();
  try {
    assert.ok(report(repo, CONTRADICTED, { pluginsDir: plugins }).trim().length > 0);
    const after = report(repo, 'php-5.6,laravel-5.4,phpunit-5.7', { pluginsDir: plugins });
    assert.ok(after.trim().length > 0, 'a changed module set did not re-open the question');
    assert.ok(after.includes('phpunit-5.7'), after);
  } finally {
    rm(repo, plugins);
  }
});

// ---- 5.x advisory-only fallback (design D7) ----

test('the advisory-only fallback names findings and raises no question', () => {
  const repo = mkProject();
  const plugins = mkPluginsDir();
  try {
    const out = report(repo, CONTRADICTED, { pluginsDir: plugins, env: { DHPK_INSTALL_HEALTH_ASK: '0' } });
    assert.ok(out.trim().length > 0, 'fallback emitted nothing');
    assert.strictEqual(countOccurrences(out, 'AskUserQuestion'), 0, `fallback still asked:\n${out}`);
    assert.ok(out.includes('php-5.6'), `fallback must still name the findings:\n${out}`);
    assert.ok(/claude-health/.test(out), `fallback must point at claude-health:\n${out}`);
  } finally {
    rm(repo, plugins);
  }
});

// ---- 6.1 remediation is offered, never applied ----

test('the gate writes no configuration file under any input', () => {
  const repo = mkProject();
  const plugins = mkPluginsDir();
  try {
    report(repo, CONTRADICTED, { pluginsDir: plugins });
    assert.ok(
      !fs.existsSync(path.join(repo, '.claude', 'settings.local.json')),
      'the gate wrote .claude/settings.local.json itself'
    );
    assert.ok(!fs.existsSync(path.join(repo, '.claude', 'settings.json')), 'the gate wrote .claude/settings.json');
    assert.ok(!fs.existsSync(path.join(repo, 'package.json')), 'the gate wrote a manifest');
    // Nothing in the fixture plugins dir may be mutated either.
    assert.ok(!fs.existsSync(path.join(plugins, 'settings.local.json')));
  } finally {
    rm(repo, plugins);
  }
});

test('the remediation text requires confirmation before any file is written', () => {
  const repo = mkProject();
  const plugins = mkPluginsDir();
  try {
    const out = report(repo, CONTRADICTED, { pluginsDir: plugins });
    assert.ok(out.includes('.claude/settings.local.json'), `override target not named:\n${out}`);
    assert.ok(/confirm/i.test(out), `confirm-then-write wording missing:\n${out}`);
    assert.ok(/only after/i.test(out), `confirm-then-write ordering missing:\n${out}`);
  } finally {
    rm(repo, plugins);
  }
});

// ---- 5.4 SessionStart wiring ----

function sessionStart(repo, { pluginsDir = '', modules = CONTRADICTED, session = 'ask-e2e' } = {}) {
  return spawnSync('bash', ['-c', 'printf %s "$P" | bash "$1"', '_', SESSION_START], {
    cwd: repo,
    encoding: 'utf8',
    env: {
      ...process.env,
      CLAUDE_PLUGIN_ROOT: ROOT,
      CLAUDE_PROJECT_DIR: repo,
      DHPK_PLUGINS_DIR: pluginsDir,
      CLAUDE_PLUGIN_OPTION_MODULES: modules,
      CLAUDE_PLUGIN_OPTION_HOOK_PROFILE: 'standard',
      P: JSON.stringify({ source: 'startup', session_id: session }),
    },
    timeout: 15000,
  });
}

test('session-start still exits 0 with findings present', () => {
  const repo = mkProject();
  const plugins = mkPluginsDir();
  try {
    const res = sessionStart(repo, { pluginsDir: plugins });
    assert.strictEqual(res.status, 0, `session-start failed with findings:\n${res.stderr}`);
  } finally {
    rm(repo, plugins);
  }
});

test('session-start emits the gate once and does not duplicate the existing mismatch warning', () => {
  const repo = mkProject();
  const plugins = mkPluginsDir();
  try {
    const res = sessionStart(repo, { pluginsDir: plugins });
    const all = res.stdout + res.stderr;
    assert.strictEqual(
      countOccurrences(all, 'WARN module/manifest mismatch'),
      1,
      `existing mismatch warning duplicated:\n${all}`
    );
    // Exactly one, not "at most one" — at most one also passes when the gate
    // was never wired in, which is the regression this test exists to catch.
    assert.strictEqual(
      countOccurrences(res.stdout, 'AskUserQuestion'),
      1,
      `expected exactly one question instruction on stdout:\n${all}`
    );
    assert.ok(res.stdout.includes('[dhpk install health]'), `gate block missing from stdout:\n${all}`);
    // The terse WARN is the operator log line on stderr; the gate block is the
    // model-facing instruction on stdout. Different channels, not a duplicate.
    assert.ok(!res.stderr.includes('[dhpk install health]'), `gate block leaked onto stderr:\n${res.stderr}`);
  } finally {
    rm(repo, plugins);
  }
});

test('session-start still exits 0 when plugin state is entirely absent', () => {
  const repo = mkProject();
  try {
    const res = sessionStart(repo, { pluginsDir: '/nonexistent/dhpk/plugins' });
    assert.strictEqual(res.status, 0, res.stderr);
  } finally {
    rm(repo);
  }
});

run('session-install-health-ask');
