'use strict';

// Coverage for scripts/gen-codex-agents.js — generates Codex CLI role .toml
// files from the explicit Codex role descriptors. Legacy role sources live
// under agents/; Codex-only sources live under codex/agent-sources/. Output
// is always redirected to a temp dir so the checked-in projection is untouched.

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
  'frontend-reviewer',
  'migration-reviewer',
  'e2e-runner',
  'ui-verifier',
  'docs-writer',
  'scoped-worker',
];

const CODEX_ONLY_AGENTS = ['ui-verifier', 'docs-writer', 'scoped-worker'];

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
  writeCodexOnlySourceFixtures(root);
  fs.cpSync(path.join(ROOT, 'scripts'), path.join(root, 'scripts'), { recursive: true });
  return root;
}

function writeCodexOnlySourceFixtures(root) {
  const sourceDir = path.join(root, 'codex', 'agent-sources');
  fs.mkdirSync(sourceDir, { recursive: true });
  for (const role of CODEX_ONLY_AGENTS) {
    fs.writeFileSync(
      path.join(sourceDir, `${role}.md`),
      [
        '---',
        `name: ${role}`,
        `description: "Codex-only ${role} fixture role."`,
        '---',
        '',
        `Canonical fixture instructions for ${role}.`,
        '',
      ].join('\n'),
    );
  }
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

test('generates the explicit 14-role Codex projection without packaging authoring sources', () => {
  const root = cloneGeneratorFixture('gen-codex-projection');
  try {
    const outDir = path.join(root, 'out');
    const res = runFixtureScript(root, [outDir]);
    assert.strictEqual(res.status, 0, res.stderr);
    assert.ok(res.stdout.includes('Generated 14 Codex role file(s).'), res.stdout);

    const files = fs.readdirSync(outDir).sort();
    assert.deepStrictEqual(files, EXPECTED_AGENTS.map((n) => `${n}.toml`).sort());

    const architect = fs.readFileSync(path.join(outDir, 'architect.toml'), 'utf8');
    assert.ok(architect.includes('name = "architect"'), architect);
    assert.ok(architect.includes('model = "gpt-6.1-sol"'), architect);
    assert.ok(architect.includes('model_reasoning_effort = "high"'), architect);
    assert.ok(architect.includes('developer_instructions = """'), architect);

    const tddGuide = fs.readFileSync(path.join(outDir, 'tdd-guide.toml'), 'utf8');
    assert.ok(tddGuide.includes('model = "gpt-6-luna"'), tddGuide);
    assert.ok(tddGuide.includes('model_reasoning_effort = "high"'), tddGuide);
    for (const name of CODEX_ONLY_AGENTS) {
      const body = fs.readFileSync(path.join(outDir, `${name}.toml`), 'utf8');
      assert.ok(body.includes(`model = "gpt-6.1-terra"`), name);
      assert.ok(body.includes('model_reasoning_effort = "medium"'), name);
      assert.ok(body.includes(`Canonical fixture instructions for ${name}.`), name);
      assert.strictEqual(fs.existsSync(path.join(root, 'agents', `${name}.md`)), false, `${name} must remain Codex-only`);
    }
    const e2eRunner = fs.readFileSync(path.join(outDir, 'e2e-runner.toml'), 'utf8');
    assert.doesNotMatch(e2eRunner, /^sandbox_mode\s*=/m);
    assert.match(e2eRunner, /Verdict: BLOCKED/);
    for (const name of EXPECTED_AGENTS) {
      const body = fs.readFileSync(path.join(outDir, `${name}.toml`), 'utf8');
      assert.doesNotMatch(body, /^sandbox_mode\s*=/m, name);
    }
    const migrationReviewer = fs.readFileSync(path.join(outDir, 'migration-reviewer.toml'), 'utf8');
    assert.doesNotMatch(migrationReviewer, /(?:dhpk:|claude-mem)/);
    assert.match(migrationReviewer, /`database-reviewer`/);
    assert.match(migrationReviewer, /`cx`\/GitNexus symbol-level pre-edit guidance/);
    assert.doesNotMatch(fs.readFileSync(path.join(outDir, 'deep-reasoner.toml'), 'utf8'), /dhpk:/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('missing Codex-only source reports its actual path before writing any TOML', () => {
  const root = cloneGeneratorFixture('gen-codex-missing-source-red');
  try {
    const missingRole = 'ui-verifier';
    const missingSource = path.join(root, 'codex', 'agent-sources', `${missingRole}.md`);
    fs.rmSync(missingSource);
    const outDir = path.join(root, 'out');
    fs.mkdirSync(outDir, { recursive: true });
    const sentinelPath = path.join(outDir, 'architect.toml');
    fs.writeFileSync(sentinelPath, 'preserve existing output\n');

    const result = runFixtureScript(root, [outDir]);
    const output = diagnostic(result);
    assert.notStrictEqual(result.status, 0, output);
    assert.match(output, /codex\/agent-sources\/ui-verifier\.md/);
    assert.strictEqual(fs.readFileSync(sentinelPath, 'utf8'), 'preserve existing output\n');
    assert.deepStrictEqual(fs.readdirSync(outDir).sort(), ['architect.toml']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
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

test('generated read-only roles return an inline handoff and do not require a review file', () => {
  const tmp = mkTmp();
  try {
    const outDir = path.join(tmp, 'out');
    const res = runScript([outDir]);
    assert.strictEqual(res.status, 0, res.stderr);
    for (const name of [
      'architect',
      'code-reviewer',
      'security-reviewer',
      'database-reviewer',
      'deep-reasoner',
      'doc-reviewer',
      'planner',
      'frontend-reviewer',
      'migration-reviewer',
    ]) {
      const body = fs.readFileSync(path.join(outDir, `${name}.toml`), 'utf8');
      assert.doesNotMatch(body, /\.pending-[a-z-]+/, name);
      assert.doesNotMatch(body, /subagent-stop-verify|clear-sentinel|post-edit-remind/, name);
      assert.doesNotMatch(body, /\.claude\/artifacts|CLAUDE_PLUGIN_ROOT/, name);
      assert.doesNotMatch(body, /Write the final review under/, name);
      assert.doesNotMatch(body, /dispatch again/, name);
      assert.match(body, /Return scope, source identity, verdict, findings, and evidence gaps inline\./, name);
      assert.match(body, /parent persists this result when it has write authority/, name);
      assert.match(body, /even when no report file exists/, name);
      assert.match(body, /Do not record unobserved evidence as PASS/, name);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('generated role methods keep host-specific judgment and do not copy a second rule set', () => {
  const tmp = mkTmp();
  try {
    const outDir = path.join(tmp, 'out');
    const res = runScript([outDir]);
    assert.strictEqual(res.status, 0, res.stderr);
    const docReviewer = fs.readFileSync(path.join(outDir, 'doc-reviewer.toml'), 'utf8');
    assert.match(docReviewer, /Codex agent TOML/);
    assert.match(docReviewer, /Do not apply the YAML checks/);
    assert.doesNotMatch(docReviewer, /docs\/agent-guidance\/frontmatter-schema\.md/);
    assert.match(docReviewer, /\.codex\/docs\/doc-review-local\.md/);
    assert.match(docReviewer, /for Codex/);
    assert.doesNotMatch(docReviewer, /for Claude and AGY/);
    assert.doesNotMatch(docReviewer, /for Cursor/);
    assert.match(docReviewer, /local_rules_loaded/);
    const database = fs.readFileSync(path.join(outDir, 'database-reviewer.toml'), 'utf8');
    assert.match(database, /No N\+1/);
    assert.match(database, /Query plans/);
    assert.doesNotMatch(database, /Latency \/ N\+1 \/ EXPLAIN/);
    const codeReviewer = fs.readFileSync(path.join(outDir, 'code-reviewer.toml'), 'utf8');
    assert.doesNotMatch(codeReviewer, /REST paths are plural nouns, not verbs/);
    assert.match(codeReviewer, /not a defect unless the project contract/);
    assert.doesNotMatch(codeReviewer, /phpunit-11/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('generated planner keeps its inline verdict protocol without a review artifact requirement', () => {
  const root = cloneGeneratorFixture('gen-codex-planner-inline');
  try {
    const outDir = path.join(root, 'out');
    const result = runFixtureScript(root, [outDir]);
    assert.strictEqual(result.status, 0, diagnostic(result));

    const planner = fs.readFileSync(path.join(outDir, 'planner.toml'), 'utf8');
    assert.doesNotMatch(planner, /Write the final review under `\.codex\/artifacts\/reviews\//);
    assert.match(planner, /Every reply begins with `VERDICT:` and ends with literal `END`/);
    assert.match(planner, /model = "gpt-6.1-sol"/);
    assert.match(planner, /model_reasoning_effort = "high"/);
    assert.doesNotMatch(planner, /^sandbox_mode\s*=/m);
    assert.doesNotMatch(planner, /stronger judgment than the driver/);
    assert.doesNotMatch(planner, /omits model_reasoning_effort/);
    assert.match(planner, /CONSULT USE:/);
    assert.doesNotMatch(planner, /override this agent's `high` frontmatter effort with `medium`/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('generated deep reasoner keeps its inline conclusion contract without a review artifact requirement', () => {
  const root = cloneGeneratorFixture('gen-codex-reasoner-inline');
  try {
    const outDir = path.join(root, 'out');
    const result = runFixtureScript(root, [outDir]);
    assert.strictEqual(result.status, 0, diagnostic(result));

    const reasoner = fs.readFileSync(path.join(outDir, 'deep-reasoner.toml'), 'utf8');
    assert.doesNotMatch(reasoner, /Write the final review under `\.codex\/artifacts\/reviews\//);
    assert.match(reasoner, /Reasoner result: READY_FOR_DISPATCH/);
    assert.match(reasoner, /Evidence status: confirmed/);
    assert.match(reasoner, /leading hypothesis/);
    assert.match(reasoner, /unresolved/);
    assert.doesNotMatch(reasoner, /stated as fact/);
    assert.match(reasoner, /## Next actions/);
    assert.match(reasoner, /model = "gpt-6.1-sol"/);
    assert.match(reasoner, /model_reasoning_effort = "high"/);
    assert.doesNotMatch(reasoner, /^sandbox_mode\s*=/m);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('generated architect keeps its plan and ADR artifact paths without a review artifact requirement', () => {
  const root = cloneGeneratorFixture('gen-codex-architect-artifacts');
  try {
    const outDir = path.join(root, 'out');
    const result = runFixtureScript(root, [outDir]);
    assert.strictEqual(result.status, 0, diagnostic(result));

    const architect = fs.readFileSync(path.join(outDir, 'architect.toml'), 'utf8');
    assert.doesNotMatch(architect, /\.codex\/artifacts\/plans\/architect-/);
    assert.doesNotMatch(architect, /\.codex\/artifacts\/adr\/ADR-/);
    assert.match(architect, /inline handoff/);
    assert.doesNotMatch(architect, /Write the final review under `\.codex\/artifacts\/reviews\//);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('generated TDD guide keeps its substantive report contract without a review artifact mandate', () => {
  const root = cloneGeneratorFixture('gen-codex-tdd-artifacts');
  try {
    const outDir = path.join(root, 'out');
    const result = runFixtureScript(root, [outDir]);
    assert.strictEqual(result.status, 0, diagnostic(result));

    const tddGuide = fs.readFileSync(path.join(outDir, 'tdd-guide.toml'), 'utf8');
    assert.match(tddGuide, /Assigned test traces and runner output may be written separately/);
    assert.match(tddGuide, /Do not record unobserved evidence as PASS/);
    assert.doesNotMatch(tddGuide, /tdd-\{yyyymmdd-HHMMSS\}-\{slug\}\.md/);
    assert.doesNotMatch(tddGuide, /Write the final review under `\.codex\/artifacts\/reviews\//);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('generated E2E runner keeps its journey artifact contract without a review artifact mandate', () => {
  const root = cloneGeneratorFixture('gen-codex-e2e-artifacts');
  try {
    const outDir = path.join(root, 'out');
    const result = runFixtureScript(root, [outDir]);
    assert.strictEqual(result.status, 0, diagnostic(result));

    const e2eRunner = fs.readFileSync(path.join(outDir, 'e2e-runner.toml'), 'utf8');
    assert.match(e2eRunner, /artifact_paths:/);
    assert.doesNotMatch(e2eRunner, /Write the final review under `\.codex\/artifacts\/reviews\//);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('E2E verdict projection is idempotent when BLOCKED is already present', () => {
  const root = cloneGeneratorFixture('gen-codex-e2e-verdict-idempotence');
  try {
    const e2eSource = fs.readFileSync(path.join(root, 'agents', 'e2e-runner.md'), 'utf8');
    assert.match(e2eSource, /Verdict: PASS \| WARNING \| FAIL \| BLOCKED/);

    const outDir = path.join(root, 'out');
    const result = runFixtureScript(root, [outDir]);
    assert.strictEqual(result.status, 0, diagnostic(result));

    const e2eRunner = fs.readFileSync(path.join(outDir, 'e2e-runner.toml'), 'utf8');
    assert.match(e2eRunner, /Verdict: PASS \| WARNING \| FAIL \| BLOCKED/);
    assert.doesNotMatch(e2eRunner, /Verdict: PASS \| WARNING \| FAIL \| BLOCKED(?: \| BLOCKED)+/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
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
