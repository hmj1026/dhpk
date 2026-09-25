'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const {
  runInstaller: runCodexInstaller,
  projectRoot,
  completeTreeFingerprint,
} = require('./_lib/install-codex-skills-fixtures');

const REPO = path.join(__dirname, '..');
const CURSOR_HOOK = path.join(REPO, 'scripts', 'hooks', 'install-cursor-harness.sh');

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function skillBody(name, heading) {
  return `---\nname: ${name}\ndescription: ${heading}\n---\n# ${heading}\n`;
}

function fakePlugin() {
  const plugin = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-ics-shared-plugin-')));
  write(path.join(plugin, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'dhpk', version: '9.9.9' }));
  write(path.join(plugin, 'skills', 'dhpk-portable', 'SKILL.md'), skillBody('dhpk-portable', 'Portable'));
  write(path.join(plugin, 'skills', 'dhpk-codex-only', 'SKILL.md'), skillBody('dhpk-codex-only', 'Codex only'));
  write(path.join(plugin, 'cursor', 'skills', 'dhpk-portable', 'SKILL.md'), skillBody('dhpk-portable', 'Portable'));
  write(path.join(plugin, 'cursor', 'agents', 'reviewer.md'), '---\nname: reviewer\ndescription: review\nmodel: inherit\nreadonly: true\n---\n# Reviewer\n');
  write(path.join(plugin, 'cursor', 'rules', 'prefer-const.mdc'), '---\nname: prefer-const\ndescription: prefer const\nalwaysApply: false\n---\n# Prefer const\n');
  write(path.join(plugin, 'cursor', 'commands', 'review.md'), '---\nname: review\ndescription: review command\n---\n# Review\n');
  write(path.join(plugin, 'codex', 'skills', 'dhpk-codex-only', 'SKILL.md'), skillBody('dhpk-codex-only', 'Codex only'));
  write(path.join(plugin, 'codex', 'agents', 'explorer.toml'), 'name = "explorer"\ndescription = "explore"\n');
  write(path.join(plugin, 'codex', 'rules', 'prefer-const.md'), '# Prefer const\n');
  write(path.join(plugin, 'agent-traps', '_common', 'prompt-defense.md'), '# defense\n');
  write(path.join(plugin, 'cursor', 'config.toml.example'), 'model = "fixture"\n');
  write(path.join(plugin, 'codex', 'config.toml.example'), 'model = "fixture"\n');
  write(path.join(plugin, 'manifests', 'distribution-inventory.json'), `${JSON.stringify({
    skills: [
      {
        id: 'portable',
        name: 'dhpk-portable',
        path: 'skills/dhpk-portable',
        lifecycle: 'promoted',
        surfaces: ['cursor-sync', 'cursor-plugin'],
        legacy_names: [],
      },
      {
        id: 'codex-only',
        name: 'dhpk-codex-only',
        path: 'skills/dhpk-codex-only',
        lifecycle: 'promoted',
        surfaces: ['codex-sync', 'codex-native'],
        legacy_names: [],
      },
    ],
    supporting_assets: [
      {
        id: 'cursor-trap',
        source: 'agent-traps/_common/prompt-defense.md',
        destination: 'dhpk/agent-traps/_common/prompt-defense.md',
      },
      {
        id: 'codex-config',
        source: 'codex/config.toml.example',
        destination: 'config.toml.example',
      },
    ],
    project_agent_projection: {
      schema: 'dhpk.project-agent-projection.v1',
      scope: 'project',
      owner: 'dhpk.project-agent-projection',
      managed_root: '.agents/skills',
      receipt: '.agents/.dhpk-installed.json',
      profiles: {
        'portable-core': {
          version: 'portable-core-v1',
          compatibility_mode: 'portable-core',
          stable_ids: ['codex-only', 'portable'],
          hosts: ['agy', 'claude', 'codex', 'cursor'],
        },
      },
      hosts: {
        claude: {
          surface: 'claude-core',
          evidence_source: 'entry_surfaces',
          shape: 'project-skill-directory',
          transform: { id: 'claude-project-skill', version: '1' },
        },
        codex: {
          surface: 'codex-sync',
          evidence_source: 'entry_surfaces',
          shape: 'project-skill-directory',
          transform: { id: 'codex-project-skill', version: '1' },
        },
        cursor: {
          surface: 'cursor-plugin',
          evidence_source: 'entry_surfaces',
          shape: 'project-skill-directory',
          transform: { id: 'cursor-project-skill', version: '1' },
        },
        agy: {
          surface: 'agy-plugin',
          evidence_source: 'entry_surfaces',
          shape: 'project-skill-direct-file',
          transform: { id: 'agy-project-direct-file', version: '1' },
        },
      },
      dependencies: {},
    },
  }, null, 2)}\n`);
  write(path.join(plugin, 'manifests', 'profile-projection-sets.json'), `${JSON.stringify({
    schema: 'dhpk.profile-projection-sets.v1',
    hostSurfaces: { cursor: 'cursor-sync', 'codex-sync': 'codex-sync' },
    profiles: {
      minimal: { cursor: ['portable'], 'codex-sync': ['codex-only'] },
      'compat-v1': { cursor: ['portable'], 'codex-sync': ['codex-only'] },
    },
  }, null, 2)}\n`);
  return plugin;
}

