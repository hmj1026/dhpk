'use strict';

// Coverage for scripts/validate/validate-harness.sh — plugin-source-mode
// asset validator. Two parts:
//   1. Behavioral: run it against the REAL repo (read-only checks; it never
//      writes) and assert the documented PASS/WARN/FAIL summary shape.
//   2. Fixture negative case: a scratch plugin-source tree with an agent
//      missing `name:` frontmatter must produce a [FAIL] and exit 1.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'validate', 'validate-harness.sh');

function createPluginSourceFixture({ rules, routeTable, agentFiles = {}, codexAgentFiles = {}, commandFiles = {} }) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-harness-route-fixture-'));
  fs.mkdirSync(path.join(tmp, '.claude-plugin'), { recursive: true });
  fs.writeFileSync(path.join(tmp, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'fixture' }));
  fs.mkdirSync(path.join(tmp, 'agents'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'codex', 'agents'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'commands'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'rules'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'skills'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'skills', 'flow-guide', 'references'), { recursive: true });
  fs.writeFileSync(
    path.join(tmp, 'skills', 'flow-guide', 'SKILL.md'),
    '---\nname: flow-guide\ndescription: fixture router skill\n---\n',
  );
  fs.mkdirSync(path.join(tmp, 'scripts', 'hooks'), { recursive: true });

  for (const [name, contents] of Object.entries(agentFiles)) {
    fs.writeFileSync(path.join(tmp, 'agents', name), contents);
  }
  for (const [name, contents] of Object.entries(codexAgentFiles)) {
    fs.writeFileSync(path.join(tmp, 'codex', 'agents', name), contents);
  }
  for (const [name, contents] of Object.entries(commandFiles)) {
    fs.writeFileSync(path.join(tmp, 'commands', name), contents);
  }

  if (routeTable !== null) {
    fs.writeFileSync(
      path.join(tmp, 'skills', 'flow-guide', 'references', 'route-table.json'),
      JSON.stringify(routeTable || { schema: 'dhpk.route-table.v2', rules }, null, 2),
    );
  }
  const statusline = path.join(tmp, 'statusline.sh');
  fs.writeFileSync(statusline, '#!/usr/bin/env bash\n');
  fs.chmodSync(statusline, 0o755);
  return tmp;
}

test('bash -n syntax check passes', () => {
  const res = spawnSync('bash', ['-n', SCRIPT], { encoding: 'utf8' });
  assert.strictEqual(res.status, 0, res.stderr);
});

test('agent containment uses a portable canonicalizer rather than GNU readlink flags', () => {
  const source = fs.readFileSync(SCRIPT, 'utf8');
  assert.doesNotMatch(source, /readlink\s+-f/);
  assert.match(source, /os\.path\.realpath/);
});

test('running against the real repo reports the section headers + a PASS/WARN/FAIL summary', () => {
  const res = spawnSync('bash', [SCRIPT], { cwd: ROOT, encoding: 'utf8', timeout: 60000 });
  // The checked-in repository is expected to be green; only warning-only exit 2
  // is acceptable for this real-repo evidence check.
  assert.ok([0, 2].includes(res.status), `real harness must not fail: exit ${res.status}\n${res.stdout}`);
  assert.ok(res.stdout.includes('== 1. Agents frontmatter =='), 'missing section 1 header');
  assert.ok(res.stdout.includes('== 7. Route table SSOT =='), 'missing section 7 header');
  assert.ok(/^(PASS|PASS \(with warnings\)|FAIL): /m.test(res.stdout), `no summary line found:\n${res.stdout}`);
  assert.doesNotMatch(res.stdout, /^FAIL: /m, 'real harness summary must not be FAIL');
  // Plugin-source mode detection: this repo has agents/ + .claude-plugin/plugin.json at root.
  assert.ok(res.stdout.includes('plugin source 模式'), 'did not detect plugin-source mode for this repo');
  assert.doesNotMatch(res.stdout, /dhpk-(bug-fix|feature-dev|post-dev-test|codex-brainstorm|de-ai-flavor)/, 'real harness must not report retired discovery targets');
});

