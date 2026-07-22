'use strict';

// GitHub issue #64: post-edit-remind.sh evaluates a module's per-slot trigger
// block (module.yaml `triggers.<slot>.extensions` / `.paths`) as two
// INDEPENDENT loops (see _dhpk_check_module_triggers, post-edit-remind.sh
// ~173-179) — an extension match alone arms the slot no matter where the file
// lives. The `js` module declares frontend extensions [".js", ".ts", ".jsx",
// ".tsx", ".mjs", ".cjs", ".vue", ".svelte"] with paths [js/, src/, app/,
// public/]. In a repo where `.js` is NOT frontend code (dhpk itself — every
// .js here is a Node CLI script or a test), `.pending-frontend-review` arms
// on every JS edit regardless of location.
//
// The fix under test (data-only, no evaluator change): the AMBIGUOUS
// extensions (.js, .ts, .mjs, .cjs — could be Node or browser) are removed
// from the affected modules' frontend `extensions` lists, leaving only the
// UNAMBIGUOUS ones (.jsx, .tsx, .vue, .svelte — frontend wherever they live).
// Files under the declared `paths` still arm via the paths loop, independent
// of this fix.
//
// This test points CLAUDE_PLUGIN_ROOT at the real repo (via hookharness's
// default `pluginRoot = ROOT`) so the hook reads the ACTUAL modules/*/module.yaml
// files — no fabricated fixtures. DHPK_ACTIVE_MODULES is set per case (rather
// than deleted, as in post-edit-remind-plugin-source.test.js) to select which
// module's triggers.frontend block is under test.

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const { mkRepo, runHook: runHookRaw } = require('./_lib/hookharness');

const HOOK = 'post-edit-remind.sh';

function mkTempRepo() {
  return mkRepo({ prefix: 'dhpk-modtrig-' });
}

function runHook(cwd, filePath, activeModules) {
  return runHookRaw(HOOK, {
    payload: { tool_input: { file_path: filePath } },
    cwd,
    env: { DHPK_ACTIVE_MODULES: activeModules },
  });
}

function frontendReviewPath(repoDir) {
  return path.join(repoDir, '.claude', 'artifacts', 'sessions', '.pending-frontend-review');
}

function codeReviewPath(repoDir) {
  return path.join(repoDir, '.claude', 'artifacts', 'sessions', '.pending-review');
}

function writeAndRun(repo, relPath, activeModules) {
  const full = path.join(repo, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, '// content\n');
  return runHook(repo, full, activeModules);
}

// ---- js module ----

