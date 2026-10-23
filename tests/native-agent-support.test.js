'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const { validateCursorPackage } = require('../scripts/lib/cursor-plugin-package');
const { materializeAgyPluginPackage, validateAgyPluginPackage } = require('../scripts/lib/agy-plugin-package');
const { rewriteCursorHarnessBody, rewriteCursorNativeAgentBody } = require('../scripts/lib/cursor-harness-adapt');
const { rewriteAgyNativeAgentBody, cursorNativeAgentClosureErrors, agyNativeAgentClosureErrors } = require('../scripts/lib/native-agent-support');

const CLAUDE_ROOT = '${' + 'CLAUDE_PLUGIN_ROOT}';
const CURSOR_ROOT = '${' + 'CURSOR_PLUGIN_ROOT}';
const ROOT = path.join(__dirname, '..');

test('project-sync Cursor rewrite still targets the consumer .cursor tree', () => {
  const rewritten = rewriteCursorHarnessBody(`Load ${CLAUDE_ROOT}/agent-traps/_common/prompt-defense.md`);
  assert.match(rewritten, /\.cursor\/dhpk\/agent-traps\/_common\/prompt-defense\.md/);
  assert.ok(!rewritten.includes(CURSOR_ROOT));
});

test('Cursor native agents locate support files in the package and adapters in the co-installed Agent Plugin', () => {
  const rewritten = rewriteCursorNativeAgentBody([
    `Load ${CLAUDE_ROOT}/agent-traps/_common/prompt-defense.md`,
    `Policy ${CLAUDE_ROOT}/rules/execution-policy.md`,
    `Routing ${CLAUDE_ROOT}/rules/tool-routing.md`,
    `bash "${CLAUDE_ROOT}/scripts/cli-dispatch/adapters/run-codex.sh"`,
  ].join('\n'));
  assert.match(rewritten, /\$\{CURSOR_PLUGIN_ROOT\}\/agent-traps\/_common\/prompt-defense\.md/);
  assert.match(rewritten, /\$\{CURSOR_PLUGIN_ROOT\}\/rules\/execution-policy\.mdc/);
  assert.match(rewritten, /\$\{CURSOR_PLUGIN_ROOT\}\/rules\/tool-routing\.mdc/);
  assert.match(rewritten, /\$\{CURSOR_PLUGIN_ROOT\}\/\.\.\/dhpk-agent\/scripts\/cli-dispatch\/adapters\/run-codex\.sh/);
  assert.ok(!rewritten.includes('.cursor/dhpk/agent-traps'));
  assert.ok(!rewritten.includes(`${CURSOR_ROOT}/skills/flow-drive/`));
  assert.ok(!rewritten.includes(CLAUDE_ROOT));
});

test('AGY native agents use plugin-relative support paths', () => {
  const rewritten = rewriteAgyNativeAgentBody([
    `Load ${CLAUDE_ROOT}/agent-traps/_common/prompt-defense.md`,
    `Policy ${CLAUDE_ROOT}/rules/execution-policy.md`,
    `bash "${CLAUDE_ROOT}/scripts/cli-dispatch/adapters/run-codex.sh"`,
    `Selector ${CLAUDE_ROOT}/scripts/fast-worker-selector.js`,
  ].join('\n'));
  assert.match(rewritten, /agent-traps\/_common\/prompt-defense\.md/);
  assert.match(rewritten, /rules\/execution-policy\.md/);
  assert.match(rewritten, /scripts\/cli-dispatch\/adapters\/run-codex\.sh/);
  assert.match(rewritten, /scripts\/fast-worker-selector\.js/);
  assert.ok(!rewritten.includes(CLAUDE_ROOT));
});

