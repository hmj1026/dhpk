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

test('the shared list detects every known secret form and passes clean text', () => {
  assert.strictEqual(SECRET_PATTERNS.length, 4);
  for (const text of SECRETS) assert.strictEqual(containsSecret(text), true, text);
  for (const text of CLEAN) assert.strictEqual(containsSecret(text), false, text);
});

test('the agents-skills generator uses the shared list, including URL credentials', () => {
  assert.strictEqual(agentsSkills.containsSecret('postgres://user:pass@db.example/app'), true);
  for (const text of CLEAN) assert.strictEqual(agentsSkills.containsSecret(text), false, text);
});

run('secret-patterns');
