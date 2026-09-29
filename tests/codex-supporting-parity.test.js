'use strict';

// Supporting assets are a second projection surface. Direct copies must remain
// byte-identical to their canonical source; the small transformed Codex files
// declare canonical_source and are checked for an explicit Codex-only boundary.

const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const INVENTORY = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests/distribution-inventory.json'), 'utf8'));

function projectionPath(entry) {
  if (entry.destination === 'config.toml.example') return path.join(ROOT, 'codex', 'config.toml.example');
  return path.join(ROOT, 'codex', 'supporting', entry.destination.replace(/^dhpk\//, ''));
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function projectedFiles(root) {
  const result = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      assert.ok(!entry.isSymbolicLink(), `${file} must be a materialized supporting file, not a symlink`);
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile()) result.push(path.relative(ROOT, file).split(path.sep).join('/'));
    }
  }
  walk(root);
  return result;
}

test('every inventory supporting asset has a unique id/destination and a materialized projection', () => {
  const entries = INVENTORY.supporting_assets || [];
  assert.strictEqual(new Set(entries.map((entry) => entry.id)).size, entries.length);
  assert.strictEqual(new Set(entries.map((entry) => entry.destination)).size, entries.length);
  const expectedPaths = entries.map((entry) => path.relative(ROOT, projectionPath(entry)).split(path.sep).join('/'));
  const configPath = path.join(ROOT, 'codex', 'config.toml.example');
  const configStat = fs.lstatSync(configPath);
  assert.ok(configStat.isFile() && !configStat.isSymbolicLink(), 'Codex config.toml.example must be a materialized file, not a symlink');
  const actualPaths = [
    ...projectedFiles(path.join(ROOT, 'codex', 'supporting')),
    ...(configStat.isFile() ? ['codex/config.toml.example'] : []),
  ];
  assert.deepStrictEqual([...actualPaths].sort(), [...expectedPaths].sort(), 'Codex supporting files drifted from the inventory projections');

  for (const entry of entries) {
    assert.ok(fs.existsSync(path.join(ROOT, entry.source)), `${entry.source} missing`);
    assert.ok(fs.existsSync(projectionPath(entry)), `${entry.destination} projection missing`);
  }
});

test('direct supporting assets stay byte-identical to canonical sources', () => {
  for (const entry of INVENTORY.supporting_assets || []) {
    if (entry.canonical_source) continue;
    const source = path.join(ROOT, entry.source);
    const projected = projectionPath(entry);
    assert.ok(Buffer.from(fs.readFileSync(source)).equals(Buffer.from(fs.readFileSync(projected))),
      `${entry.id} drifted from ${entry.source}`);
  }
});

test('transformed supporting assets declare canonical sources and remove Claude lifecycle mechanics', () => {
  for (const entry of INVENTORY.supporting_assets || []) {
    if (!entry.canonical_source) continue;
    const projected = fs.readFileSync(projectionPath(entry), 'utf8');
    const canonical = path.join(ROOT, entry.canonical_source);
    assert.ok(fs.existsSync(canonical), `${entry.canonical_source} missing`);
    assert.match(entry.canonical_digest || '', /^[a-f0-9]{64}$/, `${entry.id} needs a canonical digest`);
    assert.strictEqual(sha256(canonical), entry.canonical_digest, `${entry.id} canonical source drifted`);
    assert.match(entry.projection_digest || '', /^[a-f0-9]{64}$/, `${entry.id} needs a projection digest`);
    assert.strictEqual(sha256(projectionPath(entry)), entry.projection_digest, `${entry.id} projection drifted`);
    assert.doesNotMatch(projected, /\$\{CLAUDE_PLUGIN_ROOT\}|subagent-stop-verify|clear-sentinel|\.pending-/,
      `${entry.id} retains Claude lifecycle mechanics`);
    assert.doesNotMatch(projected, /\.claude\/|\bCLAUDE\.md\b/, `${entry.id} retains unreachable Claude references`);
  }
});

run('codex-supporting-parity');