test('fixture: agent missing name: frontmatter fails section 1 with exit 1', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-harness-fixture-'));
  try {
    fs.mkdirSync(path.join(tmp, '.claude-plugin'), { recursive: true });
    fs.writeFileSync(path.join(tmp, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'fixture' }));
    fs.mkdirSync(path.join(tmp, 'agents'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'scripts', 'hooks'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'agents', 'broken.md'), 'description: no name field here\n');
    fs.mkdirSync(path.join(tmp, 'commands'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'rules'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'skills'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'statusline.sh'), '#!/usr/bin/env bash\n');
    fs.chmodSync(path.join(tmp, 'statusline.sh'), 0o755);

    const res = spawnSync('bash', [SCRIPT], { cwd: tmp, encoding: 'utf8', timeout: 20000 });
    assert.strictEqual(res.status, 1, `expected exit 1 (FAIL):\n${res.stdout}`);
    assert.ok(res.stdout.includes('broken.md 缺 name:'), `missing expected FAIL line:\n${res.stdout}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('fixture: agent routes resolve from Claude agents or Codex TOML while dhpk routes keep command validation', () => {
  const tmp = createPluginSourceFixture({
    agentFiles: {
      'md-role.md': 'name: md-role\ndescription: fixture agent\nmodel: haiku\ntools: Read\n',
    },
    codexAgentFiles: {
      'toml-role.toml': 'name = "toml-role"\n',
    },
    commandFiles: {
      'verify.md': 'description: fixture command\n',
    },
    rules: [
      { pattern: 'test|測試', label: 'Claude agent route', target: { kind: 'agent', id: 'md-role' } },
      { pattern: 'plan|規劃', label: 'Codex agent route', target: { kind: 'agent', id: 'toml-role' } },
      { pattern: 'verify|驗證', label: 'dhpk command route', target: { kind: 'command', id: 'verify' } },
    ],
  });
  try {
    const res = spawnSync('bash', [SCRIPT], { cwd: tmp, encoding: 'utf8', timeout: 20000 });
    assert.strictEqual(res.status, 0, `expected valid route targets to pass:\n${res.stdout}`);
    assert.match(res.stdout, /route-table 3 條/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('fixture: missing agent route target fails without weakening dhpk target checks', () => {
  const tmp = createPluginSourceFixture({
    commandFiles: {
      'verify.md': 'description: fixture command\n',
    },
    rules: [
      { pattern: 'test|測試', label: 'missing agent route', target: { kind: 'agent', id: 'missing-role' } },
      { pattern: 'verify|驗證', label: 'dhpk command route', target: { kind: 'command', id: 'verify' } },
    ],
  });
  try {
    const res = spawnSync('bash', [SCRIPT], { cwd: tmp, encoding: 'utf8', timeout: 20000 });
    assert.strictEqual(res.status, 1, `expected missing agent target to fail:\n${res.stdout}`);
    assert.match(res.stdout, /missing-role/);
    assert.match(res.stdout, /agents\/missing-role\.md or codex\/agents\/missing-role\.toml/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('fixture: agent route rejects traversal identifiers before filesystem lookup', () => {
  const tmp = createPluginSourceFixture({
    rules: [
      { pattern: 'test|測試', label: 'traversal agent route', target: { kind: 'agent', id: '../outside' } },
    ],
  });
  try {
    const res = spawnSync('bash', [SCRIPT], { cwd: tmp, encoding: 'utf8', timeout: 20000 });
    assert.strictEqual(res.status, 1, `expected traversal target to fail:\n${res.stdout}`);
    assert.match(res.stdout, /agent target identifier 無效/);
    assert.match(res.stdout, /lowercase kebab-case/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('fixture: agent route rejects symlink escapes even when the link target is a regular file', () => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-harness-agent-outside-'));
  const outsideAgent = path.join(outside, 'escaped.md');
  fs.writeFileSync(outsideAgent, 'name: escaped\ndescription: fixture agent\nmodel: haiku\ntools: Read\n');
  const tmp = createPluginSourceFixture({
    rules: [
      { pattern: 'test|測試', label: 'symlink escape route', target: { kind: 'agent', id: 'escaped' } },
    ],
  });
  try {
    fs.symlinkSync(outsideAgent, path.join(tmp, 'agents', 'escaped.md'));
    const res = spawnSync('bash', [SCRIPT], { cwd: tmp, encoding: 'utf8', timeout: 20000 });
    assert.strictEqual(res.status, 1, `expected symlink escape to fail:\n${res.stdout}`);
    assert.match(res.stdout, /指向不存在的 agent/);
    assert.match(res.stdout, /must resolve to a canonical regular file under its root/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('fixture: agent route accepts a symlink whose canonical target remains under the agent root', () => {
  const tmp = createPluginSourceFixture({
    agentFiles: {
      'real-role.md': 'name: real-role\ndescription: fixture agent\nmodel: haiku\ntools: Read\n',
    },
    rules: [
      { pattern: 'test|測試', label: 'in-root symlink route', target: { kind: 'agent', id: 'linked-role' } },
    ],
  });
  try {
    fs.symlinkSync('real-role.md', path.join(tmp, 'agents', 'linked-role.md'));
    const res = spawnSync('bash', [SCRIPT], { cwd: tmp, encoding: 'utf8', timeout: 20000 });
    assert.strictEqual(res.status, 0, `expected in-root symlink target to pass:\n${res.stdout}`);
    assert.match(res.stdout, /route-table 1 條/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('fixture: route pattern and duplicate-target guardrails remain failures', () => {
  const tmp = createPluginSourceFixture({
    commandFiles: {
      'verify.md': 'description: fixture command\n',
    },
    rules: [
      { pattern: '[', label: 'invalid pattern', target: { kind: 'command', id: 'verify' } },
      { pattern: 'verify|驗證', label: 'duplicate target', target: { kind: 'command', id: 'verify' } },
    ],
  });
  try {
    const res = spawnSync('bash', [SCRIPT], { cwd: tmp, encoding: 'utf8', timeout: 20000 });
    assert.strictEqual(res.status, 1, `expected pattern/duplicate checks to fail:\n${res.stdout}`);
    assert.match(res.stdout, /pattern 無法編譯/);
    assert.match(res.stdout, /重複 skill target.*verify/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('fixture: missing route-table.json fails closed in plugin-source mode', () => {
  const tmp = createPluginSourceFixture({ routeTable: null, rules: [] });
  try {
    const res = spawnSync('bash', [SCRIPT], { cwd: tmp, encoding: 'utf8', timeout: 20000 });
    assert.strictEqual(res.status, 1, `expected missing route table to fail:\n${res.stdout}`);
    assert.match(res.stdout, /route-table\.json .*缺失|route-table\.json .*不存在/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('fixture: wrong or missing route-table schema/rules cannot report PASS', () => {
  const cases = [
    { name: 'wrong schema', routeTable: { schema: 'wrong', rules: [] }, expected: /schema/ },
    { name: 'missing schema', routeTable: { rules: [] }, expected: /schema/ },
    { name: 'missing rules', routeTable: { schema: 'dhpk.route-table.v2' }, expected: /rules/ },
    { name: 'rules is not an array', routeTable: { schema: 'dhpk.route-table.v2', rules: {} }, expected: /rules/ },
    { name: 'empty rules', routeTable: { schema: 'dhpk.route-table.v2', rules: [] }, expected: /rules/ },
  ];
  for (const item of cases) {
    const tmp = createPluginSourceFixture({ routeTable: item.routeTable, rules: [] });
    try {
      const res = spawnSync('bash', [SCRIPT], { cwd: tmp, encoding: 'utf8', timeout: 20000 });
      assert.strictEqual(res.status, 1, `${item.name} unexpectedly passed:\n${res.stdout}`);
      assert.match(res.stdout, item.expected, `${item.name} did not identify the malformed route table`);
      assert.doesNotMatch(res.stdout, /PASS: 全部通過|PASS \(with warnings\)/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }
});

test('fixture: malformed JSON and invalid rule shapes fail closed before route checks', () => {
  const malformed = createPluginSourceFixture({ rules: [] });
  try {
    fs.writeFileSync(path.join(malformed, 'skills', 'flow-guide', 'references', 'route-table.json'), '{"schema":');
    const res = spawnSync('bash', [SCRIPT], { cwd: malformed, encoding: 'utf8', timeout: 20000 });
    assert.strictEqual(res.status, 1, `malformed JSON unexpectedly passed:\n${res.stdout}`);
    assert.match(res.stdout, /valid JSON|parse|schema|route-table/);
  } finally {
    fs.rmSync(malformed, { recursive: true, force: true });
  }

  for (const rules of [[{}], [{ pattern: 'test' }], [{ target: { kind: 'command', id: 'verify' } }], [{ pattern: '', target: { kind: 'command', id: 'verify' }, label: 'bad' }]]) {
    const tmp = createPluginSourceFixture({ rules, commandFiles: { 'verify.md': 'description: fixture\n' } });
    try {
      const res = spawnSync('bash', [SCRIPT], { cwd: tmp, encoding: 'utf8', timeout: 20000 });
      assert.strictEqual(res.status, 1, `invalid rule unexpectedly passed (${JSON.stringify(rules)}):\n${res.stdout}`);
      assert.match(res.stdout, /rule|pattern|skill|label|rules|target/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }
});

run('validate-harness');
