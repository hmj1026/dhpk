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

test('every inventory supporting asset has a unique id/destination and a materialized projection', () => {
  const entries = INVENTORY.supporting_assets || [];
  assert.strictEqual(entries.length, 29);
  assert.strictEqual(new Set(entries.map((entry) => entry.id)).size, entries.length);
  assert.strictEqual(new Set(entries.map((entry) => entry.destination)).size, entries.length);
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
