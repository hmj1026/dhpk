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
//
// `docs` and `manifests` are load-bearing, not incidental: the skill-count claims live
// in docs/ pages, and the publication-scoped claims are omitted entirely when
// manifests/distribution-inventory.json is absent. Drop either and catalog.js silently
// skips those claim files, the baseline below still passes, and the new specs go
// unexercised — the exact gap that let a stale skills/INDEX.md count ship.
function makeTempRepo() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-catalog-'));
  for (const rel of ['scripts', 'agents', 'modules', 'skills', 'commands', 'rules',
    'README.md', 'README.zh-TW.md', '.claude-plugin', 'hooks', 'tests', 'docs', 'manifests']) {
    const src = path.join(ROOT, rel);
    if (fs.existsSync(src)) fs.cpSync(src, path.join(tmp, rel), { recursive: true });
  }
  return tmp;
}

function runCatalog(repo, flag) {
  const res = spawnSync('node', [path.join(repo, 'scripts', 'ci', 'catalog.js'), flag],
    { encoding: 'utf8' });
  return { status: res.status, out: (res.stdout || '') + (res.stderr || '') };
}

function runCheck(repo) {
  return runCatalog(repo, '--check');
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
  { file: 'rules/execution-policy.md', find: /(\d+)(-slot default sentinel)/, label: 'sentinel slots (execution-policy)' },
  { file: 'agents/INDEX.md', find: /(\d+)(-slot)/, label: 'sentinel slots (INDEX)' },
  { file: 'README.md', find: /(\d+)(\s+MCP-backed `codex-\*` skills)/, label: 'MCP-backed codex skills (EN)' },
  { file: 'README.md', find: /(\d+)(\s+`\/dhpk:codex-\*` commands)/, label: 'codex commands (EN)' },
  { file: 'README.zh-TW.md', find: /(\d+)(\s*個 MCP-backed `codex-\*` skill)/, label: 'MCP-backed codex skills (ZH)' },
  { file: 'README.zh-TW.md', find: /(\d+)(\s*個 `\/dhpk:codex-\*` 指令)/, label: 'codex commands (ZH)' },
  { file: 'commands/do.md', find: /(?<=dhpk's )(\d+)(\s+commands)/, label: 'commands (do.md)' },
  { file: 'README.md', find: /(\d+)(\s+events)/, label: 'hook events (EN)' },
  { file: 'README.zh-TW.md', find: /(\d+)(\s*個事件)/, label: 'hook events (ZH)' },
  // Canonical skill count. Every site is listed: retiring a skill touches all of them,
  // and one stale site is precisely the drift that shipped before these specs existed.
  { file: 'README.md', find: /(\d+)(\s+flat `dhpk-\*` packages)/, label: 'canonical skills (README EN)' },
  { file: 'README.zh-TW.md', find: /(\d+)(\s*個扁平 `dhpk-\*` package)/, label: 'canonical skills (README ZH)' },
  { file: 'skills/INDEX.md', find: /(\d+)(\s+canonical skill packages)/, label: 'canonical skills (skills/INDEX.md)' },
  { file: 'docs/skill-platform-migration.md', find: /(\d+)(\s+flat packages at)/, label: 'canonical skills (migration EN)' },
  { file: 'docs/skill-platform-migration.zh-TW.md', find: /(\d+)(\s*個扁平 package)/, label: 'canonical skills (migration ZH)' },
  { file: 'docs/distribution-surfaces.md', find: /(\d+)(\s+canonical skills)/, label: 'canonical skills (surfaces EN)' },
  // Publication-scoped count, separate from canonical. The EN phrasing spans a line
  // break in the source, so `\s+` must match a newline on both the check and write paths.
  { file: 'docs/distribution-surfaces.md', find: /(\d+)(\s+inventory-eligible Claude skill IDs)/, label: 'claude-published skills (EN)' },
  { file: 'docs/distribution-surfaces.zh-TW.md', find: /(\d+)(\s*個 inventory-eligible skill ID)/, label: 'claude-published skills (ZH)' },
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

// `--check` proves drift is detected; this proves `--write` repairs it byte-for-byte.
// One English site, one Traditional-Chinese site, and the newline-spanning EN publication
// claim — the three shapes where a wrong capture group would survive a check-only test.
const ROUND_TRIPS = [
  { file: 'skills/INDEX.md', find: /(\d+)(\s+canonical skill packages)/, label: 'canonical skills (EN)' },
  { file: 'docs/skill-platform-migration.zh-TW.md', find: /(\d+)(\s*個扁平 package)/, label: 'canonical skills (ZH)' },
  { file: 'docs/distribution-surfaces.md', find: /(\d+)(\s+inventory-eligible Claude skill IDs)/, label: 'claude-published skills (EN, spans a newline)' },
];

for (const r of ROUND_TRIPS) {
  test(`--write repairs a drifted "${r.label}" claim in place`, () => {
    const fp = path.join(repo, r.file);
    const original = fs.readFileSync(fp, 'utf8');
    const m = original.match(r.find);
    assert.ok(m, `expected to find the "${r.label}" claim phrasing in ${r.file}`);
    try {
      fs.writeFileSync(fp, original.replace(r.find, `${Number(m[1]) + 7}$2`));
      assert.strictEqual(runCheck(repo).status, 1, '--check must fail before the repair');

      const written = runCatalog(repo, '--write');
      assert.strictEqual(written.status, 0, `--write should succeed, got:\n${written.out}`);

      assert.strictEqual(
        fs.readFileSync(fp, 'utf8'), original,
        `--write must restore ${r.file} byte-for-byte, preserving surrounding whitespace`
      );
      assert.strictEqual(runCheck(repo).status, 0, '--check must pass after the repair');
    } finally {
      fs.writeFileSync(fp, original);
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
