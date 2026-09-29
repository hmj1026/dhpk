'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const {
  ROOT,
  runInstaller,
  projectRoot,
  runtimeSupportSkillNames,
} = require('./_lib/install-codex-skills-fixtures');

const GENERATOR = path.join(ROOT, 'scripts', 'ci', 'gen-agents-skills.js');
const VALIDATOR = path.join(ROOT, 'scripts', 'ci', 'validate-agents-skills.js');

test('Codex native runtime skills remain bound during a portable multi-host projection', () => {
  const project = projectRoot();
  try {
    const installed = runInstaller(project, ['--migrate', '--update']);
    assert.strictEqual(installed.status, 0, `${installed.stdout}\n${installed.stderr}`);

    const runtimeSkillNames = runtimeSupportSkillNames();
    assert.ok(runtimeSkillNames.length > 0, 'expected Codex native runtime-support skills');
    const nativeSkillsRoot = path.join(project, '.codex', 'skills');
    const nativeReceiptPath = path.join(project, '.codex', '.dhpk-installed.json');
    const nativeReceiptBefore = fs.readFileSync(nativeReceiptPath, 'utf8');
    const nativeTargetsBefore = runtimeSkillNames.map((name) => {
      const destination = path.join(nativeSkillsRoot, name);
      assert.ok(fs.lstatSync(destination).isSymbolicLink(), `${name} should be a native symlink`);
      return [name, fs.readlinkSync(destination)];
    });

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

    const nativeTargetsAfter = runtimeSkillNames.map((name) => [
      name,
      fs.readlinkSync(path.join(nativeSkillsRoot, name)),
    ]);
    assert.deepStrictEqual(nativeTargetsAfter, nativeTargetsBefore, 'projection should preserve native Codex runtime symlink targets');
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

    for (const name of runtimeSkillNames) {
      assert.ok(
        fs.statSync(path.join(project, '.agents', 'skills', name, 'SKILL.md')).isFile(),
        `${name} should remain in the shared project projection`,
      );
    }
    const projectionReceipt = JSON.parse(fs.readFileSync(path.join(project, '.agents', '.dhpk-installed.json'), 'utf8'));
    const codexBindingPaths = projectionReceipt.bindingPaths.codex.map((binding) => binding.path);
    for (const name of runtimeSkillNames) {
      assert.ok(!codexBindingPaths.includes(`.codex/skills/${name}`), `${name} must not be owned by the project projection`);
      assert.strictEqual(projectionReceipt.entries.find((entry) => entry.name === name).discoveryVisible, false);
    }

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
    for (const [name, target] of nativeTargetsBefore) {
      assert.strictEqual(fs.readlinkSync(path.join(nativeSkillsRoot, name)), target);
    }
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
