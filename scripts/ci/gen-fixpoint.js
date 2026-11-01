#!/usr/bin/env node
'use strict';

// Run the in-checkout generators in dependency order, repeating the full pass
// until a pass changes no tracked or untracked file (max 5 passes).
// Distribution packages are NOT generated here: they need a clean checkout.
// Supporting-asset digests use the non-destructive --refresh-supporting-digests
// (never gen-distribution-inventory --write, which is destructive).
//   node scripts/ci/gen-fixpoint.js [--dry-run]

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const MAX_PASSES = 5;

// Order: managed skill-resource copies -> digests -> catalogs that read them
// -> projections built from both.
const GENERATORS = [
  { name: 'sync-skill-resources', args: ['scripts/ci/sync-skill-resources.js', '--write'] },
  { name: 'gen-distribution-inventory', args: ['scripts/ci/gen-distribution-inventory.js', '--refresh-supporting-digests'] },
  { name: 'catalog', args: ['scripts/ci/catalog.js', '--write'] },
  { name: 'gen-skill-usage', args: ['scripts/ci/gen-skill-usage.js', '--write'] },
  { name: 'gen-cursor-sync', args: ['scripts/ci/gen-cursor-sync.js'] },
  { name: 'gen-codex-agents', args: ['scripts/gen-codex-agents.js'] },
  { name: 'gen-claude-manifest', args: ['scripts/ci/gen-claude-manifest.js'] },
  { name: 'gen-claude-marketplace-package', args: ['scripts/ci/gen-claude-marketplace-package.js'] },
];

const NEXT_STEP = 'next: commit, then generate the distribution packages outside the checkout (see docs/platform-installation.md)';

function defaultRunner(name, args) {
  const res = spawnSync(process.execPath, args, { cwd: ROOT, stdio: 'inherit' });
  return { status: res.status === null ? 1 : res.status };
}

function hashFile(rel) {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, rel))).digest('hex');
  } catch (_) {
    return 'absent';
  }
}

// Map of changed/untracked path -> content hash, from `git status --porcelain=v1 -z`.
function defaultSnapshot() {
  const res = spawnSync('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], { cwd: ROOT, encoding: 'utf8' });
  if (res.status !== 0) throw new Error(`git status failed: ${res.stderr}`);
  const entries = res.stdout.split('\0').filter(Boolean);
  const out = new Map();
  for (let i = 0; i < entries.length; i += 1) {
    const code = entries[i].slice(0, 2);
    const rel = entries[i].slice(3);
    if (code[0] === 'R' || code[0] === 'C') i += 1; // skip the origin path
    out.set(rel, hashFile(rel));
  }
  return out;
}

function diffPaths(before, after) {
  const paths = new Set([...before.keys(), ...after.keys()]);
  return [...paths].filter((p) => before.get(p) !== after.get(p)).sort();
}

function runFixpoint({ runner = defaultRunner, snapshot = defaultSnapshot, log = console.log, maxPasses = MAX_PASSES, dryRun = false } = {}) {
  if (dryRun) {
    log(`dry-run: up to ${maxPasses} pass(es) of ${GENERATORS.length} generators`);
    GENERATORS.forEach((g, i) => log(`  ${i + 1}. ${g.name}: node ${g.args.join(' ')}`));
    log(NEXT_STEP);
    return { ok: true, passes: 0, changed: [] };
  }
  let changed = [];
  for (let pass = 1; pass <= maxPasses; pass += 1) {
    const before = snapshot();
    for (const g of GENERATORS) {
      const { status } = runner(g.name, g.args);
      log(`pass ${pass}: ${g.name} exit ${status}`);
      if (status !== 0) return { ok: false, passes: pass, failed: g.name, exitCode: status, changed: [] };
    }
    changed = diffPaths(before, snapshot());
    if (changed.length === 0) {
      log(`converged after ${pass} pass(es)`);
      log(NEXT_STEP);
      return { ok: true, passes: pass, changed: [] };
    }
    log(`pass ${pass}: ${changed.length} path(s) changed`);
  }
  log(`did not converge after ${maxPasses} pass(es); still changing:`);
  changed.forEach((p) => log(`  ${p}`));
  return { ok: false, passes: maxPasses, changed };
}

if (require.main === module) {
  const result = runFixpoint({ dryRun: process.argv.includes('--dry-run') });
  if (result.failed) console.error(`FAIL [gen-fixpoint]: ${result.failed} exited ${result.exitCode}`);
  process.exit(result.ok ? 0 : result.exitCode || 1);
}

module.exports = { GENERATORS, runFixpoint, diffPaths };
