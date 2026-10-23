'use strict';
// dhpk:runtime-guidance-test

const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const ROUTE = path.join(ROOT, 'skills', 'flow-guide', 'scripts', 'pre-route.sh');

function route(query) {
  return execFileSync(ROUTE, [query], { cwd: ROOT, encoding: 'utf8' }).trim();
}

test('workflow routing returns the supported exploration routes and deliberate misses', () => {
  assert.strictEqual(route('how does the login flow work'), 'MATCH\tcode-trace\tcode exploration');
  assert.strictEqual(route('釐清登入流程'), 'MATCH\tcode-trace\tcode exploration');
  assert.strictEqual(route('implement password reset notification email'), 'NO_MATCH');
  assert.strictEqual(route('實作密碼重設郵件通知'), 'NO_MATCH');
});

run('workflow-guidance');
