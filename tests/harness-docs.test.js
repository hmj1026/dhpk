'use strict';

// Contract checks for the public harness documentation. The document is the
// user-facing compatibility boundary; keep the assertions narrow so wording
// can evolve without duplicating the implementation.

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const DOC = path.join(ROOT, 'docs', 'harness-workflow.md');

test('documents the stable facade phases, outcomes, exits, and receipt boundary', () => {
  assert.strictEqual(fs.existsSync(DOC), true);
  const content = fs.readFileSync(DOC, 'utf8');
  for (const phase of ['preflight', 'plan', 'generate', 'validate', 'test', 'probe', 'verify', 'release']) {
    assert.match(content, new RegExp(`\\b${phase}\\b`));
  }
  for (const token of ['PASS', 'FAIL', 'BLOCKED', 'NOT_RUN', 'UNAVAILABLE', 'NO_SHIP', 'COMPLETE', '64', '70', 'dhpk.harness.receipt.v1']) {
    assert.match(content, new RegExp(token.replace(/[.]/g, '\\.'), 'i'));
  }
  assert.match(content, /structural|package/i);
  assert.match(content, /runtime|consumer/i);
});

test('documentation links resolve to repository files', () => {
  const content = fs.readFileSync(DOC, 'utf8');
  const links = [...content.matchAll(/\]\(([^)#]+)(?:#[^)]+)?\)/g)].map((match) => match[1]);
  for (const link of links) {
    if (/^(?:https?:|mailto:)/.test(link)) continue;
    assert.strictEqual(fs.existsSync(path.resolve(path.dirname(DOC), link)), true, `broken link: ${link}`);
  }
});

run('harness-docs');
