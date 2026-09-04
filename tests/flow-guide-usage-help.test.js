'use strict';

// RED contracts for progressive, read-only Codex usage discovery through the
// flow-guide help card.  The helper is intentionally tested as a process
// boundary so a passing result proves the same generated catalog a user sees.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const CARD = path.join(ROOT, 'skills', 'flow-guide', 'scripts', 'usage-card.js');
const CATALOG = path.join(ROOT, 'skills', 'flow-guide', 'references', 'codex-usage-catalog.json');

function runHelp(args = []) {
  assert.ok(
    fs.existsSync(CARD),
    'RED: skills/flow-guide/scripts/usage-card.js is absent; progressive help is not implemented',
  );
  return spawnSync(process.execPath, [CARD, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 15000,
  });
}

function output(result) {
  return `${result.stdout || ''}${result.stderr || ''}`;
}

function jsonHelp(args = []) {
  const result = runHelp(['--json', ...args]);
  assert.strictEqual(result.status, 0, output(result));
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    assert.fail(`help --json must emit one JSON value: ${error.message}\n${output(result)}`);
  }
}

test('generated usage catalog exists under the flow-guide owner', () => {
  assert.ok(fs.existsSync(CATALOG),
    'RED: flow-guide references/codex-usage-catalog.json is absent; generated usage catalog is not available');
  const catalog = JSON.parse(fs.readFileSync(CATALOG, 'utf8'));
  assert.strictEqual(catalog.schema, 'dhpk.skill-usage-catalog.v1');
  assert.ok(Array.isArray(catalog.entries), 'generated usage catalog must expose entries');
  assert.ok(catalog.entries.length > 0, 'generated usage catalog must not be empty');
});

test('$flow-guide help lists Codex-invokable public names in deterministic order', () => {
  const result = runHelp([]);
  assert.strictEqual(result.status, 0, output(result));
  const text = output(result);
  assert.match(text, /flow-guide/i);
  assert.match(text, /flow-drive/i);
  assert.match(text, /git-smart-commit/i);
  assert.match(text, /(?:usage|available|codex)/i);

  const names = text.split(/\r?\n/)
    .map((line) => line.match(/^\s*[-*]?\s*([a-z][a-z0-9-]*)\s*(?:[|:—-]|$)/i))
    .filter(Boolean)
    .map((match) => match[1]);
  if (names.length > 1) {
    assert.deepStrictEqual(names, [...names].sort((left, right) => left.localeCompare(right)),
      'help list must be deterministic public-name order');
  }
  assert.doesNotMatch(text, /implementation dispatch|review-gate-mechanics|workflow-feature-delivery/i,
    'catalog listing must not load target procedural references');
});

test('$flow-guide help flow-drive returns only one explicit-only usage card', () => {
  const card = jsonHelp(['flow-drive']);
  const usage = card.usage || card.entry || card;
  const name = usage.publicName || usage.name || usage.id;
  assert.strictEqual(name, 'flow-drive');
  assert.strictEqual(usage.invocation_class || usage.invocationClass, 'explicit-only');
  assert.strictEqual(usage.effect_authority || usage.effectAuthority, 'workspace-write');
  assert.match(usage.syntax, /^\$flow-drive\b/);
  assert.ok(Array.isArray(usage.actions));
  assert.ok(Array.isArray(usage.options));
  assert.ok(Array.isArray(usage.examples));
  assert.ok(!('procedure' in usage), 'help cards must not carry target procedure prose');
  assert.ok(!('completion' in usage), 'help cards must not carry target completion procedure prose');
});

test('help JSON preserves one machine-readable action and option contract', () => {
  const card = jsonHelp(['dhpk-git-smart-commit']);
  const usage = card.usage || card.entry || card;
  assert.strictEqual(usage.id, 'git-smart-commit');
  assert.strictEqual(usage.name, 'dhpk-git-smart-commit');
  assert.match(usage.syntax, /^\$dhpk-git-smart-commit\b/);
  for (const action of usage.actions || []) {
    assert.ok(action.id && action.summary && action.syntax && action.input_kind,
      'each help action must expose public grammar fields');
    assert.match(action.syntax, /^\$dhpk-git-smart-commit\b/);
  }
  for (const option of usage.options || []) {
    assert.ok(option.id && option.syntax && option.value_kind && typeof option.required === 'boolean',
      'each help option must expose its grammar fields');
  }
});

test('unknown and known non-Codex help targets have distinct diagnostics', () => {
  const unknown = runHelp(['does-not-exist']);
  assert.notStrictEqual(unknown.status, 0);
  assert.match(output(unknown), /unknown-skill/i);

  const nonCodex = runHelp(['dhpk-module-design']);
  assert.notStrictEqual(nonCodex.status, 0);
  assert.match(output(nonCodex), /not-codex-invokable/i);
  assert.doesNotMatch(output(nonCodex), /unknown-skill/i);
});

test('help is metadata-only and cannot turn flow-drive into an implicit invocation', () => {
  const result = runHelp(['flow-drive']);
  assert.strictEqual(result.status, 0, output(result));
  assert.doesNotMatch(output(result), /execut(e|ing)|implement(ed|ation)?\s+(started|running)|workspace-write granted/i);
  assert.match(output(result), /explicit-only|direct.*invocation|human/i);
});

run('flow-guide-usage-help');
