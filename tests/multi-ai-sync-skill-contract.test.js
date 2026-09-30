'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const CANONICAL = path.join(ROOT, 'skills', 'harness-govern');
const CODEX = path.join(ROOT, 'codex', 'skills', 'harness-govern');
const canonical = fs.readFileSync(path.join(CANONICAL, 'SKILL.md'), 'utf8');
const codex = fs.readFileSync(path.join(CODEX, 'SKILL.md'), 'utf8');
const SHARED_REFERENCES = [
  'execution-contract.md',
  'platform-mapping.md',
  'capability-sources.md',
  'risk-policy.md',
  'improvement-todo.md',
  'source-conflicts.json',
];
const MODE_REFERENCES = {
  health: ['health-workflow.md', 'hygiene-checks.md', 'plugin-sync.md', 'usage-examples.md', 'best-practices.md'],
  budget: ['budget-workflow.md'],
  fill: ['fill-workflow.md', 'frontmatter-templates.md'],
  revise: ['revise-workflow.md', 'harness-directory-contract.md'],
  sync: ['sync-workflow.md', 'runtime-entrypoints.md', ...SHARED_REFERENCES],
};

test('canonical and Codex resolve to one complete harness-govern workflow tree', () => {
  assert.strictEqual(fs.realpathSync(CODEX), fs.realpathSync(CANONICAL));
  assert.ok(canonical.includes('health|budget|fill|revise|sync'), 'five governance modes are missing');
  assert.ok(fs.existsSync(path.join(CANONICAL, 'scripts', 'multi_ai_sync.py')), 'canonical sync CLI is missing');
  assert.ok(fs.existsSync(path.join(CANONICAL, 'scripts', 'multi_ai_sync_lib', 'agent_sync.py')), 'canonical agent-sync capability is missing');
  assert.ok(fs.existsSync(path.join(CANONICAL, 'scripts', 'multi_ai_sync_lib', 'apply_sync.py')), 'canonical apply-sync capability is missing');
  assert.strictEqual(codex, canonical);
});

test('workflow contract has explicit mode routing, completion, and gate sections', () => {
  for (const heading of [
    '# Harness Govern',
    '## Mode selection',
    '## Shared preflight',
    '## Mode contracts',
    '## Output shape',
    '## References and scripts',
    '## Verification',
  ]) {
    assert.ok(canonical.includes(heading), `missing ${heading}`);
  }
  const modes = ['health', 'budget', 'fill', 'revise', 'sync'];
  for (const mode of modes) {
    assert.match(canonical, new RegExp('\\\\| `' + mode + '` \\\\|'), `missing harness-govern mode: ${mode}`);
  }
  assert.ok(canonical.indexOf('## Shared preflight') < canonical.indexOf('## Mode contracts'), 'preflight must precede mode contracts');
  assert.ok(canonical.indexOf('## Mode contracts') < canonical.indexOf('## Verification'), 'mode contracts must precede verification');
});

test('each consolidated mode owns its procedure, references, and executable source', () => {
  const scripts = fs.readdirSync(path.join(CANONICAL, 'scripts'));
  assert.ok(scripts.includes('harness-inventory.sh'), 'revise inventory script is missing');
  assert.ok(scripts.includes('harness-scenarios.sh'), 'revise scenario script is missing');
  assert.ok(scripts.includes('test-harness.sh'), 'revise harness test script is missing');
  assert.ok(scripts.includes('multi_ai_sync.py'), 'sync executable is missing');
  for (const [mode, references] of Object.entries(MODE_REFERENCES)) {
    assert.match(canonical, new RegExp('\\\\| `' + mode + '` \\\\|'), `${mode} must have an explicit mode row`);
    for (const reference of references) {
      assert.ok(fs.existsSync(path.join(CANONICAL, 'references', reference)), `${mode} reference missing: ${reference}`);
    }
  }
});

