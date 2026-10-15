'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const { resolveConfig, resolveRole } = require('../skills/flow-drive/scripts/dispatch-runtime/cli-role-resolver');
const { buildContext } = require('../skills/flow-drive/scripts/dispatch-runtime/build-cli-dispatch-context');
const selector = require('../scripts/fast-worker-selector');
const pluginManifest = require('../.claude-plugin/plugin.json');

const ROOT = path.join(__dirname, '..');
const RETIRED_ROLES = Object.freeze([
  { name: 'agy-fast-worker', mode: 'workspace-write', provider: 'agy', successor: 'agy-worker' },
  { name: 'codex-fast-worker', mode: 'workspace-write', provider: 'codex', successor: 'codex-worker' },
  { name: 'codex-deep-reasoner', mode: 'read-only', provider: 'codex', successor: 'codex-reasoner' },
]);

function dispatchInput({ requested_role, mode, execution_provider }) {
  return {
    dispatching_agent: 'claude',
    execution_provider,
    requested_role,
    mode,
    config: {
      codex_worker_model: 'canonical-codex-model',
      codex_worker_timeout_secs: 90,
      codex_reasoner_model: 'canonical-reasoner-model',
      codex_reasoner_effort: 'high',
      codex_reasoner_timeout_secs: 90,
      agy_worker_model: 'canonical-agy-model',
      agy_worker_timeout_secs: 90,
    },
    workdir: '/trusted/workspace',
    prompt_file: '/trusted/workspace/prompt.txt',
    artifact_root: '/trusted/workspace/.dhpk/cli-receipts',
    receipt_path: '/trusted/workspace/.dhpk/cli-receipts/receipt.json',
    context_path: '/trusted/workspace/.dhpk/cli-receipts/context.json',
    assigned_files: ['src/worker.js'],
    report_only: true,
    task_id: 'retired-role-task',
    attempt_id: 'attempt-1',
    runtime_path: '/trusted/bin:/usr/bin',
    prompt_evidence: {
      path: '/trusted/workspace/prompt.txt',
      dev: 1,
      ino: 2,
      sha256: 'a'.repeat(64),
    },
  };
}

function frontmatter(file) {
  const contents = fs.readFileSync(file, 'utf8');
  const match = contents.match(/^---\n([\s\S]*?)\n---/);
  assert.ok(match, `${path.relative(ROOT, file)} must have frontmatter`);
  return match[1];
}

