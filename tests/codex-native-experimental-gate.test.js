'use strict';

// Task 4.3 (make-codex-plugin-distribution-install-safe): production native
// manifests now ship the tracked physical package at plugins/dhpk/ (structural
// validation PASSES — the symlink-mirror and parent-relative-escape bugs from
// GitHub issue #88 are fixed), but native marketplace support SHALL remain
// Experimental until a later, separately approved graduation decision
// (design.md decision 7 / spec.md "Native support graduation is explicit").
// A structural PASS is necessary evidence, never sufficient by itself — this
// test is the conscious, deliberate flip design.md/spec.md called for, paired
// with an unchanged assertion that the docs still say "experimental".

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const { validateNativeCandidate, validateNativeMembership } = require('../scripts/lib/codex-native-package');

const ROOT = path.join(__dirname, '..');

function loadManifest(rel) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
}

test('the native .codex-plugin/plugin.json now passes native-candidate structural validation (physical tracked package, no symlinks)', () => {
  const manifest = loadManifest('.codex-plugin/plugin.json');
  const result = validateNativeCandidate({ manifestSkillsField: manifest.skills, packageRoot: ROOT });
  assert.deepStrictEqual(result.errors, []);
  assert.ok(result.ok);
});

test('the marketplace-target wrapper plugin.json now passes native-candidate structural validation (./skills/, no parent-relative escape)', () => {
  const manifest = loadManifest(path.join('plugins', 'dhpk', '.codex-plugin', 'plugin.json'));
  const packageRoot = path.join(ROOT, 'plugins', 'dhpk');
  const result = validateNativeCandidate({ manifestSkillsField: manifest.skills, packageRoot });
  assert.deepStrictEqual(result.errors, []);
  assert.ok(result.ok);
});

test('the tracked package contains exactly the inventory codex-native surface — no membership drift', () => {
  const inventory = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests', 'distribution-inventory.json'), 'utf8'));
  const candidateSkillIds = fs.readdirSync(path.join(ROOT, 'plugins', 'dhpk', 'skills'));
  const result = validateNativeMembership({ candidateSkillIds, inventory });
  assert.deepStrictEqual(result.errors, []);
  assert.ok(result.ok);
});

test('README and .codex-plugin/README.md still label native Codex plugin support experimental — a structural PASS does not itself graduate the support tier', () => {
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  const codexReadme = fs.readFileSync(path.join(ROOT, '.codex-plugin', 'README.md'), 'utf8');
  assert.match(readme, /experimental/i);
  assert.match(codexReadme, /experimental/i);
});

run('codex-native-experimental-gate');