test('RED (issue #64): js module — tests/foo.test.js outside frontend paths must NOT arm frontend-review', () => {
  const repo = mkTempRepo();
  try {
    const res = writeAndRun(repo, 'tests/foo.test.js', 'js');
    assert.strictEqual(res.status, 0, `hook exited non-zero: ${res.stderr}`);
    assert.ok(!fs.existsSync(frontendReviewPath(repo)),
      `.pending-frontend-review armed for a Node test .js file outside js//src//app//public/ (issue #64 false positive):\n${res.stdout}\n${res.stderr}`);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('RED (issue #64): js module — scripts/hooks/some-tool.js outside frontend paths must NOT arm frontend-review', () => {
  const repo = mkTempRepo();
  try {
    const res = writeAndRun(repo, 'scripts/hooks/some-tool.js', 'js');
    assert.strictEqual(res.status, 0, `hook exited non-zero: ${res.stderr}`);
    assert.ok(!fs.existsSync(frontendReviewPath(repo)),
      `.pending-frontend-review armed for a Node CLI .js file outside js//src//app//public/ (issue #64 false positive):\n${res.stdout}\n${res.stderr}`);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('REGRESSION GUARD: js module — components/Button.tsx (unambiguous, outside declared paths) MUST STILL arm frontend-review', () => {
  const repo = mkTempRepo();
  try {
    const res = writeAndRun(repo, 'components/Button.tsx', 'js');
    assert.strictEqual(res.status, 0, `hook exited non-zero: ${res.stderr}`);
    assert.ok(fs.existsSync(frontendReviewPath(repo)),
      `.pending-frontend-review was NOT armed for an unambiguous .tsx file — the fix must not trade a false positive for a false negative:\n${res.stdout}\n${res.stderr}`);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('REGRESSION GUARD: js module — src/app.js (under a declared path) MUST STILL arm frontend-review', () => {
  const repo = mkTempRepo();
  try {
    const res = writeAndRun(repo, 'src/app.js', 'js');
    assert.strictEqual(res.status, 0, `hook exited non-zero: ${res.stderr}`);
    assert.ok(fs.existsSync(frontendReviewPath(repo)),
      `.pending-frontend-review was NOT armed for a .js file under a declared frontend path (src/):\n${res.stdout}\n${res.stderr}`);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

// ---- vue-2 module ----

test('RED (issue #64): vue-2 module — a .js file outside resources/assets/js/ must NOT arm frontend-review', () => {
  const repo = mkTempRepo();
  try {
    const res = writeAndRun(repo, 'other/place/widget.js', 'vue-2');
    assert.strictEqual(res.status, 0, `hook exited non-zero: ${res.stderr}`);
    assert.ok(!fs.existsSync(frontendReviewPath(repo)),
      `.pending-frontend-review armed for a .js file outside resources/assets/js/ (issue #64 false positive):\n${res.stdout}\n${res.stderr}`);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('REGRESSION GUARD: vue-2 module — resources/assets/js/app.js (declared path) MUST STILL arm frontend-review', () => {
  const repo = mkTempRepo();
  try {
    const res = writeAndRun(repo, 'resources/assets/js/app.js', 'vue-2');
    assert.strictEqual(res.status, 0, `hook exited non-zero: ${res.stderr}`);
    assert.ok(fs.existsSync(frontendReviewPath(repo)),
      `.pending-frontend-review was NOT armed for resources/assets/js/app.js under vue-2's declared path:\n${res.stdout}\n${res.stderr}`);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('REGRESSION GUARD: vue-2 module — a .vue file anywhere (unambiguous) MUST STILL arm frontend-review', () => {
  const repo = mkTempRepo();
  try {
    const res = writeAndRun(repo, 'other/place/Widget.vue', 'vue-2');
    assert.strictEqual(res.status, 0, `hook exited non-zero: ${res.stderr}`);
    assert.ok(fs.existsSync(frontendReviewPath(repo)),
      `.pending-frontend-review was NOT armed for a .vue file — .vue is unambiguous and must arm regardless of location:\n${res.stdout}\n${res.stderr}`);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

// ---- laravel-mix module ----

test('RED (issue #64): laravel-mix module — a .js file outside resources/assets/ must NOT arm frontend-review', () => {
  const repo = mkTempRepo();
  try {
    const res = writeAndRun(repo, 'other/place/build.js', 'laravel-mix');
    assert.strictEqual(res.status, 0, `hook exited non-zero: ${res.stderr}`);
    assert.ok(!fs.existsSync(frontendReviewPath(repo)),
      `.pending-frontend-review armed for a .js file outside resources/assets/ (issue #64 false positive):\n${res.stdout}\n${res.stderr}`);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('REGRESSION GUARD: laravel-mix module — resources/assets/js/app.js (declared path) MUST STILL arm frontend-review', () => {
  const repo = mkTempRepo();
  try {
    const res = writeAndRun(repo, 'resources/assets/js/app.js', 'laravel-mix');
    assert.strictEqual(res.status, 0, `hook exited non-zero: ${res.stderr}`);
    assert.ok(fs.existsSync(frontendReviewPath(repo)),
      `.pending-frontend-review was NOT armed for resources/assets/js/app.js under laravel-mix's declared path:\n${res.stdout}\n${res.stderr}`);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

// ---- yii-1.1 module: proves the fix did NOT narrow an unrelated slot ----
// yii-1.1 declares code extensions [".php"] with paths [protected/].
// Extension-only arming is CORRECT here (PHP files are unambiguously backend
// code wherever they live in a Yii app) and must survive the fix to the
// frontend-only extension lists above. ~12 module trigger blocks declare both
// keys; a careless fix could accidentally strip extensions from every slot.
//
// Caveat: this case is a smoke test, not an isolation of yii-1.1's own code
// trigger — dhpk_route_slot's BUILT-IN routing (post-edit-remind.sh ~79-82)
// already arms the code slot for any *.php file regardless of module state,
// so this assertion would still pass even if a careless fix stripped
// yii-1.1's code.extensions entirely. No extension-based canary can truly
// isolate a non-frontend module slot from the built-in route; the "frontend"
// slot is the only one this bug affects, and cases (a)-(i) above already
// cover it exhaustively. This case is kept per the task's explicit spec.

test('REGRESSION GUARD: yii-1.1 module — a .php file OUTSIDE protected/ MUST STILL arm .pending-review (code slot)', () => {
  const repo = mkTempRepo();
  try {
    const res = writeAndRun(repo, 'other/place/Helper.php', 'yii-1.1');
    assert.strictEqual(res.status, 0, `hook exited non-zero: ${res.stderr}`);
    assert.ok(fs.existsSync(codeReviewPath(repo)),
      `.pending-review was NOT armed for a .php file outside protected/ — yii-1.1's code slot extension-only arming must survive the frontend-slot fix:\n${res.stdout}\n${res.stderr}`);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

run('post-edit-remind-module-triggers');