function runCursorInstaller(project, args, pluginRoot, extraEnv) {
  return spawnSync('bash', [CURSOR_HOOK, ...args], {
    cwd: project,
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: pluginRoot, ...(extraEnv || {}) },
    encoding: 'utf8',
    timeout: 20000,
  });
}

function writeCodexEvidence(dir, status) {
  const file = path.join(dir, 'codex-consumer-evidence.json');
  write(file, `${JSON.stringify({
    stage: 'CONSUMER',
    producer: 'consumer-platform-probe',
    adapter: { id: 'codex-project-discovery', version: '1.0.0' },
    surfaceResults: [{
      surface: 'codex-project',
      status,
      adapter: { id: 'codex-project-discovery', version: '1.0.0' },
      commands: [{
        cmd: 'node scripts/release/consumer-platform-probe.js --platform codex-project',
        exitCode: status === 'PASS' ? 0 : 1,
      }],
      environment: { CI: 'true', DHPK_CONSUMER_PROBE_NETWORK: 'disabled' },
      artifacts: [],
      diagnostics: [],
      reasons: [status === 'PASS' ? 'bounded Codex project probe PASS' : 'Codex project probe failed'],
      checkedClaims: ['project-artifact-structure', 'codex-project-discovery', 'consumer-route'],
    }],
  })}\n`);
  return file;
}

function skillEntries(root) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root).sort();
}

function assertOnlySymlinks(skillsRoot) {
  for (const name of skillEntries(skillsRoot)) {
    const entry = path.join(skillsRoot, name);
    assert.ok(fs.lstatSync(entry).isSymbolicLink(), `${name} must be a native-link, not a copied directory`);
  }
}

test('fresh Codex install delegates declared skills via native-link and keeps native agents', () => {
  const scratch = projectRoot();
  const plugin = fakePlugin();
  try {
    const res = runCodexInstaller(scratch, ['--copy', '--force'], plugin);
    assert.strictEqual(res.status, 0, `${res.stdout}\n${res.stderr}`);
    const shared = path.join(scratch, '.agents', 'skills', 'dhpk-codex-only');
    const nativeSkill = path.join(scratch, '.codex', 'skills', 'dhpk-codex-only');
    assert.ok(fs.existsSync(path.join(shared, 'SKILL.md')));
    assert.ok(!fs.lstatSync(shared).isSymbolicLink());
    assert.ok(fs.lstatSync(nativeSkill).isSymbolicLink());
    assert.strictEqual(fs.readlinkSync(nativeSkill), '../../.agents/skills/dhpk-codex-only');
    assert.ok(!fs.existsSync(path.join(scratch, '.codex', 'skills', 'dhpk-portable')));
    assertOnlySymlinks(path.join(scratch, '.codex', 'skills'));
    assert.ok(fs.existsSync(path.join(scratch, '.codex', 'agents', 'explorer.toml')));
    const receipt = JSON.parse(fs.readFileSync(path.join(scratch, '.codex', '.dhpk-installed.json'), 'utf8'));
    assert.ok(!receipt.managed_entries.skills || !receipt.managed_entries.skills['dhpk-codex-only']);
    const projection = JSON.parse(fs.readFileSync(path.join(scratch, '.agents', '.dhpk-installed.json'), 'utf8'));
    assert.strictEqual(projection.hostBindings.codex.bindingShape, 'native-link');
    assert.deepStrictEqual(projection.hostBindings.codex.selectedStableIds, ['codex-only']);
    const rerun = runCodexInstaller(scratch, ['--copy', '--force'], plugin);
    assert.strictEqual(rerun.status, 0, `${rerun.stdout}\n${rerun.stderr}`);
    assert.match(rerun.stdout + rerun.stderr, /already up-to-date/);
    const again = JSON.parse(fs.readFileSync(path.join(scratch, '.agents', '.dhpk-installed.json'), 'utf8'));
    assert.deepStrictEqual(again.hostBindings.codex, projection.hostBindings.codex);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(plugin, { recursive: true, force: true });
  }
});

