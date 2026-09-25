'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const REPO = path.join(__dirname, '..');
const HOOK = path.join(REPO, 'scripts', 'hooks', 'install-cursor-harness.sh');
const INVENTORY = JSON.parse(
  fs.readFileSync(path.join(REPO, 'manifests', 'distribution-inventory.json'), 'utf8'),
);
const SKILL_REF_RE = /skills\/([A-Za-z0-9._-]+)\//g;
const ROOT_INSTALL_TIMEOUT_MS = 60_000;

function projectRoot() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-ich-project-')));
  fs.mkdirSync(path.join(dir, '.git'));
  return dir;
}

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function cursorDiscoveryEvidence(status, extra = {}) {
  return {
    stage: 'CONSUMER',
    producer: 'consumer-platform-probe',
    adapter: { id: 'cursor-project-discovery', version: '1.0.0' },
    surfaceResults: [{
      surface: 'cursor-project',
      status,
      adapter: { id: 'cursor-project-discovery', version: '1.0.0' },
      commands: [{
        cmd: 'node scripts/release/consumer-platform-probe.js --platform cursor-project',
        exitCode: status === 'PASS' ? 0 : 1,
      }],
      environment: { CI: 'true', DHPK_CONSUMER_PROBE_NETWORK: 'disabled' },
      artifacts: [],
      diagnostics: [],
      reasons: extra.reasons || [status === 'PASS'
        ? 'bounded Cursor project probe PASS'
        : 'Cursor project probe failed'],
      checkedClaims: ['project-artifact-structure', 'cursor-project-discovery', 'consumer-route'],
    }],
  };
}

function writeCursorEvidence(dir, record) {
  const file = path.join(dir, 'cursor-consumer-evidence.json');
  write(file, `${JSON.stringify(record)}\n`);
  return file;
}

function fakePlugin() {
  const plugin = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-ich-plugin-')));
  write(path.join(plugin, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'dhpk', version: '9.9.9' }));
  write(path.join(plugin, 'skills', 'dhpk-portable', 'SKILL.md'), '---\nname: dhpk-portable\ndescription: portable\n---\n# Portable\n');
  write(path.join(plugin, 'cursor', 'skills', 'dhpk-portable', 'SKILL.md'), '---\nname: dhpk-portable\ndescription: portable\n---\n# Portable\n');
  write(path.join(plugin, 'cursor', 'agents', 'reviewer.md'), '---\nname: reviewer\ndescription: review\nmodel: inherit\nreadonly: true\n---\n# Reviewer\n');
  write(path.join(plugin, 'cursor', 'rules', 'prefer-const.mdc'), '---\nname: prefer-const\ndescription: prefer const\nalwaysApply: false\n---\n# Prefer const\n');
  write(path.join(plugin, 'cursor', 'commands', 'review.md'), '---\nname: review\ndescription: review command\n---\n# Review\n');
  write(path.join(plugin, 'agent-traps', '_common', 'prompt-defense.md'), '# defense\n');
  write(path.join(plugin, 'cursor', 'config.toml.example'), 'model = "fixture"\n');
  write(path.join(plugin, 'manifests', 'distribution-inventory.json'), `${JSON.stringify({
    skills: [{
      id: 'portable',
      name: 'dhpk-portable',
      path: 'skills/dhpk-portable',
      lifecycle: 'promoted',
      surfaces: ['cursor-sync', 'cursor-plugin'],
      legacy_names: [],
    }],
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
          stable_ids: ['portable'],
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
    hostSurfaces: { cursor: 'cursor-sync' },
    profiles: {
      minimal: { cursor: ['portable'] },
    },
  }, null, 2)}\n`);
  return plugin;
}

function descriptorPseudoPathBlocker() {
  const shim = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-ich-fd-path-shim-')));
  fs.writeFileSync(path.join(shim, 'sitecustomize.py'), [
    'import os',
    'import re',
    '',
    '_dhpk_original_isdir = os.path.isdir',
    '',
    'def _dhpk_isdir(candidate):',
    '    try:',
    '        rendered = os.fspath(candidate)',
    '    except TypeError:',
    '        return _dhpk_original_isdir(candidate)',
    "    if isinstance(rendered, str) and re.fullmatch(r'/(?:proc/self/fd|dev/fd)/[0-9]+', rendered):",
    '        return False',
    '    return _dhpk_original_isdir(candidate)',
    '',
    'os.path.isdir = _dhpk_isdir',
    '',
  ].join('\n'));
  return shim;
}