function writeCursorPackage(root, { planner, worker, withFiles }) {
  fs.mkdirSync(path.join(root, '.cursor-plugin'), { recursive: true });
  fs.mkdirSync(path.join(root, 'agents'), { recursive: true });
  fs.mkdirSync(path.join(root, 'rules'), { recursive: true });
  fs.writeFileSync(path.join(root, '.cursor-plugin', 'plugin.json'), JSON.stringify({
    name: 'dhpk-cursor',
    version: '1.0.0',
    description: 'fixture',
    agents: './agents/',
    rules: './rules/',
    variables: { type: 'object', properties: {} },
  }));
  fs.writeFileSync(path.join(root, '.cursor-plugin', 'marketplace.json'), JSON.stringify({
    name: 'test',
    owner: { name: 'test' },
    plugins: [{ name: 'dhpk-cursor', source: '.' }],
  }));
  fs.writeFileSync(path.join(root, 'rules', 'execution-policy.mdc'), '---\nname: execution-policy\ndescription: policy\nalwaysApply: false\n---\n# policy\n');
  fs.writeFileSync(path.join(root, 'rules', 'tool-routing.mdc'), '---\nname: tool-routing\ndescription: routing\nalwaysApply: false\n---\n# routing\n');
  fs.writeFileSync(path.join(root, 'agents', 'planner.md'), planner);
  fs.writeFileSync(path.join(root, 'agents', 'code-reviewer.md'), planner.replace(/name: planner/g, 'name: code-reviewer'));
  fs.writeFileSync(path.join(root, 'agents', 'e2e-runner.md'), planner.replace(/name: planner/g, 'name: e2e-runner'));
  fs.writeFileSync(path.join(root, 'agents', 'codex-worker.md'), worker);
  fs.writeFileSync(path.join(root, 'agents', 'agy-worker.md'), worker.replace('run-codex.sh', 'run-agy.sh').replace(/name: codex-worker/g, 'name: agy-worker'));
  if (withFiles) {
    for (const relative of [
      'agent-traps/_common/prompt-defense.md',
      'agent-traps/_common/trap-sheet-loader.md',
      'agent-traps/_common/cli-prompt-composition.md',
      'agent-traps/_common/build-resolver-skeleton.md',
      'agent-traps/e2e-runner/playwright.md',
    ]) {
      fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
      fs.writeFileSync(path.join(root, relative), '# support\n');
    }
  }
}

