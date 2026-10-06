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
//   installedRecords — explicit installed plugin records, for scope-selection cases
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
  installedRecords = null,
} = {}) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-plugins-')));
  const mktLocation = path.join(dir, 'marketplaces', 'dhpk');

  const plugins = {};
  if (installed !== null) {
    const defaultRecord = {
      scope: 'user',
      installPath: path.join(dir, 'cache', 'dhpk', 'dhpk', installed),
      version: installed,
    };
    plugins['dhpk@dhpk'] = (installedRecords || [defaultRecord]).map((record) => ({
      ...defaultRecord,
      ...record,
    }));
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

function state(pluginsDir, projectDir) {
  const res = callLib('dhpk_version_state', { pluginsDir, projectDir });
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
    assert.ok(msg.includes('claude plugin update -y dhpk@dhpk'), `exact update command missing: ${msg}`);
    assert.ok(/fresh session/i.test(msg), `fresh-session caveat missing: ${msg}`);
  });
});

test('a project-scoped installation is selected for the current project and gets a scoped non-interactive command', () => {
  const project = tempProject();
  try {
    withPlugins({
      available: '0.29.0',
      installedRecords: [
        { scope: 'user', version: '0.28.17' },
        { scope: 'project', version: '0.28.17', projectPath: project },
      ],
    }, (dir) => {
      const s = state(dir, project);
      assert.strictEqual(s.scope, 'project', `wrong installation selected: ${JSON.stringify(s)}`);
      const msg = message(dir, project);
      assert.ok(msg.includes('claude plugin update --scope project -y dhpk@dhpk'), `scoped update command missing: ${msg}`);
    });
  } finally {
    cleanup(project);
  }
});

test('a project installation for another project does not override the user installation', () => {
  const project = tempProject();
  try {
    withPlugins({
      available: '0.29.0',
      installedRecords: [
        { scope: 'project', version: '0.28.17', projectPath: `${project}-other` },
        { scope: 'user', version: '0.28.17' },
      ],
    }, (dir) => {
      const s = state(dir);
      assert.strictEqual(s.scope, 'user', `wrong fallback installation selected: ${JSON.stringify(s)}`);
      const msg = message(dir, project);
      assert.ok(msg.includes('claude plugin update -y dhpk@dhpk'), `user update command missing: ${msg}`);
      assert.ok(!msg.includes('--scope project'), `foreign project scope leaked into: ${msg}`);
    });
  } finally {
    cleanup(project);
  }
});

test('a project installation for another project is ignored without a user fallback', () => {
  const project = tempProject();
  try {
    withPlugins({
      available: '0.29.0',
      installedRecords: [
        { scope: 'project', version: '0.28.17', projectPath: `${project}-other` },
      ],
    }, (dir) => {
      assert.deepStrictEqual(state(dir, project), {}, 'foreign project installation must not be selected');
    });
  } finally {
    cleanup(project);
  }
});

