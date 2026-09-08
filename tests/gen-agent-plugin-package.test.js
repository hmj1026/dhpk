'use strict';

// Focused contract tests for the portable Agent Plugins projection. These use
// disposable canonical roots so invalid siblings and escaping paths can be
// tested without touching the tracked publication artifact.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const {
  AGENT_PLUGIN_SCHEMA,
  MCP_SCHEMA,
  materializeAgentPluginPackage,
  validateAgentPluginPackage,
  verifyAgentPluginPackage,
  validatePortableManifest,
  validateMcpConfig,
  fingerprintDir,
} = require('../scripts/lib/agent-plugin-package');

const ROOT = path.join(__dirname, '..');
const MANIFEST = path.join(ROOT, 'manifests', 'distribution-inventory.json');

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeSkill(root, name, frontmatter, body = '# body\n', resources = {}) {
  const dir = path.join(root, 'skills', name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\n${frontmatter}\n---\n\n${body}`);
  for (const [rel, content] of Object.entries(resources)) {
    const file = path.join(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
}

function inventoryFor(...entries) {
  return { skills: entries };
}

function packageFiles(root) {
  const files = {};
  const walk = (directory, relative = '') => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === '__pycache__' || entry.name.endsWith('.pyc')) continue;
      const absolute = path.join(directory, entry.name);
      const child = path.posix.join(relative, entry.name);
      if (entry.isDirectory()) walk(absolute, child);
      else if (entry.isFile()) files[child] = fs.readFileSync(absolute);
      else throw new Error(`unexpected package entry: ${child}`);
    }
  };
  walk(root);
  return files;
}

function assertPackageFilesEquivalent(actualFiles, expectedFiles) {
  assert.deepStrictEqual(Object.keys(actualFiles).sort(), Object.keys(expectedFiles).sort());
  for (const [key, content] of Object.entries(actualFiles)) {
    assert.ok(content.equals(expectedFiles[key]), `Content mismatch for package entry: ${key}`);
  }
}

test('portable manifest is closed and uses the Agent Plugins 1.0.0 schema', () => {
  const valid = validatePortableManifest({
    $schema: AGENT_PLUGIN_SCHEMA,
    name: 'dhpk',
    version: '1.2.3',
    description: 'portable skills',
    license: 'MIT',
    keywords: ['skills'],
  });
  assert.deepStrictEqual(valid.errors, []);

  const invalid = validatePortableManifest({
    $schema: AGENT_PLUGIN_SCHEMA,
    name: 'dhpk',
    interface: 'codex',
    skills: './skills/',
  });
  assert.ok(invalid.errors.some((error) => /unknown.*interface|interface.*unknown/i.test(error)));
  assert.ok(invalid.errors.some((error) => /unknown.*skills|skills.*unknown/i.test(error)));
});

test('materialization projects only selected skills and removes client policy from frontmatter', () => {
  const root = tmpDir('dhpk-agent-source-');
  const out = tmpDir('dhpk-agent-out-');
  try {
    writeSkill(root, 'dhpk-valid-skill', [
      'name: dhpk-valid-skill',
      "description: 'A valid portable skill'",
      "allowed-tools: 'Read Grep'",
      'disable-model-invocation: true',
      'context: fork',
      "argument-hint: '[input]'",
      'metadata:',
      '  dhpk-invocation-class: implicit-eligible',
    ].join('\n'), 'Use the skill.\n', {
      'references/guide.md': 'reference\n',
      'agents/openai.yaml': 'client-only\n',
    });
    writeSkill(root, 'dhpk-invalid-skill', 'name: Not-Portable\ndescription: broken');

    const inventory = inventoryFor(
      { id: 'valid', name: 'dhpk-valid-skill', path: 'skills/dhpk-valid-skill', lifecycle: 'promoted', surfaces: ['agent-plugin'] },
      { id: 'invalid', name: 'dhpk-invalid-skill', path: 'skills/dhpk-invalid-skill', lifecycle: 'promoted', surfaces: ['agent-plugin'] },
      { id: 'not-selected', name: 'dhpk-not-selected', path: 'skills/dhpk-not-selected', lifecycle: 'promoted', surfaces: ['claude-core'] },
    );
    const result = materializeAgentPluginPackage({
      inventory,
      root,
      outDir: out,
      version: '1.2.3',
      sourceCommit: 'abc123',
    });

    assert.deepStrictEqual(result.skillIds, ['valid']);
    assert.ok(fs.existsSync(path.join(out, 'skills', 'dhpk-valid-skill', 'SKILL.md')));
    assert.ok(!fs.existsSync(path.join(out, 'skills', 'dhpk-invalid-skill')));
    assert.ok(!fs.existsSync(path.join(out, 'skills', 'dhpk-not-selected')));
    assert.ok(!fs.existsSync(path.join(out, 'skills', 'dhpk-valid-skill', 'agents')));
    const portable = fs.readFileSync(path.join(out, 'skills', 'dhpk-valid-skill', 'SKILL.md'), 'utf8');
    assert.ok(!/^disable-model-invocation:/m.test(portable));
    assert.ok(!/^context:/m.test(portable));
    assert.ok(!/^argument-hint:/m.test(portable));
    assert.match(portable, /^name:\s*dhpk-valid-skill/m);
    assert.match(portable, /^description:/m);
    assert.match(portable, /^metadata:/m);

    const validation = validateAgentPluginPackage(out);
    assert.ok(validation.skills.valid.some((skill) => skill.name === 'dhpk-valid-skill'));
    assert.deepStrictEqual(validation.skills.invalid, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test('matrix-selected IDs are accepted while an unselected inventory skill remains absent', () => {
  const root = tmpDir('dhpk-agent-matrix-source-');
  const out = tmpDir('dhpk-agent-matrix-out-');
  try {
    writeSkill(root, 'dhpk-one', 'name: dhpk-one\ndescription: One');
    writeSkill(root, 'dhpk-two', 'name: dhpk-two\ndescription: Two');
    const inventory = {
      skills: [
        { id: 'one', name: 'dhpk-one', path: 'skills/dhpk-one', lifecycle: 'promoted', surfaces: ['claude-core'] },
        { id: 'two', name: 'dhpk-two', path: 'skills/dhpk-two', lifecycle: 'promoted', surfaces: ['claude-core'] },
      ],
      platform_matrix: [{ source_id: 'two', surface: 'agent-plugin', component: 'skill', status: 'supported' }],
    };
    const result = materializeAgentPluginPackage({ inventory, root, outDir: out });
    assert.deepStrictEqual(result.skillIds, ['two']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test('minimal selection carries declared transport runtime support without widening its selection identity', () => {
  const root = tmpDir('dhpk-agent-runtime-support-source-');
  const out = tmpDir('dhpk-agent-runtime-support-out-');
  try {
    writeSkill(root, 'dhpk-core', 'name: dhpk-core\ndescription: Core');
    writeSkill(root, 'dhpk-agy-fast-worker', 'name: dhpk-agy-fast-worker\ndescription: AGY wrapper');
    writeSkill(root, 'dhpk-cli-transport', 'name: dhpk-cli-transport\ndescription: Transport runtime');
    writeSkill(root, 'dhpk-codex-bridge', 'name: dhpk-codex-bridge\ndescription: Codex wrapper');
    const inventory = {
      skills: [
        { id: 'core', name: 'dhpk-core', path: 'skills/dhpk-core', lifecycle: 'promoted', surfaces: ['agent-plugin'] },
        { id: 'agy-fast-worker', name: 'dhpk-agy-fast-worker', path: 'skills/dhpk-agy-fast-worker', lifecycle: 'promoted', surfaces: ['agent-plugin'] },
        { id: 'cli-transport', name: 'dhpk-cli-transport', path: 'skills/dhpk-cli-transport', lifecycle: 'optional', surfaces: ['agent-plugin'] },
        { id: 'codex-bridge', name: 'dhpk-codex-bridge', path: 'skills/dhpk-codex-bridge', lifecycle: 'promoted', surfaces: ['agent-plugin'] },
      ],
      surface_membership: { 'agent-plugin': ['core', 'agy-fast-worker', 'cli-transport', 'codex-bridge'] },
      projection_contract: {
        surfaces: {
          'agent-plugin': { selection_policy: { source: 'surface_membership', precedence: ['surface_membership'] } },
        },
      },
      internal_runtime_skills: {
        'agent-plugin': ['agy-fast-worker', 'cli-transport', 'codex-bridge'],
      },
    };
    const result = materializeAgentPluginPackage({
      inventory,
      root,
      outDir: out,
      profileSelection: { profileId: 'minimal', selectedStableIds: ['core'], selectionFingerprint: 'fixture-selection' },
    });
    assert.deepStrictEqual(result.skillIds, ['agy-fast-worker', 'cli-transport', 'codex-bridge', 'core']);
    assert.deepStrictEqual(result.provenance.selectedStableIds, ['core']);
    assert.ok(fs.existsSync(path.join(out, 'skills', 'dhpk-cli-transport', 'SKILL.md')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test('missing MCP remains valid and invalid sibling MCP entries are isolated', () => {
  const root = tmpDir('dhpk-agent-mcp-source-');
  const out = tmpDir('dhpk-agent-mcp-out-');
  try {
    writeSkill(root, 'dhpk-mcp-skill', 'name: dhpk-mcp-skill\ndescription: MCP');
    const noMcp = materializeAgentPluginPackage({
      inventory: inventoryFor({ id: 'skill', name: 'dhpk-mcp-skill', path: 'skills/dhpk-mcp-skill', lifecycle: 'promoted', surfaces: ['agent-plugin'] }),
      root,
      outDir: out,
    });
    assert.ok(!fs.existsSync(path.join(out, 'mcp.json')));
    assert.ok(validateAgentPluginPackage(out).ok);
    assert.deepStrictEqual(noMcp.mcp.valid, []);

    fs.mkdirSync(path.join(out, 'bin'), { recursive: true });
    fs.mkdirSync(path.join(out, 'data'), { recursive: true });
    fs.writeFileSync(path.join(out, 'bin', 'server'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });

    const config = {
      $schema: MCP_SCHEMA,
      mcpServers: {
        valid: { type: 'stdio', command: './bin/server', cwd: './data' },
        badTransport: { type: 'telnet', command: './bin/nope' },
        escaping: { type: 'stdio', command: '../outside' },
      },
    };
    const checked = validateMcpConfig(config, out);
    assert.ok(checked.valid.some((entry) => entry.name === 'valid'));
    assert.ok(checked.invalid.length >= 2);
    assert.ok(checked.errors.some((error) => /transport|type/i.test(error)));
    assert.ok(checked.errors.some((error) => /outside|escape|relative/i.test(error)));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test('escaping selected source paths and symlinked package roots are rejected', () => {
  const root = tmpDir('dhpk-agent-escape-source-');
  const out = tmpDir('dhpk-agent-escape-out-');
  const linked = `${out}-link`;
  try {
    assert.throws(
      () => materializeAgentPluginPackage({
        inventory: inventoryFor({ id: 'escape', name: 'dhpk-escape', path: '../outside', lifecycle: 'promoted', surfaces: ['agent-plugin'] }),
        root,
        outDir: out,
      }),
      /safe relative|escape|outside/i
    );
    fs.symlinkSync(out, linked, 'dir');
    assert.throws(
      () => materializeAgentPluginPackage({
        inventory: { skills: [] },
        root,
        outDir: linked,
      }),
      /symlink/i
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(out, { recursive: true, force: true });
    fs.rmSync(linked, { recursive: true, force: true });
  }
});

test('MCP paths fail closed for dot-segment placeholders, missing files, and source symlinks', () => {
  const root = tmpDir('dhpk-agent-mcp-security-source-');
  const out = tmpDir('dhpk-agent-mcp-security-out-');
  const outside = tmpDir('dhpk-agent-mcp-security-outside-');
  try {
    writeSkill(root, 'dhpk-secure', 'name: dhpk-secure\ndescription: Secure');
    fs.writeFileSync(path.join(outside, 'mcp.json'), JSON.stringify({ $schema: MCP_SCHEMA, mcpServers: {} }));
    fs.symlinkSync(path.join(outside, 'mcp.json'), path.join(root, 'mcp.json'));
    assert.throws(
      () => materializeAgentPluginPackage({ inventory: inventoryFor({ id: 'secure', name: 'dhpk-secure', path: 'skills/dhpk-secure', surfaces: ['agent-plugin'] }), root, outDir: out, mcpConfig: 'mcp.json' }),
      /regular non-symlink|symlink/i
    );
    const invalid = validateMcpConfig({
      $schema: MCP_SCHEMA,
      mcpServers: {
        escape: { type: 'stdio', command: '${PLUGIN_ROOT}/../outside' },
        missing: { type: 'stdio', command: './bin/missing', cwd: './missing' },
      },
    }, out);
    assert.strictEqual(invalid.ok, false);
    assert.ok(invalid.errors.some((error) => /placeholder|contained|dot|exist|escape/i.test(error)));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(out, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('MCP executable configuration rejects credentials in args, env, and headers', () => {
  const out = tmpDir('dhpk-agent-mcp-credentials-');
  try {
    const checked = validateMcpConfig({
      $schema: MCP_SCHEMA,
      mcpServers: {
        stdio: { type: 'stdio', command: 'server', args: ['--token=supersecretvalue'], env: { API_TOKEN: 'literal-secret-value' } },
        http: { type: 'streamable-http', url: 'https://example.test/mcp', headers: { Authorization: 'Bearer abcdefghijklmnop' } },
      },
    }, out);
    assert.strictEqual(checked.ok, false);
    assert.ok(checked.errors.some((error) => /args|env|credential|placeholder/i.test(error)));
  } finally { fs.rmSync(out, { recursive: true, force: true }); }
});

test('Agent Plugin materialization rejects output/source overlap before deleting anything', () => {
  const root = tmpDir('dhpk-agent-overlap-source-');
  try {
    writeSkill(root, 'dhpk-overlap', 'name: dhpk-overlap\ndescription: Overlap');
    assert.throws(
      () => materializeAgentPluginPackage({ inventory: inventoryFor({ id: 'overlap', name: 'dhpk-overlap', path: 'skills/dhpk-overlap', surfaces: ['agent-plugin'] }), root, outDir: root }),
      /canonical root|overlap/i
    );
    assert.ok(fs.existsSync(path.join(root, 'skills', 'dhpk-overlap', 'SKILL.md')));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('repeated generation has stable files, fingerprints, and provenance', () => {
  const root = tmpDir('dhpk-agent-deterministic-source-');
  const outA = tmpDir('dhpk-agent-deterministic-a-');
  const outB = tmpDir('dhpk-agent-deterministic-b-');
  try {
    writeSkill(root, 'dhpk-stable', 'name: dhpk-stable\ndescription: Stable');
    const inventory = inventoryFor({ id: 'stable', name: 'dhpk-stable', path: 'skills/dhpk-stable', lifecycle: 'promoted', surfaces: ['agent-plugin'] });
    const a = materializeAgentPluginPackage({ inventory, root, outDir: outA, version: '1.0.0', sourceCommit: 'same' });
    const b = materializeAgentPluginPackage({ inventory, root, outDir: outB, version: '1.0.0', sourceCommit: 'same' });
    assert.deepStrictEqual(a.fingerprints, b.fingerprints);
    assert.deepStrictEqual(a.provenance, b.provenance);
    assert.strictEqual(fingerprintDir(outA), fingerprintDir(outB));
    assert.deepStrictEqual(validateAgentPluginPackage(outA).errors, validateAgentPluginPackage(outB).errors);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outA, { recursive: true, force: true });
    fs.rmSync(outB, { recursive: true, force: true });
  }
});

test('untracked non-source CONTEXT.md does not change generated package bytes', () => {
  const absentRoot = tmpDir('dhpk-agent-context-absent-');
  const presentRoot = tmpDir('dhpk-agent-context-present-');
  const absentOut = tmpDir('dhpk-agent-context-absent-out-');
  const presentOut = tmpDir('dhpk-agent-context-present-out-');
  try {
    const frontmatter = 'name: dhpk-flow-guide\ndescription: Flow guide';
    const reference = '[Application Session](../../../CONTEXT.md#application-session)\n';
    for (const sourceRoot of [absentRoot, presentRoot]) {
      writeSkill(sourceRoot, 'dhpk-flow-guide', frontmatter, '# Flow guide\n', {
        'references/review-gate-mechanics.md': reference,
      });
    }
    fs.writeFileSync(path.join(presentRoot, 'CONTEXT.md'), 'ignored local context\n');

    const inventory = inventoryFor({
      id: 'flow-guide',
      name: 'dhpk-flow-guide',
      path: 'skills/dhpk-flow-guide',
      lifecycle: 'promoted',
      surfaces: ['agent-plugin'],
    });
    const absent = materializeAgentPluginPackage({
      inventory,
      root: absentRoot,
      outDir: absentOut,
      version: '1.0.0',
      sourceCommit: 'same-source',
    });
    const present = materializeAgentPluginPackage({
      inventory,
      root: presentRoot,
      outDir: presentOut,
      version: '1.0.0',
      sourceCommit: 'same-source',
    });

    assert.deepStrictEqual(present.fingerprints, absent.fingerprints);
    assert.deepStrictEqual(present.provenance, absent.provenance);
    assert.strictEqual(fingerprintDir(presentOut), fingerprintDir(absentOut));
    assertPackageFilesEquivalent(packageFiles(presentOut), packageFiles(absentOut));
  } finally {
    fs.rmSync(absentRoot, { recursive: true, force: true });
    fs.rmSync(presentRoot, { recursive: true, force: true });
    fs.rmSync(absentOut, { recursive: true, force: true });
    fs.rmSync(presentOut, { recursive: true, force: true });
  }
});

test('provenance-bound links ignore untracked files while preserving tracked targets', () => {
  const root = tmpDir('dhpk-agent-provenance-source-');
  const out = tmpDir('dhpk-agent-provenance-out-');
  try {
    writeSkill(root, 'dhpk-flow-guide', 'name: dhpk-flow-guide\ndescription: Flow guide', '# Flow guide\n', {
      'references/review-gate-mechanics.md': [
        '[Application Session](../../../CONTEXT.md#application-session)',
        '[Published guide](../../../docs/guide.md#guide)',
        '',
      ].join('\n'),
    });
    fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(root, 'docs', 'guide.md'), '# Published guide\n');

    execFileSync('git', ['init', '--quiet'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    execFileSync('git', ['config', 'user.email', 'fixture@example.test'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    execFileSync('git', ['config', 'user.name', 'dhpk fixture'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    execFileSync('git', ['add', '--', 'docs/guide.md', 'skills/dhpk-flow-guide/SKILL.md', 'skills/dhpk-flow-guide/references/review-gate-mechanics.md'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    execFileSync('git', ['commit', '--quiet', '-m', 'fixture'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();

    fs.writeFileSync(path.join(root, 'CONTEXT.md'), 'ignored local context\n');
    const status = execFileSync('git', ['status', '--short', '--', 'CONTEXT.md'], { cwd: root, encoding: 'utf8' }).trim();
    assert.strictEqual(status, '?? CONTEXT.md');

    materializeAgentPluginPackage({
      inventory: inventoryFor({
        id: 'flow-guide',
        name: 'dhpk-flow-guide',
        path: 'skills/dhpk-flow-guide',
        lifecycle: 'promoted',
        surfaces: ['agent-plugin'],
      }),
      root,
      outDir: out,
      version: '1.0.0',
      sourceCommit,
    });

    const reference = fs.readFileSync(path.join(out, 'skills', 'dhpk-flow-guide', 'references', 'review-gate-mechanics.md'), 'utf8');
    assert.match(reference, /^\[Application Session\]$/m);
    assert.doesNotMatch(reference, /CONTEXT\.md/);
    assert.match(reference, /^\[Published guide\]\(https:\/\/github\.com\/hmj1026\/dhpk\/blob\/main\/docs\/guide\.md#guide\)$/m);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test('unresolvable provenance commit fails closed instead of using physical source fallback', () => {
  const root = tmpDir('dhpk-agent-unresolvable-commit-source-');
  const out = tmpDir('dhpk-agent-unresolvable-commit-out-');
  try {
    writeSkill(root, 'dhpk-flow-guide', 'name: dhpk-flow-guide\ndescription: Flow guide', '# Flow guide\n', {
      'references/review-gate-mechanics.md': '[Local context](../../../CONTEXT.md)\n',
    });
    fs.writeFileSync(path.join(root, 'CONTEXT.md'), 'physical fallback must not be used\n');
    const inventory = inventoryFor({
      id: 'flow-guide',
      name: 'dhpk-flow-guide',
      path: 'skills/dhpk-flow-guide',
      lifecycle: 'promoted',
      surfaces: ['agent-plugin'],
    });

    assert.throws(
      () => materializeAgentPluginPackage({
        inventory,
        root,
        outDir: out,
        version: '1.0.0',
        sourceCommit: '0'.repeat(40),
      }),
      /provenance|source commit|published|git|resolve/i,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test('fingerprint traversal rejects excessive directory depth before unbounded recursion', () => {
  const root = tmpDir('dhpk-agent-fingerprint-depth-');
  try {
    let current = root;
    for (let depth = 0; depth < 4; depth += 1) {
      current = path.join(current, `level-${depth}`);
      fs.mkdirSync(current);
    }
    fs.writeFileSync(path.join(current, 'SKILL.md'), 'bounded\n');
    assert.throws(
      () => fingerprintDir(root, { maxDepth: 2 }),
      /maximum directory depth/i,
    );
    assert.throws(
      () => fingerprintDir(root, { maxBytes: 1 }),
      /byte budget/i,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('projection rejects an oversized source file before readFileSync allocates it', () => {
  const root = tmpDir('dhpk-agent-projection-budget-');
  const out = tmpDir('dhpk-agent-projection-budget-out-');
  try {
    writeSkill(root, 'dhpk-budget-skill', 'name: dhpk-budget-skill\ndescription: Budget fixture');
    fs.writeFileSync(path.join(root, 'skills', 'dhpk-budget-skill', 'large.txt'), '0123456789');
    assert.throws(
      () => materializeAgentPluginPackage({
        inventory: inventoryFor({ id: 'budget', name: 'dhpk-budget-skill', path: 'skills/dhpk-budget-skill', surfaces: ['agent-plugin'] }),
        root,
        outDir: out,
        projectionLimits: { maxBytes: 1 },
      }),
      /projected byte budget/i,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test('in-root symlink cycle throws fast without memory explosion', () => {
  const root = tmpDir('dhpk-agent-cycle-source-');
  const out = tmpDir('dhpk-agent-cycle-out-');
  try {
    writeSkill(root, 'dhpk-cycle-skill', 'name: dhpk-cycle-skill\ndescription: Cycle');
    const skillDir = path.join(root, 'skills', 'dhpk-cycle-skill');
    // Create a circular symlink inside the skill directory
    fs.symlinkSync(skillDir, path.join(skillDir, 'loop'), 'dir');

    assert.throws(
      () => materializeAgentPluginPackage({
        inventory: inventoryFor({ id: 'cycle', name: 'dhpk-cycle-skill', path: 'skills/dhpk-cycle-skill', lifecycle: 'promoted', surfaces: ['agent-plugin'] }),
        root,
        outDir: out,
      }),
      /symlink cycle detected/i
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test('Agent Plugin verifier rejects symlinked package roots and ancestors before reading the package', () => {
  const realParent = tmpDir('dhpk-agent-verify-root-');
  const packageRoot = path.join(realParent, 'package');
  fs.mkdirSync(packageRoot);
  const linkParent = path.join(tmpDir('dhpk-agent-verify-parent-'), 'linked-parent');
  const linkedRoot = path.join(linkParent, 'package');
  const rootLink = path.join(tmpDir('dhpk-agent-verify-link-'), 'root-link');
  try {
    fs.symlinkSync(realParent, linkParent, 'dir');
    fs.symlinkSync(packageRoot, rootLink, 'dir');
    for (const candidate of [linkedRoot, rootLink]) {
      const result = verifyAgentPluginPackage(candidate);
      assert.strictEqual(result.ok, false);
      assert.match(result.errors.join('\n'), /symlinked Agent Plugin package root ancestor|physical Agent Plugin package root/i);
    }
  } finally {
    fs.rmSync(realParent, { recursive: true, force: true });
    fs.rmSync(path.dirname(linkParent), { recursive: true, force: true });
    fs.rmSync(path.dirname(rootLink), { recursive: true, force: true });
  }
});

test('Agent Plugin verifier turns a child fingerprint failure into a structural failure', () => {
  const packageRoot = tmpDir('dhpk-agent-verify-fingerprint-');
  const outside = tmpDir('dhpk-agent-verify-fingerprint-outside-');
  try {
    fs.writeFileSync(path.join(packageRoot, 'plugin.json'), JSON.stringify({
      $schema: AGENT_PLUGIN_SCHEMA,
      name: 'fixture',
      version: '1.0.0',
    }));
    writeSkill(packageRoot, 'fixture-skill', 'name: fixture-skill\ndescription: Fixture');
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'outside\n');
    fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(packageRoot, 'skills', 'fixture-skill', 'secret.txt'));

    const result = verifyAgentPluginPackage(packageRoot);
    assert.strictEqual(result.ok, false);
    assert.match(result.errors.join('\n'), /fingerprint failed|symlink/i);
  } finally {
    fs.rmSync(packageRoot, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('compiler-backed Agent Plugin generation is byte-equivalent to the accepted package fixture', () => {
  const out = tmpDir('dhpk-agent-equivalence-out-');
  try {
    const inventory = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
    const sourceManifest = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8'));
    const priorReceipt = JSON.parse(fs.readFileSync(path.join(ROOT, 'plugins', 'dhpk-agent', 'provenance.json'), 'utf8'));
    const profileSelection = priorReceipt.profileId ? {
      profileId: priorReceipt.profileId,
      selectedStableIds: priorReceipt.selectedStableIds,
      emittedStableIds: priorReceipt.emittedStableIds,
      compatibilityMode: priorReceipt.compatibilityMode,
      selectionPolicyVersion: priorReceipt.selectionPolicyVersion,
      selectionFingerprint: priorReceipt.selectionFingerprint,
    } : undefined;
    materializeAgentPluginPackage({
      inventory,
      root: ROOT,
      outDir: out,
      name: sourceManifest.name,
      version: sourceManifest.version,
      sourceCommit: priorReceipt.sourceCommit,
      manifestMetadata: sourceManifest,
      profileSelection,
    });
    assertPackageFilesEquivalent(packageFiles(out), packageFiles(path.join(ROOT, 'plugins', 'dhpk-agent')));
  } finally { fs.rmSync(out, { recursive: true, force: true }); }
});

run('gen-agent-plugin-package');
