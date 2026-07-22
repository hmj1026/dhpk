'use strict';

// Version freshness for the session install-health gate (change:
// add-session-install-health-gate, tasks 4.1-4.4, 6.2).
//
// Everything is computed from local state — no network. Fixtures stand in for
// ~/.claude/plugins via DHPK_PLUGINS_DIR.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const LIB = path.join(ROOT, 'scripts', 'hooks', '_lib', 'install-health.sh');
const CHECK_VERSION = path.join(ROOT, 'scripts', 'hooks', 'check-plugin-version.sh');

function writeJson(fp, obj) {
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, JSON.stringify(obj, null, 2));
}

function daysAgo(n) {
  return new Date(Date.now() - n * 86400 * 1000).toISOString();
}

// Build a fixture ~/.claude/plugins tree.
//   installed   — installed dhpk version (null to omit the plugin entry)
//   available   — version in the marketplace's plugin manifest
//   source      — marketplace source object
//   fetchedDays — age of the marketplace's lastUpdated
//   extraPlugins— additional entries in marketplace.json's plugins array
function mkPluginsDir({
  installed = '0.28.17',
  available = '0.29.0',
  source = { source: 'github', repo: 'hmj1026/dhpk' },
  fetchedDays = 40,
  extraPlugins = [],
  pluginSource = './',
} = {}) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-plugins-')));
  const mktLocation = path.join(dir, 'marketplaces', 'dhpk');

  const plugins = {};
  if (installed !== null) {
    plugins['dhpk@dhpk'] = [
      { scope: 'user', installPath: path.join(dir, 'cache', 'dhpk', 'dhpk', installed), version: installed },
    ];
  }
  writeJson(path.join(dir, 'installed_plugins.json'), { version: 2, plugins });
  writeJson(path.join(dir, 'known_marketplaces.json'), {
    dhpk: { source, installLocation: mktLocation, lastUpdated: daysAgo(fetchedDays) },
  });
  writeJson(path.join(mktLocation, '.claude-plugin', 'marketplace.json'), {
    name: 'dhpk',
    plugins: [...extraPlugins, { name: 'dhpk', source: pluginSource }],
  });
  const pluginDir = path.resolve(mktLocation, pluginSource);
  writeJson(path.join(pluginDir, '.claude-plugin', 'plugin.json'), { name: 'dhpk', version: available });
  return dir;
}

// Run one function from install-health.sh against a fixture plugins dir.
function callLib(fn, { pluginsDir, projectDir, env = {} } = {}) {
  return spawnSync('bash', ['-c', '. "$1"; ' + fn, '_', LIB], {
    encoding: 'utf8',
    env: {
      ...process.env,
      DHPK_PLUGINS_DIR: pluginsDir || '',
      CLAUDE_PROJECT_DIR: projectDir || '',
      ...env,
    },
    timeout: 10000,
  });
}