test('Cursor validator rejects project-sync locators and missing support files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-native-cursor-bad-'));
  try {
    writeCursorPackage(root, {
      planner: [
        '---',
        'name: planner',
        'description: plan',
        '---',
        'Load .cursor/dhpk/agent-traps/_common/prompt-defense.md',
        'Policy .cursor/dhpk/policies/execution-policy.md',
        `Sheet .cursor/dhpk/agent-traps/_common/trap-sheet-loader.md`,
        'Route .cursor/rules/tool-routing.mdc',
        'Load .cursor/dhpk/agent-traps/e2e-runner/playwright.md',
      ].join('\n'),
      worker: [
        '---',
        'name: codex-worker',
        'description: worker',
        '---',
        `bash "${CURSOR_ROOT}/scripts/cli-dispatch/adapters/run-codex.sh"`,
      ].join('\n'),
      withFiles: false,
    });
    const result = validateCursorPackage({ packageRoot: root, expectedManifestName: 'dhpk-cursor' });
    assert.strictEqual(result.ok, false);
    const joined = result.errors.join('\n');
    assert.match(joined, /native agent support locator is not package-local: agents\/planner\.md/);
    assert.match(joined, /native agent support file is missing: agent-traps\/_common\/prompt-defense\.md/);
    assert.match(joined, /native agent support locator is not package-local: agents\/codex-worker\.md/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Cursor validator accepts package-local support and a portable-owner adapter', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-native-cursor-good-'));
  try {
    const planner = [
      '---',
      'name: planner',
      'description: plan',
      '---',
      `Load ${CURSOR_ROOT}/agent-traps/_common/prompt-defense.md`,
      `Policy ${CURSOR_ROOT}/rules/execution-policy.mdc`,
      `Sheet ${CURSOR_ROOT}/agent-traps/_common/trap-sheet-loader.md`,
      `Route ${CURSOR_ROOT}/rules/tool-routing.mdc`,
      `Load ${CURSOR_ROOT}/agent-traps/e2e-runner/playwright.md`,
      `Compose ${CURSOR_ROOT}/agent-traps/_common/cli-prompt-composition.md`,
      `Skeleton ${CURSOR_ROOT}/agent-traps/_common/build-resolver-skeleton.md`,
    ].join('\n');
    const worker = [
      '---',
      'name: codex-worker',
      'description: worker',
      '---',
      `Load ${CURSOR_ROOT}/agent-traps/_common/prompt-defense.md`,
      `Compose ${CURSOR_ROOT}/agent-traps/_common/cli-prompt-composition.md`,
      `Skeleton ${CURSOR_ROOT}/agent-traps/_common/build-resolver-skeleton.md`,
      `bash "${CURSOR_ROOT}/../dhpk-agent/scripts/cli-dispatch/adapters/run-codex.sh"`,
    ].join('\n');
    writeCursorPackage(root, { planner, worker, withFiles: true });
    assert.deepStrictEqual(cursorNativeAgentClosureErrors(root), []);
    const result = validateCursorPackage({ packageRoot: root, expectedManifestName: 'dhpk-cursor' });
    assert.strictEqual(result.ok, true, result.errors.join('\n'));
    fs.rmSync(path.join(root, 'agent-traps', '_common', 'prompt-defense.md'));
    const removed = validateCursorPackage({ packageRoot: root, expectedManifestName: 'dhpk-cursor' });
    assert.ok(removed.errors.some((error) => error.includes('native agent support file is missing: agent-traps/_common/prompt-defense.md')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('AGY validator accepts plugin-relative traps and rejects a Claude-only root', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-native-agy-'));
  try {
    fs.mkdirSync(path.join(root, 'agents'), { recursive: true });
    fs.mkdirSync(path.join(root, 'rules'), { recursive: true });
    fs.mkdirSync(path.join(root, 'agent-traps', '_common'), { recursive: true });
    fs.mkdirSync(path.join(root, 'agent-traps', 'e2e-runner'), { recursive: true });
    fs.writeFileSync(path.join(root, 'rules', 'execution-policy.md'), '# policy\n');
    fs.writeFileSync(path.join(root, 'rules', 'tool-routing.md'), '# routing\n');
    const supportFiles = [
      'scripts/cli-dispatch/adapters/run-agy.sh',
      'scripts/cli-dispatch/adapters/run-codex.sh',
      'scripts/cli-dispatch/dispatch-runtime/build-cli-dispatch-context.js',
      'scripts/cli-dispatch/dispatch-runtime/cli-role-resolver.js',
      'scripts/cli-dispatch/dispatch-runtime/launch-cli-dispatch.js',
      'scripts/cli-dispatch/dispatch-runtime/physical-file.js',
      'scripts/cli-dispatch/dispatch-runtime/physical-file.py',
      'scripts/cli-dispatch/transport/prepare-cli-request.py',
      'scripts/cli-dispatch/transport/run-cli-transport.py',
      'scripts/cli-dispatch/verify-handoff.js',
      'scripts/fast-worker-selector.js',
      'scripts/lib/dispatch-capability-evidence.js',
      'scripts/lib/dispatch-contract.js',
      'scripts/lib/dispatch-engine.js',
      'scripts/lib/native-dispatch-policy.js',
      'manifests/provider-model-catalog.json',
    ];
    for (const relative of supportFiles) {
      fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
      fs.writeFileSync(path.join(root, relative), 'fixture support\n');
    }
    for (const relative of [
      'agent-traps/_common/prompt-defense.md',
      'agent-traps/_common/trap-sheet-loader.md',
      'agent-traps/_common/cli-prompt-composition.md',
      'agent-traps/_common/build-resolver-skeleton.md',
      'agent-traps/e2e-runner/playwright.md',
    ]) fs.writeFileSync(path.join(root, relative), '# support\n');
    const body = [
      'Load agent-traps/_common/prompt-defense.md',
      'Policy rules/execution-policy.md',
      'Sheet agent-traps/_common/trap-sheet-loader.md',
      'Route rules/tool-routing.md',
      'Load agent-traps/e2e-runner/playwright.md',
      'Compose agent-traps/_common/cli-prompt-composition.md',
      'Skeleton agent-traps/_common/build-resolver-skeleton.md',
      'bash "scripts/cli-dispatch/adapters/run-codex.sh"',
      'bash "scripts/cli-dispatch/adapters/run-agy.sh"',
      'node scripts/fast-worker-selector.js',
    ].join('\n');
    fs.writeFileSync(path.join(root, 'agents', 'planner.md'), `---\nname: planner\n---\n${body}\n`);
    fs.writeFileSync(path.join(root, 'agents', 'code-reviewer.md'), `---\nname: code-reviewer\n---\n${body}\n`);
    fs.writeFileSync(path.join(root, 'agents', 'e2e-runner.md'), `---\nname: e2e-runner\n---\n${body}\n`);
    fs.writeFileSync(path.join(root, 'agents', 'codex-worker.md'), `---\nname: codex-worker\n---\n${body}\n`);
    assert.deepStrictEqual(agyNativeAgentClosureErrors(root), []);
    fs.rmSync(path.join(root, 'scripts', 'cli-dispatch', 'adapters', 'run-codex.sh'));
    const missingAdapter = agyNativeAgentClosureErrors(root);
    assert.ok(missingAdapter.some((error) => error.includes('native agent support file is missing: scripts/cli-dispatch/adapters/run-codex.sh')));
    fs.writeFileSync(path.join(root, 'scripts', 'cli-dispatch', 'adapters', 'run-codex.sh'), '#!/bin/sh\n');
    assert.deepStrictEqual(agyNativeAgentClosureErrors(root), []);
    fs.writeFileSync(path.join(root, 'agents', 'planner.md'), `---\nname: planner\n---\nLoad ${CLAUDE_ROOT}/agent-traps/_common/prompt-defense.md\n`);
    const rejected = agyNativeAgentClosureErrors(root);
    assert.ok(rejected.some((error) => /not package-local: agents\/planner\.md/.test(error)));
    fs.writeFileSync(path.join(root, 'plugin.json'), JSON.stringify({
      name: 'dhpk',
      version: '1.0.0',
      description: 'fixture',
      agents: ['./agents/'],
      skills: ['./skills/'],
      rules: ['./rules/'],
    }));
    const validated = validateAgyPluginPackage(root);
    assert.ok(!validated.errors.some((error) => /undeclared AGY package component: agent-traps/.test(error)), validated.errors.join('\n'));
    assert.ok(validated.errors.some((error) => /not package-local: agents\/planner\.md/.test(error)));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('published native packages resolve representative support without a source checkout', () => {
  const cursorRoot = path.join(ROOT, 'plugins', 'dhpk-cursor');
  const agyRoot = path.join(ROOT, 'plugins', 'dhpk-agy');
  const agentRoot = path.join(ROOT, 'plugins', 'dhpk-agent');
  const inventory = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests', 'distribution-inventory.json'), 'utf8'));
  const cursor = validateCursorPackage({ packageRoot: cursorRoot, inventory });
  assert.strictEqual(cursor.ok, true, cursor.errors.join('\n'));
  const releaseVersion = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  const agy = validateAgyPluginPackage(agyRoot, { expectedVersion: releaseVersion });
  assert.strictEqual(agy.ok, true, agy.errors.join('\n'));
  assert.deepStrictEqual(cursorNativeAgentClosureErrors(cursorRoot), []);
  assert.deepStrictEqual(agyNativeAgentClosureErrors(agyRoot), []);
  const install = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-native-coinstall-'));
  try {
    fs.cpSync(cursorRoot, path.join(install, 'dhpk-cursor'), { recursive: true });
    fs.cpSync(agentRoot, path.join(install, 'dhpk-agent'), { recursive: true });
    fs.cpSync(agyRoot, path.join(install, 'dhpk-agy'), { recursive: true });
    const consumer = path.join(install, 'empty-consumer');
    fs.mkdirSync(consumer);
    assert.ok(!fs.existsSync(path.join(consumer, '.cursor')));
    const planner = fs.readFileSync(path.join(install, 'dhpk-cursor', 'agents', 'planner.md'), 'utf8');
    assert.match(planner, /\$\{CURSOR_PLUGIN_ROOT\}\/agent-traps\/_common\/prompt-defense\.md/);
    assert.ok(fs.existsSync(path.join(install, 'dhpk-cursor', 'agent-traps', '_common', 'prompt-defense.md')));
    assert.ok(fs.existsSync(path.join(install, 'dhpk-cursor', 'agent-traps', '_common', 'trap-sheet-loader.md')));
    assert.ok(fs.existsSync(path.join(install, 'dhpk-cursor', 'rules', 'execution-policy.mdc')));
    assert.ok(!fs.existsSync(path.join(install, 'dhpk-cursor', 'skills')));
    const worker = fs.readFileSync(path.join(install, 'dhpk-cursor', 'agents', 'codex-worker.md'), 'utf8');
    assert.match(worker, /\$\{CURSOR_PLUGIN_ROOT\}\/\.\.\/dhpk-agent\/scripts\/cli-dispatch\/adapters\/run-codex\.sh/);
    assert.ok(fs.existsSync(path.resolve(path.join(install, 'dhpk-cursor'), '../dhpk-agent/scripts/cli-dispatch/adapters/run-codex.sh')));
    const agyPlanner = fs.readFileSync(path.join(install, 'dhpk-agy', 'agents', 'planner.md'), 'utf8');
    assert.match(agyPlanner, /agent-traps\/_common\/prompt-defense\.md/);
    assert.ok(!agyPlanner.includes(CLAUDE_ROOT));
    assert.ok(fs.existsSync(path.join(install, 'dhpk-agy', 'agent-traps', '_common', 'prompt-defense.md')));
    assert.ok(fs.existsSync(path.join(install, 'dhpk-agy', 'agent-traps', 'e2e-runner', 'playwright.md')));
  } finally {
    fs.rmSync(install, { recursive: true, force: true });
  }
});

test('a generated AGY package carries its native agent support closure without Flow Drive runtime scripts', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-native-agy-generated-'));
  try {
    const inventory = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests', 'distribution-inventory.json'), 'utf8'));
    const releaseVersion = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
    const provenance = JSON.parse(fs.readFileSync(path.join(ROOT, 'plugins', 'dhpk-agy', 'provenance.json'), 'utf8'));
    materializeAgyPluginPackage({
      root: ROOT,
      inventory,
      outDir: out,
      version: releaseVersion,
      sourceCommit: provenance.sourceCommit,
    });
    for (const relative of [
      'scripts/cli-dispatch/adapters/run-codex.sh',
      'scripts/cli-dispatch/adapters/run-agy.sh',
      'scripts/cli-dispatch/dispatch-runtime/launch-cli-dispatch.js',
      'scripts/cli-dispatch/transport/prepare-cli-request.py',
      'scripts/fast-worker-selector.js',
      'scripts/lib/native-dispatch-policy.js',
      'scripts/lib/dispatch-contract.js',
      'scripts/lib/dispatch-engine.js',
      'scripts/lib/dispatch-capability-evidence.js',
      'manifests/provider-model-catalog.json',
    ]) assert.ok(fs.existsSync(path.join(out, relative)), `AGY package includes ${relative}`);
    assert.ok(!fs.existsSync(path.join(out, 'skills', 'flow-drive', 'scripts', 'run.js')));
    const validation = validateAgyPluginPackage(out, { inventory, expectedVersion: releaseVersion, sourceRoot: ROOT });
    assert.strictEqual(validation.ok, true, validation.errors.join('\n'));
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});

run('native-agent-support');
