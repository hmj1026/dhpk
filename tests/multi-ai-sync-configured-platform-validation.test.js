'use strict';

// Regression coverage for harness-govern sync validation scoped to configured platforms.
// Each test proves a currently-real defect (issue #89) against the shipped
// harness-govern's multi_ai_sync.py CLI/lib, using fixture repos built on the fly — no static
// fixture directories are checked in, matching the existing parity test idiom.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'skills', 'harness-govern', 'scripts', 'multi_ai_sync.py');
const SCRIPTS_DIR = path.join(ROOT, 'skills', 'harness-govern', 'scripts');

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `dhpk-${prefix}-`));
}

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function runValidate(root, extraArgs = []) {
  return spawnSync('python3', ['-B', SCRIPT, '--root', root, 'validate', '--format', 'json', ...extraArgs], {
    encoding: 'utf8',
    timeout: 20000,
  });
}

function importLib(pyExpr) {
  const snippet = `import sys\nsys.path.insert(0, ${JSON.stringify(SCRIPTS_DIR)})\n${pyExpr}`;
  return spawnSync('python3', ['-B', '-c', snippet], { encoding: 'utf8', timeout: 20000 });
}

// ---- Fixture builders (task 1.1) ----

function buildValidClaude(root, { agents = ['architect'] } = {}) {
  writeFile(path.join(root, '.claude/settings.local.json'), '{}\n');
  writeFile(path.join(root, '.claude/skills/demo/SKILL.md'), '# Demo\n');
  writeFile(path.join(root, '.claude/commands/demo.md'), '# Demo command\n');
  writeFile(path.join(root, '.claude/hooks/noop.sh'), '#!/bin/sh\n');
  for (const role of agents) {
    writeFile(path.join(root, `.claude/agents/${role}.md`), `---\nname: ${role}\n---\nRole body\n`);
  }
}

function buildValidCodex(root, { agents = ['architect'] } = {}) {
  writeFile(path.join(root, '.codex/config.toml'), '[features]\nmulti_agent = true\n');
  writeFile(path.join(root, '.codex/skills/demo/SKILL.md'), '# Demo\n');
  for (const role of agents) {
    writeFile(
      path.join(root, `.codex/agents/${role}.toml`),
      `name = "${role}"\ndescription = "test"\ndeveloper_instructions = "This file is self-contained. test"\n`,
    );
  }
}

function buildValidAntigravity(root) {
  writeFile(path.join(root, '.agent/rules/demo.md'), 'trigger: demo\nBody\n');
  writeFile(path.join(root, '.agent/skills/demo/SKILL.md'), '# Demo\n');
  writeFile(path.join(root, '.agent/workflows/demo.md'), '# Demo workflow\n');
  writeFile(path.join(root, '.agent/workflows/review.md'), '# Review workflow\n');
}

function buildParityManifest(root, roles) {
  const manifest = {
    generated_at: '2026-01-01T00:00:00Z',
    schema_version: 1,
    owner: 'multi-ai-parity-apply',
    source: 'claude',
    target: 'codex',
    mode: 'claude-parity-self-contained',
    sync_run_id: 'fixture',
    manifest_path: '.codex/agents/sync-manifest.json',
    roles: roles.map((role) => ({
      source_agent: `.claude/agents/${role}.md`,
      target_toml: `.codex/agents/${role}.toml`,
      mirror_md: `.codex/agents/${role}.md`,
      mirrored_refs: [],
      nonportable_sources: [],
      coverage_keywords: [],
      sync_run_id: 'fixture',
    })),
    codex_native_agents: ['bug-investigator', 'explorer', 'monitor', 'worker'],
  };
  writeFile(path.join(root, '.codex/agents/sync-manifest.json'), JSON.stringify(manifest, null, 2));
  for (const role of roles) {
    writeFile(path.join(root, `.codex/agents/${role}.md`), `---\nname: ${role}\n---\nRole body\n`);
  }
}

function fixtureClaudeAndCodexOnly() {
  const root = mkTmp('claude-codex-only');
  buildValidClaude(root);
  buildValidCodex(root);
  buildParityManifest(root, ['architect']);
  return root;
}

function fixtureRetainedTargetsConfigured() {
  const root = mkTmp('retained-targets');
  buildValidClaude(root);
  buildValidCodex(root);
  buildParityManifest(root, ['architect']);
  buildValidAntigravity(root);
  return root;
}

function fixtureMissingClaudeSource() {
  const root = mkTmp('missing-claude');
  buildValidCodex(root, { agents: [] });
  buildValidAntigravity(root);
  return root;
}

function fixtureInstallerOnlyCodex() {
  const root = mkTmp('installer-only-codex');
  buildValidClaude(root, { agents: [] });
  buildValidCodex(root, { agents: [] });
  return root;
}

function fixtureParityManagedCodex() {
  const root = mkTmp('parity-managed-codex');
  buildValidClaude(root, { agents: ['architect'] });
  buildValidCodex(root, { agents: ['architect'] });
  buildParityManifest(root, ['architect']);
  return root;
}

