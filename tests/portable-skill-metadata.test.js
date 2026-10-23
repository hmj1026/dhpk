'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const {
  AGENT_PLUGIN_SCHEMA,
  materializeAgentPluginPackage,
  normalizePortableFrontmatter,
  validateAgentPluginPackage,
} = require('../scripts/lib/agent-plugin-package');
const { materializeNativePackage, verifyNativePackage } = require('../scripts/lib/codex-native-package');
const { materializeAgyPluginPackage, validateAgyPluginPackage } = require('../scripts/lib/agy-plugin-package');
const { materializeCursorPackage, validateCursorPackage } = require('../scripts/lib/cursor-plugin-package');
const { compileOpenaiSubmissionPackage } = require('../scripts/lib/openai-submission-package');

const SOURCE_COMMIT = '0123456789abcdef0123456789abcdef01234567';
const OPENAI_SCHEMA = 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json';

function temporaryRoot(prefix) {
  return fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), prefix));
}

function skillBody(name) {
  return `# ${name}\nBody preserved exactly: café.\n`;
}

function skillMarkdown(name) {
  return [
    '---',
    `name: ${name}`,
    'description: "Fixture skill."',
    'license: MIT',
    'compatibility: "Portable package source"',
    'metadata:',
    '  retained: "keep this string"',
    '  dhpk-next:',
    '    PASS: none',
    '    FAIL: none',
    '  dhpk-modes: [update, codemap]',
    '---',
    skillBody(name).trimEnd(),
    '',
  ].join('\n');
}

function writeSkill(root, name) {
  const directory = path.join(root, 'skills', name);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'SKILL.md'), skillMarkdown(name));
}

function surfaceInventory(surface, name = 'package-owner') {
  return {
    schema: 'dhpk.distribution-inventory.v2',
    skills: [{
      id: name,
      name,
      path: `skills/${name}`,
      lifecycle: 'promoted',
      surfaces: [surface],
    }],
    modules: [],
  };
}

function decodeYamlString(raw, label) {
  if (raw.startsWith('"') && raw.endsWith('"')) return JSON.parse(raw);
  if (raw.startsWith("'") && raw.endsWith("'")) return raw.slice(1, -1).replace(/''/g, "'");
  assert.fail(`${label} must be a YAML string scalar containing JSON text; got '${raw}'`);
}

function metadataString(markdown, key, label) {
  const frontmatter = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  assert.ok(frontmatter, `${label} must retain YAML frontmatter`);
  const prefix = `  ${key}:`;
  const line = frontmatter[1].split(/\r?\n/).find((entry) => entry.startsWith(prefix));
  assert.ok(line, `${label} must retain metadata.${key}`);
  return decodeYamlString(line.slice(prefix.length).trim(), `${label} metadata.${key}`);
}

function assertPortableMetadata(markdown, name, label) {
  assert.deepStrictEqual(
    JSON.parse(metadataString(markdown, 'dhpk-next', label)),
    { PASS: 'none', FAIL: 'none' },
    `${label} must preserve the map as JSON text`,
  );
  assert.deepStrictEqual(
    JSON.parse(metadataString(markdown, 'dhpk-modes', label)),
    ['update', 'codemap'],
    `${label} must preserve the list as JSON text`,
  );
  assert.strictEqual(metadataString(markdown, 'retained', label), 'keep this string');
  assert.match(markdown, /^license:\s*(?:MIT|"MIT")$/m, `${label} must preserve unrelated license frontmatter`);
  assert.match(markdown, /^compatibility:\s*(?:"Portable package source"|'Portable package source')$/m,
    `${label} must preserve unrelated compatibility frontmatter`);
  const block = markdown.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/);
  assert.ok(block, `${label} must retain a complete frontmatter block`);
  assert.strictEqual(markdown.slice(block[0].length), skillBody(name), `${label} must preserve the body`);
}

function openaiManifest() {
  return {
    $schema: OPENAI_SCHEMA,
    name: 'dhpk',
    version: '1.2.3',
    description: 'Selected developer workflow skills.',
    extensions: {
      'com.openai': {
        interface: {
          displayName: 'DHPK Skills',
          shortDescription: 'Developer workflow skills',
          longDescription: 'Selected developer workflow skills for the ChatGPT plugin listing.',
          developerName: 'DHPK',
          category: 'Developer Tools',
        },
      },
    },
  };
}

function openaiFixture(root) {
  writeSkill(root, 'package-owner');
  writeSkill(root, 'child-guide');
  return {
    root,
    inventory: {
      schema: 'dhpk.distribution-inventory.v2',
      skills: [
        { id: 'entry-owner', name: 'package-owner', path: 'skills/package-owner', lifecycle: 'promoted', profiles: ['core'], surfaces: ['agent-plugin'] },
        { id: 'child-guide', name: 'child-guide', path: 'skills/child-guide', lifecycle: 'promoted', profiles: ['core'], surfaces: ['agent-plugin'] },
      ],
      modules: [],
    },
    selection: {
      schema: 'dhpk.marketplace-selection.v1',
      skills: [
        { id: 'entry-owner', authority: 'read-only', kind: 'entry', owner: null, selection: 'common' },
        { id: 'child-guide', authority: 'guidance-only', kind: 'reference', owner: 'entry-owner', selection: 'common' },
      ],
    },
    manifest: openaiManifest(),
    sourceIdentity: { version: '1.2.3', commit: SOURCE_COMMIT },
  };
}