test('injected Codex discovery PASS binds declared skills as direct Host Bindings', () => {
  const scratch = projectRoot();
  const plugin = fakePlugin();
  try {
    const evidence = writeCodexEvidence(scratch, 'PASS');
    const res = runCodexInstaller(scratch, ['--copy', '--force'], plugin, {
      DHPK_CODEX_CONSUMER_EVIDENCE: evidence,
    });
    assert.strictEqual(res.status, 0, `${res.stdout}\n${res.stderr}`);
    assert.ok(fs.existsSync(path.join(scratch, '.agents', 'skills', 'dhpk-codex-only', 'SKILL.md')));
    assert.ok(!fs.existsSync(path.join(scratch, '.codex', 'skills', 'dhpk-codex-only')));
    const projection = JSON.parse(fs.readFileSync(path.join(scratch, '.agents', '.dhpk-installed.json'), 'utf8'));
    assert.strictEqual(projection.hostBindings.codex.bindingShape, 'direct');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(plugin, { recursive: true, force: true });
  }
});

test('Cursor then Codex unions shared skills and leaves the first Host bindings unchanged', () => {
  const scratch = projectRoot();
  const plugin = fakePlugin();
  try {
    const cursor = runCursorInstaller(scratch, ['--copy', '--force'], plugin);
    assert.strictEqual(cursor.status, 0, `${cursor.stdout}\n${cursor.stderr}`);
    const before = JSON.parse(fs.readFileSync(path.join(scratch, '.agents', '.dhpk-installed.json'), 'utf8'));
    const cursorBindings = JSON.parse(JSON.stringify(before.hostBindings.cursor));
    const cursorPaths = JSON.parse(JSON.stringify(before.bindingPaths.cursor));
    const codex = runCodexInstaller(scratch, ['--copy', '--force'], plugin);
    assert.strictEqual(codex.status, 0, `${codex.stdout}\n${codex.stderr}`);
    assert.ok(fs.existsSync(path.join(scratch, '.agents', 'skills', 'dhpk-portable', 'SKILL.md')));
    assert.ok(fs.existsSync(path.join(scratch, '.agents', 'skills', 'dhpk-codex-only', 'SKILL.md')));
    assert.ok(fs.lstatSync(path.join(scratch, '.cursor', 'skills', 'dhpk-portable')).isSymbolicLink());
    assert.ok(fs.lstatSync(path.join(scratch, '.codex', 'skills', 'dhpk-codex-only')).isSymbolicLink());
    assert.ok(!fs.existsSync(path.join(scratch, '.cursor', 'skills', 'dhpk-codex-only')));
    assert.ok(!fs.existsSync(path.join(scratch, '.codex', 'skills', 'dhpk-portable')));
    const after = JSON.parse(fs.readFileSync(path.join(scratch, '.agents', '.dhpk-installed.json'), 'utf8'));
    assert.deepStrictEqual(after.hostBindings.cursor, cursorBindings);
    assert.deepStrictEqual(after.bindingPaths.cursor, cursorPaths);
    assert.deepStrictEqual(after.hostBindings.codex.selectedStableIds, ['codex-only']);
    const again = runCodexInstaller(scratch, ['--copy', '--force'], plugin);
    assert.strictEqual(again.status, 0, `${again.stdout}\n${again.stderr}`);
    const rerun = JSON.parse(fs.readFileSync(path.join(scratch, '.agents', '.dhpk-installed.json'), 'utf8'));
    assert.deepStrictEqual(rerun.hostBindings.cursor, cursorBindings);
    assert.deepStrictEqual(rerun.hostBindings.codex.selectedStableIds, ['codex-only']);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(plugin, { recursive: true, force: true });
  }
});

