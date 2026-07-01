'use strict';

// Static sentinel-integrity guard, complementing the runtime drift guard in
// _lib/payload.sh. Asserts: (a) the four lockstep sentinel arrays are equal
// length; (b) no dead-slot token (`art` / singular `artifact`) survives under
// scripts/hooks/; (c) every `.pending-*` literal used under scripts/hooks/ is a
// member of SENTINEL_NAMES.

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const HOOKS_DIR = path.join(ROOT, 'scripts', 'hooks');
const PAYLOAD = path.join(HOOKS_DIR, '_lib', 'payload.sh');
const payloadText = fs.readFileSync(PAYLOAD, 'utf8');

// Count the "quoted" entries of a bash array literal `NAME=( "a" "b" ... )`.
function arrayEntries(name) {
  const m = payloadText.match(new RegExp(`${name}=\\(([^)]*)\\)`));
  assert.ok(m, `array ${name} not found in payload.sh`);
  return (m[1].match(/"[^"]*"/g) || []).map((s) => s.slice(1, -1));
}

function shFiles(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const fp = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...shFiles(fp));
    else if (e.name.endsWith('.sh')) out.push(fp);
  }
  return out;
}

const SLOT_ARRAYS = ['SENTINEL_NAMES', 'SENTINEL_LABELS', 'SENTINEL_SHORT_NAMES', '_dhpk_default_agents'];

test('(a) the four lockstep sentinel arrays are equal length', () => {
  const lengths = SLOT_ARRAYS.map((n) => [n, arrayEntries(n).length]);
  const first = lengths[0][1];
  assert.ok(first > 0, 'SENTINEL_NAMES parsed as empty');
  for (const [name, len] of lengths) {
    assert.strictEqual(len, first,
      `array length drift: ${name}=${len} vs SENTINEL_NAMES=${first} (${JSON.stringify(lengths)})`);
  }
});

test('(b) no dead-slot token (art / singular artifact) under scripts/hooks/', () => {
  // \bart\b / \bartifact\b match the standalone slot tokens but NOT the plural
  // "artifacts" directory (word char follows) — so `.claude/artifacts/` is safe.
  const dead = /\bart\b|\bartifact\b/;
  for (const fp of shFiles(HOOKS_DIR)) {
    const lines = fs.readFileSync(fp, 'utf8').split('\n');
    lines.forEach((line, i) => {
      assert.ok(!dead.test(line),
        `dead-slot token in ${path.relative(ROOT, fp)}:${i + 1} -> ${line.trim()}`);
    });
  }
});

test('(c) every .pending-* literal under scripts/hooks/ is a SENTINEL_NAMES member', () => {
  const members = new Set(arrayEntries('SENTINEL_NAMES'));
  assert.ok(members.size > 0, 'SENTINEL_NAMES is empty');
  const used = new Set();
  for (const fp of shFiles(HOOKS_DIR)) {
    const text = fs.readFileSync(fp, 'utf8');
    for (const lit of text.match(/\.pending-[a-z-]+/g) || []) used.add(lit);
  }
  assert.ok(used.size > 0, 'no .pending-* literals found under scripts/hooks/ (parser broken?)');
  for (const lit of used) {
    assert.ok(members.has(lit),
      `orphan sentinel literal '${lit}' used in hooks but not in SENTINEL_NAMES`);
  }
});

run('sentinel-slots');
