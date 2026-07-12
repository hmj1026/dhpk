'use strict';

// Dedicated unit coverage for scripts/ci/_lib/frontmatter.js — direct exports
// (extract/isEmpty), not just transitively via validate-agents-behavior.test.js.

const { test, run, assert } = require('./_lib/tinytest');
const { extract, isEmpty } = require('../scripts/ci/_lib/frontmatter');

test('extract parses a simple frontmatter block into key/value pairs', () => {
  const content = '---\nname: foo\ndescription: does a thing\n---\nbody text\n';
  const r = extract(content);
  assert.strictEqual(r.present, true);
  assert.strictEqual(r.values.name, 'foo');
  assert.strictEqual(r.values.description, 'does a thing');
  assert.deepStrictEqual(r.duplicates, []);
  assert.strictEqual(r.descriptionIndicator, null);
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

run('frontmatter');
