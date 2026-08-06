'use strict';

// Dedicated unit coverage for scripts/ci/_lib/frontmatter.js — direct exports
// (extract/isEmpty), not just transitively via validate-agents-behavior.test.js.

const { test, run, assert } = require('./_lib/tinytest');
const { extract, isEmpty, extractInvocationClass } = require('../scripts/ci/_lib/frontmatter');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const OFFICIAL_STRICT_FAILURE_SET = [
  'dhpk-ios-platform',
  'dhpk-laravel-mix-notes',
  'dhpk-phpunit-11-notes',
  'dhpk-laravel-package-author',
  'dhpk-openspec-artifact-guard',
  'dhpk-phpunit-9-modern',
  'dhpk-laravel-10-notes',
  'dhpk-laravel-9-notes',
  'dhpk-swiftui-architecture',
  'dhpk-php-modern-pro',
  'dhpk-laravel-11-notes',
  'dhpk-laravel-6-notes',
  'dhpk-python-static-checks',
  'dhpk-composer-package-hygiene',
  'dhpk-matrix-cell-onboard',
  'dhpk-js-lint-config',
  'dhpk-js-static-check-strategy',
  'dhpk-swift-language',
  'dhpk-laravel-7-notes',
  'dhpk-ios-icon-gen',
  'dhpk-laravel-8-notes',
  'dhpk-php-8x-features',
  'dhpk-vue-2-notes',
  'dhpk-laravel-testbench-matrix',
  'dhpk-laravel-5-4-notes',
  'dhpk-library-dual-testsuite-map',
];

function unquoteScalar(value) {
  if (/^'[^]*'$/.test(value)) return value.slice(1, -1).replace(/''/g, "'");
  if (/^"[^]*"$/.test(value)) return value.slice(1, -1);
  return value;
}

test('extract parses a simple frontmatter block into key/value pairs', () => {
  const content = '---\nname: foo\ndescription: does a thing\n---\nbody text\n';
  const r = extract(content);
  assert.strictEqual(r.present, true);
  assert.strictEqual(r.values.name, 'foo');
  assert.strictEqual(r.values.description, 'does a thing');
  assert.deepStrictEqual(r.duplicates, []);
  assert.strictEqual(r.descriptionIndicator, null);
});

test('extract preserves colon-containing quoted descriptions as one scalar', () => {
  const content = [
    '---',
    'name: quoted-description',
    "description: 'Use when: routing metadata is needed. Output: a checked result.'",
    '---',
  ].join('\n');
  const r = extract(content);
  assert.strictEqual(r.values.description, "'Use when: routing metadata is needed. Output: a checked result.'");
  assert.strictEqual(unquoteScalar(r.values.description), 'Use when: routing metadata is needed. Output: a checked result.');
  assert.strictEqual(r.descriptionIndicator, null);
});