test('task 1.1: five clean-repository fixtures build without error', () => {
  const builders = [
    fixtureClaudeAndCodexOnly,
    fixtureRetainedTargetsConfigured,
    fixtureMissingClaudeSource,
    fixtureInstallerOnlyCodex,
    fixtureParityManagedCodex,
  ];
  for (const build of builders) {
    const root = build();
    try {
      assert.ok(fs.existsSync(root), `${build.name} produced no root`);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test('task 1.2 (RED): absent target platforms should report NOT_CONFIGURED, not drag the gate to FAIL', () => {
  const root = fixtureClaudeAndCodexOnly();
  try {
    const res = runValidate(root);
    assert.ok(res.stdout, `expected JSON stdout, stderr=${res.stderr}`);
    const report = JSON.parse(res.stdout);
    const antigravity = report.results.find((r) => r.platform === 'antigravity');
    assert.ok(!report.results.some((r) => r.platform === 'gemini'), 'retired Gemini CLI must not appear in validation results');
    assert.strictEqual(
      antigravity.final_status,
      'NOT_CONFIGURED',
      `expected antigravity NOT_CONFIGURED, got ${antigravity.final_status}`,
    );
    assert.strictEqual(report.gate, 'PASS', `unconfigured platforms must not fail the gate, got ${report.gate}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('task 1.3 (RED): a documented incompatible capability reports SKIP_INCOMPATIBLE with a reason, not FAIL/legacy PARTIAL', () => {
  const root = fixtureRetainedTargetsConfigured();
  try {
    const res = runValidate(root);
    assert.ok(res.stdout, `expected JSON stdout, stderr=${res.stderr}`);
    const report = JSON.parse(res.stdout);
    const codex = report.results.find((r) => r.platform === 'codex');
    assert.strictEqual(
      codex.hook_case_state,
      'SKIP_INCOMPATIBLE',
      `expected typed SKIP_INCOMPATIBLE, got ${codex.hook_case_state}`,
    );
    assert.ok(codex.hook_case_reason, 'SKIP_INCOMPATIBLE row must carry a machine-readable reason');
    assert.notStrictEqual(codex.final_status, 'FAIL', 'a documented incompatibility must not surface as FAIL');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('task 1.4 (RED): agent discovery excludes INDEX.md/README.md navigation files from parity roles', () => {
  const root = fixtureClaudeAndCodexOnly();
  try {
    writeFile(path.join(root, '.claude/agents/INDEX.md'), '# Agent Roster\n| name | desc |\n|---|---|\n');
    writeFile(path.join(root, '.claude/agents/README.md'), '# Notes about this directory\n');
    const res = importLib(
      `from multi_ai_sync_lib.agent_sync import claude_parity_roles\nimport json\nprint(json.dumps(claude_parity_roles(${JSON.stringify(root)})))`,
    );
    assert.strictEqual(res.status, 0, res.stderr || res.stdout);
    const roles = JSON.parse(res.stdout);
    assert.ok(!roles.includes('INDEX'), `INDEX.md must not be treated as an agent role, got roles=${JSON.stringify(roles)}`);
    assert.ok(!roles.includes('README'), `README.md must not be treated as an agent role, got roles=${JSON.stringify(roles)}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('task 1.5 (RED): installer-only Codex validates without requiring .codex/agents/sync-manifest.json', () => {
  const root = fixtureInstallerOnlyCodex();
  try {
    const res = runValidate(root);
    assert.ok(res.stdout, `expected JSON stdout, stderr=${res.stderr}`);
    const report = JSON.parse(res.stdout);
    const manifestCheck = (report.policy_checks || []).find((c) => c.id === 'parity.agents.manifest');
    assert.ok(manifestCheck, 'parity.agents.manifest check must still be reported');
    assert.notStrictEqual(
      manifestCheck.status,
      'fail',
      `installer-only repo (zero Claude agent sources) must not fail for a missing sync manifest: ${manifestCheck.message}`,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('task 1.6a (RED): validate has no --targets/--all-targets flag to distinguish an explicit request from auto-discovery', () => {
  const root = fixtureRetainedTargetsConfigured();
  try {
    const res = runValidate(root, ['--targets', 'antigravity']);
    assert.ok(res.stdout, `expected JSON stdout, stderr=${res.stderr}`);
    const report = JSON.parse(res.stdout);
    assert.strictEqual(typeof report.gate, 'string');
    assert.notStrictEqual(report.gate, 'BLOCKED', 'BLOCKED must be reachable once --targets is wired to validate');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('task 1.6b (RED): an explicitly requested but wholly absent target reports BLOCKED and a non-zero exit', () => {
  const root = fixtureClaudeAndCodexOnly();
  try {
    const res = runValidate(root, ['--targets', 'agy']);
    const report = res.stdout ? JSON.parse(res.stdout) : null;
    assert.ok(report, `expected JSON output, stderr=${res.stderr}`);
    const agy = report.results.find((r) => r.platform === 'agy');
    assert.strictEqual(agy.final_status, 'BLOCKED', `explicitly requested absent agy must be BLOCKED, got ${agy && agy.final_status}`);
    assert.strictEqual(report.gate, 'BLOCKED', `gate must be BLOCKED, got ${report.gate}`);
    assert.notStrictEqual(res.status, 0, 'BLOCKED must exit non-zero');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('task 1.6c (RED): report carries a deprecated legacy_gate PASS/PARTIAL/FAIL compatibility field', () => {
  const root = fixtureRetainedTargetsConfigured();
  try {
    const res = runValidate(root);
    assert.ok(res.stdout, `expected JSON stdout, stderr=${res.stderr}`);
    const report = JSON.parse(res.stdout);
    assert.strictEqual(report.legacy_gate, 'PARTIAL', `expected legacy_gate PARTIAL (codex hooks is skip-incompatible), got ${report.legacy_gate}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('task 1.3 baseline: retained target validation does not surface retired Gemini CLI', () => {
  const root = fixtureRetainedTargetsConfigured();
  try {
    const res = runValidate(root);
    assert.ok(res.stdout, `expected JSON stdout, stderr=${res.stderr}`);
    const report = JSON.parse(res.stdout);
    assert.ok(!report.results.some((r) => r.platform === 'gemini'), 'retired Gemini CLI must not be reported');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('task 4.1/4.3 (RED): manifest carries a versioned owner marker; report states the selected ownership contract', () => {
  const root = fixtureParityManagedCodex();
  try {
    const res = runValidate(root);
    assert.ok(res.stdout, `expected JSON stdout, stderr=${res.stderr}`);
    const report = JSON.parse(res.stdout);
    const ownership = (report.policy_checks || []).find((c) => c.id === 'parity.agents.ownership_contract');
    assert.ok(ownership, 'parity.agents.ownership_contract check must be reported');
    assert.match(ownership.message, /parity_managed/, `expected parity_managed contract, got: ${ownership.message}`);
    const manifestCheck = (report.policy_checks || []).find((c) => c.id === 'parity.agents.manifest');
    assert.notStrictEqual(manifestCheck.status, 'fail', `valid versioned manifest must not fail: ${manifestCheck.message}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('task 4.4: standard Codex skill installation and parity-managed agent output coexist without a merged ownership contract', () => {
  const root = fixtureParityManagedCodex();
  try {
    const res = runValidate(root);
    assert.ok(res.stdout, `expected JSON stdout, stderr=${res.stderr}`);
    const report = JSON.parse(res.stdout);
    const codex = report.results.find((r) => r.platform === 'codex');
    assert.strictEqual(codex.smoke_ok, true, 'standard skill installation (.codex/skills/*/SKILL.md) must still be checked');
    const ownership = (report.policy_checks || []).find((c) => c.id === 'parity.agents.ownership_contract');
    assert.match(ownership.message, /parity_managed/, 'agent ownership contract must resolve independently of the skill-install check');
    assert.notStrictEqual(codex.final_status, 'FAIL', 'skill install and agent parity contracts must not be conflated into a failure');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('task 3.3 baseline: a malformed Codex role definition is reported as a failure, not counted as valid (regression guard)', () => {
  const root = fixtureParityManagedCodex();
  try {
    writeFile(path.join(root, '.codex/agents/broken.toml'), 'not-a-valid-key\n');
    const res = runValidate(root);
    assert.ok(res.stdout, `expected JSON stdout, stderr=${res.stderr}`);
    const report = JSON.parse(res.stdout);
    const codex = report.results.find((r) => r.platform === 'codex');
    assert.strictEqual(codex.final_status, 'FAIL', 'a malformed role definition must surface as a failure');
    assert.ok(
      codex.notes.some((n) => n.includes('broken.toml')),
      `expected a note naming broken.toml, got notes=${JSON.stringify(codex.notes)}`,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('regression: a Claude-only repo with parity role sources but zero .codex directory must not fail via the policy-check side channel', () => {
  const root = mkTmp('claude-only-zero-codex');
  try {
    buildValidClaude(root, { agents: ['architect'] });
    // Deliberately no .codex directory at all — codex is NOT_CONFIGURED.
    const res = runValidate(root);
    assert.ok(res.stdout, `expected JSON stdout, stderr=${res.stderr}`);
    const report = JSON.parse(res.stdout);
    const codex = report.results.find((r) => r.platform === 'codex');
    assert.strictEqual(codex.final_status, 'NOT_CONFIGURED', `expected codex NOT_CONFIGURED, got ${codex.final_status}`);
    const manifestCheck = report.policy_checks.find((c) => c.id === 'parity.agents.manifest');
    assert.notStrictEqual(manifestCheck.status, 'fail', `absent Codex must not leak a manifest FAIL: ${manifestCheck.message}`);
    const coverageCheck = report.policy_checks.find((c) => c.id === 'parity.agents.coverage');
    assert.notStrictEqual(coverageCheck.status, 'fail', `absent Codex must not leak a coverage FAIL: ${coverageCheck.message}`);
    assert.strictEqual(report.gate, 'PASS', `absent optional Codex must not fail the gate, got ${report.gate}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

run('harness-govern-sync-configured-platform-validation');