function openaiFile(result, filePath) {
  const file = result.files.find((entry) => entry.path === filePath);
  assert.ok(file, `submission package must include ${filePath}`);
  return file.bytes.toString('utf8');
}

function refreshAgySkillFingerprint(packageRoot, relative) {
  const file = path.join(packageRoot, relative);
  const digest = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const fingerprintsPath = path.join(packageRoot, 'fingerprints.json');
  const fingerprints = JSON.parse(fs.readFileSync(fingerprintsPath, 'utf8'));
  fingerprints.files[relative] = digest;
  fs.writeFileSync(fingerprintsPath, `${JSON.stringify(fingerprints, null, 2)}\n`);
  const provenancePath = path.join(packageRoot, 'provenance.json');
  const provenance = JSON.parse(fs.readFileSync(provenancePath, 'utf8'));
  provenance.fingerprints[relative] = digest;
  fs.writeFileSync(provenancePath, `${JSON.stringify(provenance, null, 2)}\n`);
}

test('Agent Plugin output serializes non-string metadata and remains idempotent', () => {
  const root = temporaryRoot('dhpk-portable-metadata-agent-');
  try {
    writeSkill(root, 'package-owner');
    const inventory = surfaceInventory('agent-plugin');
    const output = path.join(root, 'agent-plugin');
    const result = materializeAgentPluginPackage({
      root,
      inventory,
      outDir: output,
      version: '1.2.3',
      sourceCommit: 'abc123',
    });
    const projected = fs.readFileSync(path.join(output, 'skills/package-owner/SKILL.md'), 'utf8');

    const repeated = normalizePortableFrontmatter(projected);
    assert.strictEqual(repeated.ok, true, repeated.errors.join('\n'));
    assert.strictEqual(repeated.output, projected, 'normalizing portable output again must not change it');
    assertPortableMetadata(projected, 'package-owner', 'Agent Plugin output');
    const validation = validateAgentPluginPackage(output);
    assert.strictEqual(validation.ok, true, validation.errors.join('\n'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Codex Native output serializes non-string metadata', () => {
  const root = temporaryRoot('dhpk-portable-metadata-codex-');
  try {
    writeSkill(root, 'package-owner');
    const inventory = surfaceInventory('codex-native');
    delete inventory.skills[0].name;
    const output = path.join(root, 'codex-native');
    materializeNativePackage({ inventory, root, outDir: output, sourceCommit: SOURCE_COMMIT });
    const projected = fs.readFileSync(path.join(output, 'skills/package-owner/SKILL.md'), 'utf8');
    assertPortableMetadata(projected, 'package-owner', 'Codex Native output');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('AGY output serializes non-string metadata', () => {
  const root = temporaryRoot('dhpk-portable-metadata-agy-');
  try {
    writeSkill(root, 'package-owner');
    fs.mkdirSync(path.join(root, 'agents'), { recursive: true });
    fs.mkdirSync(path.join(root, 'rules'), { recursive: true });
    fs.writeFileSync(path.join(root, 'agents/sample.md'), [
      '---', 'name: sample', 'description: Sample', 'tools: ["view_file"]', 'model: inherit', '---', '# Agent', '',
    ].join('\n'));
    const inventory = {
      ...surfaceInventory('agy-plugin'),
      surface_membership: { 'agy-plugin': ['package-owner'] },
      agy_plugin: { agents: ['sample.md'], rules: [] },
    };
    const result = materializeAgyPluginPackage({
      root,
      inventory,
      outDir: path.join(root, 'agy-plugin'),
      version: '1.2.3',
      sourceCommit: SOURCE_COMMIT,
    });
    const projected = fs.readFileSync(path.join(result.packageRoot, 'skills/package-owner/SKILL.md'), 'utf8');
    assertPortableMetadata(projected, 'package-owner', 'AGY output');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Cursor output serializes bundled child metadata', () => {
  const root = temporaryRoot('dhpk-portable-metadata-cursor-child-');
  const sourceRoot = path.join(root, 'source');
  const output = path.join(root, 'cursor-plugin');
  try {
    writeSkill(sourceRoot, 'package-owner');
    const childDirectory = path.join(sourceRoot, 'skills/package-owner/references/child-guide');
    fs.mkdirSync(childDirectory, { recursive: true });
    fs.writeFileSync(path.join(childDirectory, 'SKILL.md'), skillMarkdown('child-guide'));
    const inventory = surfaceInventory('cursor-plugin');
    materializeCursorPackage({ inventory, root: sourceRoot, outDir: output, version: '1.2.3', sourceCommit: SOURCE_COMMIT });
    const projected = fs.readFileSync(path.join(output, 'skills/package-owner/references/child-guide/SKILL.md'), 'utf8');
    assertPortableMetadata(projected, 'child-guide', 'Cursor bundled child output');
    fs.writeFileSync(path.join(output, 'skills/package-owner/references/child-guide/SKILL.md'), skillMarkdown('child-guide'));
    const validation = validateCursorPackage({ packageRoot: output, inventory });
    assert.strictEqual(validation.ok, false, 'raw nested map/list metadata must fail Cursor package validation');
    assert.ok(validation.errors.some((error) => /child-guide.*metadata|metadata.*child-guide/i.test(error)), validation.errors.join('\n'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('OpenAI submission output serializes owner metadata', () => {
  const root = temporaryRoot('dhpk-portable-metadata-openai-owner-');
  try {
    const result = compileOpenaiSubmissionPackage(openaiFixture(root));
    assert.strictEqual(result.ok, true, result.errors.join('\n'));
    assertPortableMetadata(openaiFile(result, 'skills/package-owner/SKILL.md'), 'package-owner', 'OpenAI owner output');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('OpenAI submission output serializes bundled child metadata', () => {
  const root = temporaryRoot('dhpk-portable-metadata-openai-child-');
  try {
    const result = compileOpenaiSubmissionPackage(openaiFixture(root));
    assert.strictEqual(result.ok, true, result.errors.join('\n'));
    assertPortableMetadata(
      openaiFile(result, 'skills/package-owner/references/child-guide/SKILL.md'),
      'child-guide',
      'OpenAI bundled child output',
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Agent Plugin validation rejects structured metadata in raw package output', () => {
  const root = temporaryRoot('dhpk-portable-metadata-agent-validator-');
  try {
    fs.mkdirSync(path.join(root, 'skills/package-owner'), { recursive: true });
    fs.writeFileSync(path.join(root, 'plugin.json'), JSON.stringify({ $schema: AGENT_PLUGIN_SCHEMA, name: 'dhpk' }));
    fs.writeFileSync(path.join(root, 'skills/package-owner/SKILL.md'), skillMarkdown('package-owner'));

    const result = validateAgentPluginPackage(root);
    assert.strictEqual(result.ok, false, 'raw map/list metadata must be rejected, not normalized into a valid package');
    assert.ok(result.errors.some((error) => /metadata/i.test(error)), result.errors.join('\n'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Codex Native validation rejects structured metadata in raw package output', () => {
  const root = temporaryRoot('dhpk-portable-metadata-codex-validator-');
  try {
    writeSkill(root, 'package-owner');
    const inventory = surfaceInventory('codex-native');
    delete inventory.skills[0].name;
    const output = path.join(root, 'codex-native');
    materializeNativePackage({ inventory, root, outDir: output, sourceCommit: SOURCE_COMMIT });
    fs.writeFileSync(path.join(output, 'skills/package-owner/SKILL.md'), skillMarkdown('package-owner'));

    const result = verifyNativePackage({ packageRoot: output, inventory });
    assert.strictEqual(result.ok, false, 'raw map/list metadata must be rejected by the package validator');
    assert.ok(result.errors.some((error) => /metadata/i.test(error)), result.errors.join('\n'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('AGY validation rejects structured metadata in raw package output', () => {
  const root = temporaryRoot('dhpk-portable-metadata-agy-validator-');
  try {
    writeSkill(root, 'package-owner');
    fs.mkdirSync(path.join(root, 'agents'), { recursive: true });
    fs.mkdirSync(path.join(root, 'rules'), { recursive: true });
    fs.writeFileSync(path.join(root, 'agents/sample.md'), [
      '---', 'name: sample', 'description: Sample', 'tools: ["view_file"]', 'model: inherit', '---', '# Agent', '',
    ].join('\n'));
    const inventory = {
      ...surfaceInventory('agy-plugin'),
      surface_membership: { 'agy-plugin': ['package-owner'] },
      agy_plugin: { agents: ['sample.md'], rules: [] },
    };
    const output = path.join(root, 'agy-plugin');
    materializeAgyPluginPackage({ root, inventory, outDir: output, version: '1.2.3', sourceCommit: SOURCE_COMMIT });
    const relative = 'skills/package-owner/SKILL.md';
    fs.writeFileSync(path.join(output, relative), skillMarkdown('package-owner'));
    refreshAgySkillFingerprint(output, relative);

    const result = validateAgyPluginPackage(output, { inventory });
    assert.strictEqual(result.ok, false, 'raw map/list metadata must be rejected by the package validator');
    assert.ok(result.errors.some((error) => /metadata/i.test(error)), result.errors.join('\n'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

run('portable-skill-metadata');
