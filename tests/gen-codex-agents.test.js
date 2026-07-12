'use strict';

// Coverage for scripts/gen-codex-agents.js — generates Codex CLI role .toml
// files from the curated 7-agent allowlist under agents/<name>.md. Source
// dir is fixed to the repo's real agents/ (read-only, never mutated by this
// script), but the output dir is a CLI arg — always point it at a temp dir
// so the repo's own codex/agents/ output is never touched.

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'gen-codex-agents.js');

const EXPECTED_AGENTS = [
  'architect',
  'code-reviewer',
  'security-reviewer',
  'database-reviewer',
  'tdd-guide',
  'deep-reasoner',
  'doc-reviewer',
];

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gen-codex-agents-'));
}

function runScript(args) {
  return spawnSync('node', [SCRIPT, ...args], { encoding: 'utf8', timeout: 15000 });
}

function readDirBytes(dir) {
  const files = fs.readdirSync(dir).sort();
  const map = {};
  for (const f of files) map[f] = fs.readFileSync(path.join(dir, f));
  return map;
}

test('--help prints usage and exits 0', () => {
  const res = runScript(['--help']);
  assert.strictEqual(res.status, 0, res.stderr);
  assert.ok(res.stdout.includes('Usage:'), res.stdout);
});

test('too many positional args throws and exits 1', () => {
  const res = runScript(['dirA', 'dirB']);
  assert.strictEqual(res.status, 1);
  assert.ok(res.stderr.includes('at most one output directory'), res.stderr);
});

test('generates exactly the 7-agent allowlist as .toml files with derived fields', () => {
  const tmp = mkTmp();
  try {
    const outDir = path.join(tmp, 'out');
    const res = runScript([outDir]);
    assert.strictEqual(res.status, 0, res.stderr);
    assert.ok(res.stdout.includes('Generated 7 Codex role file(s).'), res.stdout);

    const files = fs.readdirSync(outDir).sort();
    assert.deepStrictEqual(files, EXPECTED_AGENTS.map((n) => `${n}.toml`).sort());

    const architect = fs.readFileSync(path.join(outDir, 'architect.toml'), 'utf8');
    assert.ok(architect.includes('name = "architect"'), architect);
    assert.ok(architect.includes('model = "gpt-5.5"'), architect);
    assert.ok(architect.includes('model_reasoning_effort = "high"'), architect);
    assert.ok(architect.includes('developer_instructions = """'), architect);

    const tddGuide = fs.readFileSync(path.join(outDir, 'tdd-guide.toml'), 'utf8');
    assert.ok(tddGuide.includes('model_reasoning_effort = "medium"'), tddGuide);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('idempotent: running twice against fresh temp dirs produces byte-identical output', () => {
  const tmp = mkTmp();
  try {
    const outDir1 = path.join(tmp, 'out1');
    const outDir2 = path.join(tmp, 'out2');
    const res1 = runScript([outDir1]);
    const res2 = runScript([outDir2]);
    assert.strictEqual(res1.status, 0, res1.stderr);
    assert.strictEqual(res2.status, 0, res2.stderr);

    const bytes1 = readDirBytes(outDir1);
    const bytes2 = readDirBytes(outDir2);
    assert.deepStrictEqual(Object.keys(bytes1), Object.keys(bytes2));
    for (const name of Object.keys(bytes1)) {
      assert.ok(bytes1[name].equals(bytes2[name]), `byte mismatch in ${name}`);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('idempotent: re-running against the SAME output dir overwrites with byte-identical content', () => {
  const tmp = mkTmp();
  try {
    const outDir = path.join(tmp, 'out');
    const res1 = runScript([outDir]);
    const before = readDirBytes(outDir);
    const res2 = runScript([outDir]);
    const after = readDirBytes(outDir);
    assert.strictEqual(res1.status, 0, res1.stderr);
    assert.strictEqual(res2.status, 0, res2.stderr);
    assert.deepStrictEqual(Object.keys(before), Object.keys(after));
    for (const name of Object.keys(before)) {
      assert.ok(before[name].equals(after[name]), `byte mismatch in ${name}`);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

run('gen-codex-agents');