function runInstaller(project, args, pluginRoot, extraEnv, timeoutMs) {
  return spawnSync('bash', [HOOK, ...args], {
    cwd: project,
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: pluginRoot, ...(extraEnv || {}) },
    encoding: 'utf8',
    timeout: timeoutMs || 20000,
  });
}

function skillTokenMap() {
  const tokens = new Map();
  for (const skill of INVENTORY.skills || []) {
    if (!skill || typeof skill.id !== 'string' || !skill.id) continue;
    tokens.set(skill.id, skill);
    if (typeof skill.name === 'string' && skill.name) tokens.set(skill.name, skill);
    if (typeof skill.path === 'string' && skill.path) {
      tokens.set(path.basename(skill.path.replace(/\/+$/, '')), skill);
    }
  }
  return tokens;
}

function referencedSkillIds(text) {
  const tokens = skillTokenMap();
  const ids = new Set();
  SKILL_REF_RE.lastIndex = 0;
  let match;
  while ((match = SKILL_REF_RE.exec(text))) {
    const skill = tokens.get(match[1]);
    if (skill) ids.add(skill.id);
  }
  return [...ids].sort();
}

function readProjectedText(target) {
  const stat = fs.lstatSync(target);
  if (stat.isSymbolicLink() || stat.isFile()) {
    return fs.readFileSync(target, 'utf8');
  }
  if (!stat.isDirectory()) return '';
  let text = '';
  for (const name of fs.readdirSync(target).sort()) {
    text += `\n${readProjectedText(path.join(target, name))}`;
  }
  return text;
}

function projectedSkillIds(projectDir) {
  const ids = new Set();
  const names = new Set();
  const cursorSkills = path.join(projectDir, '.cursor', 'skills');
  const sharedSkills = path.join(projectDir, '.agents', 'skills');
  for (const dir of [cursorSkills, sharedSkills]) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) names.add(name);
  }
  for (const skill of INVENTORY.skills || []) {
    if (skill && names.has(skill.name)) ids.add(skill.id);
  }
  return ids;
}

function assertProjectedDependencyClosure(projectDir) {
  const available = projectedSkillIds(projectDir);
  for (const kind of ['commands', 'agents']) {
    const dir = path.join(projectDir, '.cursor', kind);
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      const missing = referencedSkillIds(readProjectedText(path.join(dir, name)))
        .filter((id) => !available.has(id));
      assert.deepStrictEqual(
        missing,
        [],
        `${kind}/${name} references dhpk skills missing from the projected tree: ${missing.join(', ')}`,
      );
    }
  }
}

function hashCopiedFile(file) {
  const digest = crypto.createHash('sha256');
  digest.update('file\0');
  digest.update(fs.readFileSync(file));
  return digest.digest('hex');
}

function hashCopiedPath(target) {
  const stat = fs.lstatSync(target);
  if (stat.isFile()) return hashCopiedFile(target);
  const digest = crypto.createHash('sha256');
  digest.update('dir\0');
  for (const name of fs.readdirSync(target).sort()) {
    digest.update(name);
    digest.update('\0');
    digest.update(hashCopiedPath(path.join(target, name)));
    digest.update('\0');
  }
  return digest.digest('hex');
}

function copyDir(source, destination) {
  fs.mkdirSync(destination, { recursive: true });
  for (const name of fs.readdirSync(source)) {
    const from = path.join(source, name);
    const to = path.join(destination, name);
    if (fs.statSync(from).isDirectory()) copyDir(from, to);
    else fs.copyFileSync(from, to);
  }
}