test('the stale message points at harness-setup --show rather than duplicating its audit', () => {
  withPlugins({ installed: '0.28.17', available: '0.29.0' }, (dir) => {
    const msg = message(dir);
    assert.ok(/harness-setup\s+--show/.test(msg), `harness-setup --show pointer missing: ${msg}`);
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

// Consolidated source suite: session-install-health-modules.
{

  // Module-configuration findings for the session install-health gate (change:
  // add-session-install-health-gate, tasks 3.1-3.3).
  //
  // The trigger set is deliberately narrow (design D2). These tests pin both the
  // shapes that MUST fire and the shape that must NOT — inheriting the global
  // module list is a supported configuration, not a defect, and firing on it
  // would spend the gate's credibility on its first question.

  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { spawnSync } = require('node:child_process');
  const { test, assert } = require('./_lib/tinytest');

  const ROOT = path.join(__dirname, '..');
  const DETECT = path.join(ROOT, 'scripts', 'hooks', '_lib', 'detect-stack-hints.sh');
  const SESSION_START = path.join(ROOT, 'scripts', 'hooks', 'session-start.sh');

  // The exact set dhpk's own repository runs, and the motivating case for the
  // whole change: it contains `js`, which matches the project's real evidence,
  // alongside PHP modules that nothing supports.
  const DHPK_MODULE_SET = 'php-5.6,laravel-5.4,phpunit-5.7,js,vue-2,laravel-mix';

  function tempRepo() {
    const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-modules-')));
    spawnSync('git', ['init', '-q'], { cwd: repo });
    return repo;
  }

  function write(repo, rel, content) {
    const fp = path.join(repo, rel);
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, content);
  }

  function detect(repo, modules) {
    const res = spawnSync('bash', ['-c', '. "$1"; dhpk_detect_stack_mismatch "$2" "$3"', '_', DETECT, repo, modules], {
      encoding: 'utf8',
    });
    assert.strictEqual(res.status, 0, res.stderr);
    return res.stdout.trim();
  }

  function withRepo(fn) {
    const repo = tempRepo();
    try {
      return fn(repo);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  }

  // ---- Shapes that MUST fire ----

  test('a php module enabled against a js-manifest project is reported', () => {
    withRepo((repo) => {
      write(repo, 'package.json', JSON.stringify({ dependencies: { react: '^19' } }));
      const out = detect(repo, 'php-5.6,laravel-5.4');
      assert.ok(out.includes('configured=php-5.6,laravel-5.4'), out);
    });
  });

  // The reproduced dhpk gap: no manifest at all, so the manifest-only detector
  // returned early and said nothing.
  test('stack modules enabled with no stack manifest at all are reported', () => {
    withRepo((repo) => {
      write(repo, 'scripts/thing.js', 'module.exports = 1;\n');
      const out = detect(repo, 'php-5.6,laravel-5.4');
      assert.ok(out.length > 0, 'no-manifest project with contradicted modules stayed silent');
      assert.ok(out.includes('php-5.6'), out);
      assert.ok(out.includes('laravel-5.4'), out);
    });
  });

  test('a php module enabled against a php-source project is not reported', () => {
    withRepo((repo) => {
      write(repo, 'src/Thing.php', '<?php class Thing {}\n');
      assert.strictEqual(detect(repo, 'php-5.6'), '');
    });
  });

  // ---- The critical non-trigger (design D2) ----

  test('an inherited module set that does not contradict the evidence stays silent', () => {
    withRepo((repo) => {
      write(repo, 'package.json', JSON.stringify({ dependencies: { react: '^19' } }));
      // No project-level `modules` override exists; this is the inherited global
      // list. It matches the evidence, so absence-of-override alone must not fire.
      assert.strictEqual(detect(repo, 'js,react-19'), '');
    });
  });

  test('an inherited module set that does contradict the evidence is still reported', () => {
    withRepo((repo) => {
      write(repo, 'package.json', JSON.stringify({ dependencies: { react: '^19' } }));
      const out = detect(repo, 'php-5.6,phpunit-5.7');
      assert.ok(out.includes('php-5.6'), out);
    });
  });

  test('a project with no evidence at all stays silent whatever is configured', () => {
    withRepo((repo) => {
      write(repo, 'README.md', '# docs only\n');
      assert.strictEqual(detect(repo, DHPK_MODULE_SET), '');
    });
  });

  // ---- Contradicted modules alongside a matching module (task 3.3) ----
  //
  // The second gate. Even with source-file evidence in place, the old emit
  // condition required BOTH a contradicted module set AND a family with no
  // matching module. dhpk's configured `js` satisfies the detected js family, so
  // `missing` is empty and the contradicted PHP modules were dropped on the
  // floor. A contradiction is a finding on its own merits.

  test('contradicted modules are reported even when another configured module matches', () => {
    withRepo((repo) => {
      write(repo, 'scripts/thing.js', 'module.exports = 1;\n');
      const out = detect(repo, 'php-5.6,js');
      assert.ok(out.length > 0, 'contradicted php module was dropped because js matched the evidence');
      assert.ok(out.includes('php-5.6'), out);
      assert.ok(!out.includes('js,') && !/configured=[^ ]*\bjs\b/.test(out), `matching module must not be named as contradicted: ${out}`);
    });
  });

  test("dhpk's own module set against its own evidence produces a finding", () => {
    withRepo((repo) => {
      // No package.json, no composer.json, real .js sources — this repository.
      write(repo, 'scripts/hooks/session-start.sh', '#!/usr/bin/env bash\n');
      write(repo, 'scripts/ci/catalog.js', 'module.exports = 1;\n');
      write(repo, 'tests/run-all.js', 'module.exports = 1;\n');
      const out = detect(repo, DHPK_MODULE_SET);
      assert.ok(out.length > 0, 'the motivating case still produces no finding');
      for (const mod of ['php-5.6', 'laravel-5.4', 'phpunit-5.7']) {
        assert.ok(out.includes(mod), `${mod} missing from finding: ${out}`);
      }
    });
  });

  test('a finding names contradicted modules even when no family is left unmatched', () => {
    withRepo((repo) => {
      write(repo, 'package.json', JSON.stringify({ dependencies: { react: '^19' } }));
      // react-19 matches the detected react family, so `missing` is empty.
      const out = detect(repo, 'react-19,php-5.6');
      assert.ok(out.includes('php-5.6'), `expected the contradicted php module: ${out}`);
    });
  });

  // ---- Family routing ----
  //
  // `laravel-mix` is the JS build-tool module, but it matches the `laravel-*`
  // glob that routes the PHP family, and bash `case` takes the first matching
  // arm. Left alone it is reported as a contradicted PHP module in a JS-only
  // project — a false positive of exactly the class that destroys trust on first
  // contact. Latent before this change (the old emit condition suppressed it),
  // live once a contradicted set reports on its own.

  test('laravel-mix is a js-family module and is not flagged in a js project', () => {
    withRepo((repo) => {
      write(repo, 'webpack.mix.js', 'const mix = require("laravel-mix");\n');
      const out = detect(repo, 'laravel-mix');
      assert.strictEqual(out, '', `laravel-mix misrouted to the php family: ${out}`);
    });
  });

  test('laravel-mix is flagged when the project has no js evidence', () => {
    withRepo((repo) => {
      write(repo, 'src/Thing.php', '<?php class Thing {}\n');
      const out = detect(repo, 'laravel-mix');
      assert.ok(out.includes('laravel-mix'), `laravel-mix should be contradicted here: ${out}`);
    });
  });

  test("dhpk's own module set does not flag its js-family modules", () => {
    withRepo((repo) => {
      write(repo, 'scripts/ci/catalog.js', 'module.exports = 1;\n');
      const out = detect(repo, DHPK_MODULE_SET);
      assert.ok(!out.includes('laravel-mix'), `laravel-mix falsely reported: ${out}`);
      assert.ok(!out.includes('vue-2'), `vue-2 falsely reported: ${out}`);
      assert.ok(out.includes('laravel-5.4'), `the real php contradiction is missing: ${out}`);
    });
  });

  // ---- SessionStart deliberately does not run advisory inference ----
}


run('session-install-health-version');