test('all 26 official strict-failure skills expose equivalent quoted metadata', () => {
  assert.strictEqual(OFFICIAL_STRICT_FAILURE_SET.length, 26);
  for (const skill of OFFICIAL_STRICT_FAILURE_SET) {
    const file = path.join(ROOT, 'skills', skill, 'SKILL.md');
    const content = fs.readFileSync(file, 'utf8');
    const parsed = extract(content);
    assert.strictEqual(parsed.present, true, `${skill} must have frontmatter`);
    assert.strictEqual(parsed.descriptionIndicator, null, `${skill} must use an inline scalar`);
    const sourceDescription = parsed.values.description;
    assert.match(sourceDescription, /^'/, `${skill} description must be single-quoted for strict YAML`);
    const semanticDescription = unquoteScalar(sourceDescription);
    assert.match(semanticDescription, /Use when:|Not for:|Output:/, `${skill} routing cues disappeared`);
    assert.ok(semanticDescription.length > 20, `${skill} description unexpectedly empty`);
  }
});

test('official strict validator accepts a fixture using the same quoted scalar metadata', () => {
  const claude = spawnSync('claude', ['--version'], { encoding: 'utf8' });
  if (claude.status !== 0) return;
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-frontmatter-official-'));
  try {
    fs.mkdirSync(path.join(fixture, '.claude-plugin'), { recursive: true });
    fs.cpSync(path.join(ROOT, 'skills'), path.join(fixture, 'skills'), { recursive: true });
    fs.mkdirSync(path.join(fixture, 'skills', 'quoted-description'), { recursive: true });
    fs.writeFileSync(path.join(fixture, '.claude-plugin', 'plugin.json'), JSON.stringify({
      name: 'frontmatter-fixture',
      version: '0.0.1',
      description: 'frontmatter fixture',
      author: { name: 'dhpk test' },
      skills: ['./skills/'],
    }));
    fs.writeFileSync(path.join(fixture, 'skills', 'quoted-description', 'SKILL.md'), [
      '---',
      'name: quoted-description',
      "description: 'Use when: testing. Not for: none. Output: pass.'",
      '---',
      '# fixture',
      '',
    ].join('\n'));
    const result = spawnSync('claude', ['plugin', 'validate', path.join(fixture, '.claude-plugin', 'plugin.json'), '--strict'], {
      cwd: fixture,
      encoding: 'utf8',
    });
    assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test('extract returns present:false when there is no frontmatter block', () => {
  const r = extract('just a plain markdown file\nno frontmatter here\n');
  assert.strictEqual(r.present, false);
  assert.deepStrictEqual(r.values, {});
});

test('extract flags duplicate top-level keys', () => {
  const content = '---\nname: foo\nname: bar\n---\n';
  const r = extract(content);
  assert.strictEqual(r.present, true);
  assert.strictEqual(r.values.name, 'bar', 'last value wins for a duplicate key');
  assert.deepStrictEqual(r.duplicates, ['name']);
});

test('extract detects a literal block-scalar description (|) and skips its nested lines', () => {
  const content = [
    '---',
    'name: foo',
    'description: |',
    '  line one',
    '  line two',
    'model: sonnet',
    '---',
  ].join('\n');
  const r = extract(content);
  assert.strictEqual(r.present, true);
  assert.strictEqual(r.descriptionIndicator, '|');
  assert.strictEqual(r.values.model, 'sonnet', 'top-level key after the block scalar is still parsed');
});

test('extract tolerates a UTF-8 BOM and CRLF line endings', () => {
  const content = '﻿---\r\nname: foo\r\n---\r\nbody\r\n';
  const r = extract(content);
  assert.strictEqual(r.present, true);
  assert.strictEqual(r.values.name, 'foo');
});

test('extract does not treat a value containing # as a comment (C#, single-quoted)', () => {
  const content = "---\ndescription: 'Reviews C# code and #tags'\n---\n";
  const r = extract(content);
  assert.strictEqual(r.values.description, "'Reviews C# code and #tags'");
});

test('isEmpty treats missing, blank, and empty-quoted strings as empty', () => {
  assert.strictEqual(isEmpty(undefined), true);
  assert.strictEqual(isEmpty(''), true);
  assert.strictEqual(isEmpty('   '), true);
  assert.strictEqual(isEmpty("''"), true);
  assert.strictEqual(isEmpty('""'), true);
  assert.strictEqual(isEmpty('a value'), false);
});

test('extractInvocationClass reads the nested metadata.dhpk-invocation-class mapping', () => {
  const content = '---\nname: foo\nmetadata:\n  dhpk-invocation-class: explicit-only\n---\n';
  const r = extractInvocationClass(content);
  assert.strictEqual(r.present, true);
  assert.strictEqual(r.value, 'explicit-only');
  assert.strictEqual(r.unknownValue, false);
  assert.strictEqual(r.dottedSubstitute, false);
});

test('extractInvocationClass reads implicit-eligible alongside sibling metadata keys', () => {
  const content = [
    '---',
    'name: foo',
    'metadata:',
    '  origin: oh-my-agent-check',
    '  dhpk-invocation-class: implicit-eligible',
    '---',
  ].join('\n');
  const r = extractInvocationClass(content);
  assert.strictEqual(r.present, true);
  assert.strictEqual(r.value, 'implicit-eligible');
});

test('extractInvocationClass reports absence when metadata block is missing', () => {
  const content = '---\nname: foo\ndescription: bar\n---\n';
  const r = extractInvocationClass(content);
  assert.strictEqual(r.present, false);
  assert.strictEqual(r.value, null);
});

test('extractInvocationClass flags an unknown class value', () => {
  const content = '---\nmetadata:\n  dhpk-invocation-class: sometimes\n---\n';
  const r = extractInvocationClass(content);
  assert.strictEqual(r.present, true);
  assert.strictEqual(r.value, 'sometimes');
  assert.strictEqual(r.unknownValue, true);
});

test('extractInvocationClass rejects a dotted top-level key substitute', () => {
  const content = '---\nmetadata.dhpk-invocation-class: explicit-only\n---\n';
  const r = extractInvocationClass(content);
  assert.strictEqual(r.dottedSubstitute, true, 'must detect the dotted top-level substitute');
  assert.strictEqual(r.present, false, 'the dotted form is not a valid nested mapping');
});

test('extractInvocationClass does not see a metadata block that never nests the key', () => {
  const content = '---\nmetadata:\n  origin: something\n---\n';
  const r = extractInvocationClass(content);
  assert.strictEqual(r.present, false);
  assert.strictEqual(r.value, null);
});

run('frontmatter');