function copyManagedEntry(receipt, kind, name, source, destination) {
  const fingerprint = hashCopiedFile(destination);
  const relative = `${kind}/${name}`;
  receipt.managed_entries[kind] = receipt.managed_entries[kind] || {};
  receipt.managed_entries[kind][name] = {
    destination: relative,
    source: relative,
    mode: 'copy',
    source_fingerprint: hashCopiedFile(source),
    destination_fingerprint: fingerprint,
    fingerprint,
    ownership_marker: `copy:${relative}`,
  };
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

test('copy mode materializes native assets and delegates skills via native-link bindings', () => {
  const scratch = projectRoot();
  const plugin = fakePlugin();
  try {
    const res = runInstaller(scratch, ['--copy', '--force'], plugin);
    assert.strictEqual(res.status, 0, `${res.stdout}\n${res.stderr}`);
    const cursor = path.join(scratch, '.cursor');
    const sharedSkill = path.join(scratch, '.agents', 'skills', 'dhpk-portable');
    const nativeSkill = path.join(cursor, 'skills', 'dhpk-portable');
    assert.ok(fs.existsSync(path.join(sharedSkill, 'SKILL.md')));
    assert.ok(!fs.lstatSync(sharedSkill).isSymbolicLink());
    assert.ok(fs.lstatSync(nativeSkill).isSymbolicLink());
    assert.strictEqual(fs.readlinkSync(nativeSkill), '../../.agents/skills/dhpk-portable');
    assert.ok(fs.existsSync(path.join(cursor, 'agents', 'reviewer.md')));
    assert.ok(fs.existsSync(path.join(cursor, 'rules', 'prefer-const.mdc')));
    assert.ok(fs.existsSync(path.join(cursor, 'commands', 'review.md')));
    assert.ok(fs.existsSync(path.join(cursor, 'dhpk', 'agent-traps', '_common', 'prompt-defense.md')));
    assert.ok(!fs.existsSync(path.join(cursor, 'config.toml.example')));
    assert.ok(!fs.existsSync(path.join(cursor, 'hooks.json')));
    const receipt = JSON.parse(fs.readFileSync(path.join(cursor, '.dhpk-installed.json'), 'utf8'));
    assert.strictEqual(receipt.schema_version, 3);
    assert.strictEqual(receipt.mode, 'copy');
    assert.ok(!receipt.managed_entries.skills || !receipt.managed_entries.skills['dhpk-portable']);
    assert.ok(receipt.managed_entries.rules['prefer-const.mdc']);
    assert.ok(receipt.managed_entries.commands['review.md']);
    assert.ok(receipt.managed_entries.supporting_assets['dhpk/agent-traps/_common/prompt-defense.md']);
    assert.ok(!receipt.managed_entries.supporting_assets['config.toml.example']);
    const projection = JSON.parse(fs.readFileSync(path.join(scratch, '.agents', '.dhpk-installed.json'), 'utf8'));
    assert.strictEqual(projection.hostBindings.cursor.bindingShape, 'native-link');
    const binding = (projection.hostBindings.cursor.bindings || []).find((entry) => entry.stableId === 'portable');
    assert.ok(binding, JSON.stringify(projection.hostBindings.cursor));
    assert.strictEqual(binding.shape, 'native-link');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(plugin, { recursive: true, force: true });
  }
});

test('copy and symlink installs do not require descriptor pseudo-path child traversal', () => {
  for (const args of [['--copy', '--force'], ['--force']]) {
    const scratch = projectRoot();
    const plugin = fakePlugin();
    const shim = descriptorPseudoPathBlocker();
    try {
      const pythonPath = [shim, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter);
      const result = runInstaller(scratch, args, plugin, { PYTHONPATH: pythonPath });
      assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
      const cursor = path.join(scratch, '.cursor');
      const receipt = JSON.parse(fs.readFileSync(path.join(cursor, '.dhpk-installed.json'), 'utf8'));
      const skill = path.join(cursor, 'skills', 'dhpk-portable');
      assert.strictEqual(receipt.mode, args.includes('--copy') ? 'copy' : 'symlink');
      assert.ok(fs.lstatSync(skill).isSymbolicLink());
      assert.strictEqual(fs.readlinkSync(skill), '../../.agents/skills/dhpk-portable');
      assert.match(fs.readFileSync(path.join(skill, 'SKILL.md'), 'utf8'), /# Portable/);
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
      fs.rmSync(plugin, { recursive: true, force: true });
      fs.rmSync(shim, { recursive: true, force: true });
    }
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

test('native-link cursor skills stay linked on --update and user-owned skills stay untouched', () => {
  const scratch = projectRoot();
  const plugin = fakePlugin();
  try {
    const linked = runInstaller(scratch, ['--force'], plugin);
    assert.strictEqual(linked.status, 0, `${linked.stdout}\n${linked.stderr}`);
    const nativeSkill = path.join(scratch, '.cursor', 'skills', 'dhpk-portable');
    assert.ok(fs.lstatSync(nativeSkill).isSymbolicLink());
    const userSkill = path.join(scratch, '.cursor', 'skills', 'my-own-skill');
    fs.mkdirSync(userSkill, { recursive: true });
    fs.writeFileSync(path.join(userSkill, 'SKILL.md'), '# mine\n');

    const updated = runInstaller(scratch, ['--copy', '--update', '--force'], plugin);
    assert.strictEqual(updated.status, 0, `${updated.stdout}\n${updated.stderr}`);
    assert.ok(fs.lstatSync(nativeSkill).isSymbolicLink());
    assert.strictEqual(fs.readFileSync(path.join(userSkill, 'SKILL.md'), 'utf8'), '# mine\n');
    const rerun = runInstaller(scratch, ['--copy', '--force'], plugin);
    assert.strictEqual(rerun.status, 0, `${rerun.stdout}\n${rerun.stderr}`);
    assert.strictEqual(fs.readFileSync(path.join(userSkill, 'SKILL.md'), 'utf8'), '# mine\n');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(plugin, { recursive: true, force: true });
  }
});

test('copy-mode --update replaces unchanged receipt-owned native skills with native-link bindings', () => {
  const scratch = projectRoot();
  const plugin = fakePlugin();
  try {
    const first = runInstaller(scratch, ['--copy', '--force'], plugin);
    assert.strictEqual(first.status, 0, `${first.stdout}\n${first.stderr}`);
    const nativeSkill = path.join(scratch, '.cursor', 'skills', 'dhpk-portable');
    fs.rmSync(path.join(scratch, '.agents'), { recursive: true, force: true });
    fs.rmSync(nativeSkill, { recursive: true, force: true });
    copyDir(path.join(plugin, 'skills', 'dhpk-portable'), nativeSkill);
    const receiptPath = path.join(scratch, '.cursor', '.dhpk-installed.json');
    const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    const fingerprint = hashCopiedPath(nativeSkill);
    receipt.managed_entries.skills = receipt.managed_entries.skills || {};
    receipt.managed_entries.skills['dhpk-portable'] = {
      destination: 'skills/dhpk-portable',
      source: 'skills/dhpk-portable',
      mode: 'copy',
      source_fingerprint: fingerprint,
      destination_fingerprint: fingerprint,
      fingerprint,
      ownership_marker: 'copy:skills/dhpk-portable',
    };
    fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);

    const updated = runInstaller(scratch, ['--copy', '--update', '--force'], plugin);
    assert.strictEqual(updated.status, 0, `${updated.stdout}\n${updated.stderr}`);
    assert.ok(fs.lstatSync(nativeSkill).isSymbolicLink());
    assert.strictEqual(fs.readlinkSync(nativeSkill), '../../.agents/skills/dhpk-portable');
    const nextReceipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    assert.ok(!nextReceipt.managed_entries.skills || !nextReceipt.managed_entries.skills['dhpk-portable']);
    const projection = JSON.parse(fs.readFileSync(path.join(scratch, '.agents', '.dhpk-installed.json'), 'utf8'));
    assert.strictEqual(projection.hostBindings.cursor.bindingShape, 'native-link');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(plugin, { recursive: true, force: true });
  }
});

test('--update --adopt of a rule still replaces unchanged receipt-owned native skills with native-link bindings', () => {
  const scratch = projectRoot();
  const plugin = fakePlugin();
  try {
    const first = runInstaller(scratch, ['--copy', '--force'], plugin);
    assert.strictEqual(first.status, 0, `${first.stdout}\n${first.stderr}`);
    const nativeSkill = path.join(scratch, '.cursor', 'skills', 'dhpk-portable');
    fs.rmSync(path.join(scratch, '.agents'), { recursive: true, force: true });
    fs.rmSync(nativeSkill, { recursive: true, force: true });
    copyDir(path.join(plugin, 'skills', 'dhpk-portable'), nativeSkill);
    const receiptPath = path.join(scratch, '.cursor', '.dhpk-installed.json');
    const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    const fingerprint = hashCopiedPath(nativeSkill);
    receipt.managed_entries.skills = receipt.managed_entries.skills || {};
    receipt.managed_entries.skills['dhpk-portable'] = {
      destination: 'skills/dhpk-portable',
      source: 'skills/dhpk-portable',
      mode: 'copy',
      source_fingerprint: fingerprint,
      destination_fingerprint: fingerprint,
      fingerprint,
      ownership_marker: 'copy:skills/dhpk-portable',
    };
    delete receipt.managed_entries.rules['prefer-const.mdc'];
    fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
    const target = path.join(scratch, '.cursor', 'rules', 'prefer-const.mdc');
    fs.writeFileSync(target, '# keep me\n');

    const planned = runInstaller(scratch, ['--copy', '--update', '--plan', '--json', '--force'], plugin);
    assert.notStrictEqual(planned.status, 0, `${planned.stdout}\n${planned.stderr}`);
    const report = JSON.parse(planned.stdout);
    const collision = report.collisions.find((entry) => entry.path === 'rules/prefer-const.mdc');
    assert.ok(collision, planned.stdout);

    const adopted = runInstaller(scratch, [
      '--copy',
      '--update',
      `--adopt=rules/prefer-const.mdc@${collision.destination_fingerprint}@${collision.source_fingerprint}`,
      '--force',
    ], plugin);
    assert.strictEqual(adopted.status, 0, `${adopted.stdout}\n${adopted.stderr}`);
    assert.ok(fs.lstatSync(nativeSkill).isSymbolicLink());
    assert.strictEqual(fs.readlinkSync(nativeSkill), '../../.agents/skills/dhpk-portable');
    const after = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    assert.ok(!after.managed_entries.skills || !after.managed_entries.skills['dhpk-portable']);
    assert.ok(after.managed_entries.rules['prefer-const.mdc']);
    const projection = JSON.parse(fs.readFileSync(path.join(scratch, '.agents', '.dhpk-installed.json'), 'utf8'));
    assert.strictEqual(projection.hostBindings.cursor.bindingShape, 'native-link');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(plugin, { recursive: true, force: true });
  }
});

test('unowned native skill directories are preserved; --plan --json then --adopt still works for rules', () => {
  const scratch = projectRoot();
  const plugin = fakePlugin();
  try {
    const first = runInstaller(scratch, ['--copy', '--force'], plugin);
    assert.strictEqual(first.status, 0, `${first.stdout}\n${first.stderr}`);
    const receiptPath = path.join(scratch, '.cursor', '.dhpk-installed.json');
    const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    delete receipt.managed_entries.rules['prefer-const.mdc'];
    fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
    const target = path.join(scratch, '.cursor', 'rules', 'prefer-const.mdc');
    fs.writeFileSync(target, '# keep me\n');

    const planned = runInstaller(scratch, ['--copy', '--update', '--plan', '--json', '--force'], plugin);
    assert.notStrictEqual(planned.status, 0, `${planned.stdout}\n${planned.stderr}`);
    const report = JSON.parse(planned.stdout);
    const collision = report.collisions.find((entry) => entry.path === 'rules/prefer-const.mdc');
    assert.ok(collision, planned.stdout);
    assert.strictEqual(fs.readFileSync(target, 'utf8'), '# keep me\n');

    const adopted = runInstaller(scratch, [
      '--update',
      `--adopt=rules/prefer-const.mdc@${collision.destination_fingerprint}@${collision.source_fingerprint}`,
      '--force',
    ], plugin);
    assert.strictEqual(adopted.status, 0, `${adopted.stdout}\n${adopted.stderr}`);
    const after = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    assert.ok(after.managed_entries.rules['prefer-const.mdc']);
    assert.ok(after.reconciliation.adopted >= 1, JSON.stringify(after.reconciliation));
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

test('default minimal Cursor install keeps command and agent skill-path dependencies closed', () => {
  const scratch = projectRoot();
  try {
    const planned = runInstaller(
      scratch,
      ['--copy', '--plan', '--json', '--force'],
      REPO,
      undefined,
      ROOT_INSTALL_TIMEOUT_MS,
    );
    const report = JSON.parse(planned.stdout);
    const excluded = report.excluded || [];
    const ghostCommand = excluded.find((item) => item.kind === 'commands' && item.name === 'harness-govern.md');
    const ghostAgent = excluded.find((item) => item.kind === 'agents' && item.name === 'harness-reviser.md');
    assert.ok(ghostCommand, planned.stdout);
    assert.strictEqual(ghostCommand.reason, 'unmet-skill-dependency');
    assert.ok(ghostCommand.missing.includes('harness-govern'), JSON.stringify(ghostCommand));
    assert.ok(ghostAgent, planned.stdout);
    assert.strictEqual(ghostAgent.reason, 'unmet-skill-dependency');
    assert.ok(ghostAgent.missing.includes('harness-govern'), JSON.stringify(ghostAgent));
    assert.ok(
      !excluded.some((item) => item.kind === 'agents' && item.name === 'ui-ux-verifier.md'),
      'external skill paths must not exclude ui-ux-verifier.md',
    );

    const human = runInstaller(
      scratch,
      ['--copy', '--plan', '--force'],
      REPO,
      undefined,
      ROOT_INSTALL_TIMEOUT_MS,
    );
    assert.match(`${human.stdout}\n${human.stderr}`, /excluded: commands\/harness-govern\.md/);
    assert.match(`${human.stdout}\n${human.stderr}`, /reason=unmet-skill-dependency/);
    assert.match(`${human.stdout}\n${human.stderr}`, /missing=harness-govern/);

    const installed = runInstaller(
      scratch,
      ['--copy', '--force'],
      REPO,
      undefined,
      ROOT_INSTALL_TIMEOUT_MS,
    );
    assert.strictEqual(installed.status, 0, `${installed.stdout}\n${installed.stderr}`);
    const cursor = path.join(scratch, '.cursor');
    assert.ok(!fs.existsSync(path.join(cursor, 'commands', 'harness-govern.md')));
    assert.ok(!fs.existsSync(path.join(cursor, 'agents', 'harness-reviser.md')));
    assert.ok(fs.existsSync(path.join(cursor, 'commands', 'verify.md')));
    const flowGuide = path.join(cursor, 'skills', 'flow-guide');
    assert.ok(fs.lstatSync(flowGuide).isSymbolicLink());
    assert.strictEqual(fs.readlinkSync(flowGuide), '../../.agents/skills/flow-guide');
    assert.ok(fs.existsSync(path.join(scratch, '.agents', 'skills', 'flow-guide', 'SKILL.md')));
    const projection = JSON.parse(fs.readFileSync(path.join(scratch, '.agents', '.dhpk-installed.json'), 'utf8'));
    assert.strictEqual(projection.hostBindings.cursor.bindingShape, 'native-link');
    assertProjectedDependencyClosure(scratch);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('a profile that includes harness-govern projects the gated command and agent', () => {
  const scratch = projectRoot();
  try {
    const res = runInstaller(
      scratch,
      ['--copy', '--force', '--profile', 'minimal', '--skill', 'harness-govern'],
      REPO,
      undefined,
      ROOT_INSTALL_TIMEOUT_MS,
    );
    assert.strictEqual(res.status, 0, `${res.stdout}\n${res.stderr}`);
    const cursor = path.join(scratch, '.cursor');
    assert.ok(fs.existsSync(path.join(cursor, 'skills', 'harness-govern')));
    assert.ok(fs.existsSync(path.join(cursor, 'commands', 'harness-govern.md')));
    assert.ok(fs.existsSync(path.join(cursor, 'agents', 'harness-reviser.md')));
    assertProjectedDependencyClosure(scratch);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('--update removes unchanged excluded commands and keeps modified ones', () => {
  const scratch = projectRoot();
  try {
    const installed = runInstaller(
      scratch,
      ['--copy', '--force'],
      REPO,
      undefined,
      ROOT_INSTALL_TIMEOUT_MS,
    );
    assert.strictEqual(installed.status, 0, `${installed.stdout}\n${installed.stderr}`);
    const cursor = path.join(scratch, '.cursor');
    const receiptPath = path.join(cursor, '.dhpk-installed.json');
    const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    assert.strictEqual(receipt.profileId, 'minimal');

    const unchangedSource = path.join(REPO, 'cursor', 'commands', 'harness-govern.md');
    const unchangedDest = path.join(cursor, 'commands', 'harness-govern.md');
    fs.copyFileSync(unchangedSource, unchangedDest);
    copyManagedEntry(receipt, 'commands', 'harness-govern.md', unchangedSource, unchangedDest);

    const modifiedSource = path.join(REPO, 'cursor', 'agents', 'harness-reviser.md');
    const modifiedDest = path.join(cursor, 'agents', 'harness-reviser.md');
    fs.copyFileSync(modifiedSource, modifiedDest);
    copyManagedEntry(receipt, 'agents', 'harness-reviser.md', modifiedSource, modifiedDest);
    fs.appendFileSync(modifiedDest, '\nuser edit\n');
    fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);

    const planned = runInstaller(
      scratch,
      ['--copy', '--update', '--plan', '--json', '--force'],
      REPO,
      undefined,
      ROOT_INSTALL_TIMEOUT_MS,
    );
    const report = JSON.parse(planned.stdout);
    const excludedCommand = (report.excluded || []).find(
      (item) => item.kind === 'commands' && item.name === 'harness-govern.md',
    );
    assert.ok(excludedCommand, planned.stdout);
    assert.strictEqual(excludedCommand.reason, 'unmet-skill-dependency');
    const retiredUnchanged = (report.retired || []).find((item) => item.path === 'commands/harness-govern.md');
    const retiredModified = (report.retired || []).find((item) => item.path === 'agents/harness-reviser.md');
    assert.ok(retiredUnchanged, planned.stdout);
    assert.strictEqual(retiredUnchanged.reason, 'unchanged-receipt-owned');
    assert.ok(retiredModified, planned.stdout);
    assert.ok(/modified|unowned|orphaned/.test(retiredModified.reason || retiredModified.ownership || ''), JSON.stringify(retiredModified));

    const updated = runInstaller(
      scratch,
      ['--copy', '--update', '--force'],
      REPO,
      undefined,
      ROOT_INSTALL_TIMEOUT_MS,
    );
    assert.notStrictEqual(updated.status, 0, `${updated.stdout}\n${updated.stderr}`);
    assert.match(`${updated.stdout}\n${updated.stderr}`, /orphaned preserved: agents\/harness-reviser\.md/);
    assert.ok(!fs.existsSync(unchangedDest), 'unchanged excluded command must be pruned');
    assert.ok(fs.existsSync(modifiedDest), 'modified excluded agent must be preserved');
    assert.match(fs.readFileSync(modifiedDest, 'utf8'), /user edit/);
    const nextReceipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    assert.ok(!nextReceipt.managed_entries.commands['harness-govern.md']);
    assert.ok(nextReceipt.managed_entries.agents['harness-reviser.md']);
    assert.strictEqual(nextReceipt.managed_entries.agents['harness-reviser.md'].orphaned, true);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('PASS probe record installs Cursor direct bindings without native skill entries', () => {
  const scratch = projectRoot();
  const plugin = fakePlugin();
  const evidence = writeCursorEvidence(scratch, cursorDiscoveryEvidence('PASS'));
  try {
    const res = runInstaller(scratch, ['--copy', '--force'], plugin, {
      DHPK_CURSOR_CONSUMER_EVIDENCE: evidence,
    });
    assert.strictEqual(res.status, 0, `${res.stdout}\n${res.stderr}`);
    const nativeSkill = path.join(scratch, '.cursor', 'skills', 'dhpk-portable');
    assert.ok(!fs.existsSync(nativeSkill), 'direct bindings must not create dhpk native skill entries');
    assert.ok(fs.existsSync(path.join(scratch, '.agents', 'skills', 'dhpk-portable', 'SKILL.md')));
    const projection = JSON.parse(fs.readFileSync(path.join(scratch, '.agents', '.dhpk-installed.json'), 'utf8'));
    assert.strictEqual(projection.hostBindings.cursor.bindingShape, 'direct');
    assert.deepStrictEqual(projection.bindingPaths.cursor || [], []);
    const binding = (projection.hostBindings.cursor.bindings || []).find((entry) => entry.stableId === 'portable');
    assert.ok(binding, JSON.stringify(projection.hostBindings.cursor));
    assert.strictEqual(binding.shape, 'direct');
    assert.ok(!binding.path && !binding.target);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(plugin, { recursive: true, force: true });
  }
});

test('FAIL or missing probe record keeps Cursor native-link bindings', () => {
  for (const evidence of [null, cursorDiscoveryEvidence('FAIL')]) {
    const scratch = projectRoot();
    const plugin = fakePlugin();
    const extraEnv = {};
    if (evidence) extraEnv.DHPK_CURSOR_CONSUMER_EVIDENCE = writeCursorEvidence(scratch, evidence);
    try {
      const res = runInstaller(scratch, ['--copy', '--force'], plugin, extraEnv);
      assert.strictEqual(res.status, 0, `${res.stdout}\n${res.stderr}`);
      const nativeSkill = path.join(scratch, '.cursor', 'skills', 'dhpk-portable');
      assert.ok(fs.lstatSync(nativeSkill).isSymbolicLink());
      const projection = JSON.parse(fs.readFileSync(path.join(scratch, '.agents', '.dhpk-installed.json'), 'utf8'));
      assert.strictEqual(projection.hostBindings.cursor.bindingShape, 'native-link');
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
      fs.rmSync(plugin, { recursive: true, force: true });
    }
  }
});

test('--plan --json reports the Cursor binding shape and evidence reason', () => {
  const scratch = projectRoot();
  const plugin = fakePlugin();
  try {
    const missing = runInstaller(scratch, ['--copy', '--plan', '--json', '--force'], plugin);
    const missingReport = JSON.parse(missing.stdout);
    assert.strictEqual(missingReport.cursorBindingShape, 'native-link');
    assert.match(String(missingReport.cursorBindingReason || ''), /missing/i);

    const evidence = writeCursorEvidence(scratch, cursorDiscoveryEvidence('PASS'));
    const passing = runInstaller(scratch, ['--copy', '--plan', '--json', '--force'], plugin, {
      DHPK_CURSOR_CONSUMER_EVIDENCE: evidence,
    });
    const passingReport = JSON.parse(passing.stdout);
    assert.strictEqual(passingReport.cursorBindingShape, 'direct');
    assert.match(String(passingReport.cursorBindingReason || ''), /PASS/i);
    assert.ok(!fs.existsSync(path.join(scratch, '.agents', '.dhpk-installed.json')));
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(plugin, { recursive: true, force: true });
  }
});

test('reinstall after PASS converts native-link bindings to direct and removes the links', () => {
  const scratch = projectRoot();
  const plugin = fakePlugin();
  try {
    const first = runInstaller(scratch, ['--copy', '--force'], plugin);
    assert.strictEqual(first.status, 0, `${first.stdout}\n${first.stderr}`);
    const nativeSkill = path.join(scratch, '.cursor', 'skills', 'dhpk-portable');
    assert.ok(fs.lstatSync(nativeSkill).isSymbolicLink());
    const evidence = writeCursorEvidence(scratch, cursorDiscoveryEvidence('PASS'));
    const second = runInstaller(scratch, ['--copy', '--force'], plugin, {
      DHPK_CURSOR_CONSUMER_EVIDENCE: evidence,
    });
    assert.strictEqual(second.status, 0, `${second.stdout}\n${second.stderr}`);
    assert.ok(!fs.existsSync(nativeSkill), 'PASS reinstall must remove previous native-link dests');
    const projection = JSON.parse(fs.readFileSync(path.join(scratch, '.agents', '.dhpk-installed.json'), 'utf8'));
    assert.strictEqual(projection.hostBindings.cursor.bindingShape, 'direct');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(plugin, { recursive: true, force: true });
  }
});

test('a static .agents skill tree is not treated as Cursor discovery PASS evidence', () => {
  const scratch = projectRoot();
  const plugin = fakePlugin();
  try {
    write(path.join(scratch, '.agents', 'notes.md'), 'planted\n');
    const res = runInstaller(scratch, ['--copy', '--force'], plugin);
    assert.strictEqual(res.status, 0, `${res.stdout}\n${res.stderr}`);
    const nativeSkill = path.join(scratch, '.cursor', 'skills', 'dhpk-portable');
    assert.ok(fs.lstatSync(nativeSkill).isSymbolicLink());
    const projection = JSON.parse(fs.readFileSync(path.join(scratch, '.agents', '.dhpk-installed.json'), 'utf8'));
    assert.strictEqual(projection.hostBindings.cursor.bindingShape, 'native-link');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(plugin, { recursive: true, force: true });
  }
});

run('install-cursor-harness');