function state(pluginsDir) {
  const res = callLib('dhpk_version_state', { pluginsDir });
  assert.strictEqual(res.status, 0, res.stderr);
  const out = {};
  for (const kv of res.stdout.trim().split(/\s+/).filter(Boolean)) {
    const i = kv.indexOf('=');
    out[kv.slice(0, i)] = kv.slice(i + 1);
  }
  return out;
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function withPlugins(opts, fn) {
  const dir = mkPluginsDir(opts);
  try {
    return fn(dir);
  } finally {
    cleanup(dir);
  }
}

// ---- 4.1 version resolution ----

test('installed behind by a minor version raises the question', () => {
  withPlugins({ installed: '0.28.17', available: '0.29.0' }, (dir) => {
    const s = state(dir);
    assert.strictEqual(s.installed, '0.28.17');
    assert.strictEqual(s.available, '0.29.0');
    assert.strictEqual(s.gap, 'minor');
    assert.strictEqual(s.ask, '1', `minor gap must raise the question: ${JSON.stringify(s)}`);
  });
});

test('installed behind by a major version raises the question', () => {
  withPlugins({ installed: '0.28.17', available: '1.0.0' }, (dir) => {
    const s = state(dir);
    assert.strictEqual(s.gap, 'major');
    assert.strictEqual(s.ask, '1');
  });
});

test('installed behind by a patch only does not raise the question', () => {
  withPlugins({ installed: '0.28.17', available: '0.28.18' }, (dir) => {
    const s = state(dir);
    assert.strictEqual(s.gap, 'patch');
    assert.strictEqual(s.ask, '0', `patch drift must be advisory only: ${JSON.stringify(s)}`);
  });
});

test('equal versions raise no question', () => {
  withPlugins({ installed: '0.29.0', available: '0.29.0' }, (dir) => {
    const s = state(dir);
    assert.strictEqual(s.gap, 'none');
    assert.strictEqual(s.ask, '0');
  });
});

test('an installed version ahead of the marketplace raises no question', () => {
  withPlugins({ installed: '0.30.0', available: '0.29.0' }, (dir) => {
    const s = state(dir);
    assert.strictEqual(s.ask, '0', `a dev install ahead of the marketplace must not nag: ${JSON.stringify(s)}`);
  });
});

// ---- 4.1 directory-source exemption (design D4) ----

test('a directory-source marketplace raises no question even when versions differ', () => {
  withPlugins(
    { installed: '0.28.17', available: '0.29.0', source: { source: 'directory', path: '/home/paul/projects/dhpk' } },
    (dir) => {
      const s = state(dir);
      assert.strictEqual(s.ask, '0', `directory installs must be exempt: ${JSON.stringify(s)}`);
      assert.strictEqual(s.source, 'directory');
    }
  );
});

// ---- 4.1 the correct entry is picked from a multi-plugin marketplace ----

test('the dhpk entry is selected by name from a multi-plugin marketplace', () => {
  withPlugins(
    {
      installed: '0.28.17',
      available: '0.29.0',
      extraPlugins: [
        { name: 'other-plugin', source: './other' },
        { name: 'another-plugin', source: './another' },
      ],
    },
    (dir) => {
      // Give the decoy entries manifests with a wildly different version.
      const mkt = path.join(dir, 'marketplaces', 'dhpk');
      writeJson(path.join(mkt, 'other', '.claude-plugin', 'plugin.json'), { name: 'other-plugin', version: '9.9.9' });
      writeJson(path.join(mkt, 'another', '.claude-plugin', 'plugin.json'), { name: 'another-plugin', version: '8.8.8' });
      const s = state(dir);
      assert.strictEqual(s.available, '0.29.0', `wrong plugin manifest was read: ${JSON.stringify(s)}`);
    }
  );
});

// ---- 4.1 degrade silently ----

test('a missing plugins directory is a silent no-op that still exits 0', () => {
  const res = callLib('dhpk_version_state', { pluginsDir: '/nonexistent/dhpk/plugins' });
  assert.strictEqual(res.status, 0, res.stderr);
  assert.strictEqual(res.stdout.trim(), '');
});

test('unparseable state files are a silent no-op that still exits 0', () => {
  withPlugins({}, (dir) => {
    fs.writeFileSync(path.join(dir, 'installed_plugins.json'), '{ not json at all');
    const res = callLib('dhpk_version_state', { pluginsDir: dir });
    assert.strictEqual(res.status, 0, res.stderr);
    assert.strictEqual(res.stdout.trim(), '');
  });
});

test('an unparseable marketplace file is a silent no-op that still exits 0', () => {
  withPlugins({}, (dir) => {
    fs.writeFileSync(path.join(dir, 'known_marketplaces.json'), 'nope');
    const res = callLib('dhpk_version_state', { pluginsDir: dir });
    assert.strictEqual(res.status, 0, res.stderr);
    assert.strictEqual(res.stdout.trim(), '');
  });
});

test('a missing plugin manifest at the resolved source is a silent no-op', () => {
  withPlugins({}, (dir) => {
    fs.rmSync(path.join(dir, 'marketplaces', 'dhpk', '.claude-plugin', 'plugin.json'), { force: true });
    const res = callLib('dhpk_version_state', { pluginsDir: dir });
    assert.strictEqual(res.status, 0, res.stderr);
    assert.strictEqual(res.stdout.trim(), '');
  });
});

test('dhpk absent from installed_plugins is a silent no-op', () => {
  withPlugins({ installed: null }, (dir) => {
    const res = callLib('dhpk_version_state', { pluginsDir: dir });
    assert.strictEqual(res.status, 0, res.stderr);
    assert.strictEqual(res.stdout.trim(), '');
  });
});

// ---- 4.3 currency claims are bounded by fetch age (design D5) ----

const BARE_CURRENCY = ['up to date', 'up-to-date'];

function message(pluginsDir, projectDir) {
  const res = callLib('dhpk_version_message', { pluginsDir, projectDir });
  assert.strictEqual(res.status, 0, res.stderr);
  return res.stdout;
}

test('the currency message carries the fetch age and never claims bare currency', () => {
  withPlugins({ installed: '0.29.0', available: '0.29.0', fetchedDays: 40 }, (dir) => {
    const msg = message(dir);
    assert.ok(/40 days ago/.test(msg), `fetch age missing from: ${msg}`);
    for (const phrase of BARE_CURRENCY) {
      assert.ok(!msg.toLowerCase().includes(phrase), `bare-currency phrase "${phrase}" in: ${msg}`);
    }
    // "current" is permitted only when an age qualifier accompanies it.
    if (/\bcurrent\b/i.test(msg)) {
      assert.ok(/\bcurrent\b[^.]*ago/i.test(msg), `"current" used without an age qualifier: ${msg}`);
    }
  });
});

test('the stale message also carries the fetch age', () => {
  withPlugins({ installed: '0.28.17', available: '0.29.0', fetchedDays: 12 }, (dir) => {
    const msg = message(dir);
    assert.ok(/12 days ago/.test(msg), `fetch age missing from: ${msg}`);
  });
});

// ---- 6.2 remediation is a command, not an action ----

test('the stale message carries the exact update command and the fresh-session caveat', () => {
  withPlugins({ installed: '0.28.17', available: '0.29.0' }, (dir) => {
    const msg = message(dir);
    assert.ok(msg.includes('claude plugin update dhpk@dhpk'), `exact update command missing: ${msg}`);
    assert.ok(/fresh session/i.test(msg), `fresh-session caveat missing: ${msg}`);
  });
});

test('the stale message points at claude-health rather than duplicating its audit', () => {
  withPlugins({ installed: '0.28.17', available: '0.29.0' }, (dir) => {
    const msg = message(dir);
    assert.ok(/claude-health/.test(msg), `claude-health pointer missing: ${msg}`);
  });
});

// ---- 4.4 version messages do not stack ----

function tempProject() {
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-pinproj-')));
  spawnSync('git', ['init', '-q'], { cwd: repo });
  return repo;
}

function writePin(repo, pins) {
  writeJson(path.join(repo, '.claude', 'dhpk-versions.json'), pins);
}

// (a) both would speak — the pin advisory wins and freshness is suppressed.
test('a pin file with something to say suppresses the freshness finding', () => {
  withPlugins({ installed: '0.28.17', available: '0.29.0' }, (dir) => {
    const repo = tempProject();
    try {
      writePin(repo, { verified: [{ range: '0.27.x' }] }); // 0.28.17 is unverified -> advisory speaks
      const msg = message(dir, repo);
      assert.strictEqual(msg.trim(), '', `freshness spoke over an active pin advisory: ${msg}`);
    } finally {
      cleanup(repo);
    }
  });
});

// (b) no pin file at all — freshness is emitted.
test('freshness speaks when the project has no pin file at all', () => {
  withPlugins({ installed: '0.28.17', available: '0.29.0' }, (dir) => {
    const repo = tempProject();
    try {
      const msg = message(dir, repo);
      assert.ok(msg.includes('0.29.0'), `freshness should speak with no pin file: ${msg}`);
    } finally {
      cleanup(repo);
    }
  });
});

// (c) the distinguishing case: pin file present and SILENT (verified covers the
// running version), but the available version is outside the verified ranges.
// Keying on advisory-silence would recommend an upgrade the project's own
// policy has not blessed.
test('a silent pin advisory does not license recommending an unblessed upgrade', () => {
  withPlugins({ installed: '0.28.17', available: '0.29.0' }, (dir) => {
    const repo = tempProject();
    try {
      writePin(repo, { verified: [{ range: '0.28.x' }] }); // covers 0.28.17 -> advisory silent
      const msg = message(dir, repo);
      assert.ok(!/claude plugin update/.test(msg), `upgrade recommended against an existing pin policy: ${msg}`);
      if (msg.trim()) {
        assert.ok(
          /pin|dhpk-versions\.json/i.test(msg),
          `output must name the pin file as the reason: ${msg}`
        );
      }
    } finally {
      cleanup(repo);
    }
  });
});

test('check-plugin-version.sh still exits 0 and stays silent without a pin file', () => {
  const repo = tempProject();
  try {
    const res = spawnSync('bash', [CHECK_VERSION], {
      cwd: repo,
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_PROJECT_DIR: repo, CLAUDE_PLUGIN_ROOT: ROOT },
      timeout: 10000,
    });
    assert.strictEqual(res.status, 0, res.stderr);
    assert.strictEqual(res.stdout.trim(), '');
  } finally {
    cleanup(repo);
  }
});

run('session-install-health-version');
