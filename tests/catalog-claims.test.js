'use strict';

// Guards the broadened claim specs in scripts/ci/catalog.js: for each enforced
// numeric claim (EN total agents, root agents, modules, sentinel slots, ZH total
// agents), planting a wrong digit must make `catalog.js --check` fail. Runs
// against a faithful temp copy of the subtrees catalog.js reads, so the real
// repo files are never mutated.

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');

// Copy only the subtrees catalog.js resolves relative to its own root: the count
// sources (agents/modules/skills/commands), the sentinel SSOT (scripts), and the
// claim files. catalog.js derives ROOT from __dirname, so the copied script sees
// the temp tree as its repo.
function makeTempRepo() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-catalog-'));
  for (const rel of ['scripts', 'agents', 'modules', 'skills', 'commands', 'rules',
    'README.md', 'README.zh-TW.md', '.claude-plugin']) {
    const src = path.join(ROOT, rel);
    if (fs.existsSync(src)) fs.cpSync(src, path.join(tmp, rel), { recursive: true });
  }
  return tmp;
}

function runCheck(repo) {
  const res = spawnSync('node', [path.join(repo, 'scripts', 'ci', 'catalog.js'), '--check'],
    { encoding: 'utf8' });
  return { status: res.status, out: (res.stdout || '') + (res.stderr || '') };
}

const repo = makeTempRepo();
process.on('exit', () => { try { fs.rmSync(repo, { recursive: true, force: true }); } catch { /* best effort */ } });

test('faithful temp copy passes --check as-is', () => {
  const { status, out } = runCheck(repo);
  assert.strictEqual(status, 0, `baseline temp copy should pass --check, got:\n${out}`);
});

// Each entry: an enforced claim phrasing + the claim file it lives in. Planting a
// wrong digit (found + 7, always a mismatch) must flip --check to exit 1.
const DRIFTS = [
  { file: 'README.md', find: /(\d+)(\s+role-based agents)/, label: 'EN total agents' },
  { file: 'README.md', find: /(\d+)(\s+root-level agents)/, label: 'root-level agents' },
  { file: 'README.md', find: /(\d+)(\s+opt-in stack modules)/, label: 'modules' },
  { file: 'README.md', find: /(\d+)(-slot)/, label: 'sentinel slots' },
  { file: 'README.zh-TW.md', find: /(\d+)(\s*個角色導向 agent)/, label: 'ZH total agents' },
  { file: 'rules/execution-policy.md', find: /(\d+)(-slot)/, label: 'sentinel slots (execution-policy)' },
  { file: 'agents/INDEX.md', find: /(\d+)(-slot)/, label: 'sentinel slots (INDEX)' },
];

for (const d of DRIFTS) {
  test(`planted drift in "${d.label}" makes --check fail`, () => {
    const fp = path.join(repo, d.file);
    const original = fs.readFileSync(fp, 'utf8');
    const m = original.match(d.find);
    assert.ok(m, `expected to find the "${d.label}" claim phrasing in ${d.file}`);
    const mutated = original.replace(d.find, `${Number(m[1]) + 7}$2`);
    assert.notStrictEqual(mutated, original, 'mutation must change the file');
    fs.writeFileSync(fp, mutated);
    try {
      const { status } = runCheck(repo);
      assert.strictEqual(status, 1, `--check must fail on a wrong "${d.label}" count`);
    } finally {
      fs.writeFileSync(fp, original); // restore so specs stay independent
    }
  });
}

run('catalog-claims');
