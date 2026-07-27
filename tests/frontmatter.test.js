'use strict';

// Dedicated unit coverage for scripts/ci/_lib/frontmatter.js — direct exports
// (extract/isEmpty), not just transitively via validate-agents-behavior.test.js.

const { test, run, assert } = require('./_lib/tinytest');
const { extract, isEmpty, extractInvocationClass } = require('../scripts/ci/_lib/frontmatter');

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
