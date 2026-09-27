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

function markdownSection(content, heading) {
  const lines = content.split(/\r?\n/);
  const start = lines.indexOf(heading);
  assert.notStrictEqual(start, -1, `missing Markdown section: ${heading}`);
  const end = lines.findIndex((line, index) => index > start && /^## /.test(line));
  return lines.slice(start, end === -1 ? lines.length : end).join('\n');
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

test('the native Codex marketplace support decision remains Experimental until explicit graduation', () => {
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  const readmeSection = markdownSection(readme, '## Sync Codex CLI content');
  assert.match(
    readmeSection,
    /Codex Plugin Marketplace support\s+nevertheless remains experimental until a separate graduation decision\./,
    'the Codex CLI section must keep the marketplace support tier Experimental pending separate graduation',
  );

  const pluginReadme = fs.readFileSync(path.join(ROOT, '.codex-plugin', 'README.md'), 'utf8');
  const structureSection = markdownSection(pluginReadme, '## Structure');
  assert.match(
    structureSection,
    /This native surface is experimental and must be exercised only with a\s+disposable isolated `CODEX_HOME`\./,
    'the native plugin structure section must keep the surface Experimental and limited to a disposable isolated CODEX_HOME',
  );

  const distributionDocs = fs.readFileSync(path.join(ROOT, 'docs', 'distribution-surfaces.md'), 'utf8');
  const marker = '**Experimental status, not automatic graduation.**';
  const markerOffset = distributionDocs.indexOf(marker);
  assert.notStrictEqual(markerOffset, -1, 'native Codex publication docs must retain the specific experimental-status section');

  const afterMarker = distributionDocs.slice(markerOffset);
  const nextSectionOffset = afterMarker.search(/^## /m);
  const supportSection = nextSectionOffset === -1 ? afterMarker : afterMarker.slice(0, nextSectionOffset);
  assert.match(
    supportSection,
    /Native Codex marketplace support remains \*\*experimental\*\* until a later,\s*separately approved graduation decision/,
    'the native Codex marketplace support section must state that its tier remains Experimental pending a separate graduation decision',
  );
});

run('codex-native-experimental-gate');
