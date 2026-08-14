'use strict';

// Cursor projection contract tests (OpenSpec tasks 4.1-4.5).  These tests use
// a tiny canonical fixture so they exercise the generator/validator boundary
// without relying on a Cursor installation or on the repository's large
// canonical skill tree.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const ROOT = path.join(__dirname, '..');
const {
  compileCursorPackage,
  materializeCursorPackage,
  validateCursorPackage,
  verifyCursorPackage,
  runCursorConsumerProbe,
  fingerprintDir,
  fingerprintPath,
} = require('../scripts/lib/cursor-plugin-package');

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function write(file, content, mode) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, mode ? { mode } : undefined);
}

function makeFixture() {
  const root = tmpDir('dhpk-cursor-source-');
  write(path.join(root, 'skills', 'dhpk-portable', 'SKILL.md'), [
    '---',
    'name: dhpk-portable',
    "description: 'Portable skill: use for fixture checks.'",
    'disable-model-invocation: true',
    'metadata:',
    '  dhpk-invocation-class: explicit-only',
    '---',
    '# Portable fixture',
    '',
  ].join('\n'));
  write(path.join(root, 'skills', 'dhpk-portable', 'agents', 'openai.yaml'), 'interface:\n  display_name: secret policy\n');
  write(path.join(root, 'skills', 'dhpk-invalid', 'SKILL.md'), '---\nname: wrong\n---\ninvalid sibling\n');
  write(path.join(root, 'rules', 'prefer-const.md'), '# Prefer const\nUse const when values do not change.\n');
  write(path.join(root, 'agents', 'reviewer.md'), [
    '---',
    'name: reviewer',
    "description: 'Review fixture changes.'",
    'tools: Read, Bash',
    'model: sonnet',
    '---',
    '# Reviewer',
    '',
  ].join('\n'));
  write(path.join(root, 'agents', 'INDEX.md'), '# navigation\n');
  write(path.join(root, 'commands', 'review.md'), [
    '---',
    "description: 'Review the fixture.'",
    'disable-model-invocation: true',
    '---',
    '# Review command',
    '',
  ].join('\n'));
  write(path.join(root, 'commands', 'INDEX.md'), '# navigation\n');
  write(path.join(root, 'hooks', 'hooks.json'), JSON.stringify({ hooks: {
    PreToolUse: [{ hooks: [{ type: 'command', command: 'bash', args: ['${CLAUDE_PLUGIN_ROOT}/scripts/unsafe.sh'] }] }],
  } }, null, 2) + '\n');
  write(path.join(root, 'scripts', 'unsafe.sh'), '#!/bin/sh\nexit 0\n', 0o755);
  return root;
}

function fixtureInventory() {
  return {
    skills: [
      { id: 'portable', name: 'dhpk-portable', path: 'skills/dhpk-portable', lifecycle: 'promoted', surfaces: ['cursor-plugin'] },
      { id: 'invalid', name: 'dhpk-invalid', path: 'skills/dhpk-invalid', lifecycle: 'promoted', surfaces: ['cursor-plugin'] },
      { id: 'codex-only', name: 'dhpk-codex-only', path: 'skills/dhpk-codex-only', lifecycle: 'promoted', surfaces: ['codex-native'] },
    ],
    surface_membership: { 'cursor-plugin': ['portable', 'invalid'] },
    platform_matrix: {
      schema: 'dhpk.platform-capability-matrix.v1',
      entries: [{
        id: 'dhpk.platform.cursor-plugin.skills',
        public_name: 'cursor-plugin-portable-skills',
        surface: 'cursor-plugin',
        source_paths: ['skills/'],
        destination: 'plugins/dhpk-cursor/skills/',
        transform: 'agent-skills-frontmatter',
        fallback: 'agent-plugin',
        projection_mode: 'overlay',
        evidence: 'NOT_RUN',
      }],
    },
  };
}

