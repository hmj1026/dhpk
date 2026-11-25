'use strict';

const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');

const resolver = path.resolve(__dirname, '../skills/change-verdict/scripts/resolve-review-triggers.js');
const modules = path.resolve(__dirname, '../modules');

test('review triggers resolve exactly the requested Git scope and configuration', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-review-triggers-'));
  process.on('exit', () => fs.rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd, stdio: 'pipe' }).toString().trim();
  function write(name) {
    const file = path.join(cwd, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, 'example\n');
  }
  function resolve(...args) {
    return spawnSync(process.execPath, [resolver, ...args], {
      cwd, encoding: 'utf8',
      env: { ...process.env, DHPK_ACTIVE_MODULES: '', CLAUDE_PLUGIN_OPTION_MODULES: '', CLAUDE_PLUGIN_OPTION_REVIEW_TRIGGER_EXTRA_PATHS: '' },
    });
  }

  git('init', '-q');
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'user.name', 'Fixture');
  write('notes.txt');
  write('src/Home.jsx');
  git('add', '.');
  git('commit', '-qm', 'base');
  const base = git('rev-parse', 'HEAD');
  assert.strictEqual(resolve('--staged').stdout, '[]\n');
  write('docs/example.md');
  git('add', 'docs');
  git('commit', '-qm', 'docs');
  write('config/\nAuth.php');
  git('add', 'config');
  write('src/Home.jsx');

  const staged = resolve('--staged', '--extra', 'mig:config/');
  assert.strictEqual(staged.status, 0, staged.stderr);
  assert.deepStrictEqual(JSON.parse(staged.stdout), ['code-reviewer', 'migration-reviewer', 'security-reviewer']);
  const unstagedArgs = ['--unstaged', '--modules-root', modules, '--modules', 'react-19'];
  const unstaged = resolve(...unstagedArgs);
  assert.strictEqual(unstaged.status, 0, unstaged.stderr);
  assert.strictEqual(unstaged.stdout, '["frontend-reviewer"]\n');
  assert.strictEqual(resolve(...unstagedArgs).stdout, unstaged.stdout);
  assert.strictEqual(resolve('--base', base).stdout, '["doc-reviewer"]\n');
  assert.notStrictEqual(resolve('--base', 'does-not-exist').status, 0);
  assert.notStrictEqual(resolve('--staged', '--unstaged').status, 0);
  assert.notStrictEqual(resolve('--staged', '--extra', 'unknown:src/').status, 0);

  fs.mkdirSync(path.join(cwd, '.claude'));
  fs.writeFileSync(path.join(cwd, '.claude/settings.local.json'), JSON.stringify({
    pluginConfigs: { 'dhpk@dhpk': { options: { review_trigger_extra_paths: ['db:src/'] } } },
  }));
  assert.strictEqual(resolve(...unstagedArgs).stdout, '["database-reviewer","frontend-reviewer"]\n');

  git('reset', '-q');
  write('.claude/agents/example.md');
  git('add', '.claude/agents/example.md');
  assert.strictEqual(resolve('--staged').stdout, '["doc-reviewer"]\n');
});

run('resolve-review-triggers');
