'use strict';

// Coverage for scripts/gen-codex-agents.js — generates Codex CLI role .toml
// files from the curated 12-agent allowlist under agents/<name>.md. Source
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
  'planner',
  'spec-miner',
  'frontend-reviewer',
  'migration-reviewer',
  'e2e-runner',
];

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gen-codex-agents-'));
}

function runScript(args) {
  return spawnSync('node', [SCRIPT, ...args], { encoding: 'utf8', timeout: 15000 });
}

// The generator resolves its source, role map, ownership manifest, and shared
// helper modules relative to the script directory.  Copy those public inputs
// into a disposable fixture so mutation tests never edit the canonical
// checkout or its generated TOMLs.
function cloneGeneratorFixture(prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix || 'gen-codex-agents'}-`));
  fs.cpSync(path.join(ROOT, 'agents'), path.join(root, 'agents'), { recursive: true });
  fs.mkdirSync(path.join(root, 'codex'), { recursive: true });
  for (const file of ['agent-projection-manifest.json', 'agent-role-map.json']) {
    fs.copyFileSync(path.join(ROOT, 'codex', file), path.join(root, 'codex', file));
  }
  fs.cpSync(path.join(ROOT, 'scripts'), path.join(root, 'scripts'), { recursive: true });
  return root;
}

function runFixtureScript(root, args) {
  return spawnSync(
    'node',
    [path.join(root, 'scripts', 'gen-codex-agents.js'), ...args],
    { cwd: root, encoding: 'utf8', timeout: 15000 },
  );
}

function appendCanonicalBody(root, role, body) {
  fs.appendFileSync(path.join(root, 'agents', `${role}.md`), `\n${body.trim()}\n`);
}

function diagnostic(result) {
  return `${result.stdout || ''}\n${result.stderr || ''}`;
}

function assertNeighborDiagnostic(output, { source, token, state }) {
  assert.match(output, new RegExp(source));
  assert.match(output, new RegExp(token));
  assert.match(output, new RegExp(`\\b${state}\\b`, 'i'));
  assert.match(output, /direct Codex role|explicit manual fallback/i);
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

test('generated source rejects a known non-direct neighbor before writing its TOML', () => {
  const root = cloneGeneratorFixture('gen-codex-known-neighbor-red');
  try {
    appendCanonicalBody(root, 'architect', 'The handoff remains `silent-failure-hunter` and must be reviewed.');
    const outDir = path.join(root, 'out');
    const result = runFixtureScript(root, [outDir]);
    const output = diagnostic(result);
    assert.notStrictEqual(result.status, 0, output);
    assert.strictEqual(fs.existsSync(path.join(outDir, 'architect.toml')), false, output);
    assertNeighborDiagnostic(output, {
      source: 'architect',
      token: 'silent-failure-hunter',
      state: 'merged',
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('generated source rejects an unknown executable neighbor before writing its TOML', () => {
  const root = cloneGeneratorFixture('gen-codex-unknown-neighbor-red');
  try {
    appendCanonicalBody(root, 'architect', 'dispatch `ghost-role` for the unresolved handoff.');
    const outDir = path.join(root, 'out');
    const result = runFixtureScript(root, [outDir]);
    const output = diagnostic(result);
    assert.notStrictEqual(result.status, 0, output);
    assert.strictEqual(fs.existsSync(path.join(outDir, 'architect.toml')), false, output);
    assertNeighborDiagnostic(output, {
      source: 'architect',
      token: 'ghost-role',
      state: 'unknown',
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('generated source keeps unknown prose and fenced-code mentions out of the executable fence', () => {
  const root = cloneGeneratorFixture('gen-codex-neighbor-false-positive');
  try {
    appendCanonicalBody(root, 'architect', [
      'Historical prose mentions `ghost-role`, `data-testid`, and `playwright-cli`.',
      'The version marker is `v1-2-3`, while the file name is `agents/ghost-role.md`.',
      '',
      '```text',
      'dispatch `fenced-ghost-role`',
      '```',
    ].join('\n'));
    const outDir = path.join(root, 'out');
    const result = runFixtureScript(root, [outDir]);
    assert.strictEqual(result.status, 0, diagnostic(result));
    assert.ok(fs.existsSync(path.join(outDir, 'architect.toml')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('generates exactly the 12-agent allowlist as .toml files with derived fields', () => {
  const tmp = mkTmp();
  try {
    const outDir = path.join(tmp, 'out');
    const res = runScript([outDir]);
    assert.strictEqual(res.status, 0, res.stderr);
    assert.ok(res.stdout.includes('Generated 12 Codex role file(s).'), res.stdout);

    const files = fs.readdirSync(outDir).sort();
    assert.deepStrictEqual(files, EXPECTED_AGENTS.map((n) => `${n}.toml`).sort());

    const architect = fs.readFileSync(path.join(outDir, 'architect.toml'), 'utf8');
    assert.ok(architect.includes('name = "architect"'), architect);
    assert.ok(architect.includes('model = "gpt-5.6-sol"'), architect);
    assert.ok(architect.includes('model_reasoning_effort = "high"'), architect);
    assert.ok(architect.includes('developer_instructions = """'), architect);

    const tddGuide = fs.readFileSync(path.join(outDir, 'tdd-guide.toml'), 'utf8');
    assert.ok(tddGuide.includes('model = "gpt-5.6-luna"'), tddGuide);
    assert.ok(tddGuide.includes('model_reasoning_effort = "max"'), tddGuide);
    const e2eRunner = fs.readFileSync(path.join(outDir, 'e2e-runner.toml'), 'utf8');
    assert.ok(e2eRunner.includes('sandbox_mode = "workspace-write"'), e2eRunner);
    assert.match(e2eRunner, /Verdict: BLOCKED/);
    const migrationReviewer = fs.readFileSync(path.join(outDir, 'migration-reviewer.toml'), 'utf8');
    assert.doesNotMatch(migrationReviewer, /(?:dhpk:|claude-mem)/);
    assert.match(migrationReviewer, /`database-reviewer`/);
    assert.match(migrationReviewer, /`cx`\/GitNexus symbol-level pre-edit guidance/);
    assert.doesNotMatch(fs.readFileSync(path.join(outDir, 'deep-reasoner.toml'), 'utf8'), /dhpk:/);
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

test('generated reviewer roles retain reachable Codex trap and contract references', () => {
  const tmp = mkTmp();
  try {
    const outDir = path.join(tmp, 'out');
    const res = runScript([outDir]);
    assert.strictEqual(res.status, 0, res.stderr);
    const codeReviewer = fs.readFileSync(path.join(outDir, 'code-reviewer.toml'), 'utf8');
    assert.match(codeReviewer, /\.codex\/dhpk\/agent-traps\/_common\/prompt-defense\.md/);
    assert.match(codeReviewer, /\.codex\/dhpk\/agent-traps\/_common\/trap-sheet-loader\.md/);
    assert.match(codeReviewer, /\.codex\/dhpk\/contracts\/reviewer-contract\.md/);
    assert.match(codeReviewer, /\.codex\/dhpk\/policies\/execution-policy\.md/);
    assert.doesNotMatch(codeReviewer, /\$\{CLAUDE_PLUGIN_ROOT\}/);
    const architect = fs.readFileSync(path.join(outDir, 'architect.toml'), 'utf8');
    assert.match(architect, /\.codex\/dhpk\/agent-traps\/architect\/\<stack\>\.md/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('selected role prompts do not duplicate discovery descriptions', () => {
  const tmp = mkTmp();
  try {
    const outDir = path.join(tmp, 'out');
    const res = runScript([outDir]);
    assert.strictEqual(res.status, 0, res.stderr);
    const source = fs.readFileSync(path.join(ROOT, 'agents', 'code-reviewer.md'), 'utf8');
    const description = source.match(/^description:\s*'([\s\S]*)'\s*$/m);
    assert.ok(description, 'code-reviewer source description missing');
    const value = description[1].replace(/''/g, "'").trim();
    const generated = fs.readFileSync(path.join(outDir, 'code-reviewer.toml'), 'utf8');
    const instructions = generated.slice(generated.indexOf('developer_instructions = """'));
    assert.ok(!instructions.includes(value), 'description must not be repeated in developer_instructions');
    assert.match(generated, /Use the supplied scoped task packet/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('generated reviewer roles use Codex manual review and artifact semantics', () => {
  const tmp = mkTmp();
  try {
    const outDir = path.join(tmp, 'out');
    const res = runScript([outDir]);
    assert.strictEqual(res.status, 0, res.stderr);
    for (const name of ['code-reviewer', 'security-reviewer', 'database-reviewer', 'doc-reviewer']) {
      const body = fs.readFileSync(path.join(outDir, `${name}.toml`), 'utf8');
      assert.doesNotMatch(body, /\.pending-[a-z-]+/);
      assert.doesNotMatch(body, /subagent-stop-verify|clear-sentinel|post-edit-remind/);
      assert.doesNotMatch(body, /\.claude\/artifacts|CLAUDE_PLUGIN_ROOT/);
      assert.match(body, /\.codex\/artifacts/);
      assert.match(body, /manual/i);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('planner projection uses direct Codex explorer fallback and reconsult semantics', () => {
  const tmp = mkTmp();
  try {
    const outDir = path.join(tmp, 'out');
    const res = runScript([outDir]);
    assert.strictEqual(res.status, 0, res.stderr);
    const planner = fs.readFileSync(path.join(outDir, 'planner.toml'), 'utf8');
    assert.match(
      planner,
      /several-file discovery, dispatch the direct Codex `explorer` role\. If `explorer` is unavailable, return `VERDICT: RECONSULT/,
    );
    assert.match(planner, /bounded read-only discovery uses at most 2 Explore children/);
    assert.strictEqual(
      planner.includes('spawn the built-in read-only `Explore` agent through\n  `Agent`'),
      false,
      planner,
    );
    assert.doesNotMatch(planner, /If `Explore` is unavailable, use a read-only `general-purpose` child\./);
    assert.doesNotMatch(planner, /`general-purpose`/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

run('gen-codex-agents');
