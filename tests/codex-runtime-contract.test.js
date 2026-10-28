'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const CODEX_STUB_BIN = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-codex-runtime-stub-')));
fs.writeFileSync(path.join(CODEX_STUB_BIN, 'codex'), `#!/bin/sh
if [ "$1" = "plugin" ] && [ "$2" = "list" ] && [ "$3" = "--json" ]; then
  printf '%s\n' '{"installed":[],"available":[]}'
  exit 0
fi
exit 2
`, { mode: 0o755 });
process.on('exit', () => fs.rmSync(CODEX_STUB_BIN, { recursive: true, force: true }));
const GENERATOR = path.join(ROOT, 'scripts', 'gen-codex-agents.js');
const {
  collectCodexRuntimeErrors,
  collectCodexProjectionReferenceErrors,
  collectCodexCoverageErrors,
  collectCodexCanonicalRoleDefaultErrors,
} = require(path.join(ROOT, 'scripts', 'ci', '_lib', 'codex-runtime'));
const { RUNTIME_METADATA } = require(path.join(ROOT, 'scripts', 'gen-codex-agents'));

const EXPECTED_RUNTIME = {
  architect: ['gpt-6.1-sol', 'high'],
  'code-reviewer': ['gpt-6.1-sol', 'medium'],
  'security-reviewer': ['gpt-6.1-sol', 'high'],
  'database-reviewer': ['gpt-6.1-sol', 'high'],
  'tdd-guide': ['gpt-6-luna', 'high'],
  'deep-reasoner': ['gpt-6.1-sol', 'high'],
  'doc-reviewer': ['gpt-6-luna', 'high'],
  planner: ['gpt-6.1-sol', 'high'],
  'frontend-reviewer': ['gpt-6.1-sol', 'medium'],
  'migration-reviewer': ['gpt-6.1-sol', 'high'],
  'e2e-runner': ['gpt-6.1-sol', 'medium'],
  'ui-verifier': ['gpt-6.1-terra', 'medium'],
  'docs-writer': ['gpt-6.1-terra', 'medium'],
  'scoped-worker': ['gpt-6.1-terra', 'medium'],
};

const EXPECTED_DIRECT_RUNTIME = {
  ...EXPECTED_RUNTIME,
  explorer: ['gpt-6-luna', 'high'],
  worker: ['gpt-6.1-sol', 'medium'],
  monitor: ['gpt-6-luna', 'low'],
  'bug-investigator': ['gpt-6.1-sol', 'medium'],
};

const UNAVAILABLE_HANDOFFS = /`(?:silent-failure-hunter|type-design-analyzer|ui-ux-verifier|fast-worker)`/;
const CODEX_BRIDGE_SURFACES = [
  'agents/INDEX.md',
  'agent-traps/_common/cli-prompt-composition.md',
  'rules/execution-policy.md',
  'cursor/rules/execution-policy.mdc',
  'plugins/dhpk-agy/rules/execution-policy.md',
  'plugins/dhpk-cursor/rules/execution-policy.mdc',
];

function tmpRoot(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `dhpk-${prefix}-`));
}

function readTomlField(file, field) {
  const source = fs.readFileSync(file, 'utf8');
  const match = source.match(new RegExp(`^${field}\\s*=\\s*"([^"]*)"$`, 'm'));
  return match ? match[1] : null;
}

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function appendDeveloperInstructions(file, text) {
  const source = fs.readFileSync(file, 'utf8');
  const closing = source.lastIndexOf('"""');
  assert.ok(closing > 0, `${file}: developer_instructions closing delimiter missing`);
  fs.writeFileSync(file, `${source.slice(0, closing)}\n${text.trim()}\n${source.slice(closing)}`);
}

function installConsumerProjection(root) {
  fs.mkdirSync(path.join(root, '.git'));
  const installed = spawnSync('bash', [path.join(ROOT, 'scripts', 'hooks', 'install-codex-skills.sh'), '--copy', '--force'], {
    cwd: root,
    env: consumerInstallEnv(),
    encoding: 'utf8',
  });
  assert.strictEqual(installed.status, 0, `${installed.stdout}\n${installed.stderr}`);
}

function consumerInstallEnv() {
  return {
    ...process.env,
    PATH: `${CODEX_STUB_BIN}:${process.env.PATH || ''}`,
    CLAUDE_PLUGIN_ROOT: ROOT,
  };
}

