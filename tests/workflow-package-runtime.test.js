'use strict';

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const SURFACES = [
  'plugins/dhpk',
  'plugins/dhpk-agent',
  'plugins/dhpk-agy',
  'generated/claude-profiles/minimal/package',
];

function runIsolated(script, args) {
  const env = { ...process.env };
  delete env.DHPK_SOURCE_ROOT;
  delete env.PLUGIN_ROOT;
  return spawnSync(process.execPath, [path.join(ROOT, script), ...args], {
    cwd: path.dirname(require.resolve('./workflow-package-runtime.test')),
    env,
    encoding: 'utf8',
  });
}

for (const surface of SURFACES) {
  test(`${surface} carries a self-contained flow workflow runtime`, () => {
  const usage = runIsolated(path.join(surface, 'skills/flow-guide/scripts/usage-card.js'), ['--json', 'flow-drive']);
    assert.strictEqual(usage.status, 0, `${usage.stdout}\n${usage.stderr}`);
    assert.strictEqual(JSON.parse(usage.stdout).id, 'flow-drive');

    const help = runIsolated(path.join(surface, 'skills/flow-guide/scripts/action-runner.js'), ['help', '--json', 'flow-drive']);
    assert.strictEqual(help.status, 0, `${help.stdout}\n${help.stderr}`);
    assert.strictEqual(JSON.parse(help.stdout).id, 'flow-drive');

    const route = runIsolated(path.join(surface, 'skills/flow-guide/scripts/action-runner.js'), ['route', '--go', 'review current change']);
    assert.strictEqual(route.status, 2, `${route.stdout}\n${route.stderr}`);
    const routeResult = JSON.parse(route.stdout);
    assert.strictEqual(routeResult.schema, 'dhpk.route-result.v3');
    assert.strictEqual(routeResult.availability, 'not-configured');
    assert.strictEqual(routeResult.disposition, 'blocked');

    for (const action of ['rules', 'close']) {
      const manual = runIsolated(path.join(surface, 'skills/flow-guide/scripts/action-runner.js'), [action]);
      assert.strictEqual(manual.status, 0, `${manual.stdout}\n${manual.stderr}`);
      const report = JSON.parse(manual.stdout);
      assert.strictEqual(report.action, action);
      assert.strictEqual(report.status, 'manual-evidence-required');
    }

    const invocation = runIsolated(path.join(surface, 'skills/flow-drive/scripts/invocation.js'), [
      'confirmed-change-123', '--cross-provider', '--reasoner=codex:terra:high', '--architect',
    ]);
    assert.strictEqual(invocation.status, 0, `${invocation.stdout}\n${invocation.stderr}`);
    const context = JSON.parse(invocation.stdout);
    assert.strictEqual(context.schema, 'dhpk.flow-drive-invocation.v1');
    assert.strictEqual(context.options.crossProvider, true);
    assert.strictEqual(context.options.reasoner.backend, 'codex');
  });
}

test('action-runner wires next to the package-local analyzer', () => {
  const next = runIsolated('plugins/dhpk/skills/flow-guide/scripts/action-runner.js', ['next']);
  assert.ok([0, 1, 2].includes(next.status), `${next.stdout}\n${next.stderr}`);
  assert.match(next.stdout, /"phase"/);
});

test('action-runner rejects multiple or cross-action options', () => {
  const invalid = runIsolated('plugins/dhpk/skills/flow-guide/scripts/action-runner.js', ['route', 'rules']);
  assert.strictEqual(invalid.status, 2, `${invalid.stdout}\n${invalid.stderr}`);
  assert.match(invalid.stderr, /exactly one action/i);
  const crossAction = runIsolated('plugins/dhpk/skills/flow-guide/scripts/action-runner.js', ['help', '--go']);
  assert.strictEqual(crossAction.status, 2);
  assert.match(crossAction.stderr, /only valid for the route action/i);
});

test('runtime loader uses explicit development roots and blocks ambient guesses', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-runtime-loader-'));
  try {
    const scriptRoot = path.join(tempRoot, 'skills', 'flow-guide', 'scripts');
    fs.mkdirSync(path.join(scriptRoot, '_lib'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, 'skills/flow-guide/scripts/usage-card.js'), path.join(scriptRoot, 'usage-card.js'));
    fs.copyFileSync(path.join(ROOT, 'skills/flow-guide/scripts/_lib/runtime-loader.js'), path.join(scriptRoot, '_lib/runtime-loader.js'));
    const explicit = spawnSync(process.execPath, [path.join(scriptRoot, 'usage-card.js'), '--root', ROOT, '--json', 'flow-drive'], {
      cwd: tempRoot,
      env: { ...process.env, DHPK_SOURCE_ROOT: ROOT },
      encoding: 'utf8',
    });
    assert.strictEqual(explicit.status, 0, `${explicit.stdout}\n${explicit.stderr}`);
    assert.strictEqual(JSON.parse(explicit.stdout).id, 'flow-drive');
    const blocked = spawnSync(process.execPath, [path.join(scriptRoot, 'usage-card.js'), '--root', ROOT, '--json', 'flow-drive'], {
      cwd: tempRoot,
      env: Object.fromEntries(Object.entries(process.env).filter(([key]) => !['DHPK_SOURCE_ROOT', 'PLUGIN_ROOT'].includes(key))),
      encoding: 'utf8',
    });
    assert.notStrictEqual(blocked.status, 0);
    assert.match(blocked.stderr, /BLOCKED_RESOURCE_MISSING|unavailable/i);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

run('workflow-package-runtime');
