'use strict';

// Smoke coverage for install-codex-skills.sh (destructive filesystem sync
// script — symlinks/copies plugin codex/ tree into a project's .codex/).
// A full behavioral test would require running it against a real project
// tree and mutating .codex/; that is out of scope for a smoke test. Instead:
//   1. bash -n syntax check.
//   2. --help invocation, which is provably a safe no-op: the arg parser
//      handles --help by printing the header comment and exiting 0 BEFORE
//      any filesystem mutation (no .codex/ dir created, no symlinks made).

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const HOOK = path.join(ROOT, 'scripts', 'hooks', 'install-codex-skills.sh');

test('bash -n syntax check passes', () => {
  const res = spawnSync('bash', ['-n', HOOK], { encoding: 'utf8' });
  assert.strictEqual(res.status, 0, `syntax error: ${res.stderr}`);
});

test('--help invocation is a safe no-op (no .codex/ created, exit 0)', () => {
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-ics-')));
  try {
    const env = { ...process.env };
    const res = spawnSync('bash', [HOOK, '--help'], {
      cwd: scratch,
      env,
      encoding: 'utf8',
      timeout: 10000,
    });
    assert.strictEqual(res.status, 0, `expected exit 0: ${res.stderr}`);
    assert.ok(!fs.existsSync(path.join(scratch, '.codex')),
      'expected --help to provably no-op: no .codex/ directory created');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

function runInstaller(project, args, pluginRoot = ROOT) {
  return spawnSync('bash', [HOOK, ...args], {
    cwd: project,
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: pluginRoot },
    encoding: 'utf8',
    timeout: 20000,
  });
}

function projectRoot() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-ics-behavior-')));
  fs.mkdirSync(path.join(dir, '.git'));
  return dir;
}

test('copy mode materializes skills/agents and records the install manifest', () => {
  const scratch = projectRoot();
  try {
    const res = runInstaller(scratch, ['--copy', '--force']);
    assert.strictEqual(res.status, 0, `${res.stdout}\n${res.stderr}`);
    const codex = path.join(scratch, '.codex');
    const skills = fs.readdirSync(path.join(codex, 'skills'));
    const agents = fs.readdirSync(path.join(codex, 'agents'));
    assert.ok(skills.length > 0, 'expected copied Codex skills');
    assert.ok(agents.length > 0, 'expected copied Codex agents');
    assert.ok(!fs.lstatSync(path.join(codex, 'skills', skills[0])).isSymbolicLink(), 'copy mode must materialize files');
    const manifest = JSON.parse(fs.readFileSync(path.join(codex, '.dhpk-installed.json'), 'utf8'));
    assert.strictEqual(manifest.mode, 'copy');
    assert.strictEqual(manifest.plugin_version, JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin/plugin.json'))).version);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('symlink mode links the target and --update replaces stale copied content', () => {
  const scratch = projectRoot();
  try {
    const linked = runInstaller(scratch, ['--force']);
    assert.strictEqual(linked.status, 0, `${linked.stdout}\n${linked.stderr}`);
    const skillName = fs.readdirSync(path.join(scratch, '.codex', 'skills'))[0];
    assert.ok(fs.lstatSync(path.join(scratch, '.codex', 'skills', skillName)).isSymbolicLink());

    const copied = runInstaller(scratch, ['--copy', '--update', '--force']);
    assert.strictEqual(copied.status, 0, `${copied.stdout}\n${copied.stderr}`);
    const skillFile = path.join(scratch, '.codex', 'skills', skillName, 'SKILL.md');
    fs.writeFileSync(skillFile, 'stale target\n');
    const updated = runInstaller(scratch, ['--copy', '--update', '--force']);
    assert.strictEqual(updated.status, 0, `${updated.stdout}\n${updated.stderr}`);
    assert.notStrictEqual(fs.readFileSync(skillFile, 'utf8'), 'stale target\n');
    const manifest = JSON.parse(fs.readFileSync(path.join(scratch, '.codex', '.dhpk-installed.json'), 'utf8'));
    assert.strictEqual(manifest.mode, 'copy');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('same plugin version but changed source content is not treated as up-to-date', () => {
  const scratch = projectRoot();
  const fakePlugin = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-ics-plugin-')));
  try {
    fs.cpSync(path.join(ROOT, 'codex'), path.join(fakePlugin, 'codex'), { recursive: true });
    fs.mkdirSync(path.join(fakePlugin, '.claude-plugin'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), path.join(fakePlugin, '.claude-plugin', 'plugin.json'));
    const first = runInstaller(scratch, ['--copy', '--force'], fakePlugin);
    assert.strictEqual(first.status, 0, `${first.stdout}\n${first.stderr}`);

    const sourceFiles = [];
    function collect(dir) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fp = path.join(dir, entry.name);
        if (entry.isDirectory()) collect(fp);
        else if (entry.isFile()) sourceFiles.push(fp);
      }
    }
    collect(path.join(fakePlugin, 'codex', 'skills'));
    assert.ok(sourceFiles.length > 0, 'fixture plugin must contain a regular Codex skill file');
    const sourceFile = sourceFiles[0];
    fs.appendFileSync(sourceFile, '\nsource changed without version bump\n');
    const relative = path.relative(path.join(fakePlugin, 'codex', 'skills'), sourceFile);
    const targetFile = path.join(scratch, '.codex', 'skills', relative);
    const second = runInstaller(scratch, ['--copy', '--force'], fakePlugin);
    assert.strictEqual(second.status, 0, `${second.stdout}\n${second.stderr}`);
    assert.strictEqual(fs.readFileSync(targetFile, 'utf8'), fs.readFileSync(sourceFile, 'utf8'));
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(fakePlugin, { recursive: true, force: true });
  }
});

run('install-codex-skills');
