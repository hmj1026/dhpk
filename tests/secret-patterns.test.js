'use strict';

// One secret-pattern list for canonical skill content (#1248). The agents-skills
// generator and the project projection publisher used to miss URL-embedded
// credentials that the AGY generator blocked.

const { test, run, assert } = require('./_lib/tinytest');
const { SECRET_PATTERNS, containsSecret } = require('../scripts/lib/secret-patterns');
const agentsSkills = require('../scripts/lib/agents-skills-package');

const SECRETS = [
  'token ghp_abcdefghijklmnopqrstuvwxyz0123',
  'key sk-abcdefghijklmnopqrstuvwxyz',
  'password: abcdefghijklmnop1234',
  'postgres://user:pass@db.example/app',
  'https://user:pass@example.com/repo',
  'mongodb+srv://u:p@cluster/db',
];
const CLEAN = [
  'postgres://db.example/app',
  'https://example.com/user@domain',
  'password: ${SECRET_FROM_ENV}',
  'see sk-short',
];

// Synthetic, format-valid but fake values assembled at runtime.
const AWS_KEY = ['AKIA', 'ABCDEFGHIJKLMNOP'].join('');
const SLACK_TOKEN = ['xoxb', 'abcdefghijklmnopqrstuvwx'].join('-');
const PRIVATE_KEY = ['-----BEGIN', 'RSA PRIVATE KEY-----'].join(' ');
const GITHUB_PAT = ['github_pat', 'abcdefghijklmnopqrstuvwxyz0123'].join('_');

test('the shared list detects every known secret form and passes clean text', () => {
  assert.strictEqual(SECRET_PATTERNS.length, 7);
  for (const text of [...SECRETS, `aws ${AWS_KEY}`, `slack ${SLACK_TOKEN}`, PRIVATE_KEY, GITHUB_PAT]) {
    assert.strictEqual(containsSecret(text), true, text);
  }
  for (const text of [...CLEAN, 'AKIA-not-a-key', 'xoxb-short', '-----BEGIN PUBLIC KEY-----']) {
    assert.strictEqual(containsSecret(text), false, text);
  }
});

test('the Cursor and Agent MCP scans extend the shared base with their own rules (#1252)', () => {
  const { CURSOR_SECRET_PATTERNS } = require('../scripts/lib/cursor-plugin-package');
  const { MCP_SECRET_PATTERNS } = require('../scripts/lib/agent-plugin-package');
  for (const [label, list] of [['cursor', CURSOR_SECRET_PATTERNS], ['agent mcp', MCP_SECRET_PATTERNS]]) {
    const sources = list.map((pattern) => pattern.source);
    for (const shared of SECRET_PATTERNS) {
      assert.ok(sources.includes(shared.source), `${label} must include shared rule ${shared.source}`);
    }
    assert.ok(list.length > SECRET_PATTERNS.length, `${label} keeps its MCP-specific rules`);
    // Formats the MCP lists used to miss before sharing the base.
    for (const text of [GITHUB_PAT, AWS_KEY, 'mariadb://user:pass@db.example/app']) {
      assert.ok(list.some((pattern) => pattern.test(text)), `${label} must catch ${text.slice(0, 12)}…`);
    }
  }
  assert.ok(MCP_SECRET_PATTERNS.some((pattern) => pattern.test('Authorization: Basic abcdefgh12')), 'agent keeps bearer/basic');
  assert.ok(CURSOR_SECRET_PATTERNS.some((pattern) => pattern.test('"token": "abcdefgh12"')), 'cursor keeps quoted key forms');
});

test('the agents-skills generator uses the shared list, including URL credentials', () => {
  assert.strictEqual(agentsSkills.containsSecret('postgres://user:pass@db.example/app'), true);
  for (const text of CLEAN) assert.strictEqual(agentsSkills.containsSecret(text), false, text);
});

run('secret-patterns');
