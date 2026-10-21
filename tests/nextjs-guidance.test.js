'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const GUIDE = 'skills/nextjs/references/15.5.md';
const NEEDLES = [
  'ends at v15.5.19',
  '止於 v15.5.19',
  'end-of-life at v15.5.19',
  '15.x line ends at',
  '15.x ends at v15.5.19',
];
const SKIP_DIRS = new Set(['.git', 'node_modules']);

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), 'utf8');
}

function forbiddenClaims(dir, hits) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      forbiddenClaims(full, hits);
      continue;
    }
    if (!entry.isFile()) continue;
    const relative = path.relative(ROOT, full).split(path.sep).join('/');
    if (relative === 'tests/nextjs-guidance.test.js') continue;
    const bytes = fs.readFileSync(full);
    if (bytes.includes(0)) continue;
    const text = bytes.toString('utf8').replace(/\*\*/g, '').replace(/\s+/g, ' ');
    for (const needle of NEEDLES) {
      if (text.includes(needle)) hits.push(`${relative}: ${needle}`);
    }
  }
}

test('Next.js 15.5 is not described as ending at v15.5.19', () => {
  const hits = [];
  forbiddenClaims(ROOT, hits);
  assert.deepStrictEqual(hits, []);

  const guide = read(GUIDE);
  assert.match(guide, /no `nextjs-15\.6` module/);
  assert.match(guide, /2026-10-21/);
  assert.match(guide, /https:\/\/nextjs\.org\/support-policy/);
  assert.match(guide, /Maintenance LTS/);
  assert.match(guide, /two years following the initial release/);
  assert.match(guide, /Re-check the page before treating that status as current\./);
  assert.match(guide, /v15\.5\.20/);
  assert.match(guide, /v15\.5\.21/);
  assert.match(guide, /security fixes/);
  assert.match(guide, /not a minimum patched version/);
  assert.match(guide, /v15\.5\.28/);
  assert.match(guide, /not a final 15\.x patch/);
  assert.match(guide, /v15\.5\.19 is not the last 15\.x patch/);
  const plain = guide.replace(/\*\*/g, '').replace(/\s+/g, ' ');
  assert.ok(!/ends at v15\.5\.\d+/.test(plain));
  assert.ok(!/end-of-life at v15\.5\.\d+/.test(plain));
  assert.ok(!fs.existsSync(path.join(ROOT, 'modules', 'nextjs-15.6')));

  for (const relative of [
    'modules/nextjs-15.5/module.yaml',
    'README.md',
    'manifests/module-catalog.json',
    'skills/harness-setup/data/module-catalog.json',
    'codex/supporting/manifests/module-catalog.json',
    'cursor/dhpk/manifests/module-catalog.json',
  ]) {
    assert.match(read(relative), /after v15\.5\.19/, relative);
  }
  assert.match(read('README.zh-TW.md'), /v15\.5\.19 之後/);
});

run('nextjs-guidance');
