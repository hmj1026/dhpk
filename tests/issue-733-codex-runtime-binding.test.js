'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const {
  ROOT,
  runInstaller,
  projectRoot,
} = require('./_lib/install-codex-skills-fixtures');

const GENERATOR = path.join(ROOT, 'scripts', 'ci', 'gen-agents-skills.js');
const VALIDATOR = path.join(ROOT, 'scripts', 'ci', 'validate-agents-skills.js');

test('canonical Codex native ownership stays separate from portable multi-host Skill bindings', () => {
  const project = projectRoot();
  try {
    const installed = runInstaller(project, ['--migrate', '--update']);
    assert.strictEqual(installed.status, 0, `${installed.stdout}\n${installed.stderr}`);

    const nativeSkillsRoot = path.join(project, '.codex', 'skills');
    const nativeReceiptPath = path.join(project, '.codex', '.dhpk-installed.json');
    const nativeReceiptBefore = fs.readFileSync(nativeReceiptPath, 'utf8');
    const nativeReceipt = JSON.parse(nativeReceiptBefore);
    assert.deepStrictEqual(nativeReceipt.runtimeSupportStableIds, []);
    assert.deepStrictEqual(nativeReceipt.managed_entries.skills, {});
    const nativeTargetsBefore = Object.values(nativeReceipt.managed_entries.agents).map((entry) => [
      entry.destination, fs.readFileSync(path.join(project, '.codex', entry.destination), 'utf8'),
    ]);
    assert.ok(nativeTargetsBefore.length > 0, 'native agent ownership must remain exercised');

    const generated = spawnSync(process.execPath, [
      GENERATOR,
      '--source-root', ROOT,
      '--project-root', project,
      '--profile', 'portable-core',
      '--host', 'claude',
      '--host', 'codex',
      '--host', 'cursor',
      '--host', 'agy',
      '--update',
    ], { cwd: project, encoding: 'utf8', timeout: 120_000 });
    const validated = spawnSync(process.execPath, [
      VALIDATOR,
      '--source-root', ROOT,
      '--project-root', project,
    ], { cwd: project, encoding: 'utf8', timeout: 120_000 });

    const nativeTargetsAfter = nativeTargetsBefore.map(([destination]) => [
      destination,
      fs.readFileSync(path.join(project, '.codex', destination), 'utf8'),
    ]);
    assert.deepStrictEqual(nativeTargetsAfter, nativeTargetsBefore, 'portable projection must preserve native agent files');
    assert.strictEqual(
      generated.status,
      0,
      `multi-host projection failed (${generated.status})\n${generated.stdout}\n${generated.stderr}`,
    );
    assert.strictEqual(
      validated.status,
      0,
      `generated projection did not validate (${validated.status})\n${validated.stdout}\n${validated.stderr}`,
    );

    assert.strictEqual(typeof require(path.join(nativeSkillsRoot, 'flow-drive/scripts/run.js')).runFlowDrive, 'function');
    const projectionReceipt = JSON.parse(fs.readFileSync(path.join(project, '.agents', '.dhpk-installed.json'), 'utf8'));
    const codexBindingPaths = projectionReceipt.bindingPaths.codex.map((binding) => binding.path);
    assert.ok(codexBindingPaths.includes('.codex/skills/flow-drive'));
    assert.ok(projectionReceipt.entries.some((entry) => entry.name === 'flow-drive'
      && entry.stableId === 'flow-drive' && entry.provenance.canonicalSource === 'skills/flow-drive'));

    const repeated = spawnSync(process.execPath, [
      GENERATOR, '--source-root', ROOT, '--project-root', project, '--profile', 'portable-core',
      '--host', 'claude', '--host', 'codex', '--host', 'cursor', '--host', 'agy', '--update',
    ], { cwd: project, encoding: 'utf8', timeout: 120_000 });
    assert.strictEqual(repeated.status, 0, `${repeated.stdout}\n${repeated.stderr}`);

    const removed = spawnSync(process.execPath, [GENERATOR, '--source-root', ROOT, '--project-root', project, '--uninstall'], {
      cwd: project, encoding: 'utf8', timeout: 120_000,
    });
    assert.strictEqual(removed.status, 0, `${removed.stdout}\n${removed.stderr}`);
    assert.strictEqual(fs.readFileSync(nativeReceiptPath, 'utf8'), nativeReceiptBefore);
    for (const [destination, content] of nativeTargetsBefore) {
      assert.strictEqual(fs.readFileSync(path.join(project, '.codex', destination), 'utf8'), content);
    }
    assert.ok(!fs.existsSync(path.join(nativeSkillsRoot, 'flow-drive')), 'shared uninstall removes its own binding');
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
  }
});

test('Codex projection refuses a foreign skill at a visible binding path', () => {
  const project = projectRoot();
  const foreign = path.join(project, '.codex', 'skills', 'code-trace', 'SKILL.md');
  try {
    fs.mkdirSync(path.dirname(foreign), { recursive: true });
    fs.writeFileSync(foreign, '# User skill\n');
    const generated = spawnSync(process.execPath, [
      GENERATOR, '--source-root', ROOT, '--project-root', project,
      '--profile', 'portable-core', '--host', 'codex', '--update',
    ], { cwd: project, encoding: 'utf8', timeout: 120_000 });
    assert.notStrictEqual(generated.status, 0);
    assert.match(generated.stderr, /collides with unmanaged content: \.codex\/skills\/code-trace/);
    assert.strictEqual(fs.readFileSync(foreign, 'utf8'), '# User skill\n');
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
  }
});

test('Codex projection refuses an edited receipt-owned visible binding', () => {
  const project = projectRoot();
  const binding = path.join(project, '.codex', 'skills', 'code-trace');
  try {
    const args = [
      GENERATOR, '--source-root', ROOT, '--project-root', project,
      '--profile', 'portable-core', '--host', 'codex', '--update',
    ];
    const installed = spawnSync(process.execPath, args, { cwd: project, encoding: 'utf8', timeout: 120_000 });
    assert.strictEqual(installed.status, 0, `${installed.stdout}\n${installed.stderr}`);
    fs.unlinkSync(binding);
    fs.mkdirSync(binding);
    const edited = path.join(binding, 'SKILL.md');
    fs.writeFileSync(edited, '# Edited binding\n');
    const updated = spawnSync(process.execPath, args, { cwd: project, encoding: 'utf8', timeout: 120_000 });
    assert.notStrictEqual(updated.status, 0);
    assert.match(updated.stderr, /receipt-owned Host binding was (?:modified|replaced): \.codex\/skills\/code-trace/);
    assert.strictEqual(fs.readFileSync(edited, 'utf8'), '# Edited binding\n');
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
  }
});

run('issue-733-codex-runtime-binding');
