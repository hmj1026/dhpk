'use strict';

// Harness path policy for the Public Plugin (#1497): dhpk-internal reads are
// found, consumer-project paths and bare directory mentions are not.

const { test, run, assert } = require('./_lib/tinytest');
const { ALLOWED_CONSUMER_PATHS, findInternalPathReferences } = require('../scripts/lib/public-plugin-paths');

const find = (file, text) => findInternalPathReferences(new Map([[file, Buffer.from(text)]]));

test('a read of .claude/rules is reported with its file and path', () => {
  assert.deepStrictEqual(find('skills/a/SKILL.md', 'Read `.claude/rules/x.md`.'), [
    { file: 'skills/a/SKILL.md', reference: '.claude/rules/x.md' },
  ]);
});

test('trailing sentence punctuation is not part of the reported path', () => {
  assert.deepStrictEqual(find('skills/a/SKILL.md', 'see .codex/agents/a.toml.').map((hit) => hit.reference), ['.codex/agents/a.toml']);
});

test('a bare harness directory mention is not a reference', () => {
  assert.deepStrictEqual(find('skills/a/SKILL.md', 'Excludes .claude/ and .codex/.'), []);
});

test('every allowed consumer path carries a reason', () => {
  for (const entry of ALLOWED_CONSUMER_PATHS) assert.ok(entry.reason.length > 0, String(entry.pattern));
});

test('files outside skills/ and non-text files are not scanned', () => {
  assert.deepStrictEqual(find('README.md', 'Read .claude/rules/x.md'), []);
  assert.deepStrictEqual(find('skills/a/icon.svg', 'Read .claude/rules/x.md'), []);
});

run('public-plugin-paths');