test('workflow contains no stale unsupported instructions', () => {
  for (const content of [canonical, codex]) {
    assert.ok(!content.includes('--force'), 'stale --force bypass remains');
    assert.ok(!content.includes('gemini-adapt-agents'), 'obsolete Gemini adapter remains');
    assert.ok(!content.includes('.gemini/agents'), 'unsupported Gemini agent output remains');
    for (const predecessor of ['dhpk-claude-health', 'dhpk-harness-budget', 'dhpk-harness-fill', 'dhpk-harness-revise', 'dhpk-cross-agent-sync']) {
      assert.ok(!content.includes(predecessor), `retired predecessor alias remains: ${predecessor}`);
    }
  }
  assert.ok(fs.existsSync(path.join(CODEX, 'scripts', 'multi_ai_sync_lib', 'agent_sync.py')), 'Codex agent-sync extension is missing');
  assert.ok(fs.existsSync(path.join(CODEX, 'scripts', 'multi_ai_sync_lib', 'apply_sync.py')), 'Codex apply-sync extension is missing');
  assert.ok(codex.includes('sync'), 'Codex sync mode is missing');
});

test('shared references stay synced and runtime entrypoints stay harness-specific', () => {
  const canonicalRuntime = fs.readFileSync(path.join(CANONICAL, 'references', 'runtime-entrypoints.md'), 'utf8');
  const codexRuntime = fs.readFileSync(path.join(CODEX, 'references', 'runtime-entrypoints.md'), 'utf8');
  assert.strictEqual(codexRuntime, canonicalRuntime);
  assert.ok(canonicalRuntime.includes('SYNC_CLI="skills/harness-govern/scripts/multi_ai_sync.py"'));
  for (const skillRoot of [CANONICAL, CODEX]) {
    const runtimeReference = path.join(skillRoot, 'references', 'runtime-entrypoints.md');
    assert.ok(fs.existsSync(runtimeReference), `missing ${runtimeReference}`);
    const runtime = fs.readFileSync(runtimeReference, 'utf8');
    assert.ok(runtime.includes('SYNC_CLI'), `missing SYNC_CLI contract in ${runtimeReference}`);
    assert.ok(runtime.includes('--root <repo-root>'), `missing root contract in ${runtimeReference}`);
  }
  for (const referenceName of SHARED_REFERENCES) {
    const canonicalReference = path.join(CANONICAL, 'references', referenceName);
    const codexReference = path.join(CODEX, 'references', referenceName);
    assert.ok(fs.existsSync(canonicalReference), `missing ${canonicalReference}`);
    assert.ok(fs.existsSync(codexReference), `missing ${codexReference}`);
    assert.strictEqual(
      fs.readFileSync(codexReference, 'utf8'),
      fs.readFileSync(canonicalReference, 'utf8'),
      `shared reference drift: ${referenceName}`,
    );
  }
});

test('task 5.4: configured-platform status vocabulary stays consistent between SKILL.md and execution-contract.md', () => {
  const executionContract = fs.readFileSync(path.join(CANONICAL, 'references', 'execution-contract.md'), 'utf8');
  const syncWorkflow = fs.readFileSync(path.join(CANONICAL, 'references', 'sync-workflow.md'), 'utf8');
  for (const term of ['NOT_CONFIGURED', 'BLOCKED']) {
    assert.ok(canonical.includes(term), `missing status vocabulary term "${term}"`);
  }
  for (const content of [executionContract, syncWorkflow]) {
    for (const term of ['NOT_CONFIGURED', 'SKIP_INCOMPATIBLE', 'BLOCKED']) {
      assert.ok(content.includes(term), `missing status vocabulary term "${term}"`);
    }
  }
  assert.ok(executionContract.includes('legacy_gate'), 'compatibility field must remain documented in the sync contract');
  assert.ok(syncWorkflow.includes('--targets'), 'sync workflow must document the --targets/--all-targets explicit-request flags');
});