function assertNeighborError(errors, { source, token, state }) {
  const diagnostic = errors.find((error) => error.includes(token));
  assert.ok(diagnostic, `missing ${token} diagnostic:\n${errors.join('\n')}`);
  assert.match(diagnostic, new RegExp(source));
  assert.match(diagnostic, new RegExp(`\\b${state}\\b`, 'i'));
  assert.match(diagnostic, /direct Codex role|explicit manual fallback/i);
}

function cloneProjectionFixture(prefix) {
  const root = tmpRoot(prefix);
  for (const entry of ['agents', 'agent-traps', 'codex', 'manifests', 'modules']) {
    fs.cpSync(path.join(ROOT, entry), path.join(root, entry), { recursive: true });
  }
  fs.mkdirSync(path.join(root, 'scripts', 'lib'), { recursive: true });
  fs.copyFileSync(
    path.join(ROOT, 'scripts', 'gen-codex-agents.js'),
    path.join(root, 'scripts', 'gen-codex-agents.js'),
  );
  fs.copyFileSync(
    path.join(ROOT, 'scripts', 'lib', 'codex-role-neighbors.js'),
    path.join(root, 'scripts', 'lib', 'codex-role-neighbors.js'),
  );
  return root;
}

test('the Codex handoff contract keeps parent permissions, inline completion, and file precedence', () => {
  const contract = fs.readFileSync(path.join(ROOT, 'codex', 'supporting', 'contracts', 'artifact-contract.md'), 'utf8');
  assert.match(contract, /file value takes precedence/);
  assert.match(contract, /explicit spawn value, then the \[agents\] default, then the parent/);
  assert.match(contract, /does not create an independent sandbox/);
  assert.match(contract, /do not dispatch the role again only because the report file is missing/);
  assert.match(contract, /NOT_RUN/);
  assert.doesNotMatch(contract, /must dispatch again/);
  const guidance = fs.readFileSync(path.join(ROOT, 'codex', 'guidance.md'), 'utf8');
  assert.match(guidance, /completed implementation wave/);
  assert.doesNotMatch(guidance, /after ANY code edit/);
  assert.doesNotMatch(guidance, /after an edit is recommended/);
  assert.doesNotMatch(guidance, /remains the primary built-in execution boundary/);
  const explorer = fs.readFileSync(path.join(ROOT, 'codex', 'agents', 'explorer.toml'), 'utf8');
  assert.strictEqual(readTomlField(path.join(ROOT, 'codex', 'agents', 'explorer.toml'), 'sandbox_mode'), null);
  assert.match(explorer, /Hand implementation to `worker`/);
  assert.doesNotMatch(explorer, /unless explicitly asked/);
  for (const role of ['monitor', 'bug-investigator']) {
    const body = fs.readFileSync(path.join(ROOT, 'codex', 'agents', `${role}.toml`), 'utf8');
    assert.match(body, /Return scope, source identity, verdict, findings, and evidence gaps inline/);
    assert.match(body, /Do not write an artifact/);
  }
});

test('the Codex projection satisfies runtime metadata and handoff contracts', () => {
  const errors = collectCodexRuntimeErrors(ROOT);
  assert.deepStrictEqual(errors, [], errors.join('\n'));
});

