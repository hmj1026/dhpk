'use strict';

// On-demand package prebuild for tests/run-all.js, split out to keep the
// runner under the 800-line ceiling. Every function expects an env that the
// runner has already stripped of inherited Git overrides (GIT_DIR, ...).

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const COMMIT_SHA = /^[a-f0-9]{40}$/i;

function loadProvenanceLib(root) {
  for (const candidate of [
    path.join(root, 'scripts', 'lib', 'platform-provenance.js'),
    path.join(__dirname, '..', '..', 'scripts', 'lib', 'platform-provenance.js'),
  ]) {
    if (!fs.existsSync(candidate)) continue;
    try {
      return require(candidate);
    } catch (_) {
      // Fixture copied only part of scripts/lib; fall back to the next candidate.
    }
  }
  return null;
}

function isCheckoutClean(root, cleanEnv) {
  const probe = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: root, env: cleanEnv, encoding: 'utf8' });
  if (probe.status !== 0 || probe.stdout.trim() !== 'true') return true;
  const status = spawnSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], { cwd: root, env: cleanEnv, encoding: 'utf8' });
  return status.status === 0 && status.stdout.trim() === '';
}

function readJsonOrNull(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return null;
  }
}

function matchesHead(root, receipt, cleanEnv) {
  const head = spawnSync('git', ['rev-parse', '--verify', 'HEAD'], { cwd: root, env: cleanEnv, encoding: 'utf8' });
  if (head.status !== 0 || !head.stdout.trim()) return true;
  const commit = receipt.generatedFromCommit || receipt.sourceCommit;
  if (typeof commit !== 'string' || !COMMIT_SHA.test(commit)) return false;
  return commit.toLowerCase() === head.stdout.trim().toLowerCase();
}

function isOnDemandPackageFresh(root, surface, packageDir, cleanEnv) {
  const inventoryPath = path.join(root, 'manifests', 'distribution-inventory.json');
  const manifestPath = path.join(root, '.claude-plugin', 'plugin.json');
  if (!fs.existsSync(inventoryPath) || !fs.existsSync(manifestPath)) return true;
  const provenanceLib = loadProvenanceLib(root);
  if (!provenanceLib || typeof provenanceLib.packageInventoryDigest !== 'function') return true;
  const receiptPath = path.join(packageDir, 'provenance.json');
  if (!fs.existsSync(receiptPath)) return false;
  const inventory = readJsonOrNull(inventoryPath);
  const manifest = readJsonOrNull(manifestPath);
  const receipt = readJsonOrNull(receiptPath);
  if (!inventory || !manifest || !receipt) return false;
  if (receipt.sourceVersion !== manifest.version) return false;
  if (receipt.inventoryDigest !== provenanceLib.packageInventoryDigest(surface, inventory)) return false;
  return matchesHead(root, receipt, cleanEnv);
}

function warnSkippedPrebuild(surface, exists, warn) {
  const condition = exists ? 'stale' : 'missing';
  warn(`[run-all] skipping on-demand ${surface} prebuild: package is ${condition} and the checkout has uncommitted changes; suites that read dist/on-demand may fail. Commit or stash, then rerun.`);
}

// Host packages built on demand (ADR 0040) are not committed, yet package and
// consumer-gate suites read them from dist/on-demand. A fresh checkout (a CI
// shard, a new worktree) has none, and an older local checkout may hold stale
// packages from a previous commit, version, or inventory, so build missing or
// stale surfaces before the full suite on a clean checkout. Trees without the
// on-demand library (copied fixtures) are skipped; dirty git checkouts are
// skipped with a warning because `distribution build` fails closed on
// uncommitted changes.
function ensureOnDemandPackages(root, cleanEnv, { warn = console.warn } = {}) {
  const libFile = path.join(root, 'scripts', 'lib', 'on-demand-packages.js');
  const launcher = path.join(root, 'bin', 'dhpk');
  if (!fs.existsSync(libFile) || !fs.existsSync(launcher)) return;
  const { ON_DEMAND_SURFACES, onDemandPackageDir } = require(libFile);
  let cleanCheckout = null;
  for (const surface of ON_DEMAND_SURFACES) {
    const packageDir = onDemandPackageDir(root, surface);
    const exists = fs.existsSync(packageDir);
    if (exists && isOnDemandPackageFresh(root, surface, packageDir, cleanEnv)) continue;
    if (cleanCheckout === null) cleanCheckout = isCheckoutClean(root, cleanEnv);
    if (!cleanCheckout) {
      warnSkippedPrebuild(surface, exists, warn);
      continue;
    }
    const built = spawnSync('bash', [launcher, 'distribution', 'build', surface, '--json'], { cwd: root, env: cleanEnv, encoding: 'utf8' });
    if (built.status !== 0) {
      throw new Error(`on-demand ${surface} build failed before the test run: ${String(built.stderr || built.stdout).trim()}`);
    }
  }
}

module.exports = { ensureOnDemandPackages };