test('Codex --plan sees declared shared-skill source drift without --update', () => {
  const scratch = projectRoot();
  const plugin = fakePlugin();
  try {
    const first = runCodexInstaller(scratch, ['--copy', '--force'], plugin);
    assert.strictEqual(first.status, 0, `${first.stdout}\n${first.stderr}`);
    const current = runCodexInstaller(scratch, ['--copy', '--force', '--plan', '--json'], plugin);
    assert.strictEqual(current.status, 0, `${current.stdout}\n${current.stderr}`);
    assert.strictEqual(JSON.parse(current.stdout).state, 'current');
    fs.writeFileSync(
      path.join(plugin, 'skills', 'dhpk-codex-only', 'SKILL.md'),
      skillBody('dhpk-codex-only', 'Codex only edited'),
    );
    const planned = runCodexInstaller(scratch, ['--copy', '--force', '--plan', '--json'], plugin);
    assert.notStrictEqual(planned.status, 0, `${planned.stdout}\n${planned.stderr}`);
    const report = JSON.parse(planned.stdout);
    assert.notStrictEqual(report.state, 'current');
    assert.match((report.reasons || []).join('\n'), /source fingerprint/);
    const unchanged = runCodexInstaller(scratch, ['--copy', '--force'], plugin);
    assert.notStrictEqual(unchanged.status, 0, `${unchanged.stdout}\n${unchanged.stderr}`);
    assert.match(`${unchanged.stdout}\n${unchanged.stderr}`, /SOURCE_DRIFT|explicit update authority|source fingerprint/);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(plugin, { recursive: true, force: true });
  }
});

test('receipt-owned native Codex skill copies stay until --update', () => {
  const scratch = projectRoot();
  const plugin = fakePlugin();
  try {
    const first = runCodexInstaller(scratch, ['--copy', '--force'], plugin);
    assert.strictEqual(first.status, 0, `${first.stdout}\n${first.stderr}`);
    const nativeSkill = path.join(scratch, '.codex', 'skills', 'dhpk-codex-only');
    fs.rmSync(path.join(scratch, '.agents'), { recursive: true, force: true });
    fs.rmSync(nativeSkill, { recursive: true, force: true });
    fs.cpSync(path.join(plugin, 'skills', 'dhpk-codex-only'), nativeSkill, { recursive: true });
    const receiptPath = path.join(scratch, '.codex', '.dhpk-installed.json');
    const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    const fingerprint = completeTreeFingerprint(nativeSkill);
    receipt.managed_entries.skills = receipt.managed_entries.skills || {};
    receipt.managed_entries.skills['dhpk-codex-only'] = {
      destination: 'skills/dhpk-codex-only',
      source: 'skills/dhpk-codex-only',
      mode: 'copy',
      source_fingerprint: fingerprint,
      destination_fingerprint: fingerprint,
      fingerprint,
      ownership_marker: 'copy:skills/dhpk-codex-only',
    };
    fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);

    const kept = runCodexInstaller(scratch, ['--copy', '--force'], plugin);
    assert.strictEqual(kept.status, 0, `${kept.stdout}\n${kept.stderr}`);
    assert.ok(!fs.lstatSync(nativeSkill).isSymbolicLink());
    assert.ok(fs.existsSync(path.join(nativeSkill, 'SKILL.md')));

    const updated = runCodexInstaller(scratch, ['--copy', '--update', '--force'], plugin);
    assert.strictEqual(updated.status, 0, `${updated.stdout}\n${updated.stderr}`);
    assert.ok(fs.lstatSync(nativeSkill).isSymbolicLink());
    assert.strictEqual(fs.readlinkSync(nativeSkill), '../../.agents/skills/dhpk-codex-only');
    const nextReceipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    assert.ok(!nextReceipt.managed_entries.skills || !nextReceipt.managed_entries.skills['dhpk-codex-only']);
    const projection = JSON.parse(fs.readFileSync(path.join(scratch, '.agents', '.dhpk-installed.json'), 'utf8'));
    assert.strictEqual(projection.hostBindings.codex.bindingShape, 'native-link');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(plugin, { recursive: true, force: true });
  }
});

