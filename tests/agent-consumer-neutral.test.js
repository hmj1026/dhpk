'use strict';

// Issue #1203 contract: shipped subagent bodies and stack trap sheets stay
// consumer-neutral. Project-specific values come from task inputs or the
// consumer's own rules, never from private notes or one consumer's paths.

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');

function listMarkdown(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listMarkdown(full);
    return entry.name.endsWith('.md') ? [full] : [];
  });
}

function shippedAgentDocs() {
  const moduleAgents = fs.readdirSync(path.join(ROOT, 'modules'))
    .flatMap((name) => listMarkdown(path.join(ROOT, 'modules', name, 'agents')));
  return [
    ...listMarkdown(path.join(ROOT, 'agents')),
    ...moduleAgents,
    ...listMarkdown(path.join(ROOT, 'agent-traps')),
  ];
}

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

const FORBIDDEN = [
  { label: 'private memory note', pattern: /\bmemory\/[\w.-]+\.md/ },
  { label: 'consumer rule path', pattern: /\.claude\/rules\/(php|frontend)/ },
  // doc-reviewer resolves links against Claude Code's user-level directories,
  // so naming them there is a lookup location, not a private reference.
  { label: 'user-private config path', pattern: /~\/\.claude\//, allow: ['agents/doc-reviewer.md'] },
  { label: 'consumer application host', pattern: /\.test\/dev3/ },
  { label: 'consumer collation', pattern: /utf8_unicode_ci/ },
  { label: 'consumer rounding helper', pattern: /\bbcround\b/ },
];

test('shipped agent bodies and trap sheets carry no consumer-private references', () => {
  const offenders = [];
  for (const file of shippedAgentDocs()) {
    const text = fs.readFileSync(file, 'utf8');
    const relative = path.relative(ROOT, file);
    for (const { label, pattern, allow = [] } of FORBIDDEN) {
      if (!allow.includes(relative) && pattern.test(text)) offenders.push(`${relative}: ${label}`);
    }
  }
  assert.deepStrictEqual(offenders, []);
});

test('refactor-cleaner verifies each batch and leaves commits to the orchestrator', () => {
  const body = read('agents/refactor-cleaner.md');
  assert.match(body, /small batches/i);
  assert.doesNotMatch(body, /\band commit\b/i);
  assert.match(body, /orchestrator[^.]*commit/i);
});

test('CLI-backed roles scope frontmatter model/effort to the outer agent', () => {
  for (const file of ['codex-reasoner.md', 'codex-worker.md', 'agy-worker.md']) {
    const body = read(path.join('agents', file));
    assert.ok(body.includes('`<role>_target`'), `${file} must name <role>_target`);
    assert.match(body, /outer agent/i, `${file} must scope frontmatter to the outer agent`);
  }
});

run('agent-consumer-neutral');
