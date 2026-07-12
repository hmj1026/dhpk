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
// sources (agents/modules/skills/commands), the sentinel SSOT (scripts), the
// claim files, hooks/hooks.json (hook-event count), and tests/ (script-coverage
// check reads the real tests/ dir). catalog.js derives ROOT from __dirname, so
// the copied script sees the temp tree as its repo.
function makeTempRepo() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-catalog-'));
  for (const rel of ['scripts', 'agents', 'modules', 'skills', 'commands', 'rules',
    'README.md', 'README.zh-TW.md', '.claude-plugin', 'hooks', 'tests']) {
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
  { file: 'README.md', find: /(\d+)(\s+MCP-backed `codex-\*` skills)/, label: 'MCP-backed codex skills (EN)' },
  { file: 'README.md', find: /(\d+)(\s+`\/dhpk:codex-\*` commands)/, label: 'codex commands (EN)' },
  { file: 'README.zh-TW.md', find: /(\d+)(\s*個 MCP-backed `codex-\*` skill)/, label: 'MCP-backed codex skills (ZH)' },
  { file: 'README.zh-TW.md', find: /(\d+)(\s*個 `\/dhpk:codex-\*` 指令)/, label: 'codex commands (ZH)' },
  { file: 'commands/do.md', find: /(?<=dhpk's )(\d+)(\s+commands)/, label: 'commands (do.md)' },
  { file: 'README.md', find: /(\d+)(\s+events)/, label: 'hook events (EN)' },
  { file: 'README.zh-TW.md', find: /(\d+)(\s*個事件)/, label: 'hook events (ZH)' },
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

test('hookEvents equals the distinct top-level event-key count of hooks/hooks.json', () => {
  const hooksJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'hooks', 'hooks.json'), 'utf8'));
  const expected = Object.keys(hooksJson.hooks || {}).length;
  const res = spawnSync('node', [path.join(ROOT, 'scripts', 'ci', 'catalog.js')], { encoding: 'utf8' });
  assert.strictEqual(res.status, 0, res.stderr);
  const m = res.stdout.match(/hooks:\s+(\d+) events/);
  assert.ok(m, `expected the printed table to report hook-event count, got:\n${res.stdout}`);
  assert.strictEqual(Number(m[1]), expected, 'printed hookEvents must equal hooks.json top-level key count');
});

test('command-count claim spec matches commands/do.md phrasing', () => {
  const doMd = fs.readFileSync(path.join(ROOT, 'commands', 'do.md'), 'utf8');
  const m = doMd.match(/dhpk's (\d+) commands/);
  assert.ok(m, 'expected commands/do.md to contain the "dhpk\'s N commands" phrasing catalog.js anchors on');
});

test('coverage check reports zero uncovered scripts on the real repo', () => {
  const res = spawnSync('node', [path.join(ROOT, 'scripts', 'ci', 'catalog.js'), '--check'], { encoding: 'utf8' });
  const out = (res.stdout || '') + (res.stderr || '');
  assert.strictEqual(res.status, 0, `real repo --check must pass, got:\n${out}`);
  assert.ok(out.includes('0 uncovered'), `expected "0 uncovered" in output, got:\n${out}`);
});

test('a synthetic uncovered script is detected and fails --check', () => {
  const fixtureRel = path.join('scripts', 'zz-synthetic-uncovered-fixture.sh');
  const fixtureFp = path.join(repo, fixtureRel);
  fs.writeFileSync(fixtureFp, '#!/usr/bin/env bash\necho fixture\n');
  try {
    const { status, out } = runCheck(repo);
    assert.strictEqual(status, 1, `--check must fail when a script has no dedicated test, got:\n${out}`);
    assert.ok(
      out.includes('UNCOVERED scripts/zz-synthetic-uncovered-fixture.sh'),
      `expected an UNCOVERED line naming the fixture, got:\n${out}`
    );
  } finally {
    fs.rmSync(fixtureFp, { force: true });
  }
});

run('catalog-claims');
