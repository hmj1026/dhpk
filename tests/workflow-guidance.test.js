'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const ROUTE = path.join(ROOT, 'skills', 'flow-guide', 'scripts', 'pre-route.sh');

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), 'utf8');
}

function route(query) {
  return execFileSync(ROUTE, [query], { cwd: ROOT, encoding: 'utf8' }).trim();
}

test('workflow guidance matches the route table, kernel, and PR base order', () => {
  assert.strictEqual(route('how does the login flow work'), 'MATCH\tcode-trace\tcode exploration');
  assert.strictEqual(route('釐清登入流程'), 'MATCH\tcode-trace\tcode exploration');
  assert.strictEqual(route('implement password reset notification email'), 'NO_MATCH');
  assert.strictEqual(route('實作密碼重設郵件通知'), 'NO_MATCH');

  for (const relative of ['README.md', 'docs/basic-operations.md']) {
    const text = read(relative);
    assert.match(text, /how does the login flow work/, relative);
    assert.match(text, /implement password reset notification email/, relative);
    assert.match(text, /A miss stays deliberate classification\./, relative);
    assert.match(text, /`--go` does not hand off a miss\./, relative);
  }
  for (const relative of ['README.zh-TW.md', 'docs/basic-operations.zh-TW.md']) {
    const text = read(relative);
    assert.match(text, /釐清登入流程/, relative);
    assert.match(text, /實作密碼重設郵件通知/, relative);
    assert.match(text, /沒有命中的查詢維持 deliberate classification。/, relative);
    assert.match(text, /`--go` 不會為 miss 建立 handoff。/, relative);
  }

  const guide = read('skills/flow-guide/SKILL.md');
  assert.match(guide, /execution-policy-kernel\.md/);
  assert.match(guide, /Listing a reference does not load it\./);
  assert.ok(!guide.includes('Read the local `references/execution-bundle/rules/execution-policy.md` first.'));

  for (const relative of ['skills/create-pr/SKILL.md', 'skills/create-pr/references/workflow.md']) {
    const text = read(relative);
    assert.match(text, /An explicit `--base` wins\./, relative);
    assert.match(text, /does not define a userConfig key/, relative);
    assert.match(text, /the generic fallback is `main`/, relative);
    assert.match(text, /When the project does not set `\{TICKET_PATTERN\}`, use `\[A-Z\]\+-\\d\+`\./, relative);
    assert.match(text, /do not invent one/, relative);
  }

  const cursor = read('cursor/guidance.md');
  assert.ok(!cursor.includes('agy-fast-worker'));
  assert.match(cursor, /`agy-worker`/);
});

run('workflow-guidance');
