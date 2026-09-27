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
  const phaseOrder = content.match(/Release-capable work follows this order:\s*```text\s*([^`]+)```/);
  assert.ok(phaseOrder, 'workflow must publish the ordered release phases');
  assert.deepStrictEqual(phaseOrder[1].trim().split(/\s*->\s*/), [
    'preflight', 'plan', 'generate', 'validate', 'test', 'probe', 'verify', 'release',
  ]);

  const rows = new Map([...content.matchAll(/^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*$/gm)]
    .map((match) => [match[1].replace(/`/g, '').trim(), match[3].trim()]));
  assert.strictEqual(rows.get('PASS, COMPLETE'), '0');
  assert.strictEqual(rows.get('FAIL'), '1');
  assert.strictEqual(
    rows.get('BLOCKED, NOT_RUN, NOT_CONFIGURED, SKIP_INCOMPATIBLE, UNAVAILABLE, NO_SHIP, PARTIAL, PUBLISHED_PENDING, PUBLISHED_UNHEALTHY, OVERRIDDEN'),
    '2',
  );
  assert.strictEqual(rows.get('invalid usage'), '64');
  assert.strictEqual(rows.get('unexpected harness error'), '70');
  assert.match(content, /dhpk\.harness\.receipt\.v1/);
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
