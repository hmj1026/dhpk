'use strict';

// Self-contained Codex Skills are installed as their complete physical
// directories.  The retired per-Skill descriptor can no longer inject files
// from the plugin root.  Keep this suite on the real installer boundary so a
// receipt can never claim a projection that was not actually materialized.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const {
  ROOT,
  runInstaller,
  projectRoot,
  copyDistributionInventory,
  completeTreeFingerprint,
  materializeFixtureSkill,
} = require('./_lib/install-codex-skills-fixtures');

const LOCAL_SCRIPT = path.join('scripts', 'harness-audit.js');

function makePlugin() {
  const plugin = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-ics-runtime-plugin-')));
  fs.cpSync(path.join(ROOT, 'codex'), path.join(plugin, 'codex'), {
    recursive: true,
    dereference: true,
  });
  fs.mkdirSync(path.join(plugin, '.claude-plugin'), { recursive: true });
  fs.copyFileSync(
    path.join(ROOT, '.claude-plugin', 'plugin.json'),
    path.join(plugin, '.claude-plugin', 'plugin.json'),
  );
  copyDistributionInventory(plugin);
  // cpSync's dereference option does not dereference nested Codex skill links
  // on every supported Node release. Materialize before writing fixture files
  // so this test never follows a link back into ROOT/skills.
  materializeFixtureSkill(plugin, 'harness-govern');
  const skill = path.join(plugin, 'codex', 'skills', 'harness-govern');
  fs.copyFileSync(
    path.join(ROOT, 'skills', 'harness-audit', 'scripts', 'harness-audit.js'),
    path.join(skill, LOCAL_SCRIPT),
  );
  // A stale retired descriptor still names a plugin-root overlay.  It must be
  // inert: nothing outside the Skill directory may be injected.
  fs.mkdirSync(path.join(plugin, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(plugin, 'scripts', 'overlay-only.js'), 'module.exports = "overlay";\n');
  fs.writeFileSync(path.join(skill, 'skill-package.json'), `${JSON.stringify({
    schema: 'dhpk.skill-package.v1',
    id: 'harness-govern',
    version: '1.0.0',
    entry: 'SKILL.md',
    resources: [{ path: 'SKILL.md', kind: 'entry', required: true }],
    runtimeAssets: [{ source: 'scripts/overlay-only.js', destination: 'scripts/overlay-only.js', required: true }],
  }, null, 2)}\n`);
  return plugin;
}

function sourceSkill(plugin) {
  return path.join(plugin, 'codex', 'skills', 'harness-govern');
}

function installedSkill(project) {
  return path.join(project, '.codex', 'skills', 'harness-govern');
}

function runRunner(target) {
  return spawnSync(process.execPath, [path.join(target, LOCAL_SCRIPT), '--help'], {
    encoding: 'utf8',
    timeout: 10_000,
  });
}

function stageMutationShim() {
  const shim = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-stage-mutation-shim-')));
  fs.writeFileSync(path.join(shim, 'sitecustomize.py'), [
    'import os',
    '',
    '_dhpk_original_replace = os.replace',
    '_dhpk_mutated = False',
    '',
    'def _dhpk_replace(src, dst, *args, **kwargs):',
    '    global _dhpk_mutated',
    "    src_dir_fd = kwargs.get('src_dir_fd')",
    "    marker = os.environ.get('DHPK_TEST_STAGE_MUTATION_MARKER')",
    "    if not _dhpk_mutated and src_dir_fd is not None and isinstance(src, str):",
    '        stage_fd = None',
    '        asset_fd = None',
    '        try:',
    "            stage_fd = os.open(src, os.O_RDONLY | getattr(os, 'O_DIRECTORY', 0), dir_fd=src_dir_fd)",
    "            asset_fd = os.open('scripts/harness-audit.js', os.O_WRONLY | os.O_APPEND, dir_fd=stage_fd)",
    "            os.write(asset_fd, b'\\n# test staged mutation\\n')",
    '            os.fsync(asset_fd)',
    '            _dhpk_mutated = True',
    '            if marker:',
    "                with open(marker, 'w', encoding='utf-8') as handle: handle.write('mutated')",
    '        except (FileNotFoundError, NotADirectoryError, OSError):',
    '            pass',
    '        finally:',
    '            if asset_fd is not None:',
    '                os.close(asset_fd)',
    '            if stage_fd is not None:',
    '                os.close(stage_fd)',
    '    return _dhpk_original_replace(src, dst, *args, **kwargs)',
    '',
    'os.replace = _dhpk_replace',
    '',
  ].join('\n'));
  return shim;
}

test('a stale descriptor cannot inject plugin-root files into an installed Skill', () => {
  for (const mode of [['--force'], ['--copy', '--force']]) {
    const project = projectRoot();
    const plugin = makePlugin();
    try {
      const installed = runInstaller(project, mode, plugin);
      assert.strictEqual(installed.status, 0, `${installed.stdout}\n${installed.stderr}`);
      const target = installedSkill(project);
      assert.ok(fs.existsSync(path.join(target, LOCAL_SCRIPT)), `${mode.join(' ')}: Skill-local script is installed`);
      assert.ok(!fs.existsSync(path.join(target, 'scripts', 'overlay-only.js')),
        `${mode.join(' ')}: a plugin-root overlay must never be injected`);
      if (mode.includes('--copy')) {
        const receipt = JSON.parse(fs.readFileSync(path.join(project, '.codex', '.dhpk-installed.json'), 'utf8'));
        assert.strictEqual(receipt.managed_entries.skills['harness-govern'].source_fingerprint,
          completeTreeFingerprint(target), 'receipt source hash must cover the complete installed tree');
        fs.rmSync(path.join(plugin, 'scripts'), { recursive: true, force: true });
        const runner = runRunner(target);
        assert.strictEqual(runner.status, 0, `${runner.stdout}\n${runner.stderr}`);
      }
    } finally {
      fs.rmSync(project, { recursive: true, force: true });
      fs.rmSync(plugin, { recursive: true, force: true });
    }
  }
});

test('--copy refreshes a Skill-local script and preserves an edited unowned destination', () => {
  const project = projectRoot();
  const plugin = makePlugin();
  try {
    const installed = runInstaller(project, ['--copy', '--force'], plugin);
    assert.strictEqual(installed.status, 0, `${installed.stdout}\n${installed.stderr}`);
    const target = installedSkill(project);
    const projected = path.join(target, LOCAL_SCRIPT);
    const before = fs.readFileSync(projected, 'utf8');
    fs.appendFileSync(path.join(sourceSkill(plugin), LOCAL_SCRIPT), '\n// Skill-local fixture update\n');
    const updated = runInstaller(project, ['--copy', '--update', '--force'], plugin);
    assert.strictEqual(updated.status, 0, `${updated.stdout}\n${updated.stderr}`);
    assert.notStrictEqual(fs.readFileSync(projected, 'utf8'), before,
      'a Skill-local source change must refresh the projection');

    const edited = path.join(target, 'SKILL.md');
    fs.appendFileSync(edited, '\nuser-owned edit\n');
    const editedContent = fs.readFileSync(edited, 'utf8');
    const rejected = runInstaller(project, ['--copy', '--update', '--force'], plugin);
    assert.notStrictEqual(rejected.status, 0, `${rejected.stdout}\n${rejected.stderr}`);
    assert.match(`${rejected.stdout}\n${rejected.stderr}`, /adopt|collision/i);
    assert.strictEqual(fs.readFileSync(edited, 'utf8'), editedContent,
      'an edited unowned destination must remain untouched even with --force');
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
    fs.rmSync(plugin, { recursive: true, force: true });
  }
});

test('Skill-local ignored bytecode is never projected and never changes the fingerprint', () => {
  const project = projectRoot();
  const plugin = makePlugin();
  try {
    const installed = runInstaller(project, ['--copy', '--force'], plugin);
    assert.strictEqual(installed.status, 0, `${installed.stdout}\n${installed.stderr}`);
    const receiptPath = path.join(project, '.codex', '.dhpk-installed.json');
    const before = fs.readFileSync(receiptPath, 'utf8');
    const cache = path.join(sourceSkill(plugin), 'scripts', '__pycache__');
    fs.mkdirSync(cache, { recursive: true });
    fs.writeFileSync(path.join(cache, 'runner.cpython-312.pyc'), 'ignored bytes\n');
    fs.writeFileSync(path.join(sourceSkill(plugin), 'scripts', 'stray.pyc'), 'ignored bytes\n');
    const updated = runInstaller(project, ['--copy', '--update', '--force'], plugin);
    assert.strictEqual(updated.status, 0, `${updated.stdout}\n${updated.stderr}`);
    const target = installedSkill(project);
    assert.ok(!fs.existsSync(path.join(target, 'scripts', '__pycache__')));
    assert.ok(!fs.existsSync(path.join(target, 'scripts', 'stray.pyc')));
    assert.strictEqual(JSON.parse(fs.readFileSync(receiptPath, 'utf8')).source_fingerprint,
      JSON.parse(before).source_fingerprint, 'ignored bytecode must not alter the source fingerprint');
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
    fs.rmSync(plugin, { recursive: true, force: true });
  }
});

test('installer rejects a staged Skill mutation after preverification and preserves accepted output and receipt', () => {
  const project = projectRoot();
  const plugin = makePlugin();
  const shim = stageMutationShim();
  const marker = path.join(shim, 'mutated');
  try {
    const installed = runInstaller(project, ['--copy', '--force'], plugin);
    assert.strictEqual(installed.status, 0, `${installed.stdout}\n${installed.stderr}`);
    const target = installedSkill(project);
    const receiptPath = path.join(project, '.codex', '.dhpk-installed.json');
    const beforeProjection = completeTreeFingerprint(target);
    const beforeReceipt = fs.readFileSync(receiptPath, 'utf8');

    fs.appendFileSync(path.join(sourceSkill(plugin), LOCAL_SCRIPT), '\nsource update before staged verification\n');
    const pythonPath = [shim, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter);
    const rejected = runInstaller(project, ['--copy', '--update', '--force'], plugin, {
      PYTHONPATH: pythonPath,
      DHPK_TEST_STAGE_MUTATION_MARKER: marker,
    });
    assert.ok(fs.existsSync(marker), 'fixture must mutate the selected stage before publication');
    assert.notStrictEqual(rejected.status, 0, `${rejected.stdout}\n${rejected.stderr}`);
    assert.strictEqual(completeTreeFingerprint(target), beforeProjection,
      'a staged mutation must not replace the previously accepted projection');
    assert.strictEqual(fs.readFileSync(receiptPath, 'utf8'), beforeReceipt,
      'a staged mutation must not publish a new receipt');
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
    fs.rmSync(plugin, { recursive: true, force: true });
    fs.rmSync(shim, { recursive: true, force: true });
  }
});

test('rejects a symlinked Skill-local script before creating a copy projection', () => {
  const project = projectRoot();
  const plugin = makePlugin();
  const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-ics-runtime-outside-')));
  try {
    fs.writeFileSync(path.join(outside, 'harness-audit.js'), 'outside runtime\n');
    const local = path.join(sourceSkill(plugin), LOCAL_SCRIPT);
    fs.rmSync(local);
    fs.symlinkSync(path.join(outside, 'harness-audit.js'), local);
    const rejected = runInstaller(project, ['--copy', '--force'], plugin);
    assert.notStrictEqual(rejected.status, 0, `${rejected.stdout}\n${rejected.stderr}`);
    assert.ok(!fs.existsSync(path.join(project, '.codex', '.dhpk-installed.json')),
      'a symlinked Skill source must not publish a receipt');
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
    fs.rmSync(plugin, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

run('install-codex-runtime-assets');