test('sync library model literals are catalogued models, not a retired generation', () => {
  const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests', 'provider-model-catalog.json'), 'utf8'));
  const known = new Set(JSON.stringify(catalog).match(/"model_id":\s*"([^"]+)"/g).map(m => m.split('"')[3]));
  const libDir = path.join(ROOT, 'skills', 'harness-govern', 'scripts', 'multi_ai_sync_lib');
  const stale = [];
  for (const name of fs.readdirSync(libDir).filter(file => file.endsWith('.py'))) {
    const source = fs.readFileSync(path.join(libDir, name), 'utf8');
    for (const [, model] of source.matchAll(/["'](gpt-[\w.-]+)["']/g)) {
      if (!known.has(model)) stale.push(`${name}: ${model}`);
    }
  }
  assert.deepStrictEqual(stale, [], `uncatalogued model ids:\n${stale.join('\n')}`);
});


// Begin merged tests from tests/multi-ai-sync-cursor-discovery.test.js.
{
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const SCRIPT_ROOT = path.join(ROOT, 'skills/harness-govern/scripts');

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

test('harness-govern sync Cursor discovery unions all roots and filters metadata', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-cursor-discovery-'));
  try {
    const roots = [
      path.join(repo, 'plugins/dhpk-cursor/agents'),
      path.join(repo, '.cursor/plugins/local/dhpk-cursor/agents'),
      path.join(repo, '.cursor/agents'),
    ];
    const filesByRoot = [
      ['reviewer.md', 'architect.md'],
      ['writer.md'],
      ['reviewer.md', 'security.md'],
    ];
    for (let index = 0; index < roots.length; index += 1) {
      for (const role of filesByRoot[index]) {
        const name = path.basename(role, '.md');
        write(path.join(roots[index], role), `---\nname: ${name}\ndescription: Test role\n---\n# Test role\n`);
      }
      for (const metadata of ['INDEX.md', 'README.md', 'provenance.md', 'fingerprints.md', 'receipt.md', 'receipts.md', '_resource.md']) {
        write(path.join(roots[index], metadata), '# metadata, not a role\n');
      }
    }
    const code = [
      'from multi_ai_sync_lib.agent_sync import cursor_agent_roles',
      'import json',
      `print(json.dumps(cursor_agent_roles(${JSON.stringify(repo)})))`,
    ].join('\n');
    const result = spawnSync('python3', ['-c', code], { cwd: SCRIPT_ROOT, encoding: 'utf8' });
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);
    assert.deepStrictEqual(JSON.parse(result.stdout), ['architect', 'reviewer', 'security', 'writer']);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
}
// End merged tests from tests/multi-ai-sync-cursor-discovery.test.js.


// Begin merged tests from tests/multi-ai-sync-parity.test.js.
{
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const CANONICAL = path.join(ROOT, 'skills', 'harness-govern', 'scripts', 'multi_ai_sync.py');
const CODEX = path.join(ROOT, 'codex', 'skills', 'harness-govern', 'scripts', 'multi_ai_sync.py');
const DRIFT = path.join(ROOT, 'scripts', 'check-cross-cli-drift.sh');

function runPython(script, args = []) {
  return spawnSync('python3', ['-B', script, ...args], { encoding: 'utf8', timeout: 20000 });
}

test('canonical and Codex harness-govern sync self-tests both pass in a clean scratch repo', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-multi-ai-sync-'));
  try {
    assert.strictEqual(fs.realpathSync(CODEX), fs.realpathSync(CANONICAL),
      'Codex entrypoint must resolve to the canonical implementation');
    const result = runPython(CODEX, ['--root', root, 'self-test', '--format', 'json']);
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);
    const report = JSON.parse(result.stdout);
    assert.strictEqual(report.total, 4, result.stdout);
    assert.strictEqual(report.passed, 4, result.stdout);
    assert.strictEqual(report.failed, 0, result.stdout);
    assert.deepStrictEqual(report.results.map(({ name, status }) => [name, status]), [
      ['agent-bundle-tdd-guide', 'pass'],
      ['agent-bundle-architect-parseable', 'pass'],
      ['agent-manifest-build', 'pass'],
      ['agent-bundle-refactor-cleaner-parseable', 'pass'],
    ]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('cross-cli drift reports content mismatch even below the mtime threshold', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-content-drift-'));
  try {
    fs.mkdirSync(path.join(root, '.claude', 'skills'), { recursive: true });
    fs.mkdirSync(path.join(root, '.codex', 'skills'), { recursive: true });
    fs.writeFileSync(path.join(root, '.claude', 'skills', 'same.md'), 'canonical\n');
    fs.writeFileSync(path.join(root, '.codex', 'skills', 'same.md'), 'stale\n');
    const now = new Date();
    fs.utimesSync(path.join(root, '.claude', 'skills', 'same.md'), now, now);
    fs.utimesSync(path.join(root, '.codex', 'skills', 'same.md'), now, now);
    const res = spawnSync('bash', [DRIFT], {
      cwd: root,
      env: { ...process.env, CLAUDE_PROJECT_DIR: root, DHPK_CROSS_CLI_DRIFT_THRESHOLD: '3600' },
      encoding: 'utf8',
      timeout: 10000,
    });
    assert.strictEqual(res.status, 0, res.stderr);
    assert.match(res.stdout, /content drift/);
    assert.match(res.stdout, /\.codex/);

    fs.writeFileSync(path.join(root, '.codex', 'skills', 'same.md'), 'canonical\n');
    fs.utimesSync(path.join(root, '.claude', 'skills', 'same.md'), now, now);
    fs.utimesSync(path.join(root, '.codex', 'skills', 'same.md'), now, now);
    assert.strictEqual(
      fs.statSync(path.join(root, '.claude', 'skills', 'same.md')).mtimeMs,
      fs.statSync(path.join(root, '.codex', 'skills', 'same.md')).mtimeMs,
      'matching-content control must retain equal mtimes',
    );
    const synchronized = spawnSync('bash', [DRIFT], {
      cwd: root,
      env: { ...process.env, CLAUDE_PROJECT_DIR: root, DHPK_CROSS_CLI_DRIFT_THRESHOLD: '3600' },
      encoding: 'utf8',
      timeout: 10000,
    });
    assert.strictEqual(synchronized.status, 0, synchronized.stderr);
    assert.doesNotMatch(synchronized.stdout, /content drift/i,
      'matching content must remove the drift advisory below the mtime threshold');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
}
// End merged tests from tests/multi-ai-sync-parity.test.js.


// Begin merged tests from tests/harness-govern-toml-fallback.test.js.
{
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'skills', 'harness-govern', 'scripts', 'multi_ai_sync.py');
const LIB_DIR = path.join(ROOT, 'skills', 'harness-govern', 'scripts', 'multi_ai_sync_lib');
const SYSTEM_PYTHON3 = '/usr/bin/python3';
const CODEX_AGENTS_DIR = path.join(ROOT, 'codex', 'agents');

function haveSystemPython3() {
  return fs.existsSync(SYSTEM_PYTHON3);
}

test('multi_ai_sync self-test passes under the isolation harness interpreter (no tomllib/tomli)', () => {
  assert.ok(
    haveSystemPython3(),
    'required isolation harness interpreter is missing: ' + SYSTEM_PYTHON3,
  );

  const fallbackScript = [
    'import builtins',
    'import os',
    'import sys',
    'import tempfile',
    'blocked = []',
    'original_import = builtins.__import__',
    'def deny_toml_import(name, *args, **kwargs):',
    '    if name in ("tomllib", "tomli"):',
    '        blocked.append(name)',
    '        raise ImportError("forced missing parser " + name)',
    '    return original_import(name, *args, **kwargs)',
    'builtins.__import__ = deny_toml_import',
    'sys.path.insert(0, os.environ["DHPK_TEST_SCRIPT_ROOT"])',
    'try:',
    '    from multi_ai_sync_lib.agent_sync import _load_toml',
    'finally:',
    '    builtins.__import__ = original_import',
    'if blocked != ["tomllib", "tomli"]:',
    '    raise AssertionError("expected both parser imports to fail, saw " + repr(blocked))',
    'with tempfile.TemporaryDirectory() as temp_dir:',
    '    fixture_path = os.path.join(temp_dir, "fixture.toml")',
    '    with open(fixture_path, "wb") as fixture:',
    '        fixture.write(os.environ["DHPK_TOML_FIXTURE"].encode("utf-8"))',
    '    actual = _load_toml(fixture_path)',
    'expected = {"title": "Fallback oracle", "agent": {"name": "sentinel", "metadata": {"enabled": True, "tags": ["audit", "review"]}}}',
    'if actual != expected:',
    '    raise AssertionError("nested table/array mismatch: " + repr(actual))',
    'print("forced fallback nested-table and array oracle passed")',
  ].join('\n');
  const fallback = spawnSync(SYSTEM_PYTHON3, ['-B', '-c', fallbackScript], {
    encoding: 'utf8',
    timeout: 20000,
    env: {
      ...process.env,
      DHPK_TEST_SCRIPT_ROOT: path.dirname(LIB_DIR),
      DHPK_TOML_FIXTURE: [
        'title = "Fallback oracle"',
        '[agent]',
        'name = "sentinel"',
        '[agent.metadata]',
        'enabled = true',
        'tags = ["audit", "review"]',
      ].join('\n'),
    },
  });
  assert.strictEqual(fallback.status, 0, fallback.stderr || fallback.stdout);
  assert.strictEqual(fallback.stdout.trim(), 'forced fallback nested-table and array oracle passed');

  const selfTest = spawnSync(SYSTEM_PYTHON3, ['-B', SCRIPT, 'self-test', '--format', 'json'], {
    encoding: 'utf8',
    timeout: 20000,
  });
  assert.strictEqual(selfTest.status, 0, selfTest.stderr || selfTest.stdout);
  const report = JSON.parse(selfTest.stdout);
  assert.strictEqual(report.total, 4, selfTest.stdout);
  assert.strictEqual(report.failed, 0, selfTest.stdout);
  assert.strictEqual(report.passed, 4, selfTest.stdout);
});

test('vendored tomli fallback parses real Codex agent TOML files identically to stdlib tomllib', () => {
  assert.ok(fs.existsSync(CODEX_AGENTS_DIR), `tracked Codex agent TOML directory is missing: ${CODEX_AGENTS_DIR}`);
  const tomlFiles = fs
    .readdirSync(CODEX_AGENTS_DIR)
    .filter((name) => name.endsWith('.toml'))
    .slice(0, 5);
  assert.ok(tomlFiles.length > 0, 'expected at least one codex/agents/*.toml fixture');

  const script = `
import json, sys
sys.path.insert(0, ${JSON.stringify(LIB_DIR)})
import tomllib
from vendor.tomli import loads as vendor_loads
paths = json.loads(sys.argv[1])
mismatches = []
for p in paths:
    with open(p, 'rb') as fh:
        text = fh.read().decode('utf-8')
    stdlib_result = tomllib.loads(text)
    vendor_result = vendor_loads(text)
    if stdlib_result != vendor_result:
        mismatches.append(p)
print(json.dumps(mismatches))
`;
  const absolutePaths = tomlFiles.map((name) => path.join(CODEX_AGENTS_DIR, name));
  const res = spawnSync('python3', ['-c', script, JSON.stringify(absolutePaths)], {
    encoding: 'utf8',
    timeout: 20000,
  });
  assert.strictEqual(res.status, 0, res.stderr || res.stdout);
  const mismatches = JSON.parse(res.stdout.trim());
  assert.deepStrictEqual(mismatches, [], `vendored tomli disagreed with tomllib on: ${mismatches.join(', ')}`);
});
}
// End merged tests from tests/harness-govern-toml-fallback.test.js.

run('multi-ai-sync-skill-contract');
