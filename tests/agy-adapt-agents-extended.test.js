'use strict';

// RED coverage for the AGY frontmatter contract. These tests exercise the
// exported pure adapter, not the CLI's filesystem loop.

const { test, run, assert } = require('./_lib/tinytest');
const { adaptFrontmatter } = require('../scripts/agy-adapt-agents');

const SOURCE = [
  '---',
  'name: code-reviewer',
  'description: Review code',
  'tools: Read, Write, Edit, Bash, Grep, Glob, WebSearch, WebFetch, Agent, mcp__foo__bar',
  'model: sonnet',
  'effort: medium',
  'maxTurns: 25',
  'color: blue',
  'skills: ["dhpk-tdd-workflow"]',
  '---',
  '',
  '# Body',
  '',
].join('\n');

test('adapts bare tools and Claude model to the AGY contract', () => {
  const result = adaptFrontmatter(SOURCE);
  assert.strictEqual(result.changed, true);
  assert.ok(result.text.includes(
    'tools: ["read_file", "write_to_file", "replace_file_content", "run_command", "grep_search", "glob", "search_web", "read_url_content", "invoke_subagent", "mcp_foo_bar"]',
  ), result.text);
  assert.ok(result.text.includes('model: pro'), result.text);
  assert.ok(!result.text.includes('effort:'), result.text);
  assert.ok(!result.text.includes('maxTurns:'), result.text);
  assert.ok(!result.text.includes('color:'), result.text);
  assert.ok(!result.text.includes('skills:'), result.text);
  assert.deepStrictEqual(result.droppedFields, ['effort', 'maxTurns', 'color', 'skills']);
  assert.ok(result.text.includes('# Body'), result.text);
});

test('preserves valid AGY model values and defaults an omitted model to inherit', () => {
  const source = ['---', 'name: sample', 'description: Sample', 'tools: [read_file]', '---', 'Body', ''].join('\n');
  const result = adaptFrontmatter(source);
  assert.ok(result.text.includes('model: inherit'), result.text);

  const alreadyAgy = ['---', 'name: sample', 'description: Sample', 'tools: [read_file]', 'model: flash_lite', '---', 'Body', ''].join('\n');
  const preserved = adaptFrontmatter(alreadyAgy);
  assert.ok(preserved.text.includes('model: flash_lite'), preserved.text);
});

test('rejects an unknown model instead of silently selecting a fallback', () => {
  const source = SOURCE.replace('model: sonnet', 'model: unknown-model');
  assert.throws(() => adaptFrontmatter(source), /Unsupported AGY model.*unknown-model/);
});

test('adaptation is idempotent', () => {
  const first = adaptFrontmatter(SOURCE);
  const second = adaptFrontmatter(first.text);
  assert.strictEqual(second.changed, false);
  assert.strictEqual(second.text, first.text);
  assert.deepStrictEqual(second.droppedFields, []);
});

run('agy-adapt-agents-extended');
