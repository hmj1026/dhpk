'use strict';

// Path-safety contract for the physical Skill tree every publisher shares.
// Per-Skill descriptors, runtime overlays, and peer closures are retired;
// what remains must still fail closed on escapes, symlinks, and caches.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const {
  isIgnoredTreeName,
  physicalSkillTree,
  resolveSafeSkillPath,
} = require('../scripts/lib/workflow-package-closure');

const ROOT = path.join(__dirname, '..');

function tempRoot(prefix) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

function writeSkill(root, relative, name) {
  const skillRoot = path.join(root, relative);
  fs.mkdirSync(skillRoot, { recursive: true });
  fs.writeFileSync(path.join(skillRoot, 'SKILL.md'), `---\nname: ${name}\n---\n`);
  return skillRoot;
}

test('flow-guide and flow-drive publish their execution bundles from their own trees', () => {
  for (const id of ['flow-guide', 'flow-drive']) {
    const files = physicalSkillTree(ROOT, { id }).map((file) => file.relative);
    assert.ok(files.includes('SKILL.md'), `${id} entry`);
    assert.ok(files.includes('references/execution-bundle/rules/execution-policy.md'), `${id} policy bundle`);
    assert.ok(files.includes('references/execution-bundle/scripts/lib/flow-handoff-contract.js'), `${id} handoff contract`);
    assert.ok(!files.includes('skill-package.json'), `${id} retired descriptor`);
  }
});

