'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const HOOK = path.join(__dirname, '..', 'scripts', 'hooks', 'install-cursor-harness.sh');

function projectRoot() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-ich-project-')));
  fs.mkdirSync(path.join(dir, '.git'));
  return dir;
}

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function fakePlugin() {
  const plugin = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-ich-plugin-')));
  write(path.join(plugin, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'dhpk', version: '9.9.9' }));
  write(path.join(plugin, 'cursor', 'skills', 'dhpk-portable', 'SKILL.md'), '---\nname: dhpk-portable\ndescription: portable\n---\n# Portable\n');
  write(path.join(plugin, 'cursor', 'agents', 'reviewer.md'), '---\nname: reviewer\ndescription: review\nmodel: inherit\nreadonly: true\n---\n# Reviewer\n');
  write(path.join(plugin, 'cursor', 'rules', 'prefer-const.mdc'), '---\nname: prefer-const\ndescription: prefer const\nalwaysApply: false\n---\n# Prefer const\n');
  write(path.join(plugin, 'cursor', 'commands', 'review.md'), '---\nname: review\ndescription: review command\n---\n# Review\n');
  write(path.join(plugin, 'agent-traps', '_common', 'prompt-defense.md'), '# defense\n');
  write(path.join(plugin, 'cursor', 'config.toml.example'), 'model = "fixture"\n');
  write(path.join(plugin, 'manifests', 'distribution-inventory.json'), `${JSON.stringify({
    skills: [{ id: 'portable', name: 'dhpk-portable', path: 'skills/dhpk-portable', legacy_names: [] }],
    supporting_assets: [
      {
        id: 'cursor-trap',
        source: 'agent-traps/_common/prompt-defense.md',
        destination: 'dhpk/agent-traps/_common/prompt-defense.md',
      },
      {
        id: 'codex-config',
        source: 'cursor/config.toml.example',
        destination: 'config.toml.example',
      },
    ],
  }, null, 2)}\n`);
  return plugin;
}

function runInstaller(project, args, pluginRoot, extraEnv) {
  return spawnSync('bash', [HOOK, ...args], {
    cwd: project,
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: pluginRoot, ...(extraEnv || {}) },
    encoding: 'utf8',
    timeout: 20000,
  });
}

test('bash -n syntax check passes', () => {
  const res = spawnSync('bash', ['-n', HOOK], { encoding: 'utf8' });
  assert.strictEqual(res.status, 0, `syntax error: ${res.stderr}`);
});

