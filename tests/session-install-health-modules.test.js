'use strict';

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
const { test, run, assert } = require('./_lib/tinytest');

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

// ---- End-to-end: the finding survives the SessionStart path ----

test('session-start reports the contradiction for an inherited set with no project override', () => {
  withRepo((repo) => {
    write(repo, 'package.json', JSON.stringify({ dependencies: { react: '^19' } }));
    assert.ok(
      !fs.existsSync(path.join(repo, '.claude', 'settings.local.json')),
      'fixture must have no project-level override for this to test inheritance'
    );
    const res = spawnSync('bash', ['-c', 'printf %s "$P" | bash "$1"', '_', SESSION_START], {
      cwd: repo,
      encoding: 'utf8',
      env: {
        ...process.env,
        CLAUDE_PLUGIN_ROOT: ROOT,
        CLAUDE_PROJECT_DIR: repo,
        CLAUDE_PLUGIN_OPTION_MODULES: 'php-5.6,laravel-5.4',
        CLAUDE_PLUGIN_OPTION_HOOK_PROFILE: 'standard',
        P: JSON.stringify({ source: 'startup', session_id: 'modules-e2e' }),
      },
      timeout: 10000,
    });
    assert.strictEqual(res.status, 0, res.stderr);
    assert.ok(res.stderr.includes('WARN module/manifest mismatch'), res.stderr);
  });
});

run('session-install-health-modules');