test('Cursor compiler freezes shared/overlay intent before materialization', () => {
  const root = makeFixture();
  const out = tmpDir('dhpk-cursor-compile-');
  try {
    const inventory = fixtureInventory();
    inventory.skills.push({
      id: 'shared',
      name: 'dhpk-shared',
      path: 'skills/dhpk-portable',
      lifecycle: 'promoted',
      surfaces: ['agent-plugin'],
    });
    inventory.surface_membership['agent-plugin'] = ['shared'];
    inventory.platform_matrix.entries = [
      {
        id: 'dhpk.platform.cursor-plugin.shared-skills',
        public_name: 'cursor-plugin-portable-skills',
        surface: 'cursor-plugin',
        source_paths: ['skills/'],
        destination: 'plugins/dhpk-agent/skills/',
        transform: 'shared-agent-plugin-skills',
        fallback: 'agent-plugin',
        projection_mode: 'shared',
        shared_surface: 'agent-plugin',
        stable_ids: ['shared'],
        evidence: 'NOT_RUN',
      },
      {
        id: 'dhpk.platform.cursor-plugin.overlay',
        public_name: 'cursor-plugin-environment-overlay',
        surface: 'cursor-plugin',
        source_paths: ['skills/dhpk-portable'],
        destination: 'plugins/dhpk-cursor/skills/',
        transform: 'cursor-native-adaptation',
        fallback: 'SKIP_INCOMPATIBLE',
        projection_mode: 'overlay',
        stable_ids: ['portable'],
        evidence: 'NOT_RUN',
      },
    ];

    const compiled = compileCursorPackage({
      inventory,
      root,
      outDir: out,
      version: '1.2.3',
      sourceCommit: 'abc123',
    });
    assert.deepStrictEqual(compiled.sharedSkillIds, ['shared']);
    assert.deepStrictEqual(compiled.selectedSkillIds, ['portable']);
    assert.strictEqual(compiled.plan.surface, 'cursor-plugin');
    assert.ok(Object.isFrozen(compiled.plan));
    assert.ok(compiled.plan.entries.some((entry) => entry.destination === 'skills/dhpk-portable/SKILL.md'));
    assert.deepStrictEqual(fs.readdirSync(out), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test('Cursor compiler is read-only until the artifact store materializes the plan', () => {
  const root = makeFixture();
  const out = tmpDir('dhpk-cursor-compile-readonly-');
  const originalWriteFileSync = fs.writeFileSync;
  let writes = 0;
  fs.writeFileSync = (...args) => {
    writes += 1;
    throw new Error(`compiler attempted a direct write: ${args[0]}`);
  };
  try {
    compileCursorPackage({ inventory: fixtureInventory(), root, outDir: out });
    assert.strictEqual(writes, 0);
    assert.deepStrictEqual(fs.readdirSync(out), []);
  } finally {
    fs.writeFileSync = originalWriteFileSync;
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test('materializes selected Cursor skills and native components as physical files', () => {
  const root = makeFixture();
  const out = tmpDir('dhpk-cursor-package-');
  try {
    const result = materializeCursorPackage({
      inventory: fixtureInventory(),
      root,
      outDir: out,
      version: '1.2.3',
      sourceCommit: 'abc123',
    });
    assert.deepStrictEqual(result.skillIds, ['portable']);
    assert.ok(fs.existsSync(path.join(out, 'skills', 'dhpk-portable', 'SKILL.md')));
    assert.ok(!fs.existsSync(path.join(out, 'skills', 'dhpk-portable', 'agents', 'openai.yaml')));
    assert.ok(fs.existsSync(path.join(out, 'rules', 'prefer-const.md')));
    assert.ok(fs.existsSync(path.join(out, 'agents', 'reviewer.md')));
    assert.ok(fs.existsSync(path.join(out, 'commands', 'review.md')));
    assert.ok(fs.existsSync(path.join(out, '.cursor-plugin', 'plugin.json')));
    assert.ok(fs.existsSync(path.join(out, '.cursor-plugin', 'marketplace.json')));
    assert.deepStrictEqual(validateCursorPackage({ packageRoot: out }).errors, []);
    assert.strictEqual(result.provenance.schema, 'dhpk.platform-provenance.v1');
    assert.strictEqual(result.provenance.owner, 'plugins/dhpk-cursor');
    assert.deepStrictEqual(result.provenance.fingerprints, result.fingerprints);
    assert.ok(result.provenance.inventoryDigest);
    assert.ok(result.provenance.transformations.some((t) => /frontmatter/.test(t.transform)));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test('Cursor frontmatter adaptation keeps identity while removing client-only policy', () => {
  const root = makeFixture();
  const out = tmpDir('dhpk-cursor-frontmatter-');
  try {
    materializeCursorPackage({ inventory: fixtureInventory(), root, outDir: out });
    const skill = fs.readFileSync(path.join(out, 'skills', 'dhpk-portable', 'SKILL.md'), 'utf8');
    const agent = fs.readFileSync(path.join(out, 'agents', 'reviewer.md'), 'utf8');
    const command = fs.readFileSync(path.join(out, 'commands', 'review.md'), 'utf8');
    assert.match(skill, /^name: dhpk-portable$/m);
    assert.doesNotMatch(skill, /disable-model-invocation|dhpk-invocation-class/);
    assert.match(agent, /^name: reviewer$/m);
    assert.doesNotMatch(agent, /^tools:|^model:/m);
    assert.match(command, /^name: review$/m);
    assert.doesNotMatch(command, /disable-model-invocation/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test('invalid sibling skill is reported and skipped without disabling valid siblings', () => {
  const root = makeFixture();
  const out = tmpDir('dhpk-cursor-invalid-skill-');
  try {
    const result = materializeCursorPackage({ inventory: fixtureInventory(), root, outDir: out });
    assert.deepStrictEqual(result.skillNames, ['dhpk-portable']);
    assert.ok(result.skippedSkills.some((s) => /invalid/.test(s.id)));
    const validation = validateCursorPackage(out);
    assert.strictEqual(validation.ok, true, validation.errors.join('\n'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test('matrix source_id selection narrows the Cursor skill set even without surface membership', () => {
  const root = makeFixture();
  const out = tmpDir('dhpk-cursor-matrix-source-id-');
  try {
    const inventory = fixtureInventory();
    delete inventory.surface_membership;
    inventory.skills.forEach((skill) => { skill.surfaces = ['claude-core']; });
    inventory.platform_matrix.entries = [{
      id: 'dhpk.platform.cursor-plugin.skill-one',
      public_name: 'cursor-plugin-skill',
      surface: 'cursor-plugin',
      source_id: 'portable',
      source_paths: ['skills/dhpk-portable'],
      destination: 'plugins/dhpk-cursor/skills/',
      transform: 'agent-skills-frontmatter',
      fallback: 'agent-plugin',
      evidence: 'NOT_RUN',
    }];
    const result = materializeCursorPackage({ inventory, root, outDir: out });
    assert.deepStrictEqual(result.skillIds, ['portable']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test('shared Cursor portable skills record Agent Plugin ownership without a duplicate skills directory', () => {
  const root = tmpDir('dhpk-cursor-shared-source-');
  const out = tmpDir('dhpk-cursor-shared-out-');
  try {
    write(path.join(root, 'skills', 'dhpk-shared', 'SKILL.md'), [
      '---',
      'name: dhpk-shared',
      "description: 'Shared portable fixture.'",
      '---',
      '# Shared fixture',
      '',
    ].join('\n'));
    const inventory = {
      skills: [{
        id: 'shared',
        name: 'dhpk-shared',
        path: 'skills/dhpk-shared',
        lifecycle: 'promoted',
        surfaces: ['agent-plugin'],
      }],
      surface_membership: { 'agent-plugin': ['shared'] },
      platform_matrix: {
        schema: 'dhpk.platform-capability-matrix.v1',
        entries: [
          {
            id: 'dhpk.platform.agent-plugin.skills',
            public_name: 'agent-plugin-portable-skills',
            surface: 'agent-plugin',
            source_paths: ['skills/'],
            destination: 'plugins/dhpk-agent/skills/',
            transform: 'agent-skills-frontmatter',
            fallback: 'codex-sync',
            projection_mode: 'owner',
            evidence: 'NOT_RUN',
          },
          {
            id: 'dhpk.platform.cursor-plugin.skills',
            public_name: 'cursor-plugin-portable-skills',
            surface: 'cursor-plugin',
            source_paths: ['skills/'],
            destination: 'plugins/dhpk-agent/skills/',
            transform: 'shared-agent-plugin-skills',
            fallback: 'agent-plugin',
            projection_mode: 'shared',
            shared_surface: 'agent-plugin',
            evidence: 'NOT_RUN',
          },
        ],
      },
    };
    const result = materializeCursorPackage({
      inventory,
      root,
      outDir: out,
      version: '1.2.3',
      sourceCommit: 'a'.repeat(40),
    });

    assert.deepStrictEqual(result.skillIds, []);
    assert.strictEqual(result.provenance.skillProjectionMode, 'shared');
    assert.strictEqual(result.provenance.sharedSkillSurface, 'agent-plugin');
    assert.strictEqual(result.provenance.sharedSkillSource, 'plugins/dhpk-agent/skills/');
    assert.deepStrictEqual(result.provenance.sharedSkillIds, ['shared']);
    assert.deepStrictEqual(result.provenance.sharedSkillNames, ['dhpk-shared']);
    assert.ok(!fs.existsSync(path.join(out, 'skills')));
    const manifest = JSON.parse(fs.readFileSync(path.join(out, '.cursor-plugin', 'plugin.json'), 'utf8'));
    assert.strictEqual(manifest.skills, undefined);
    assert.ok(result.provenance.transformations.some((entry) => (
      entry.source === 'plugins/dhpk-agent/skills/'
      && entry.destination === null
      && entry.transform === 'shared-surface:agent-plugin'
      && entry.stableIds.join(',') === 'shared'
    )));
    const validation = validateCursorPackage({ packageRoot: out });
    assert.strictEqual(validation.ok, true, validation.errors.join('\n'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test('explicit Cursor overlay remains materialized alongside shared Agent Plugin skills', () => {
  const root = makeFixture();
  const out = tmpDir('dhpk-cursor-shared-overlay-');
  try {
    write(path.join(root, 'skills', 'dhpk-overlay', 'SKILL.md'), [
      '---',
      'name: dhpk-overlay',
      "description: 'Environment overlay fixture.'",
      '---',
      '# Overlay fixture',
      '',
    ].join('\n'));
    const inventory = fixtureInventory();
    inventory.skills = [
      { id: 'shared', name: 'dhpk-shared', path: 'skills/dhpk-portable', lifecycle: 'promoted', surfaces: ['agent-plugin'] },
      { id: 'overlay', name: 'dhpk-overlay', path: 'skills/dhpk-overlay', lifecycle: 'promoted', surfaces: ['cursor-plugin'] },
    ];
    inventory.surface_membership = { 'agent-plugin': ['shared'] };
    inventory.platform_matrix.entries = [
      {
        id: 'dhpk.platform.agent-plugin.skills',
        public_name: 'agent-plugin-portable-skills',
        surface: 'agent-plugin',
        source_paths: ['skills/'],
        destination: 'plugins/dhpk-agent/skills/',
        transform: 'agent-skills-frontmatter',
        fallback: 'codex-sync',
        projection_mode: 'owner',
        evidence: 'NOT_RUN',
      },
      {
        id: 'dhpk.platform.cursor-plugin.shared-skills',
        public_name: 'cursor-plugin-portable-skills',
        surface: 'cursor-plugin',
        source_paths: ['skills/'],
        destination: 'plugins/dhpk-agent/skills/',
        transform: 'shared-agent-plugin-skills',
        fallback: 'agent-plugin',
        projection_mode: 'shared',
        shared_surface: 'agent-plugin',
        stable_ids: ['shared'],
        evidence: 'NOT_RUN',
      },
      {
        id: 'dhpk.platform.cursor-plugin.overlay',
        public_name: 'cursor-plugin-environment-overlay',
        surface: 'cursor-plugin',
        source_paths: ['skills/dhpk-overlay'],
        destination: 'plugins/dhpk-cursor/skills/',
        transform: 'cursor-native-adaptation',
        fallback: 'SKIP_INCOMPATIBLE',
        projection_mode: 'overlay',
        stable_ids: ['overlay'],
        evidence: 'NOT_RUN',
      },
    ];
    const result = materializeCursorPackage({ inventory, root, outDir: out });

    assert.deepStrictEqual(result.skillIds, ['overlay']);
    assert.deepStrictEqual(result.provenance.sharedSkillIds, ['shared']);
    assert.strictEqual(result.provenance.sharedSkillSurface, 'agent-plugin');
    assert.strictEqual(result.provenance.sharedSkillSource, 'plugins/dhpk-agent/skills/');
    assert.strictEqual(result.provenance.skillProjectionMode, 'overlay');
    assert.ok(fs.existsSync(path.join(out, 'skills', 'dhpk-overlay', 'SKILL.md')));
    assert.ok(!fs.existsSync(path.join(out, 'skills', 'dhpk-shared')));
    assert.deepStrictEqual(validateCursorPackage({ packageRoot: out }).errors, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test('manifest paths, marketplace source, hooks, and variables stay package-contained', () => {
    const root = makeFixture();
  const out = tmpDir('dhpk-cursor-boundary-');
  try {
    materializeCursorPackage({ inventory: fixtureInventory(), root, outDir: out });
    const manifest = JSON.parse(fs.readFileSync(path.join(out, '.cursor-plugin', 'plugin.json'), 'utf8'));
    assert.strictEqual(manifest.skills, './skills/');
    assert.strictEqual(manifest.rules, './rules/');
    assert.strictEqual(manifest.agents, './agents/');
    assert.strictEqual(manifest.commands, './commands/');
    assert.strictEqual(manifest.hooks, './hooks/hooks.json');
    assert.deepStrictEqual(manifest.variables, { type: 'object', properties: {} });
    const marketplace = JSON.parse(fs.readFileSync(path.join(out, '.cursor-plugin', 'marketplace.json'), 'utf8'));
    assert.strictEqual(marketplace.plugins[0].source, '.');
    assert.strictEqual(validateCursorPackage({ packageRoot: out }).ok, true);

    manifest.hooks = '../../outside/hooks.json';
    fs.writeFileSync(path.join(out, '.cursor-plugin', 'plugin.json'), JSON.stringify(manifest, null, 2) + '\n');
    const invalid = validateCursorPackage({ packageRoot: out });
    assert.strictEqual(invalid.ok, false);
    assert.ok(invalid.errors.some((e) => /hooks.*(?:escape|package-relative)/i.test(e)), invalid.errors.join('\n'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test('validator blocks literal credentials and escaping hook commands', () => {
  const root = makeFixture();
  const out = tmpDir('dhpk-cursor-secrets-');
  try {
    materializeCursorPackage({ inventory: fixtureInventory(), root, outDir: out });
    const manifestPath = path.join(out, '.cursor-plugin', 'plugin.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.variables = { type: 'object', properties: { API_TOKEN: { type: 'string', default: 'ghp_123456789012345678901234567890' } } };
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
    const secret = validateCursorPackage({ packageRoot: out });
    assert.strictEqual(secret.ok, false);
    assert.ok(secret.errors.some((e) => /secret|credential|token/i.test(e)));

    manifest.variables = { type: 'object', properties: {} };
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
    fs.writeFileSync(path.join(out, 'hooks', 'hooks.json'), JSON.stringify({ hooks: {
      sessionStart: [{ command: '../../outside.sh' }],
    } }, null, 2) + '\n');
    const escapingHook = validateCursorPackage({ packageRoot: out });
    assert.strictEqual(escapingHook.ok, false);
    assert.ok(escapingHook.errors.some((e) => /hook.*relative|escape/i.test(e)));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test('Cursor rejects executable configuration that is not closed and safe', () => {
  const root = tmpDir('dhpk-cursor-security-source-');
  const out = tmpDir('dhpk-cursor-security-out-');
  try {
    write(path.join(root, 'hooks', 'hooks.json'), JSON.stringify({ hooks: { sessionStart: [{ command: './scripts/run.sh; touch /tmp/pwned', unknown: true }] } }));
    fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
    const inventory = { skills: [] };
    materializeCursorPackage({ inventory, root, outDir: out, version: '1.0.0' });
    const generatedHooks = JSON.parse(fs.readFileSync(path.join(out, 'hooks', 'hooks.json'), 'utf8'));
    assert.deepStrictEqual(generatedHooks.hooks, {});
    fs.writeFileSync(path.join(out, 'hooks', 'hooks.json'), JSON.stringify({ hooks: { sessionStart: [{ command: './hooks/commands/run.sh;touch' }] } }));
    fs.mkdirSync(path.join(out, 'hooks', 'commands'), { recursive: true });
    fs.writeFileSync(path.join(out, 'hooks', 'commands', 'run.sh;touch'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    const unsafe = validateCursorPackage({ packageRoot: out, expectedManifestName: 'dhpk-cursor' });
    assert.ok(unsafe.errors.some((error) => /unsafe executable|contained|hook/i.test(error)));

    const manifest = { name: 'dhpk-cursor', version: '1.0.0', description: 'bad', mcpServers: { server: { type: 'stdio', command: 'sh' } }, variables: { type: 'object', properties: {} } };
    fs.mkdirSync(path.join(out, '.cursor-plugin'), { recursive: true });
    fs.writeFileSync(path.join(out, '.cursor-plugin', 'plugin.json'), JSON.stringify(manifest));
    fs.writeFileSync(path.join(out, '.cursor-plugin', 'marketplace.json'), JSON.stringify({ name: 'test', owner: { name: 'test' }, plugins: [{ name: 'dhpk-cursor', source: '.' }] }));
    const rejected = validateCursorPackage({ packageRoot: out, expectedManifestName: 'dhpk-cursor' });
    assert.ok(rejected.errors.some((error) => /mcpServers|mcp\.json|unknown field/i.test(error)));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test('Cursor variable URL credentials and output overlap fail closed', () => {
  const root = tmpDir('dhpk-cursor-overlap-source-');
  try {
    assert.throws(
      () => materializeCursorPackage({ inventory: { skills: [] }, root, outDir: root, variables: { type: 'object', properties: { endpoint: { type: 'string', default: 'https://user:pass@example.test' } } } }),
      /credential|canonical root|overlap/i
    );
    assert.ok(fs.existsSync(root));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('generation is byte-stable and consumer probe is unavailable without Cursor tooling', () => {
  const root = makeFixture();
  const outA = tmpDir('dhpk-cursor-deterministic-a-');
  const outB = tmpDir('dhpk-cursor-deterministic-b-');
  try {
    const args = { inventory: fixtureInventory(), root, version: '1.2.3', sourceCommit: 'abc123' };
    materializeCursorPackage({ ...args, outDir: outA });
    materializeCursorPackage({ ...args, outDir: outB });
    assert.strictEqual(fingerprintDir(outA), fingerprintDir(outB));
    const probe = runCursorConsumerProbe({ packageRoot: outA, pathValue: '/usr/bin:/bin' });
    assert.strictEqual(probe.status, 'UNAVAILABLE');
    assert.match(probe.reason, /Cursor/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outA, { recursive: true, force: true });
    fs.rmSync(outB, { recursive: true, force: true });
  }
});

test('fingerprint traversal rejects excessive directory depth before unbounded recursion', () => {
  const root = tmpDir('dhpk-cursor-fingerprint-depth-');
  try {
    let current = root;
    for (let depth = 0; depth < 4; depth += 1) {
      current = path.join(current, `level-${depth}`);
      fs.mkdirSync(current);
    }
    fs.writeFileSync(path.join(current, 'SKILL.md'), 'bounded\n');
    assert.throws(
      () => fingerprintPath(root, { maxDepth: 2 }),
      /maximum directory depth/i,
    );
    assert.throws(
      () => fingerprintPath(root, { maxBytes: 1 }),
      /byte budget/i,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Cursor projection uses one byte budget across selected skills and generated documents', () => {
  const root = tmpDir('dhpk-cursor-aggregate-budget-');
  const out = tmpDir('dhpk-cursor-aggregate-budget-out-');
  const body = 'x'.repeat(180);
  try {
    const skills = [];
    const stableIds = [];
    for (const [id, name] of [['one', 'dhpk-one'], ['two', 'dhpk-two']]) {
      write(path.join(root, 'skills', name, 'SKILL.md'), `---\nname: ${name}\ndescription: fixture\n---\n${body}\n`);
      skills.push({ id, name, path: `skills/${name}`, lifecycle: 'promoted', surfaces: ['cursor-plugin'] });
      stableIds.push(id);
    }
    const inventory = {
      skills,
      platform_matrix: {
        entries: [{
          surface: 'cursor-plugin',
          source_paths: ['skills/'],
          stable_ids: stableIds,
          projection_mode: 'overlay',
        }],
      },
    };
    assert.throws(
      () => compileCursorPackage({ inventory, root, outDir: out, traversalOptions: { maxBytes: 900 } }),
      /byte budget/i,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test('Cursor fingerprinting rejects symlink entries before following external targets', () => {
  const root = tmpDir('dhpk-cursor-fingerprint-symlink-');
  const outside = tmpDir('dhpk-cursor-fingerprint-outside-');
  try {
    fs.writeFileSync(path.join(outside, 'secret.md'), 'outside\n');
    fs.symlinkSync(path.join(outside, 'secret.md'), path.join(root, 'secret.md'));
    assert.throws(() => fingerprintPath(root), /symlink/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('Cursor verifier rejects symlinked package roots and ancestors before reading the package', () => {
  const realParent = tmpDir('dhpk-cursor-verify-root-');
  const packageRoot = path.join(realParent, 'package');
  fs.mkdirSync(packageRoot);
  const linkParent = path.join(tmpDir('dhpk-cursor-verify-parent-'), 'linked-parent');
  const linkedRoot = path.join(linkParent, 'package');
  const rootLink = path.join(tmpDir('dhpk-cursor-verify-link-'), 'root-link');
  try {
    fs.symlinkSync(realParent, linkParent, 'dir');
    fs.symlinkSync(packageRoot, rootLink, 'dir');
    for (const candidate of [linkedRoot, rootLink]) {
      const result = verifyCursorPackage({ packageRoot: candidate });
      assert.strictEqual(result.ok, false);
      assert.match(result.errors.join('\n'), /symlinked Cursor package root ancestor|physical Cursor package root/i);
    }
  } finally {
    fs.rmSync(realParent, { recursive: true, force: true });
    fs.rmSync(path.dirname(linkParent), { recursive: true, force: true });
    fs.rmSync(path.dirname(rootLink), { recursive: true, force: true });
  }
});

test('consumer probe only reports PASS for an explicitly supplied loader command', () => {
  const out = tmpDir('dhpk-cursor-consumer-fixture-');
  try {
    const probe = runCursorConsumerProbe({
      packageRoot: out,
      executable: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
      args: process.platform === 'win32' ? ['/c', 'if not "%CURSOR_PLUGIN_ROOT%"=="" exit 0'] : ['-c', 'test -n "$CURSOR_PLUGIN_ROOT"'],
      pathValue: '',
    });
    assert.strictEqual(probe.status, 'PASS');
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test('hung Cursor consumer probes return bounded BLOCKED timeout evidence', () => {
  const out = tmpDir('dhpk-cursor-consumer-timeout-');
  try {
    const probe = runCursorConsumerProbe({
      packageRoot: out,
      executable: process.execPath,
      args: ['-e', 'setTimeout(() => {}, 1000)'],
      pathValue: '',
      timeoutMs: 40,
    });
    assert.strictEqual(probe.status, 'BLOCKED');
    assert.strictEqual(probe.timed_out, true);
    assert.strictEqual(probe.timeout_ms, 40);
    assert.strictEqual(probe.exit_code, null);
    assert.ok(probe.signal, JSON.stringify(probe));
    assert.match(probe.reason, /timed out/i);
    assert.notStrictEqual(probe.status, 'PASS');
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test('Cursor probe forcibly bounds a client that ignores SIGTERM', () => {
  if (process.platform === 'win32') return;
  const out = tmpDir('dhpk-cursor-consumer-ignore-term-');
  try {
    const started = Date.now();
    const probe = runCursorConsumerProbe({
      packageRoot: out,
      executable: process.execPath,
      args: ['-e', "process.on('SIGTERM', () => {}); setTimeout(() => {}, 5000)"],
      timeoutMs: 40,
    });
    assert.ok(Date.now() - started < 1000, `probe exceeded hard timeout: ${Date.now() - started}ms`);
    assert.strictEqual(probe.status, 'BLOCKED');
    assert.strictEqual(probe.timed_out, true);
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test('Cursor probe timeout cleans up ordinary descendants in the probe group', () => {
  const out = tmpDir('dhpk-cursor-consumer-descendant-');
  const marker = path.join(out, 'descendant-wrote-after-timeout');
  try {
    const childCode = `setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'escaped'), 200)`;
    const probeCode = [
      "const { spawn } = require('node:child_process');",
      `spawn(process.execPath, ['-e', ${JSON.stringify(childCode)}], { stdio: 'ignore' });`,
      'setTimeout(() => {}, 1000);',
    ].join('');
    const probe = runCursorConsumerProbe({
      packageRoot: out,
      executable: process.execPath,
      args: ['-e', probeCode],
      pathValue: '',
      timeoutMs: 50,
    });
    assert.strictEqual(probe.status, 'BLOCKED');
    assert.strictEqual(probe.timed_out, true);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300);
    assert.strictEqual(fs.existsSync(marker), false, 'ordinary descendant survived the timeout group cleanup');
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test('Cursor consumer probe rejects invalid limits and bounds redacted output', () => {
  const out = tmpDir('dhpk-cursor-consumer-limits-');
  const marker = 'CURSOR_PROBE_SECRET_MARKER_123456789';
  try {
    assert.throws(
      () => runCursorConsumerProbe({ packageRoot: out, executable: process.execPath, args: ['-e', ''], timeoutMs: 0 }),
      /positive safe integer/i,
    );
    assert.throws(
      () => runCursorConsumerProbe({ packageRoot: out, executable: process.execPath, args: ['-e', ''], timeoutMs: Number.MAX_SAFE_INTEGER }),
      /positive safe integer.*<=/i,
    );
    const probe = runCursorConsumerProbe({
      packageRoot: out,
      executable: process.execPath,
      args: ['-e', `process.stdout.write('token="${marker}"'.repeat(100))`],
      pathValue: '',
      timeoutMs: 500,
      maxOutputBytes: 32,
    });
    assert.strictEqual(probe.status, 'BLOCKED');
    assert.strictEqual(probe.output_limited, true);
    assert.doesNotMatch(JSON.stringify(probe), new RegExp(marker));
    assert.ok(probe.output_limit_bytes <= 32);
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test('Cursor consumer probe does not inherit arbitrary credential environment', () => {
  const out = tmpDir('dhpk-cursor-consumer-env-');
  const key = 'DHPK_CURSOR_PROBE_SECRET_MARKER';
  const previous = process.env[key];
  process.env[key] = 'credential-value-should-not-cross-boundary';
  try {
    const probe = runCursorConsumerProbe({
      packageRoot: out,
      executable: process.execPath,
      args: ['-e', `process.stdout.write(process.env.${key} || 'absent')`],
      timeoutMs: 500,
    });
    assert.strictEqual(probe.status, 'PASS');
    assert.doesNotMatch(JSON.stringify(probe), /credential-value-should-not-cross-boundary/);
    assert.match(probe.diagnostic, /absent/);
  } finally {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test('Cursor consumer probe rejects relative executable paths', () => {
  const out = tmpDir('dhpk-cursor-consumer-relative-executable-');
  try {
    const probe = runCursorConsumerProbe({
      packageRoot: out,
      executable: 'bin/cursor-agent',
      args: ['--version'],
      timeoutMs: 500,
    });
    assert.strictEqual(probe.status, 'UNAVAILABLE');
    assert.match(probe.reason, /absolute path/i);
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test('Cursor PATH resolution is anchored before the probe changes cwd', () => {
  if (process.platform === 'win32') return;
  const root = tmpDir('dhpk-cursor-consumer-path-');
  const packageRoot = path.join(root, 'package');
  const trustedBin = path.join(root, 'trusted-bin');
  const packageBin = path.join(packageRoot, 'bin');
  const previousCwd = process.cwd();
  fs.mkdirSync(packageBin, { recursive: true });
  fs.mkdirSync(trustedBin);
  fs.writeFileSync(path.join(trustedBin, 'cursor-agent'), '#!/bin/sh\nprintf trusted\n', { mode: 0o755 });
  fs.writeFileSync(path.join(packageBin, 'cursor-agent'), '#!/bin/sh\nprintf package-controlled\n', { mode: 0o755 });
  try {
    process.chdir(root);
    const probe = runCursorConsumerProbe({
      packageRoot,
      pathValue: 'trusted-bin',
      args: ['--version'],
      timeoutMs: 500,
    });
    assert.strictEqual(probe.status, 'PASS');
    assert.match(probe.diagnostic, /trusted/);
    assert.doesNotMatch(probe.diagnostic, /package-controlled/);
  } finally {
    process.chdir(previousCwd);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('CLI generates and validates a Cursor package without requiring the client', () => {
  const root = makeFixture();
  const out = tmpDir('dhpk-cursor-cli-');
  const inventoryPath = path.join(root, 'manifests', 'distribution-inventory.json');
  write(inventoryPath, JSON.stringify(fixtureInventory(), null, 2) + '\n');
  try {
    const result = spawnSync('node', [
      path.join(ROOT, 'scripts', 'ci', 'gen-cursor-plugin-package.js'),
      out,
      '--repo-root', root,
      '--version=1.2.3',
    ], { encoding: 'utf8' });
    assert.strictEqual(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /PASS.*cursor-plugin/);
    assert.ok(fs.existsSync(path.join(out, '.cursor-plugin', 'plugin.json')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(out, { recursive: true, force: true });
  }
});

run('gen-cursor-plugin-package');