test('minimal projection validation does not import role names from the module checkout', () => {
  const root = tmpRoot('codex-minimal-agent-names');
  try {
    const agents = path.join(root, 'codex', 'agents');
    fs.mkdirSync(agents, { recursive: true });
    fs.writeFileSync(path.join(agents, 'worker.toml'), [
      'name = "worker"',
      'description = "Minimal fixture worker"',
      'model = "gpt-6.1-sol"',
      'model_reasoning_effort = "medium"',
      'developer_instructions = """',
      'A display reference to `ui-verifier` appears here.',
      '"""',
      '',
    ].join('\n'));

    const errors = collectCodexRuntimeErrors(root);
    assert.ok(
      !errors.some((error) => /references non-dispatchable Codex agent 'ui-verifier'/i.test(error)),
      errors.join('\n'),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the canonical agent coverage matrix classifies every role exactly once', () => {
  const errors = collectCodexCoverageErrors(ROOT);
  assert.deepStrictEqual(errors, [], errors.join('\n'));
});

test('all committed direct roles match the approved runtime map and global defaults', () => {
  const ownership = JSON.parse(fs.readFileSync(path.join(ROOT, 'codex', 'agent-projection-manifest.json'), 'utf8'));
  assert.strictEqual(ownership.generated_roles.length, 14);
  assert.strictEqual(ownership.package_roles.length, 18);
  for (const role of ['ui-verifier', 'docs-writer', 'scoped-worker']) {
    assert.ok(ownership.generated_roles.includes(role), role);
    assert.ok(ownership.package_roles.includes(role), role);
  }

  for (const [role, [model, effort]] of Object.entries(EXPECTED_DIRECT_RUNTIME)) {
    const file = path.join(ROOT, 'codex', 'agents', `${role}.toml`);
    assert.strictEqual(readTomlField(file, 'model'), model, role);
    assert.strictEqual(readTomlField(file, 'model_reasoning_effort'), effort, role);
    assert.strictEqual(readTomlField(file, 'sandbox_mode'), null, role);
    assert.match(model, /^gpt-6(?:\.1-(?:sol|terra)|-(?:sol|luna))$/, role);
  }
  const config = fs.readFileSync(path.join(ROOT, 'codex', 'config.toml.example'), 'utf8');
  assert.match(config, /default_subagent_model\s*=\s*"gpt-6\.1-sol"/);
  assert.match(config, /default_subagent_reasoning_effort\s*=\s*"medium"/);
  for (const role of ['ui-verifier', 'docs-writer', 'scoped-worker']) {
    assert.match(config, new RegExp(`\\[agents\\."${role}"\\][\\s\\S]*?config_file = "agents/${role}\\.toml"`), role);
  }
});

test('every active Codex bridge surface selects only the GPT-6 family', () => {
  for (const relative of CODEX_BRIDGE_SURFACES) {
    const surfacePath = path.join(ROOT, relative);
    let source = fs.readFileSync(surfacePath, 'utf8');
    const selectedPolicy = source.match(/\[full execution policy\]\(([^)]+)\)/);
    if (selectedPolicy) {
      assert.ok(!path.isAbsolute(selectedPolicy[1]), `${relative}: selected policy link must be relative`);
      const selectedPath = path.resolve(path.dirname(surfacePath), selectedPolicy[1]);
      const fromRoot = path.relative(ROOT, selectedPath);
      assert.ok(
        fromRoot !== '..' && fromRoot !== '' && !fromRoot.startsWith(`..${path.sep}`) && !path.isAbsolute(fromRoot),
        `${relative}: selected policy escapes the checkout`,
      );
      assert.ok(fs.statSync(selectedPath).isFile(), `${relative}: selected full policy resource is missing`);
      source = fs.readFileSync(selectedPath, 'utf8');
    }
    const identifiers = [...source.matchAll(/\bgpt-\d+(?:\.\d+)*(?!\.x)(?:-[a-z0-9-]+)?/gi)]
      .map((match) => match[0]);
    assert.ok(identifiers.length > 0, `${relative}: missing explicit Codex model`);
    for (const identifier of identifiers) {
      assert.match(identifier, /^gpt-6(?:\.1-sol|-(?:sol|luna))?$/i, relative);
    }
  }
});

test('the generator emits the effective Codex model metadata and compatible handoffs', () => {
  const root = tmpRoot('codex-generator-contract');
  try {
    const output = path.join(root, 'agents');
    const result = spawnSync('node', [GENERATOR, output], { encoding: 'utf8', timeout: 15000 });
    assert.strictEqual(result.status, 0, result.stderr);

    for (const [role, [model, effort]] of Object.entries(EXPECTED_RUNTIME)) {
      const file = path.join(output, `${role}.toml`);
      assert.strictEqual(readTomlField(file, 'model'), model, role);
      assert.strictEqual(readTomlField(file, 'model_reasoning_effort'), effort, role);
      const source = fs.readFileSync(file, 'utf8');
      assert.doesNotMatch(source, UNAVAILABLE_HANDOFFS, role);
    }

    const e2eRunner = fs.readFileSync(path.join(output, 'e2e-runner.toml'), 'utf8');
    assert.strictEqual(readTomlField(path.join(output, 'e2e-runner.toml'), 'sandbox_mode'), null);
    assert.match(e2eRunner, /Assigned test traces and runner output may be written separately/);
    assert.match(e2eRunner, /Verdict: BLOCKED/);
    assert.match(e2eRunner, /playwright-cli/);
    assert.doesNotMatch(e2eRunner, /ui-ux-verifier/);
    assert.doesNotMatch(fs.readFileSync(path.join(output, 'frontend-reviewer.toml'), 'utf8'), /modules\/js\//);
    assert.doesNotMatch(fs.readFileSync(path.join(output, 'migration-reviewer.toml'), 'utf8'), /modules\/(?:yii|laravel)/);
    assert.doesNotMatch(fs.readFileSync(path.join(output, 'planner.toml'), 'utf8'), /`\/dhpk:do(?:\s|`)/);
    assert.doesNotMatch(readTomlField(path.join(output, 'doc-reviewer.toml'), 'description'), /\bHaiku\b/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the Codex runtime validator catches stale labels, unavailable handoffs, and legacy config keys', () => {
  const root = tmpRoot('codex-runtime-contract-red');
  try {
    write(path.join(root, 'agents', 'code-reviewer.md'), '---\nname: code-reviewer\n---\n');
    write(path.join(root, 'agents', 'silent-failure-hunter.md'), '---\nname: silent-failure-hunter\n---\n');
    write(path.join(root, 'agents', 'type-design-analyzer.md'), '---\nname: type-design-analyzer\n---\n');
    write(path.join(root, 'agents', 'ui-ux-verifier.md'), '---\nname: ui-ux-verifier\n---\n');
    write(path.join(root, 'codex', 'agents', 'legacy.md'), 'legacy Codex agent body\n');
    write(
      path.join(root, 'codex', 'agents', 'code-reviewer.toml'),
      [
        'name = "code-reviewer"',
        'description = "Review role (Haiku)"',
        'model = "gpt-6.1-sol"',
        'model_reasoning_effort = "medium"',
        'developer_instructions = "Use `silent-failure-hunter`, `type-design-analyzer`, `ui-ux-verifier`, and `dhpk:legacy-agent`; do not consult claude-mem."',
        '',
      ].join('\n'),
    );
    write(path.join(root, 'codex', 'config.toml.example'), '[agents]\nmax_threads = 6\nmax_depth = 2\n');

    const errors = [
      ...collectCodexRuntimeErrors(root),
      ...collectCodexCoverageErrors(root),
    ];
    assert.ok(errors.some((error) => error.includes('Haiku')), errors.join('\n'));
    assert.ok(errors.some((error) => error.includes('silent-failure-hunter')), errors.join('\n'));
    assert.ok(errors.some((error) => error.includes('type-design-analyzer')), errors.join('\n'));
    assert.ok(errors.some((error) => error.includes('ui-ux-verifier')), errors.join('\n'));
    assert.ok(errors.some((error) => error.includes('Claude namespace')), errors.join('\n'));
    assert.ok(errors.some((error) => error.includes('claude-mem')), errors.join('\n'));
    assert.ok(errors.some((error) => error.includes('must use the .toml format')), errors.join('\n'));
    assert.ok(errors.some((error) => error.includes('max_concurrent_threads_per_session')), errors.join('\n'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('clean consumer projection resolves every generated role reference', () => {
  const root = tmpRoot('codex-reference-consumer');
  try {
    fs.mkdirSync(path.join(root, '.git'));
    const installed = spawnSync('bash', [path.join(ROOT, 'scripts', 'hooks', 'install-codex-skills.sh'), '--copy', '--force'], {
      cwd: root,
      env: consumerInstallEnv(),
      encoding: 'utf8',
    });
    assert.strictEqual(installed.status, 0, `${installed.stdout}\n${installed.stderr}`);
    for (const role of ['ui-verifier', 'docs-writer', 'scoped-worker']) {
      assert.ok(fs.statSync(path.join(root, '.codex', 'agents', `${role}.toml`)).isFile(), `${role} must materialize as a physical role`);
    }
    assert.strictEqual(fs.existsSync(path.join(root, '.codex', 'agent-sources')), false, 'authoring sources must not be installed');
    const errors = collectCodexProjectionReferenceErrors(root, ROOT);
    assert.deepStrictEqual(errors, [], errors.join('\n'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('clean consumer projection reports a missing supporting asset', () => {
  const root = tmpRoot('codex-reference-consumer-red');
  try {
    fs.mkdirSync(path.join(root, '.git'));
    const installed = spawnSync('bash', [path.join(ROOT, 'scripts', 'hooks', 'install-codex-skills.sh'), '--copy', '--force'], {
      cwd: root,
      env: consumerInstallEnv(),
      encoding: 'utf8',
    });
    assert.strictEqual(installed.status, 0, `${installed.stdout}\n${installed.stderr}`);
    fs.rmSync(path.join(root, '.codex', 'dhpk', 'contracts', 'artifact-contract.md'));
    const errors = collectCodexProjectionReferenceErrors(root, ROOT);
    assert.ok(errors.some((error) => error.includes('artifact-contract.md')), errors.join('\n'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('clean consumer projection reports a missing dynamic stack trap sheet', () => {
  const root = tmpRoot('codex-reference-consumer-dynamic-red');
  try {
    fs.mkdirSync(path.join(root, '.git'));
    const installed = spawnSync('bash', [path.join(ROOT, 'scripts', 'hooks', 'install-codex-skills.sh'), '--copy', '--force'], {
      cwd: root,
      env: consumerInstallEnv(),
      encoding: 'utf8',
    });
    assert.strictEqual(installed.status, 0, `${installed.stdout}\n${installed.stderr}`);
    fs.rmSync(path.join(root, '.codex', 'dhpk', 'agent-traps', 'code-reviewer', 'php.md'));
    const errors = collectCodexProjectionReferenceErrors(root, ROOT);
    assert.ok(errors.some((error) => error.includes('code-reviewer/php.md')), errors.join('\n'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('clean consumer projection reports unreachable references inside supporting assets', () => {
  const root = tmpRoot('codex-reference-supporting-red');
  try {
    fs.mkdirSync(path.join(root, '.git'));
    const installed = spawnSync('bash', [path.join(ROOT, 'scripts', 'hooks', 'install-codex-skills.sh'), '--copy', '--force'], {
      cwd: root,
      env: consumerInstallEnv(),
      encoding: 'utf8',
    });
    assert.strictEqual(installed.status, 0, `${installed.stdout}\n${installed.stderr}`);
    const target = path.join(root, '.codex', 'dhpk', 'agent-traps', 'architect', 'yii.md');
    fs.appendFileSync(target, '\nSee `.claude/rules/php/coding-style.md` and `skills/dhpk-php-runtime-router/reference.md`.\n');
    const errors = collectCodexProjectionReferenceErrors(root, ROOT);
    assert.ok(errors.some((error) => error.includes('unreachable Claude project reference')), errors.join('\n'));
    assert.ok(errors.some((error) => error.includes('unresolved source-tree reference')), errors.join('\n'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('consumer projection fails closed when sourceRoot role contracts are missing or malformed', () => {
  const cases = [
    {
      label: 'missing role map',
      relative: path.join('codex', 'agent-role-map.json'),
      mutate(file) { fs.rmSync(file); },
      expected: /codex\/agent-role-map\.json.*canonical Codex coverage matrix is missing/i,
    },
    {
      label: 'malformed role map JSON',
      relative: path.join('codex', 'agent-role-map.json'),
      mutate(file) { fs.writeFileSync(file, '{'); },
      expected: /codex\/agent-role-map\.json.*coverage matrix is not valid JSON/i,
    },
    {
      label: 'malformed role map shape',
      relative: path.join('codex', 'agent-role-map.json'),
      mutate(file) { fs.writeFileSync(file, '{"roles":[]}\n'); },
      expected: /codex\/agent-role-map\.json.*must contain a roles object/i,
    },
    {
      label: 'missing ownership manifest',
      relative: path.join('codex', 'agent-projection-manifest.json'),
      mutate(file) { fs.rmSync(file); },
      expected: /codex\/agent-projection-manifest\.json.*role ownership manifest is missing/i,
    },
    {
      label: 'malformed ownership manifest JSON',
      relative: path.join('codex', 'agent-projection-manifest.json'),
      mutate(file) { fs.writeFileSync(file, '{'); },
      expected: /codex\/agent-projection-manifest\.json.*role ownership manifest is not valid JSON/i,
    },
  ];

  for (const fixture of cases) {
    const sourceRoot = cloneProjectionFixture(`codex-neighbor-source-root-${fixture.label.replace(/\s+/g, '-')}`);
    const consumer = tmpRoot(`codex-neighbor-source-root-consumer-${fixture.label.replace(/\s+/g, '-')}`);
    try {
      fixture.mutate(path.join(sourceRoot, fixture.relative));
      installConsumerProjection(consumer);
      const errors = collectCodexProjectionReferenceErrors(consumer, sourceRoot);
      assert.ok(errors.some((error) => fixture.expected.test(error)), `${fixture.label}: ${errors.join('\n')}`);
    } finally {
      fs.rmSync(sourceRoot, { recursive: true, force: true });
      fs.rmSync(consumer, { recursive: true, force: true });
    }
  }
});

test('mutation: committed and clean consumer generated roles reject an unknown executable neighbor', () => {
  const committed = cloneProjectionFixture('codex-neighbor-committed-unknown-red');
  const consumer = tmpRoot('codex-neighbor-consumer-unknown-red');
  try {
    const committedFile = path.join(committed, 'codex', 'agents', 'code-reviewer.toml');
    appendDeveloperInstructions(committedFile, 'dispatch `ghost-role` for the unresolved handoff.');
    const committedErrors = collectCodexProjectionReferenceErrors(committed);

    installConsumerProjection(consumer);
    const consumerFile = path.join(consumer, '.codex', 'agents', 'code-reviewer.toml');
    appendDeveloperInstructions(consumerFile, 'dispatch `ghost-role` for the unresolved handoff.');
    const consumerErrors = collectCodexProjectionReferenceErrors(consumer, ROOT);

    for (const errors of [committedErrors, consumerErrors]) {
      assertNeighborError(errors, {
        source: 'code-reviewer',
        token: 'ghost-role',
        state: 'unknown',
      });
    }
  } finally {
    fs.rmSync(committed, { recursive: true, force: true });
    fs.rmSync(consumer, { recursive: true, force: true });
  }
});

test('mutation: committed and clean consumer generated roles reject known non-direct neighbors without dispatch wording', () => {
  const committed = cloneProjectionFixture('codex-neighbor-committed-known-red');
  const consumer = tmpRoot('codex-neighbor-consumer-known-red');
  try {
    const committedFile = path.join(committed, 'codex', 'agents', 'code-reviewer.toml');
    appendDeveloperInstructions(committedFile, 'Historical notes retain `silent-failure-hunter`.');
    const committedErrors = collectCodexProjectionReferenceErrors(committed);

    installConsumerProjection(consumer);
    const consumerFile = path.join(consumer, '.codex', 'agents', 'code-reviewer.toml');
    appendDeveloperInstructions(consumerFile, 'Historical notes retain `silent-failure-hunter`.');
    const consumerErrors = collectCodexProjectionReferenceErrors(consumer, ROOT);

    for (const errors of [committedErrors, consumerErrors]) {
      assertNeighborError(errors, {
        source: 'code-reviewer',
        token: 'silent-failure-hunter',
        state: 'merged',
      });
    }
  } finally {
    fs.rmSync(committed, { recursive: true, force: true });
    fs.rmSync(consumer, { recursive: true, force: true });
  }
});

test('generic Codex roles skip the neighbor fence while metadata, ownership, and reference checks stay active', () => {
  const root = cloneProjectionFixture('codex-neighbor-generic-exclusion');
  try {
    appendDeveloperInstructions(
      path.join(root, 'codex', 'agents', 'worker.toml'),
      [
        'dispatch `ghost-role` from this generic worker role.',
        'Historical notes retain `silent-failure-hunter`.',
        '${CLAUDE_PLUGIN_ROOT}/rules/tool-routing.md',
      ].join('\n'),
    );
    const explorer = path.join(root, 'codex', 'agents', 'explorer.toml');
    const explorerModel = readTomlField(explorer, 'model');
    assert.ok(explorerModel, 'explorer model should be present before mutation');
    fs.writeFileSync(
      explorer,
      fs.readFileSync(explorer, 'utf8').replace(
        `model = "${explorerModel}"`,
        'model = "not-a-codex-model"',
      ),
    );
    fs.rmSync(path.join(root, 'codex', 'agents', 'monitor.toml'));

    const errors = [
      ...collectCodexRuntimeErrors(root),
      ...collectCodexCoverageErrors(root),
    ];
    assert.ok(!errors.some((error) => /ghost-role/.test(error)), errors.join('\n'));
    assert.ok(
      !errors.some((error) => error.includes('silent-failure-hunter') && /merged|direct Codex role|explicit manual fallback/i.test(error)),
      errors.join('\n'),
    );
    assert.ok(
      errors.some((error) => /references non-dispatchable Codex agent 'silent-failure-hunter'/i.test(error)),
      errors.join('\n'),
    );
    assert.ok(errors.some((error) => /invalid model.*not-a-codex-model/i.test(error)), errors.join('\n'));
    assert.ok(errors.some((error) => /package-owned role 'monitor'.*missing/i.test(error)), errors.join('\n'));
    assert.ok(errors.some((error) => /CLAUDE_PLUGIN_ROOT|unsupported.*interpolation/i.test(error)), errors.join('\n'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('mutation: role metadata, filename, and sandbox drift fail closed', () => {
  const root = cloneProjectionFixture('codex-role-metadata-mutation');
  try {
    const file = path.join(root, 'codex', 'agents', 'explorer.toml');
    const explorerModel = readTomlField(file, 'model');
    const explorerEffort = readTomlField(file, 'model_reasoning_effort');
    assert.ok(explorerModel, 'explorer model should be present before mutation');
    assert.ok(explorerEffort, 'explorer effort should be present before mutation');
    let source = fs.readFileSync(file, 'utf8')
      .replace('name = "explorer"', 'name = "not-explorer"')
      .replace(`model = "${explorerModel}"`, 'model = "not-a-codex-model"')
      .replace(`model_reasoning_effort = "${explorerEffort}"`, 'model_reasoning_effort = "not-an-effort"');
    fs.writeFileSync(file, `${source}\nsandbox_mode = "read-only"\n`);
    const errors = [
      ...collectCodexRuntimeErrors(root),
      ...collectCodexCoverageErrors(root),
    ];
    assert.ok(errors.some((error) => /filename.*name|name.*filename|does not match/i.test(error)), errors.join('\n'));
    assert.ok(errors.some((error) => /invalid.*model|unknown model|model.*catalog/i.test(error)), errors.join('\n'));
    assert.ok(errors.some((error) => /invalid.*reasoning_effort|reasoning_effort.*invalid/i.test(error)), errors.join('\n'));
    assert.ok(errors.some((error) => /sandbox_mode does not create an independent sandbox/i.test(error)), errors.join('\n'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('mutation: merged and capability-gated role targets cannot point at ghosts', () => {
  const root = cloneProjectionFixture('codex-role-graph-mutation');
  try {
    const mapPath = path.join(root, 'codex', 'agent-role-map.json');
    const matrix = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
    matrix.roles['fast-worker'].target = 'ghost-role';
    matrix.roles['performance-analyzer'].target = 'capability:ghost-capability';
    fs.writeFileSync(mapPath, `${JSON.stringify(matrix, null, 2)}\n`);
    const errors = collectCodexCoverageErrors(root);
    assert.ok(errors.some((error) => /fast-worker.*ghost-role|ghost-role.*fast-worker/i.test(error)), errors.join('\n'));
    assert.ok(errors.some((error) => /performance-analyzer.*ghost-capability|ghost-capability.*performance-analyzer/i.test(error)), errors.join('\n'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('mutation: supporting assets cannot dispatch an unavailable role or Claude namespace', () => {
  const root = cloneProjectionFixture('codex-supporting-graph-mutation');
  try {
    const file = path.join(root, 'codex', 'supporting', 'agent-traps', 'code-reviewer', 'js.md');
    fs.appendFileSync(file, '\nDispatch `ghost-role` through `dhpk:code-reviewer`.\n');
    const errors = collectCodexProjectionReferenceErrors(root);
    assert.ok(errors.some((error) => /ghost-role.*dispatch|dispatch.*ghost-role/i.test(error)), errors.join('\n'));
    assert.ok(errors.some((error) => /namespace|dhpk:code-reviewer|Claude/i.test(error)), errors.join('\n'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('mutation: generator rejects stale package TOML and preserves declared local extensions', () => {
  const root = tmpRoot('codex-generator-stale-mutation');
  try {
    const output = path.join(root, 'agents');
    let result = spawnSync('node', [GENERATOR, output], { encoding: 'utf8', timeout: 15000 });
    assert.strictEqual(result.status, 0, result.stderr);
    fs.writeFileSync(path.join(output, 'stale-generated.toml'), 'name = "stale-generated"\n');
    result = spawnSync('node', [GENERATOR, output], { encoding: 'utf8', timeout: 15000 });
    assert.notStrictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stderr, /stale.*stale-generated\.toml|stale-generated\.toml.*stale/i);
    assert.ok(fs.existsSync(path.join(output, 'stale-generated.toml')));

    fs.rmSync(path.join(output, 'stale-generated.toml'));
    fs.writeFileSync(path.join(output, 'local-extension.toml'), 'name = "local-extension"\n');
    fs.writeFileSync(path.join(output, '.codex-agent-ownership.json'), JSON.stringify({
      version: 1,
      workspace_local_extensions: ['local-extension'],
    }));
    result = spawnSync('node', [GENERATOR, output], { encoding: 'utf8', timeout: 15000 });
    assert.strictEqual(result.status, 0, result.stderr);
    assert.ok(fs.existsSync(path.join(output, 'local-extension.toml')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('mutation: module-agent removal and default effort drift are reported', () => {
  const root = cloneProjectionFixture('codex-module-default-mutation');
  try {
    fs.rmSync(path.join(root, 'modules', 'library-author', 'agents', 'polyfill-reviewer.md'));
    const config = path.join(root, 'codex', 'config.toml.example');
    fs.writeFileSync(config, fs.readFileSync(config, 'utf8').replace(
      'default_subagent_reasoning_effort = "medium"',
      'default_subagent_reasoning_effort = "max"',
    ));
    const errors = [
      ...collectCodexRuntimeErrors(root),
      ...collectCodexCoverageErrors(root),
    ];
    assert.ok(errors.some((error) => /polyfill-reviewer.*canonical|matrix.*polyfill-reviewer|module.*polyfill-reviewer/i.test(error)), errors.join('\n'));
    assert.ok(errors.some((error) => /default.*effort|default_subagent_reasoning_effort/i.test(error)), errors.join('\n'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Codex host-profile role_defaults match canonical agent runtime metadata', () => {
  assert.deepStrictEqual(collectCodexCanonicalRoleDefaultErrors(ROOT), []);
});

test('a drifted Codex role_defaults value names the canonical role', () => {
  const root = cloneProjectionFixture('codex-role-defaults-drift');
  try {
    const file = path.join(root, 'manifests', 'host-profiles.json');
    const profiles = JSON.parse(fs.readFileSync(file, 'utf8'));
    const codex = profiles.profiles.find((profile) => profile.host === 'codex-cli');
    codex.role_defaults.planner.effort = 'low';
    fs.writeFileSync(file, `${JSON.stringify(profiles, null, 2)}\n`);
    const errors = collectCodexCanonicalRoleDefaultErrors(root);
    assert.ok(errors.some((error) => /planner/.test(error)), errors.join('\n'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a drifted RUNTIME_METADATA value names the canonical role', () => {
  const drifted = {
    ...RUNTIME_METADATA,
    planner: { ...RUNTIME_METADATA.planner, effort: 'low' },
  };
  const errors = collectCodexCanonicalRoleDefaultErrors(ROOT, { runtimeMetadata: drifted });
  assert.ok(errors.some((error) => /planner/.test(error)), errors.join('\n'));
});

test('a drifted worker toml value names the canonical role', () => {
  const root = cloneProjectionFixture('codex-worker-toml-drift');
  try {
    const file = path.join(root, 'codex', 'agents', 'worker.toml');
    const currentEffort = readTomlField(file, 'model_reasoning_effort');
    assert.ok(currentEffort, 'worker effort should be present before mutation');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(
      `model_reasoning_effort = "${currentEffort}"`,
      'model_reasoning_effort = "low"',
    ));
    const errors = collectCodexCanonicalRoleDefaultErrors(root);
    assert.ok(errors.some((error) => /worker/.test(error)), errors.join('\n'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('an explicit exception list documents a canonical role mismatch', () => {
  const drifted = {
    ...RUNTIME_METADATA,
    planner: { ...RUNTIME_METADATA.planner, effort: 'low' },
  };
  const errors = collectCodexCanonicalRoleDefaultErrors(ROOT, {
    runtimeMetadata: drifted,
    exceptions: { planner: { model: RUNTIME_METADATA.planner.model, effort: 'low' } },
  });
  assert.deepStrictEqual(errors, []);
});

run('codex-runtime-contract');
