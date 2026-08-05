'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const GENERATOR = path.join(ROOT, 'scripts', 'gen-codex-agents.js');
const { collectCodexRuntimeErrors } = require(
  path.join(ROOT, 'scripts', 'ci', '_lib', 'codex-runtime')
);
const { collectCodexProjectionReferenceErrors } = require(
  path.join(ROOT, 'scripts', 'ci', '_lib', 'codex-runtime')
);

const EXPECTED_RUNTIME = {
  architect: ['gpt-5.6-sol', 'high'],
  'code-reviewer': ['gpt-5.6-sol', 'medium'],
  'security-reviewer': ['gpt-5.6-sol', 'medium'],
  'database-reviewer': ['gpt-5.6-sol', 'medium'],
  'tdd-guide': ['gpt-5.6-luna', 'max'],
  'deep-reasoner': ['gpt-5.6-sol', 'high'],
  'doc-reviewer': ['gpt-5.6-luna', 'xhigh'],
};

const UNAVAILABLE_HANDOFFS = /`(?:silent-failure-hunter|type-design-analyzer|e2e-runner|fast-worker)`/;

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

test('the Codex projection satisfies runtime metadata and handoff contracts', () => {
  const errors = collectCodexRuntimeErrors(ROOT);
  assert.deepStrictEqual(errors, [], errors.join('\n'));
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
    write(path.join(root, 'agents', 'e2e-runner.md'), '---\nname: e2e-runner\n---\n');
    write(path.join(root, 'codex', 'agents', 'legacy.md'), 'legacy Codex agent body\n');
    write(
      path.join(root, 'codex', 'agents', 'code-reviewer.toml'),
      [
        'name = "code-reviewer"',
        'description = "Review role (Haiku)"',
        'model = "gpt-5.6-sol"',
        'model_reasoning_effort = "medium"',
        'developer_instructions = "Use `silent-failure-hunter`, `type-design-analyzer`, and `e2e-runner`."',
        '',
      ].join('\n'),
    );
    write(path.join(root, 'codex', 'config.toml.example'), '[agents]\nmax_threads = 6\nmax_depth = 2\n');

    const errors = collectCodexRuntimeErrors(root);
    assert.ok(errors.some((error) => error.includes('Haiku')), errors.join('\n'));
    assert.ok(errors.some((error) => error.includes('silent-failure-hunter')), errors.join('\n'));
    assert.ok(errors.some((error) => error.includes('type-design-analyzer')), errors.join('\n'));
    assert.ok(errors.some((error) => error.includes('e2e-runner')), errors.join('\n'));
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
      env: { ...process.env, CLAUDE_PLUGIN_ROOT: ROOT },
      encoding: 'utf8',
    });
    assert.strictEqual(installed.status, 0, `${installed.stdout}\n${installed.stderr}`);
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
      env: { ...process.env, CLAUDE_PLUGIN_ROOT: ROOT },
      encoding: 'utf8',
    });
    assert.strictEqual(installed.status, 0, `${installed.stdout}\n${installed.stderr}`);
    fs.rmSync(path.join(root, '.codex', 'dhpk', 'contracts', 'reviewer-contract.md'));
    const errors = collectCodexProjectionReferenceErrors(root, ROOT);
    assert.ok(errors.some((error) => error.includes('reviewer-contract.md')), errors.join('\n'));
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
      env: { ...process.env, CLAUDE_PLUGIN_ROOT: ROOT },
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
      env: { ...process.env, CLAUDE_PLUGIN_ROOT: ROOT },
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

run('codex-runtime-contract');