test('uninstalling Cursor leaves Codex-bound shared skills and Codex native assets', () => {
  const scratch = projectRoot();
  const plugin = fakePlugin();
  try {
    const cursor = runCursorInstaller(scratch, ['--copy', '--force'], plugin);
    assert.strictEqual(cursor.status, 0, `${cursor.stdout}\n${cursor.stderr}`);
    const codex = runCodexInstaller(scratch, ['--copy', '--force'], plugin);
    assert.strictEqual(codex.status, 0, `${codex.stdout}\n${codex.stderr}`);
    write(path.join(scratch, '.agents', 'skills', 'foreign', 'keep.md'), '# keep\n');
    write(path.join(scratch, '.cursor', 'skills', 'unrelated', 'keep.txt'), 'keep\n');
    const removed = runCursorInstaller(scratch, ['--uninstall', '--force'], plugin);
    assert.strictEqual(removed.status, 0, `${removed.stdout}\n${removed.stderr}`);
    assert.ok(!fs.existsSync(path.join(scratch, '.cursor', 'skills', 'dhpk-portable')));
    assert.ok(!fs.existsSync(path.join(scratch, '.agents', 'skills', 'dhpk-portable', 'SKILL.md')));
    assert.ok(!fs.existsSync(path.join(scratch, '.cursor', 'agents', 'reviewer.md')));
    assert.ok(fs.existsSync(path.join(scratch, '.cursor', 'skills', 'unrelated', 'keep.txt')));
    assert.ok(fs.existsSync(path.join(scratch, '.agents', 'skills', 'dhpk-codex-only', 'SKILL.md')));
    assert.ok(fs.lstatSync(path.join(scratch, '.codex', 'skills', 'dhpk-codex-only')).isSymbolicLink());
    assert.ok(fs.existsSync(path.join(scratch, '.codex', 'agents', 'explorer.toml')));
    assert.strictEqual(fs.readFileSync(path.join(scratch, '.agents', 'skills', 'foreign', 'keep.md'), 'utf8'), '# keep\n');
    const projection = JSON.parse(fs.readFileSync(path.join(scratch, '.agents', '.dhpk-installed.json'), 'utf8'));
    assert.strictEqual(projection.hostBindings.cursor, undefined);
    assert.deepStrictEqual(projection.hostBindings.codex.selectedStableIds, ['codex-only']);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(plugin, { recursive: true, force: true });
  }
});

test('uninstalling the last Host removes shared skills and leaves unowned files', () => {
  const scratch = projectRoot();
  const plugin = fakePlugin();
  try {
    const first = runCodexInstaller(scratch, ['--copy', '--force'], plugin);
    assert.strictEqual(first.status, 0, `${first.stdout}\n${first.stderr}`);
    write(path.join(scratch, '.agents', 'skills', 'foreign', 'keep.md'), '# keep\n');
    write(path.join(scratch, '.codex', 'skills', 'unrelated', 'keep.txt'), 'keep\n');
    const removed = runCodexInstaller(scratch, ['--uninstall', '--force'], plugin);
    assert.strictEqual(removed.status, 0, `${removed.stdout}\n${removed.stderr}`);
    assert.ok(!fs.existsSync(path.join(scratch, '.codex', 'skills', 'dhpk-codex-only')));
    assert.ok(!fs.existsSync(path.join(scratch, '.agents', 'skills', 'dhpk-codex-only', 'SKILL.md')));
    assert.ok(!fs.existsSync(path.join(scratch, '.agents', '.dhpk-installed.json')));
    assert.ok(!fs.existsSync(path.join(scratch, '.codex', 'agents', 'explorer.toml')));
    assert.strictEqual(fs.readFileSync(path.join(scratch, '.agents', 'skills', 'foreign', 'keep.md'), 'utf8'), '# keep\n');
    assert.ok(fs.existsSync(path.join(scratch, '.codex', 'skills', 'unrelated', 'keep.txt')));
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(plugin, { recursive: true, force: true });
  }
});

run('install-codex-sync-shared');