test('an inventory path outside the source root fails closed', () => {
  const root = tempRoot('dhpk-tree-root-');
  const outside = tempRoot('dhpk-tree-outside-');
  try {
    writeSkill(outside, '.', 'escape');
    const entry = { id: 'escape', path: path.relative(root, outside).split(path.sep).join('/') };
    assert.throws(() => physicalSkillTree(root, entry, { availableEntries: [entry] }), /unsafe|escapes|source root/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('a symlinked Skill ancestor or leaf fails closed', () => {
  const root = tempRoot('dhpk-tree-link-');
  const outside = tempRoot('dhpk-tree-link-outside-');
  try {
    writeSkill(outside, 'real', 'linked');
    fs.mkdirSync(path.join(root, 'skills'), { recursive: true });
    fs.symlinkSync(path.join(outside, 'real'), path.join(root, 'skills', 'linked'));
    assert.throws(() => physicalSkillTree(root, { id: 'linked', path: 'skills/linked' }), /symlink/i);

    const skill = writeSkill(root, 'skills/leaf', 'leaf');
    fs.writeFileSync(path.join(outside, 'data.txt'), 'external');
    fs.symlinkSync(path.join(outside, 'data.txt'), path.join(skill, 'data.txt'));
    assert.throws(() => physicalSkillTree(root, { id: 'leaf', path: 'skills/leaf' }), /symlink/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('a stable ID resolves through its renamed canonical path from the inventory', () => {
  const root = tempRoot('dhpk-tree-renamed-');
  try {
    writeSkill(root, 'skills/tdd-workflow', 'tdd-workflow');
    const entry = { id: 'tdd', name: 'tdd-workflow', path: 'skills/tdd-workflow' };
    fs.mkdirSync(path.join(root, 'manifests'), { recursive: true });
    fs.writeFileSync(path.join(root, 'manifests', 'distribution-inventory.json'), JSON.stringify({ skills: [entry] }));
    assert.strictEqual(resolveSafeSkillPath(root, 'tdd').relative, 'skills/tdd-workflow');
    assert.deepStrictEqual(physicalSkillTree(root, { id: 'tdd' }).map((file) => file.relative), ['SKILL.md']);
    assert.deepStrictEqual(
      physicalSkillTree(root, { id: 'tdd' }, { availableEntries: [entry] }).map((file) => file.relative),
      ['SKILL.md'],
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('nested bytecode is ignored and a skill-package.json name has no special meaning', () => {
  const root = tempRoot('dhpk-tree-ignored-');
  try {
    const skill = writeSkill(root, 'skills/demo', 'demo');
    for (const relative of [
      'scripts/runtime/__pycache__/runner.js',
      'scripts/runtime/generated/runner.pyc',
      'skill-package.json',
      'references/examples/skill-package.json',
      'scripts/runtime/generated/runner.py',
    ]) {
      fs.mkdirSync(path.dirname(path.join(skill, relative)), { recursive: true });
      fs.writeFileSync(path.join(skill, relative), 'bytes\n');
    }
    assert.deepStrictEqual(physicalSkillTree(root, { id: 'demo', path: 'skills/demo' }).map((file) => file.relative), [
      'SKILL.md',
      'references/examples/skill-package.json',
      'scripts/runtime/generated/runner.py',
      'skill-package.json',
    ]);
    assert.strictEqual(isIgnoredTreeName('__pycache__', true), true);
    assert.strictEqual(isIgnoredTreeName('runner.pyc', false), true);
    assert.strictEqual(isIgnoredTreeName('runner.py', false), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

{
  // F24 source block: workflow-package-runtime.test.js
  const path = require('node:path');
  const fs = require('node:fs');
  const os = require('node:os');
  const { spawnSync } = require('node:child_process');
  const { test, assert } = require('./_lib/tinytest');

  const ROOT = path.join(__dirname, '..');
  const SURFACES = [
    'plugins/dhpk',
    'plugins/dhpk-agent',
    'plugins/dhpk-agy',
    'generated/claude-profiles/minimal/package',
  ];

  function isolatedEnvironment() {
    const env = { ...process.env };
    delete env.DHPK_SOURCE_ROOT;
    delete env.PLUGIN_ROOT;
    delete env.CLAUDECODE;
    return env;
  }

  function runIsolated(script, args, env = isolatedEnvironment()) {
    return spawnSync(process.execPath, [path.join(ROOT, script), ...args], {
      cwd: __dirname,
      env,
      encoding: 'utf8',
    });
  }

  for (const surface of SURFACES) {
    test(surface + ' carries a self-contained flow workflow runtime', () => {
      const usage = runIsolated(path.join(surface, 'skills/flow-guide/scripts/usage-card.js'), ['--json', 'flow-drive']);
      assert.strictEqual(usage.status, 0, usage.stdout + '\n' + usage.stderr);
      assert.strictEqual(JSON.parse(usage.stdout).id, 'flow-drive');

      const help = runIsolated(path.join(surface, 'skills/flow-guide/scripts/action-runner.js'), ['help', '--json', 'flow-drive']);
      assert.strictEqual(help.status, 0, help.stdout + '\n' + help.stderr);
      assert.strictEqual(JSON.parse(help.stdout).id, 'flow-drive');

      const route = runIsolated(path.join(surface, 'skills/flow-guide/scripts/action-runner.js'), ['route', '--go', 'review current change']);
      assert.strictEqual(route.status, 2, route.stdout + '\n' + route.stderr);
      const routeResult = JSON.parse(route.stdout);
      assert.strictEqual(routeResult.schema, 'dhpk.route-result.v3');
      assert.strictEqual(routeResult.availability, 'not-configured');
      assert.strictEqual(routeResult.disposition, 'blocked');

      for (const action of ['rules', 'close']) {
        const manual = runIsolated(path.join(surface, 'skills/flow-guide/scripts/action-runner.js'), [action]);
        assert.strictEqual(manual.status, 0, manual.stdout + '\n' + manual.stderr);
        const report = JSON.parse(manual.stdout);
        assert.strictEqual(report.action, action);
        assert.strictEqual(report.status, 'manual-evidence-required');
      }

      const invocation = runIsolated(path.join(surface, 'skills/flow-drive/scripts/invocation.js'), [
        'confirmed-change-123', '--cross-provider', '--reasoner=codex:terra:high', '--architect',
      ]);
      assert.strictEqual(invocation.status, 0, invocation.stdout + '\n' + invocation.stderr);
      const context = JSON.parse(invocation.stdout);
      assert.strictEqual(context.schema, 'dhpk.flow-drive-invocation.v1');
      assert.strictEqual(context.options.crossProvider, true);
      assert.strictEqual(context.options.reasoner.backend, 'codex');
    });
  }

  test('action-runner wires next to the package-local analyzer', () => {
    const env = isolatedEnvironment();
    const actionRunner = runIsolated(
      'plugins/dhpk/skills/flow-guide/scripts/action-runner.js',
      ['next'],
      env,
    );
    const analyzer = runIsolated(
      'plugins/dhpk/skills/flow-guide/scripts/analyze.js',
      [],
      env,
    );
    assert.strictEqual(actionRunner.status, analyzer.status, actionRunner.stdout + '\n' + actionRunner.stderr);
    assert.strictEqual(actionRunner.stdout, analyzer.stdout);
    assert.strictEqual(actionRunner.stderr, analyzer.stderr);

    const report = JSON.parse(actionRunner.stdout);
    assert.strictEqual(report.version, 2);
    assert.ok(typeof report.phase === 'string' && report.phase.trim().length > 0);
    assert.ok(Number.isInteger(report.finding_count && report.finding_count.P0)
      && report.finding_count.P0 >= 0);
    assert.ok(Number.isInteger(report.finding_count && report.finding_count.P1)
      && report.finding_count.P1 >= 0);
  });

  test('action-runner rejects multiple or cross-action options', () => {
    const invalid = runIsolated('plugins/dhpk/skills/flow-guide/scripts/action-runner.js', ['route', 'rules']);
    assert.strictEqual(invalid.status, 2, invalid.stdout + '\n' + invalid.stderr);
    assert.match(invalid.stderr, /exactly one action/i);
    const crossAction = runIsolated('plugins/dhpk/skills/flow-guide/scripts/action-runner.js', ['help', '--go']);
    assert.strictEqual(crossAction.status, 2);
    assert.match(crossAction.stderr, /only valid for the route action/i);
  });

  test('runtime loader resolves only the physical Skill tree and ignores ambient roots', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-runtime-loader-'));
    try {
      const partialRoot = path.join(tempRoot, 'partial', 'skills', 'flow-guide', 'scripts');
      fs.mkdirSync(path.join(partialRoot, '_lib'), { recursive: true });
      fs.copyFileSync(path.join(ROOT, 'skills/flow-guide/scripts/usage-card.js'), path.join(partialRoot, 'usage-card.js'));
      fs.copyFileSync(path.join(ROOT, 'skills/flow-guide/scripts/_lib/runtime-loader.js'), path.join(partialRoot, '_lib/runtime-loader.js'));
      const blocked = spawnSync(process.execPath, [path.join(partialRoot, 'usage-card.js'), '--json', 'flow-drive'], {
        cwd: tempRoot,
        env: { ...process.env, DHPK_SOURCE_ROOT: ROOT, PLUGIN_ROOT: ROOT },
        encoding: 'utf8',
      });
      assert.notStrictEqual(blocked.status, 0, 'an ambient source root must not satisfy a missing Skill-local resource');
      assert.match(blocked.stderr, /BLOCKED_RESOURCE_MISSING|unavailable/i);

      const skillCopy = path.join(tempRoot, 'relocated', 'flow-guide');
      fs.cpSync(path.join(ROOT, 'skills', 'flow-guide'), skillCopy, { recursive: true });
      const local = spawnSync(process.execPath, [path.join(skillCopy, 'scripts', 'usage-card.js'), '--json', 'flow-drive'], {
        cwd: tempRoot,
        env: Object.fromEntries(Object.entries(process.env).filter(([key]) => !['DHPK_SOURCE_ROOT', 'PLUGIN_ROOT'].includes(key))),
        encoding: 'utf8',
      });
      assert.strictEqual(local.status, 0, local.stdout + '\n' + local.stderr);
      assert.strictEqual(JSON.parse(local.stdout).id, 'flow-drive');
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
}

run('workflow-package-closure');