test('--help is a no-op and documents Codex-parity flags', () => {
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-ich-help-')));
  try {
    const res = spawnSync('bash', [HOOK, '--help'], {
      cwd: scratch,
      env: process.env,
      encoding: 'utf8',
      timeout: 10000,
    });
    assert.strictEqual(res.status, 0, res.stderr);
    assert.match(res.stdout, /--migrate/);
    assert.match(res.stdout, /--uninstall/);
    assert.ok(!fs.existsSync(path.join(scratch, '.cursor')));
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('copy mode materializes skills, .mdc rules, commands, dhpk support files, and a schema-v3 receipt', () => {
  const scratch = projectRoot();
  const plugin = fakePlugin();
  try {
    const res = runInstaller(scratch, ['--copy', '--force'], plugin);
    assert.strictEqual(res.status, 0, `${res.stdout}\n${res.stderr}`);
    const cursor = path.join(scratch, '.cursor');
    assert.ok(!fs.lstatSync(path.join(cursor, 'skills', 'dhpk-portable')).isSymbolicLink());
    assert.ok(fs.existsSync(path.join(cursor, 'agents', 'reviewer.md')));
    assert.ok(fs.existsSync(path.join(cursor, 'rules', 'prefer-const.mdc')));
    assert.ok(fs.existsSync(path.join(cursor, 'commands', 'review.md')));
    assert.ok(fs.existsSync(path.join(cursor, 'dhpk', 'agent-traps', '_common', 'prompt-defense.md')));
    assert.ok(!fs.existsSync(path.join(cursor, 'config.toml.example')));
    assert.ok(!fs.existsSync(path.join(cursor, 'hooks.json')));
    const receipt = JSON.parse(fs.readFileSync(path.join(cursor, '.dhpk-installed.json'), 'utf8'));
    assert.strictEqual(receipt.schema_version, 3);
    assert.strictEqual(receipt.mode, 'copy');
    assert.strictEqual(receipt.managed_entries.skills['dhpk-portable'].id, 'portable');
    assert.strictEqual(receipt.managed_entries.skills['dhpk-portable'].name, 'dhpk-portable');
    assert.ok(receipt.managed_entries.rules['prefer-const.mdc']);
    assert.ok(receipt.managed_entries.commands['review.md']);
    assert.ok(receipt.managed_entries.supporting_assets['dhpk/agent-traps/_common/prompt-defense.md']);
    assert.ok(!receipt.managed_entries.supporting_assets['config.toml.example']);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(plugin, { recursive: true, force: true });
  }
});

test('cursor supporting assets prefer the rewritten cursor/dhpk projection', () => {
  const scratch = projectRoot();
  const plugin = fakePlugin();
  const token = '${' + 'CLAUDE_PLUGIN_ROOT}';
  write(path.join(plugin, 'codex', 'supporting', 'agent-traps', '_common', 'prompt-defense.md'), [
    '# Codex copy',
    'Read .codex/dhpk/agent-traps/_common/prompt-defense.md',
    `Load ${token}/agent-traps/_common/prompt-defense.md`,
    '',
  ].join('\n'));
  write(path.join(plugin, 'cursor', 'dhpk', 'agent-traps', '_common', 'prompt-defense.md'), [
    '# Cursor copy',
    'Read .cursor/dhpk/agent-traps/_common/prompt-defense.md',
    '',
  ].join('\n'));
  const inventory = JSON.parse(fs.readFileSync(path.join(plugin, 'manifests', 'distribution-inventory.json'), 'utf8'));
  inventory.supporting_assets[0].source = 'codex/supporting/agent-traps/_common/prompt-defense.md';
  write(path.join(plugin, 'manifests', 'distribution-inventory.json'), `${JSON.stringify(inventory, null, 2)}\n`);
  try {
    const res = runInstaller(scratch, ['--copy', '--force'], plugin);
    assert.strictEqual(res.status, 0, `${res.stdout}\n${res.stderr}`);
    const installed = fs.readFileSync(path.join(scratch, '.cursor', 'dhpk', 'agent-traps', '_common', 'prompt-defense.md'), 'utf8');
    assert.match(installed, /Cursor copy/);
    assert.match(installed, /\.cursor\/dhpk\/agent-traps\/_common\/prompt-defense\.md/);
    assert.ok(!installed.includes('.codex/dhpk'));
    assert.ok(!installed.includes(token));
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(plugin, { recursive: true, force: true });
  }
});

test('symlink mode links the projection and --update preserves edited copied content', () => {
  const scratch = projectRoot();
  const plugin = fakePlugin();
  try {
    const linked = runInstaller(scratch, ['--force'], plugin);
    assert.strictEqual(linked.status, 0, `${linked.stdout}\n${linked.stderr}`);
    assert.ok(fs.lstatSync(path.join(scratch, '.cursor', 'skills', 'dhpk-portable')).isSymbolicLink());

    const copied = runInstaller(scratch, ['--copy', '--force'], plugin);
    assert.strictEqual(copied.status, 0, `${copied.stdout}\n${copied.stderr}`);
    const edited = path.join(scratch, '.cursor', 'skills', 'dhpk-portable', 'SKILL.md');
    fs.appendFileSync(edited, '\nuser edit\n');
    const updated = runInstaller(scratch, ['--copy', '--update', '--force'], plugin);
    assert.strictEqual(updated.status, 0, `${updated.stdout}\n${updated.stderr}`);
    assert.match(fs.readFileSync(edited, 'utf8'), /user edit/);
    assert.match(`${updated.stdout}\n${updated.stderr}`, /collision|orphaned|preserved/i);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(plugin, { recursive: true, force: true });
  }
});

test('unowned collisions are preserved; --plan --json then --adopt promotes one path', () => {
  const scratch = projectRoot();
  const plugin = fakePlugin();
  try {
    const first = runInstaller(scratch, ['--copy', '--force'], plugin);
    assert.strictEqual(first.status, 0, `${first.stdout}\n${first.stderr}`);
    const receiptPath = path.join(scratch, '.cursor', '.dhpk-installed.json');
    const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    delete receipt.managed_entries.skills['dhpk-portable'];
    fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
    const target = path.join(scratch, '.cursor', 'skills', 'dhpk-portable');
    fs.writeFileSync(path.join(target, 'user-owned.txt'), 'keep me\n');

    const planned = runInstaller(scratch, ['--copy', '--update', '--plan', '--json', '--force'], plugin);
    assert.notStrictEqual(planned.status, 0, `${planned.stdout}\n${planned.stderr}`);
    const report = JSON.parse(planned.stdout);
    const collision = report.collisions.find((entry) => entry.path === 'skills/dhpk-portable');
    assert.ok(collision, planned.stdout);
    assert.strictEqual(fs.readFileSync(path.join(target, 'user-owned.txt'), 'utf8'), 'keep me\n');

    const adopted = runInstaller(scratch, [
      '--update',
      `--adopt=skills/dhpk-portable@${collision.destination_fingerprint}@${collision.source_fingerprint}`,
      '--force',
    ], plugin);
    assert.strictEqual(adopted.status, 0, `${adopted.stdout}\n${adopted.stderr}`);
    const after = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    assert.ok(after.managed_entries.skills['dhpk-portable']);
    assert.ok(!fs.existsSync(path.join(target, 'user-owned.txt')));
    assert.ok(after.reconciliation.adopted >= 1, JSON.stringify(after.reconciliation));
    const backup = after.reconciliation.evidence.backups.find((item) => item.original === 'skills/dhpk-portable');
    assert.ok(backup, JSON.stringify(after.reconciliation.evidence.backups));
    assert.ok(fs.existsSync(path.join(scratch, backup.path, 'user-owned.txt')));
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(plugin, { recursive: true, force: true });
  }
});

test('--uninstall removes unchanged owned entries and leaves unowned files and hooks.json alone', () => {
  const scratch = projectRoot();
  const plugin = fakePlugin();
  try {
    const first = runInstaller(scratch, ['--copy', '--force'], plugin);
    assert.strictEqual(first.status, 0, `${first.stdout}\n${first.stderr}`);
    const hooks = path.join(scratch, '.cursor', 'hooks.json');
    fs.writeFileSync(hooks, '{"hooks":{"afterFileEdit":[]}}\n');
    const unrelated = path.join(scratch, '.cursor', 'skills', 'unrelated');
    fs.mkdirSync(unrelated, { recursive: true });
    fs.writeFileSync(path.join(unrelated, 'keep.txt'), 'keep\n');
    const removed = runInstaller(scratch, ['--uninstall', '--force'], plugin);
    assert.strictEqual(removed.status, 0, `${removed.stdout}\n${removed.stderr}`);
    assert.ok(!fs.existsSync(path.join(scratch, '.cursor', 'skills', 'dhpk-portable')));
    assert.ok(fs.existsSync(path.join(unrelated, 'keep.txt')));
    assert.strictEqual(fs.readFileSync(hooks, 'utf8'), '{"hooks":{"afterFileEdit":[]}}\n');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(plugin, { recursive: true, force: true });
  }
});

test('project-root heuristic requires a project marker unless --force is passed', () => {
  const empty = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-ich-empty-')));
  const plugin = fakePlugin();
  try {
    const blocked = runInstaller(empty, [], plugin);
    assert.notStrictEqual(blocked.status, 0);
    assert.match(`${blocked.stdout}\n${blocked.stderr}`, /does not look like a project root/);
    const forced = runInstaller(empty, ['--force'], plugin);
    assert.strictEqual(forced.status, 0, `${forced.stdout}\n${forced.stderr}`);
    const marked = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-ich-marked-')));
    try {
      fs.mkdirSync(path.join(marked, '.cursor'));
      const allowed = runInstaller(marked, ['--copy'], plugin);
      assert.strictEqual(allowed.status, 0, `${allowed.stdout}\n${allowed.stderr}`);
    } finally {
      fs.rmSync(marked, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(empty, { recursive: true, force: true });
    fs.rmSync(plugin, { recursive: true, force: true });
  }
});

test('--plan --json warns when marketplace hash cache version drifts from local packages', () => {
  const scratch = projectRoot();
  const plugin = fakePlugin();
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-ich-home-')));
  try {
    write(path.join(home, '.cursor', 'plugins', 'cache', 'dhpk', 'dhpk', 'deadbeefcafe', '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'dhpk', version: '0.38.2' }));
    write(path.join(home, '.cursor', 'plugins', 'local', 'dhpk-agent', 'plugin.json'), JSON.stringify({ name: 'dhpk', version: '9.9.9' }));
    write(path.join(home, '.cursor', 'plugins', 'local', 'dhpk-cursor', '.cursor-plugin', 'plugin.json'), JSON.stringify({ name: 'dhpk', version: '9.9.9' }));
    const first = runInstaller(scratch, ['--copy', '--force'], plugin, { HOME: home });
    assert.strictEqual(first.status, 0, `${first.stdout}\n${first.stderr}`);
    const planned = runInstaller(scratch, ['--update', '--plan', '--json', '--force'], plugin, { HOME: home });
    const report = JSON.parse(planned.stdout);
    const warning = (report.warnings || []).find((entry) => entry.code === 'cursor_marketplace_hash_cache_drift');
    assert.ok(warning, planned.stdout);
    assert.strictEqual(warning.cache_version, '0.38.2');
    assert.ok((warning.ssot_versions || []).includes('9.9.9'), JSON.stringify(warning));
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(plugin, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('--plan --json does not warn when hash cache version matches local packages', () => {
  const scratch = projectRoot();
  const plugin = fakePlugin();
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-ich-home-match-')));
  try {
    write(path.join(home, '.cursor', 'plugins', 'cache', 'dhpk', 'dhpk', 'cafebabe0001', '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'dhpk', version: '9.9.9' }));
    write(path.join(home, '.cursor', 'plugins', 'local', 'dhpk-agent', 'plugin.json'), JSON.stringify({ name: 'dhpk', version: '9.9.9' }));
    const first = runInstaller(scratch, ['--copy', '--force'], plugin, { HOME: home });
    assert.strictEqual(first.status, 0, `${first.stdout}\n${first.stderr}`);
    const planned = runInstaller(scratch, ['--update', '--plan', '--json', '--force'], plugin, { HOME: home });
    const report = JSON.parse(planned.stdout);
    const warning = (report.warnings || []).find((entry) => entry.code === 'cursor_marketplace_hash_cache_drift');
    assert.ok(!warning, JSON.stringify(report.warnings || []));
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(plugin, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

run('install-cursor-harness');
