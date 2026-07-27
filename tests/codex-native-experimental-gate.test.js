'use strict';

// Task 3.5: keep native Codex support gated as experimental unless the
// installed-cache test passes for the STAGED release package (task 3.3 — which
// does pass, tested in codex-native-install-smoke.test.js). Productionizing that
// staged candidate — swapping .codex-plugin/plugin.json and
// plugins/dhpk/.codex-plugin/plugin.json to ship a physical tree instead of the
// symlink-dependent codex/skills/ mirror — is a separate, larger release-artifact
// decision (design.md's "release location and retention policy for generated
// Codex physical artifacts" is an explicit Open Question, not resolved here).
//
// This test enforces the gate stays honest: the PRODUCTION native manifests
// must currently FAIL validateNativeCandidate (proving they still depend on the
// symlink mirror, so labeling them experimental remains correct) AND the docs
// must still say "experimental". If a future change fixes production to pass
// this check, both assertions need a deliberate, conscious update — not a
// silent drift.

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const { validateNativeCandidate } = require('../scripts/lib/codex-native-package');

const ROOT = path.join(__dirname, '..');

function loadManifest(rel) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
}

test('the native .codex-plugin/plugin.json still fails native-candidate validation (symlink-dependent codex/skills/ mirror) — experimental gate correctly stays closed', () => {
  const manifest = loadManifest('.codex-plugin/plugin.json');
  const result = validateNativeCandidate({ manifestSkillsField: manifest.skills, packageRoot: ROOT });
  assert.ok(!result.ok, 'expected the current native manifest to still fail (it depends on symlinks) — if this now passes, task 3.5 requires a conscious decision to graduate native support, not a silent pass here');
});

test('the marketplace-target wrapper plugin.json still fails native-candidate validation (parent-relative skills path) — experimental gate correctly stays closed', () => {
  const manifest = loadManifest(path.join('plugins', 'dhpk', '.codex-plugin', 'plugin.json'));
  const packageRoot = path.join(ROOT, 'plugins', 'dhpk');
  const result = validateNativeCandidate({ manifestSkillsField: manifest.skills, packageRoot });
  assert.ok(!result.ok, 'expected the wrapper manifest to still fail (parent-relative ../../codex/skills/) — if this now passes, task 3.5 requires a conscious decision, not a silent pass here');
});

test('README and .codex-plugin/README.md still label native Codex plugin support experimental', () => {
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  const codexReadme = fs.readFileSync(path.join(ROOT, '.codex-plugin', 'README.md'), 'utf8');
  assert.match(readme, /experimental/i);
  assert.match(codexReadme, /experimental/i);
});

run('codex-native-experimental-gate');