function registeredAgentPaths() {
  return pluginManifest.agents.map((file) => file.replace(/^\.\//, ''));
}

function cloneGeneratorFixture(prefix) {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
  fs.cpSync(path.join(ROOT, 'agents'), path.join(fixtureRoot, 'agents'), { recursive: true });
  fs.mkdirSync(path.join(fixtureRoot, 'codex'), { recursive: true });
  for (const file of ['agent-projection-manifest.json', 'agent-role-map.json']) {
    fs.copyFileSync(path.join(ROOT, 'codex', file), path.join(fixtureRoot, 'codex', file));
  }
  fs.cpSync(path.join(ROOT, 'scripts'), path.join(fixtureRoot, 'scripts'), { recursive: true });
  return fixtureRoot;
}

for (const role of RETIRED_ROLES) {
  test(`${role.name} is BLOCKED with successor and rollback guidance`, () => {
    const result = resolveRole({
      requestedRole: role.name,
      mode: role.mode,
      provider: role.provider,
    });

    assert.strictEqual(result.status, 'BLOCKED', `${role.name} must not resolve as an executable alias`);
    assert.match(result.reason, new RegExp(role.successor));
    assert.match(result.reason, /0\.66\.1/);
  });
}

test('unknown execution roles remain distinguishable from retired names', () => {
  const result = resolveRole({ requestedRole: 'invented-role', mode: 'read-only' });

  assert.strictEqual(result.status, 'BLOCKED');
  assert.match(result.reason, /unknown role/i);
  assert.doesNotMatch(result.reason, /retired|codex-worker|codex-reasoner|agy-worker/);
});

for (const role of RETIRED_ROLES) {
  test(`${role.name} cannot publish dispatch context`, () => {
    const writes = [];
    const result = buildContext(dispatchInput({
      requested_role: role.name,
      mode: role.mode,
      execution_provider: role.provider,
    }), {
      writeFile: (filePath, payload, options) => writes.push({ filePath, payload, options }),
    });

    assert.strictEqual(result.status, 'BLOCKED', `${role.name} must not dispatch`);
    assert.match(result.reason, new RegExp(role.successor));
    assert.match(result.reason, /0\.66\.1/);
    assert.deepStrictEqual(writes, [], `${role.name} must not publish context`);
  });
}

for (const role of RETIRED_ROLES.filter((candidate) => candidate.name !== 'codex-deep-reasoner')) {
  test(`fast-worker selection blocks ${role.name} instead of silently selecting Claude`, () => {
    const result = selector.select({ backend: role.name }, {
      availability: () => ({ available: true, reason: 'available fixture' }),
    });

    assert.strictEqual(result.status, 'blocked', `${role.name} must not become a successful worker selection`);
    assert.strictEqual(result.requested_backend, role.name);
    assert.match(result.reason, new RegExp(role.successor));
    assert.match(result.reason, /0\.66\.1/);
  });
}

test('canonical worker agents preload tdd-workflow', () => {
  const agentPaths = registeredAgentPaths();
  const tddPreloads = agentPaths
    .filter((relativePath) => /skills:\s*\[[^\]]*["']tdd-workflow["']/m.test(
      frontmatter(path.join(ROOT, relativePath)),
    ))
    .map((relativePath) => path.basename(relativePath, '.md'));

  for (const role of ['tdd-guide', 'fast-worker', 'codex-worker', 'agy-worker']) {
    assert.ok(tddPreloads.includes(role), `${role} must preload tdd-workflow`);
  }
});

for (const role of RETIRED_ROLES) {
  test(`${role.name} is absent from active agent registration and TDD preloads`, () => {
    const agentPaths = registeredAgentPaths();
    const tddPreloads = agentPaths
      .filter((relativePath) => /skills:\s*\[[^\]]*["']tdd-workflow["']/m.test(
        frontmatter(path.join(ROOT, relativePath)),
      ))
      .map((relativePath) => path.basename(relativePath, '.md'));

    assert.ok(!agentPaths.includes(`agents/${role.name}.md`), `${role.name} must leave active agent registration`);
    assert.ok(!tddPreloads.includes(role.name), `${role.name} must leave the TDD preload set`);
  });
}

for (const role of RETIRED_ROLES) {
  test(`${role.name} source file is no longer a prompt-composition surface`, () => {
    const file = path.join(ROOT, 'agents', `${role.name}.md`);
    assert.strictEqual(fs.existsSync(file), false, `${path.relative(ROOT, file)} must be retired`);
  });
}

test('canonical prompt-composition surfaces load Shared with the provider section', () => {
  const codexSurfaces = ['agents/codex-worker.md', 'agents/codex-reasoner.md'];
  for (const relativePath of codexSurfaces) {
    const source = fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
    assert.match(source, /cli-prompt-composition\.md/);
    assert.match(source, /Shared\s*\+\s*GPT-5\.x/);
    assert.doesNotMatch(source, /Shared\s*\+\s*Gemini/);
  }

  const agySource = fs.readFileSync(path.join(ROOT, 'agents/agy-worker.md'), 'utf8');
  assert.match(agySource, /cli-prompt-composition\.md/);
  assert.match(agySource, /Shared\s*\+\s*Gemini/);
  assert.doesNotMatch(agySource, /Shared\s*\+\s*GPT-5\.x/);
});

test('retired deep-reasoner model and effort keys are absent from plugin configuration', () => {
  const keys = Object.keys(pluginManifest.userConfig);

  assert.ok(keys.includes('codex_reasoner_model'));
  assert.ok(keys.includes('codex_reasoner_effort'));
  assert.ok(!keys.includes('codex_deep_reasoner_model'));
  assert.ok(!keys.includes('codex_deep_reasoner_effort'));
});

test('retired deep-reasoner config keys cannot silently select dispatch values', () => {
  const resolved = resolveConfig({
    effectiveRole: 'codex-reasoner',
    config: {
      codex_deep_reasoner_model: 'retired-model',
      codex_deep_reasoner_effort: 'low',
    },
  });

  const blocked = resolved.status === 'BLOCKED';
  const retiredValuesIgnored = resolved.model?.source !== 'codex_deep_reasoner_model'
    && resolved.effort?.source !== 'codex_deep_reasoner_effort';
  assert.ok(blocked || retiredValuesIgnored, 'retired config keys must be blocked or ignored');
});

test('Codex role generator rejects retired forwarder references before publishing files', () => {
  const fixtureRoot = cloneGeneratorFixture('codex-forwarder-retirement');
  try {
    const sourceFile = path.join(fixtureRoot, 'agents', 'architect.md');
    fs.appendFileSync(sourceFile, [
      '',
      'Forward implementation through `codex-fast-worker`.',
      'Forward read-only reasoning through `codex-deep-reasoner`.',
      'Forward AGY implementation through `agy-fast-worker`.',
      '',
    ].join('\n'));

    const outDir = path.join(fixtureRoot, 'out');
    const result = spawnSync('node', [
      path.join(fixtureRoot, 'scripts', 'gen-codex-agents.js'),
      outDir,
    ], { cwd: fixtureRoot, encoding: 'utf8', timeout: 15000 });
    const output = `${result.stdout || ''}\n${result.stderr || ''}`;

    assert.notStrictEqual(result.status, 0, output);
    for (const role of RETIRED_ROLES) {
      assert.match(output, new RegExp(role.name));
      assert.match(output, new RegExp(role.successor));
    }
    assert.match(output, /0\.66\.1/);
    assert.strictEqual(fs.existsSync(path.join(outDir, 'architect.toml')), false);
    for (const role of RETIRED_ROLES) {
      assert.strictEqual(fs.existsSync(path.join(outDir, `${role.name}.toml`)), false);
    }
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('retired configuration fails closed before context publication', () => {
  const writes = [];
  const input = dispatchInput({ requested_role: 'codex-reasoner', mode: 'read-only', execution_provider: 'codex' });
  const result = buildContext({ ...input, config: { ...input.config, codex_deep_reasoner_model: 'old-model' } },
    { writeFile: (...args) => writes.push(args) });
  assert.strictEqual(result.status, 'BLOCKED');
  assert.match(result.reason, /codex_reasoner_model/);
  assert.deepStrictEqual(writes, []);
});

test('shared catalog and legacy request interfaces reject retired roles', () => {
  const contract = require('../scripts/lib/dispatch-contract');
  const catalog = require('../manifests/provider-model-catalog.json');
  for (const role of RETIRED_ROLES) {
    assert.throws(() => contract.translateLegacyRequest({ schema: 'dhpk.cli.request.v1', requested_role: role.name }),
      new RegExp(role.successor));
    assert.throws(() => contract.createProviderModelCatalog({ ...catalog,
      role_aliases: { [role.name]: { role: 'worker', authority: 'workspace-write' } } }),
    new RegExp(role.successor));
  }
});

test('AGY package agent selection contains canonical successors without retired forwarders', () => {
  const inventory = require('../manifests/distribution-inventory.json');
  const agents = inventory.agy_plugin.agents;

  for (const role of RETIRED_ROLES) {
    assert.ok(!agents.includes(`${role.name}.md`), `${role.name} must leave AGY package selection`);
    assert.strictEqual(agents.filter((agent) => agent === `${role.successor}.md`).length, 1,
      `${role.successor} must appear exactly once in AGY package selection`);
    assert.ok(fs.existsSync(path.join(ROOT, 'agents', `${role.successor}.md`)),
      `${role.successor} must resolve to a canonical source agent`);
  }
});

run('library-doc-forwarder-retirement');
