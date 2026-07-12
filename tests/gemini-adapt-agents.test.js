'use strict';

// Coverage for scripts/gemini-adapt-agents.js — rewrites agent frontmatter
// `tools: [...]` lines to Gemini-compatible tool names and strips `color:`
// metadata. Always run against a temp fixture dir, never the repo's real
// .gemini/agents.

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'gemini-adapt-agents.js');

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-adapt-'));
}

function runScript(args) {
  return spawnSync('node', [SCRIPT, ...args], { encoding: 'utf8', timeout: 10000 });
}

test('--help prints usage and exits 0', () => {
  const res = runScript(['--help']);
  assert.strictEqual(res.status, 0, res.stderr);
  assert.ok(res.stdout.includes('Usage:'), res.stdout);
});

test('missing directory errors and exits 1', () => {
  const tmp = mkTmp();
  try {
    const missing = path.join(tmp, 'nope');
    const res = runScript([missing]);
    assert.strictEqual(res.status, 1);
    assert.ok(res.stderr.includes('Agents directory not found'), res.stderr);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('too many positional args throws and exits 1', () => {
  const res = runScript(['dirA', 'dirB']);
  assert.strictEqual(res.status, 1);
  assert.ok(res.stderr.includes('at most one agents directory'), res.stderr);
});

test('rewrites tools list to Gemini names, dedupes, strips color, and reports counts', () => {
  const tmp = mkTmp();
  try {
    const agentsDir = path.join(tmp, 'agents');
    fs.mkdirSync(agentsDir, { recursive: true });
    const src = [
      '---',
      'name: sample',
      'color: blue',
      "tools: ['Read', 'Write', 'Read', 'mcp__foo__bar']",
      '---',
      '',
      'Body text.',
      '',
    ].join('\n');
    fs.writeFileSync(path.join(agentsDir, 'sample.md'), src);
    fs.writeFileSync(path.join(agentsDir, 'no-frontmatter.md'), 'Just a plain markdown file.\n');

    const res = runScript([agentsDir]);
    assert.strictEqual(res.status, 0, res.stderr);
    assert.ok(res.stdout.includes('Updated 1 agent file(s); 1 already compatible'), res.stdout);

    const rewritten = fs.readFileSync(path.join(agentsDir, 'sample.md'), 'utf8');
    assert.ok(!rewritten.includes('color:'), rewritten);
    assert.ok(rewritten.includes('tools: ["read_file", "write_file", "mcp_foo_bar"]'), rewritten);
    assert.ok(rewritten.includes('Body text.'), rewritten);

    const untouched = fs.readFileSync(path.join(agentsDir, 'no-frontmatter.md'), 'utf8');
    assert.strictEqual(untouched, 'Just a plain markdown file.\n');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('already-compatible tools line is left unchanged (idempotent, reported as unchanged)', () => {
  const tmp = mkTmp();
  try {
    const agentsDir = path.join(tmp, 'agents');
    fs.mkdirSync(agentsDir, { recursive: true });
    const src = ['---', 'name: sample', 'tools: ["read_file", "write_file"]', '---', '', 'Body.', ''].join('\n');
    fs.writeFileSync(path.join(agentsDir, 'sample.md'), src);

    const res = runScript([agentsDir]);
    assert.strictEqual(res.status, 0, res.stderr);
    assert.ok(res.stdout.includes('Updated 0 agent file(s); 1 already compatible'), res.stdout);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

run('gemini-adapt-agents');
