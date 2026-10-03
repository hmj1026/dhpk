'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const { compileOpenaiSubmissionPackage } = require('../scripts/lib/openai-submission-package');
const { compileMarketplaceSkillContent } = require('../scripts/lib/marketplace-skill-content');

const ROOT_SCHEMA = 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json';
const SOURCE_VERSION = '1.2.3';
const SOURCE_COMMIT = '0123456789abcdef0123456789abcdef01234567';

function sourceSkill(name, body = 'Fixture instructions.') {
  return ['---', `name: ${name}`, 'description: Fixture skill.', '---', '', body, ''].join('\n');
}

function listingManifest(interfaceOverrides = {}) {
  return {
    $schema: ROOT_SCHEMA,
    name: 'dhpk',
    version: SOURCE_VERSION,
    description: 'Selected developer workflow skills.',
    extensions: {
      'com.openai': {
        interface: {
          displayName: 'DHPK Skills',
          shortDescription: 'Developer workflow skills',
          longDescription: 'Selected developer workflow skills for the ChatGPT plugin listing.',
          developerName: 'DHPK',
          category: 'Developer Tools',
          ...interfaceOverrides,
        },
      },
    },
  };
}

function makeFixture(options = {}) {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'dhpk-openai-package-'));
  const cleanupRoots = [];
  const skills = [
    { id: 'entry-owner', name: 'package-owner', path: 'skills/package-owner', lifecycle: 'promoted', profiles: ['core'], surfaces: ['agent-plugin'] },
    { id: 'child-guide', name: 'child-guide', path: 'skills/child-guide', lifecycle: 'promoted', profiles: ['core'], surfaces: ['agent-plugin'] },
    { id: 'host-entry', name: 'host-only-entry', path: 'skills/host-only-entry', lifecycle: 'optional', profiles: ['core'], surfaces: ['claude-core'] },
    { id: 'withdrawn-skill', name: 'withdrawn-skill', path: 'skills/withdrawn-skill', lifecycle: 'deprecated', profiles: ['core'], surfaces: [] },
  ];
  const selection = {
    schema: 'dhpk.marketplace-selection.v1',
    skills: [
      { id: 'entry-owner', authority: 'read-only', kind: 'entry', owner: null, selection: 'common' },
      { id: 'child-guide', authority: 'guidance-only', kind: 'reference', owner: 'entry-owner', selection: 'common' },
      { id: 'host-entry', authority: 'guidance-only', kind: 'entry', owner: null, selection: 'host-only' },
      { id: 'withdrawn-skill', authority: 'guidance-only', kind: 'withdrawn', owner: null, selection: 'withdrawn' },
    ],
  };
  const inventory = { schema: 'dhpk.distribution-inventory.v2', skills, modules: [] };
  for (const skill of skills) {
    if (options.omitSkills && options.omitSkills.includes(skill.id)) continue;
    if (options.symlinkSkill === skill.id) continue;
    const directory = path.join(root, skill.path);
    fs.mkdirSync(directory, { recursive: true });
    if (!options.omitSkillMarkdown || !options.omitSkillMarkdown.includes(skill.id)) {
      fs.writeFileSync(path.join(directory, 'SKILL.md'), sourceSkill(skill.name));
    }
    fs.writeFileSync(path.join(directory, 'notes.md'), 'Supporting note.\n');
  }
  if (options.symlinkSkill) {
    const outside = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'dhpk-openai-outside-'));
    cleanupRoots.push(outside);
    fs.writeFileSync(path.join(outside, 'SKILL.md'), sourceSkill('package-owner'));
    fs.symlinkSync(outside, path.join(root, 'skills', 'package-owner'), 'dir');
  }
  if (options.ownerBody !== undefined) {
    fs.writeFileSync(path.join(root, 'skills', 'package-owner', 'SKILL.md'), sourceSkill('package-owner', options.ownerBody));
  }
  return {
    root,
    cleanupRoots,
    inventory: options.inventory || inventory,
    selection: options.selection || selection,
    manifest: options.manifest || listingManifest(),
    sourceIdentity: { version: SOURCE_VERSION, commit: SOURCE_COMMIT },
  };
}

function addHostRulesDependency(root, inventory) {
  const skill = {
    id: 'host-rules-guide',
    name: 'host-rules-guide',
    path: 'skills/host-rules-guide',
    lifecycle: 'optional',
    profiles: ['core'],
    surfaces: ['claude-core'],
  };
  fs.mkdirSync(path.join(root, skill.path), { recursive: true });
  fs.writeFileSync(path.join(root, skill.path, 'SKILL.md'), sourceSkill(skill.name));
  fs.mkdirSync(path.join(root, 'rules'), { recursive: true });
  fs.writeFileSync(path.join(root, 'rules', 'execution-policy.md'), 'Host execution policy.\n');
  return {
    skill,
    inventory: {
      ...inventory,
      skills: [...inventory.skills, skill],
      standalone_dependencies: {
        ...(inventory.standalone_dependencies || {}),
        [skill.name]: {
          files: [{ source: 'rules/execution-policy.md', destination: 'rules/execution-policy.md' }],
        },
      },
    },
  };
}

function compile(fixture, overrides = {}) {
  return compileOpenaiSubmissionPackage({ ...fixture, ...overrides });
}

function fileByPath(result, filePath) {
  return result.files.find((file) => file.path === filePath);
}

function errorText(result) {
  return (result.errors || []).join('\n');
}

function removeFixture(fixture) {
  fs.rmSync(fixture.root, { recursive: true, force: true });
  for (const directory of fixture.cleanupRoots || []) fs.rmSync(directory, { recursive: true, force: true });
}

function addCommonEntry(fixture, id, name) {
  const skill = { id, name, path: `skills/${name}`, lifecycle: 'promoted', profiles: ['core'], surfaces: ['agent-plugin'] };
  fixture.inventory.skills.push(skill);
  fixture.selection.skills.push({ id, authority: 'read-only', kind: 'entry', owner: null, selection: 'common' });
  const directory = path.join(fixture.root, skill.path);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'SKILL.md'), sourceSkill(name));
  fs.writeFileSync(path.join(directory, 'notes.md'), 'Supporting note.\n');
}

test('compiles a common entry into a portable plugin manifest with source provenance', () => {
  const fixture = makeFixture();
  try {
    const result = compile(fixture);
    assert.strictEqual(result.ok, true, errorText(result));
    assert.deepStrictEqual(result.errors, []);
    const plugin = JSON.parse(fileByPath(result, 'plugin.json').bytes.toString('utf8'));
    assert.strictEqual(plugin.$schema, ROOT_SCHEMA);
    assert.strictEqual(plugin.name, 'dhpk');
    assert.strictEqual(plugin.version, SOURCE_VERSION);
    assert.strictEqual(plugin.extensions['com.openai'].interface.displayName, 'DHPK Skills');
    assert.strictEqual(plugin.extensions['com.openai'].interface.category, 'Developer Tools');
    assert.ok(result.provenance.sourceIdentity);
    assert.ok(result.provenance.fileFingerprints);
  } finally {
    removeFixture(fixture);
  }
});

test('bundles common child content under its owner and rewrites its entrypoint link', () => {
  const fixture = makeFixture({ ownerBody: 'Read the [child guide](../child-guide/SKILL.md).' });
  try {
    const result = compile(fixture);
    assert.strictEqual(result.ok, true, errorText(result));
    const child = fileByPath(result, 'skills/package-owner/references/child-guide/notes.md');
    assert.ok(child, 'the selected child resource must be inside its owner package');
    const owner = fileByPath(result, 'skills/package-owner/SKILL.md').bytes.toString('utf8');
    assert.match(owner, /\]\(references\/child-guide\/SKILL\.md\)/);
    assert.doesNotMatch(owner, /\.\.\/child-guide/);
    const sourceChild = fs.readFileSync(path.join(fixture.root, 'skills', 'child-guide', 'SKILL.md'));
    assert.deepStrictEqual(fileByPath(result, 'skills/package-owner/references/child-guide/SKILL.md').bytes, sourceChild);
    assert.strictEqual(child.bytes.toString('utf8'), 'Supporting note.\n');
  } finally {
    removeFixture(fixture);
  }
});

test('omits host-only and withdrawn skills from the common submission package', () => {
  const fixture = makeFixture();
  try {
    const result = compile(fixture);
    assert.strictEqual(result.ok, true, errorText(result));
    const paths = result.files.map((file) => file.path);
    assert.ok(!paths.some((filePath) => filePath.includes('host-only-entry')));
    assert.ok(!paths.some((filePath) => filePath.includes('withdrawn-skill')));
  } finally {
    removeFixture(fixture);
  }
});

test('retains root plugin-token links only for host-only owners with an enumerated root resource', () => {
  const fixture = makeFixture();
  const hostEntry = fixture.inventory.skills.find((skill) => skill.id === 'host-entry');
  fs.writeFileSync(
    path.join(fixture.root, hostEntry.path, 'SKILL.md'),
    sourceSkill(hostEntry.name, 'Read [the policy](${CLAUDE_PLUGIN_ROOT}/rules/host-policy.md).'),
  );
  fs.mkdirSync(path.join(fixture.root, 'rules'));
  fs.writeFileSync(path.join(fixture.root, 'rules', 'host-policy.md'), 'Retained host policy.\n');
  try {
    const result = compileMarketplaceSkillContent({
      root: fixture.root,
      inventory: fixture.inventory,
      publicationView: {
        publicEntries: [],
        hostOnly: [hostEntry],
        bundledChildren: {},
        selectionDigest: 'a'.repeat(64),
      },
      retainedHostResourcePaths: new Set(['rules']),
    });
    assert.strictEqual(result.ok, true, result.errors.join('\n'));
    const hostSkill = result.files.find((file) => file.path === 'skills/host-only-entry/SKILL.md').bytes.toString('utf8');
    assert.match(hostSkill, /\]\(\$\{CLAUDE_PLUGIN_ROOT\}\/rules\/host-policy\.md\)/);
  } finally {
    removeFixture(fixture);
  }
});

test('preserves the trailing slash when linking to an existing retained host directory', () => {
  const fixture = makeFixture();
  const hostEntry = fixture.inventory.skills.find((skill) => skill.id === 'host-entry');
  fs.writeFileSync(
    path.join(fixture.root, hostEntry.path, 'SKILL.md'),
    sourceSkill(hostEntry.name, 'Browse the [host rules](${CLAUDE_PLUGIN_ROOT}/rules/).'),
  );
  fs.mkdirSync(path.join(fixture.root, 'rules'));
  fs.writeFileSync(path.join(fixture.root, 'rules', 'host-policy.md'), 'Retained host policy.\n');
  try {
    const result = compileMarketplaceSkillContent({
      root: fixture.root,
      inventory: fixture.inventory,
      publicationView: {
        publicEntries: [], hostOnly: [hostEntry], bundledChildren: {}, selectionDigest: 'a'.repeat(64),
      },
      retainedHostResourcePaths: new Set(['rules']),
    });
    assert.strictEqual(result.ok, true, result.errors.join('\n'));
    const hostSkill = result.files.find((file) => file.path === 'skills/host-only-entry/SKILL.md').bytes.toString('utf8');
    assert.match(hostSkill, /\]\(\$\{CLAUDE_PLUGIN_ROOT\}\/rules\/\)/);
  } finally {
    removeFixture(fixture);
  }
});

test('maps host-only rules directory and terminal ellipsis through packaged dependencies', () => {
  const fixture = makeFixture();
  const hostEntry = fixture.inventory.skills.find((skill) => skill.id === 'host-entry');
  const { inventory, skill: dependencySkill } = addHostRulesDependency(fixture.root, fixture.inventory);
  fs.writeFileSync(
    path.join(fixture.root, hostEntry.path, 'SKILL.md'),
    sourceSkill(
      hostEntry.name,
      'Browse [the policy directory](${CLAUDE_PLUGIN_ROOT}/rules/) or [all rules](${CLAUDE_PLUGIN_ROOT}/rules/...).',
    ),
  );
  try {
    const result = compileMarketplaceSkillContent({
      root: fixture.root,
      inventory,
      publicationView: {
        publicEntries: [],
        hostOnly: [hostEntry],
        bundledChildren: { 'host-entry': [{ id: dependencySkill.id, kind: 'reference' }] },
        selectionDigest: 'a'.repeat(64),
      },
    });
    assert.strictEqual(result.ok, true, result.errors.join('\n'));
    const hostSkill = result.files.find((file) => file.path === 'skills/host-only-entry/SKILL.md').bytes.toString('utf8');
    assert.match(hostSkill, /\]\(references\/_dependencies\/rules\/\)/);
    assert.match(hostSkill, /\]\(references\/_dependencies\/rules\/\.\.\.\)/);
    assert.ok(result.files.some((file) => file.path === 'skills/host-only-entry/references/_dependencies/rules/execution-policy.md'));
  } finally {
    removeFixture(fixture);
  }
});

test('does not infer a host-only rules directory from an unselected dependency', () => {
  const fixture = makeFixture();
  const hostEntry = fixture.inventory.skills.find((skill) => skill.id === 'host-entry');
  addHostRulesDependency(fixture.root, fixture.inventory);
  fs.writeFileSync(
    path.join(fixture.root, hostEntry.path, 'SKILL.md'),
    sourceSkill(hostEntry.name, 'Browse [all rules](${CLAUDE_PLUGIN_ROOT}/rules/...).'),
  );
  try {
    const result = compileMarketplaceSkillContent({
      root: fixture.root,
      inventory: fixture.inventory,
      publicationView: {
        publicEntries: [], hostOnly: [hostEntry], bundledChildren: {}, selectionDigest: 'a'.repeat(64),
      },
    });
    assert.strictEqual(result.ok, false);
    assert.match(result.errors.join('\n'), /missing or undeclared local resource.*rules/);
  } finally {
    removeFixture(fixture);
  }
});

test('does not let a common owner infer a host-only rules directory', () => {
  const fixture = makeFixture({ ownerBody: 'Browse [all rules](${CLAUDE_PLUGIN_ROOT}/rules/...).' });
  const hostEntry = fixture.inventory.skills.find((skill) => skill.id === 'host-entry');
  const { inventory, skill: dependencySkill } = addHostRulesDependency(fixture.root, fixture.inventory);
  try {
    const result = compileMarketplaceSkillContent({
      root: fixture.root,
      inventory,
      publicationView: {
        publicEntries: [fixture.inventory.skills[0]],
        hostOnly: [hostEntry],
        bundledChildren: { 'host-entry': [{ id: dependencySkill.id, kind: 'reference' }] },
        selectionDigest: 'a'.repeat(64),
      },
    });
    assert.strictEqual(result.ok, false);
    assert.match(result.errors.join('\n'), /missing or undeclared local resource.*rules/);
  } finally {
    removeFixture(fixture);
  }
});

test('does not let a common owner resolve links through retained host root resources', () => {
  const fixture = makeFixture({ ownerBody: 'See [the policy](${CLAUDE_PLUGIN_ROOT}/rules/host-policy.md).' });
  const hostEntry = fixture.inventory.skills.find((skill) => skill.id === 'host-entry');
  fs.mkdirSync(path.join(fixture.root, 'rules'));
  fs.writeFileSync(path.join(fixture.root, 'rules', 'host-policy.md'), 'Retained host policy.\n');
  try {
    const result = compileMarketplaceSkillContent({
      root: fixture.root,
      inventory: fixture.inventory,
      publicationView: {
        publicEntries: [fixture.inventory.skills[0]],
        hostOnly: [hostEntry],
        bundledChildren: { 'entry-owner': [] },
        selectionDigest: 'a'.repeat(64),
      },
      retainedHostResourcePaths: new Set(['rules']),
    });
    assert.strictEqual(result.ok, false);
    assert.match(result.errors.join('\n'), /links to missing or undeclared local resource/);
  } finally {
    removeFixture(fixture);
  }
});

test('rejects backslash paths and symlink descendants of retained host resources', () => {
  for (const kind of ['backslash', 'symlink', 'ancestor-symlink', 'non-normalized']) {
    const fixture = makeFixture();
    const hostEntry = fixture.inventory.skills.find((skill) => skill.id === 'host-entry');
    fs.mkdirSync(path.join(fixture.root, 'rules'));
    const name = kind === 'backslash' ? 'alias\\..\\policy.md'
      : kind === 'ancestor-symlink' ? 'linked/SKILL.md'
        : kind === 'non-normalized' ? 'sub/../policy.md' : 'alias.md';
    if (kind === 'backslash') fs.writeFileSync(path.join(fixture.root, 'rules', name), 'Private policy.');
    else if (kind === 'ancestor-symlink') fs.symlinkSync(path.join(fixture.root, 'skills/package-owner'), path.join(fixture.root, 'rules/linked'));
    else if (kind === 'non-normalized') {
      fs.mkdirSync(path.join(fixture.root, 'rules/sub'));
      fs.writeFileSync(path.join(fixture.root, 'rules/policy.md'), 'Private policy.');
    } else fs.symlinkSync(path.join(fixture.root, 'skills/package-owner/SKILL.md'), path.join(fixture.root, 'rules', name));
    fs.writeFileSync(path.join(fixture.root, hostEntry.path, 'SKILL.md'), sourceSkill(hostEntry.name, `Read \`\${CLAUDE_PLUGIN_ROOT}/rules/${name}\`.`));
    try {
      const result = compileMarketplaceSkillContent({ root: fixture.root, inventory: fixture.inventory,
        publicationView: { publicEntries: [], hostOnly: [hostEntry], bundledChildren: {}, selectionDigest: 'a'.repeat(64) },
        retainedHostResourcePaths: new Set(['rules']) });
      assert.strictEqual(result.ok, false, kind);
      assert.match(result.errors.join('\n'), /contained relative path|normalized relative path|symlink/);
    } finally { removeFixture(fixture); }
  }
});

test('does not resolve a host-only link to a missing descendant of a retained directory', () => {
  const fixture = makeFixture();
  const hostEntry = fixture.inventory.skills.find((skill) => skill.id === 'host-entry');
  fs.writeFileSync(
    path.join(fixture.root, hostEntry.path, 'SKILL.md'),
    sourceSkill(hostEntry.name, 'Read [the missing policy](${CLAUDE_PLUGIN_ROOT}/rules/missing.md).'),
  );
  fs.mkdirSync(path.join(fixture.root, 'rules'));
  try {
    const result = compileMarketplaceSkillContent({
      root: fixture.root,
      inventory: fixture.inventory,
      publicationView: {
        publicEntries: [], hostOnly: [hostEntry], bundledChildren: {}, selectionDigest: 'a'.repeat(64),
      },
      retainedHostResourcePaths: new Set(['rules']),
    });
    assert.strictEqual(result.ok, false);
    assert.match(result.errors.join('\n'), /missing or undeclared local resource.*rules\/missing\.md/);
  } finally {
    removeFixture(fixture);
  }
});

test('rejects retained host resource mappings outside shipped docs and rules roots', () => {
  const fixture = makeFixture();
  const hostEntry = fixture.inventory.skills.find((skill) => skill.id === 'host-entry');
  try {
    const result = compileMarketplaceSkillContent({
      root: fixture.root,
      inventory: fixture.inventory,
      publicationView: {
        publicEntries: [], hostOnly: [hostEntry], bundledChildren: {}, selectionDigest: 'a'.repeat(64),
      },
      retainedHostResourcePaths: new Set(['.env']),
    });
    assert.strictEqual(result.ok, false);
    assert.match(result.errors.join('\n'), /retained host resource paths must be under docs or rules/);
  } finally {
    removeFixture(fixture);
  }
});

test('fails the package when a selected child is missing its skill entrypoint', () => {
  const fixture = makeFixture({ omitSkillMarkdown: ['child-guide'] });
  try {
    const result = compile(fixture);
    assert.strictEqual(result.ok, false);
    assert.match(errorText(result), /child-guide/);
    assert.match(errorText(result), /SKILL\.md|entrypoint|missing/i);
  } finally {
    removeFixture(fixture);
  }
});

test('fails the package when a selected child has malformed frontmatter', () => {
  const fixture = makeFixture();
  fs.writeFileSync(path.join(fixture.root, 'skills', 'child-guide', 'SKILL.md'), 'name: child-guide\nmissing opening delimiter\n');
  try {
    const result = compile(fixture);
    assert.strictEqual(result.ok, false);
    assert.match(errorText(result), /child-guide/);
    assert.match(errorText(result), /frontmatter|metadata|invalid/i);
  } finally {
    removeFixture(fixture);
  }
});

test('rejects selected content reached through a symlink outside the source root', () => {
  const fixture = makeFixture({ symlinkSkill: 'entry-owner' });
  try {
    const result = compile(fixture);
    assert.strictEqual(result.ok, false);
    assert.match(errorText(result), /package-owner|entry-owner/);
    assert.match(errorText(result), /symlink|outside|contained/i);
  } finally {
    removeFixture(fixture);
  }
});

test('returns a structured error when the source root is unavailable', () => {
  const result = compileMarketplaceSkillContent({ root: '/path/that/does/not/exist', inventory: { skills: [] }, publicationView: {} });
  assert.strictEqual(result.ok, false);
  assert.deepStrictEqual(result.files, []);
  assert.strictEqual(result.bundleProvenance, null);
  assert.match(result.errors.join('\n'), /source root is unavailable/);
});

test('rejects malformed inventory input in the shared content compiler', () => {
  const fixture = makeFixture();
  try {
    const result = compileMarketplaceSkillContent({ root: fixture.root, inventory: {}, publicationView: {} });
    assert.strictEqual(result.ok, false);
    assert.match(result.errors.join('\n'), /inventory\.skills must be an array/);
  } finally {
    removeFixture(fixture);
  }
});

test('rejects an invalid publication view digest in the shared content compiler', () => {
  const fixture = makeFixture();
  try {
    const result = compileMarketplaceSkillContent({
      root: fixture.root,
      inventory: fixture.inventory,
      publicationView: { publicEntries: [], bundledChildren: {}, selectionDigest: 'bad' },
    });
    assert.strictEqual(result.ok, false);
    assert.match(result.errors.join('\n'), /selectionDigest must be a SHA-256 digest/);
  } finally {
    removeFixture(fixture);
  }
});

test('rejects non-Set explicit source allowlists in the shared content compiler', () => {
  const fixture = makeFixture();
  try {
    const result = compileMarketplaceSkillContent({
      root: fixture.root,
      inventory: fixture.inventory,
      publicationView: { publicEntries: [], bundledChildren: {}, selectionDigest: 'a'.repeat(64) },
      sourceFileAllowlist: [],
    });
    assert.strictEqual(result.ok, false);
    assert.match(result.errors.join('\n'), /sourceFileAllowlist must be a Set/);
  } finally {
    removeFixture(fixture);
  }
});

test('requires a Git checkout root when deriving tracked paths automatically', () => {
  const fixture = makeFixture();
  const subdirectory = path.join(fixture.root, 'subproject');
  fs.mkdirSync(subdirectory);
  const runGit = (args) => {
    const result = spawnSync('git', args, { cwd: fixture.root, encoding: 'utf8' });
    assert.strictEqual(result.status, 0, result.stderr);
  };
  runGit(['init']);
  runGit(['config', 'user.name', 'Fixture']);
  runGit(['config', 'user.email', 'fixture@example.test']);
  runGit(['add', '.']);
  runGit(['commit', '-m', 'fixture source']);
  try {
    const result = compile(fixture, { root: subdirectory });
    assert.strictEqual(result.ok, false);
    assert.match(errorText(result), /source root must be the Git checkout root/);
  } finally {
    removeFixture(fixture);
  }
});

test('fails closed when a Git checkout has no HEAD tree to enumerate', () => {
  const fixture = makeFixture();
  const result = spawnSync('git', ['init'], { cwd: fixture.root, encoding: 'utf8' });
  assert.strictEqual(result.status, 0, result.stderr);
  try {
    const compiled = compile(fixture);
    assert.strictEqual(compiled.ok, false);
    assert.match(errorText(compiled), /could not enumerate HEAD source paths/);
  } finally {
    removeFixture(fixture);
  }
});

test('rejects a symlink nested inside selected skill content', () => {
  const fixture = makeFixture();
  const outside = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'dhpk-openai-outside-file-'));
  fixture.cleanupRoots.push(outside);
  fs.writeFileSync(path.join(outside, 'external.md'), 'external content');
  fs.symlinkSync(path.join(outside, 'external.md'), path.join(fixture.root, 'skills', 'package-owner', 'external.md'));
  try {
    const result = compile(fixture);
    assert.strictEqual(result.ok, false);
    assert.match(errorText(result), /symlink.*external\.md/);
  } finally {
    removeFixture(fixture);
  }
});

test('rejects selected resources that are not readable UTF-8', () => {
  const fixture = makeFixture();
  fs.writeFileSync(path.join(fixture.root, 'skills', 'package-owner', 'notes.md'), Buffer.from([0xc3, 0x28]));
  try {
    const result = compile(fixture);
    assert.strictEqual(result.ok, false);
    assert.match(errorText(result), /notes\.md is not readable UTF-8/);
  } finally {
    removeFixture(fixture);
  }
});

test('excludes generated Python bytecode caches from selected source trees', () => {
  const fixture = makeFixture();
  const cache = path.join(fixture.root, 'skills', 'package-owner', '__pycache__');
  fs.mkdirSync(cache);
  fs.writeFileSync(path.join(cache, 'module.cpython-314.pyc'), Buffer.from([0xff, 0x00]));
  fs.writeFileSync(path.join(fixture.root, 'skills', 'package-owner', 'module.pyo'), Buffer.from([0xff, 0x00]));
  try {
    const result = compile(fixture);
    assert.strictEqual(result.ok, true, errorText(result));
    assert.ok(!result.files.some((file) => file.path.includes('__pycache__') || /\.(?:pyc|pyo)$/.test(file.path)));
  } finally {
    removeFixture(fixture);
  }
});

test('fails when selected Markdown refers to a missing local resource', () => {
  const fixture = makeFixture({ ownerBody: 'See [the missing guide](references/not-present.md).' });
  try {
    const result = compile(fixture);
    assert.strictEqual(result.ok, false);
    assert.match(errorText(result), /package-owner/);
    assert.match(errorText(result), /not-present\.md|missing|unresolved/i);
  } finally {
    removeFixture(fixture);
  }
});

test('rejects absolute local Markdown links', () => {
  const fixture = makeFixture({ ownerBody: 'See [outside](/etc/passwd).' });
  try {
    const result = compile(fixture);
    assert.strictEqual(result.ok, false);
    assert.match(errorText(result), /non-contained local Markdown link/);
  } finally {
    removeFixture(fixture);
  }
});

test('rewrites angle-bracket local Markdown links into the selected package', () => {
  const fixture = makeFixture({ ownerBody: 'Read [notes](<notes.md>).' });
  try {
    const result = compile(fixture);
    assert.strictEqual(result.ok, true, errorText(result));
    const owner = fileByPath(result, 'skills/package-owner/SKILL.md').bytes.toString('utf8');
    assert.match(owner, /\]\(<notes\.md>\)/);
  } finally {
    removeFixture(fixture);
  }
});

test('rewrites plain plugin-root references for declared resources', () => {
  const fixture = makeFixture({ ownerBody: 'Policy path: ${CLAUDE_PLUGIN_ROOT}/rules/tool-routing.md.' });
  fixture.inventory.standalone_dependencies = {
    'package-owner': { files: [{ source: 'rules/tool-routing.md', destination: 'rules/tool-routing.md' }] },
  };
  fs.mkdirSync(path.join(fixture.root, 'rules'), { recursive: true });
  fs.writeFileSync(path.join(fixture.root, 'rules', 'tool-routing.md'), 'Declared routing contract.\n');
  try {
    const result = compile(fixture);
    assert.strictEqual(result.ok, true, errorText(result));
    const owner = fileByPath(result, 'skills/package-owner/SKILL.md').bytes.toString('utf8');
    assert.match(owner, /Policy path: references\/_dependencies\/rules\/tool-routing\.md\./);
  } finally {
    removeFixture(fixture);
  }
});

test('rejects plain plugin-root references to undeclared files', () => {
  const fixture = makeFixture({ ownerBody: 'Policy path: ${CLAUDE_PLUGIN_ROOT}/rules/unlisted.md.' });
  try {
    const result = compile(fixture);
    assert.strictEqual(result.ok, false);
    assert.match(errorText(result), /references missing or undeclared local resource 'rules\/unlisted\.md\.'/);
  } finally {
    removeFixture(fixture);
  }
});

test('rejects a bundled child folder supplied with an invalid collection shape', () => {
  const fixture = makeFixture();
  try {
    const result = compileMarketplaceSkillContent({
      root: fixture.root,
      inventory: fixture.inventory,
      publicationView: {
        publicEntries: [fixture.inventory.skills[0]],
        bundledChildren: { 'entry-owner': {} },
        selectionDigest: 'a'.repeat(64),
      },
    });
    assert.strictEqual(result.ok, false);
    assert.match(result.errors.join('\n'), /entry-owner bundled children must be an array/);
  } finally {
    removeFixture(fixture);
  }
});

test('rejects a bundled child that is missing from the inventory', () => {
  const fixture = makeFixture();
  try {
    const result = compileMarketplaceSkillContent({
      root: fixture.root,
      inventory: fixture.inventory,
      publicationView: {
        publicEntries: [fixture.inventory.skills[0]],
        bundledChildren: { 'entry-owner': [{ id: 'missing-child' }] },
        selectionDigest: 'a'.repeat(64),
      },
    });
    assert.strictEqual(result.ok, false);
    assert.match(result.errors.join('\n'), /entry-owner child missing-child is not in inventory/);
  } finally {
    removeFixture(fixture);
  }
});

test('keeps external and fragment links while preserving local link suffixes', () => {
  const fixture = makeFixture({ ownerBody: 'See [notes](notes.md?raw=1#part), [site](https://example.test/docs), and [section](#install).' });
  try {
    const result = compile(fixture);
    assert.strictEqual(result.ok, true, errorText(result));
    const owner = fileByPath(result, 'skills/package-owner/SKILL.md').bytes.toString('utf8');
    assert.match(owner, /\]\(notes\.md\?raw=1#part\)/);
    assert.match(owner, /\]\(https:\/\/example\.test\/docs\)/);
    assert.match(owner, /\]\(#install\)/);
  } finally {
    removeFixture(fixture);
  }
});

test('rejects plugin-root Markdown links that escape the source root', () => {
  const fixture = makeFixture({ ownerBody: 'See [outside](${CLAUDE_PLUGIN_ROOT}/../outside.md).' });
  try {
    const result = compile(fixture);
    assert.strictEqual(result.ok, false);
    assert.match(errorText(result), /Markdown link escaping the source root/);
  } finally {
    removeFixture(fixture);
  }
});

test('copies only explicitly declared standalone dependencies', () => {
  const fixture = makeFixture({ ownerBody: 'Read [the routing policy](${CLAUDE_PLUGIN_ROOT}/rules/tool-routing.md).' });
  fixture.inventory.standalone_dependencies = {
    'package-owner': {
      files: [{ source: 'rules/tool-routing.md', destination: 'rules/tool-routing.md' }],
    },
  };
  fs.mkdirSync(path.join(fixture.root, 'rules'), { recursive: true });
  fs.writeFileSync(path.join(fixture.root, 'rules', 'tool-routing.md'), 'Declared routing contract.\n');
  fs.writeFileSync(path.join(fixture.root, 'rules', 'unlisted.md'), 'Must stay outside the package.\n');
  try {
    const result = compile(fixture);
    assert.strictEqual(result.ok, true, errorText(result));
    assert.strictEqual(fileByPath(result, 'skills/package-owner/references/_dependencies/rules/tool-routing.md').bytes.toString('utf8'), 'Declared routing contract.\n');
    const owner = fileByPath(result, 'skills/package-owner/SKILL.md').bytes.toString('utf8');
    assert.match(owner, /\]\(references\/_dependencies\/rules\/tool-routing\.md\)/);
    assert.ok(!result.files.some((file) => file.path === 'rules/unlisted.md'));
  } finally {
    removeFixture(fixture);
  }
});

test('copies child-declared dependencies under the parent owner and rewrites child links', () => {
  const fixture = makeFixture();
  fixture.inventory.standalone_dependencies = {
    'child-guide': { files: [{ source: 'rules/child-policy.md', destination: 'rules/child-policy.md' }] },
  };
  fs.writeFileSync(
    path.join(fixture.root, 'skills', 'child-guide', 'SKILL.md'),
    sourceSkill('child-guide', 'Read [the policy](${CLAUDE_PLUGIN_ROOT}/rules/child-policy.md).'),
  );
  fs.mkdirSync(path.join(fixture.root, 'rules'));
  fs.writeFileSync(path.join(fixture.root, 'rules', 'child-policy.md'), 'Child-specific declared policy.\n');
  try {
    const result = compile(fixture);
    assert.strictEqual(result.ok, true, errorText(result));
    assert.strictEqual(
      fileByPath(result, 'skills/package-owner/references/_dependencies/rules/child-policy.md').bytes.toString('utf8'),
      'Child-specific declared policy.\n',
    );
    const child = fileByPath(result, 'skills/package-owner/references/child-guide/SKILL.md').bytes.toString('utf8');
    assert.match(child, /\]\(\.\.\/_dependencies\/rules\/child-policy\.md\)/);
  } finally {
    removeFixture(fixture);
  }
});

test('keeps the same declared dependency inside each owner package', () => {
  const fixture = makeFixture();
  addCommonEntry(fixture, 'secondary-owner', 'secondary-owner');
  fixture.inventory.standalone_dependencies = {
    'package-owner': { files: [{ source: 'rules/tool-routing.md', destination: 'rules/tool-routing.md' }] },
    'secondary-owner': { files: [{ source: 'rules/tool-routing.md', destination: 'rules/tool-routing.md' }] },
  };
  fs.mkdirSync(path.join(fixture.root, 'rules'), { recursive: true });
  fs.writeFileSync(path.join(fixture.root, 'rules', 'tool-routing.md'), 'Shared source dependency.\n');
  try {
    const result = compile(fixture);
    assert.strictEqual(result.ok, true, errorText(result));
    assert.strictEqual(fileByPath(result, 'skills/package-owner/references/_dependencies/rules/tool-routing.md').bytes.toString('utf8'), 'Shared source dependency.\n');
    assert.strictEqual(fileByPath(result, 'skills/secondary-owner/references/_dependencies/rules/tool-routing.md').bytes.toString('utf8'), 'Shared source dependency.\n');
  } finally {
    removeFixture(fixture);
  }
});

test('rejects standalone dependency destinations that escape their owner folder', () => {
  const fixture = makeFixture();
  fixture.inventory.standalone_dependencies = {
    'package-owner': { files: [{ source: 'rules/tool-routing.md', destination: '../escape.md' }] },
  };
  fs.mkdirSync(path.join(fixture.root, 'rules'), { recursive: true });
  fs.writeFileSync(path.join(fixture.root, 'rules', 'tool-routing.md'), 'Declared routing contract.\n');
  try {
    const result = compile(fixture);
    assert.strictEqual(result.ok, false);
    assert.match(errorText(result), /standalone dependency destination.*normalized relative path/i);
    assert.ok(!result.files.some((file) => file.path.includes('escape.md')));
  } finally {
    removeFixture(fixture);
  }
});

test('rejects a standalone dependency that is not a regular file', () => {
  const fixture = makeFixture();
  fs.mkdirSync(path.join(fixture.root, 'rules'));
  fixture.inventory.standalone_dependencies = {
    'package-owner': { files: [{ source: 'rules', destination: 'rules' }] },
  };
  try {
    const result = compile(fixture);
    assert.strictEqual(result.ok, false);
    assert.match(errorText(result), /source is not a regular file: rules/);
  } finally {
    removeFixture(fixture);
  }
});

test('rejects one owner mapping a source resource to two destinations', () => {
  const fixture = makeFixture();
  fs.mkdirSync(path.join(fixture.root, 'rules'));
  fs.writeFileSync(path.join(fixture.root, 'rules', 'routing.md'), 'Routing policy.\n');
  fixture.inventory.standalone_dependencies = {
    'package-owner': { files: [
      { source: 'rules/routing.md', destination: 'policy/a.md' },
      { source: 'rules/routing.md', destination: 'policy/b.md' },
    ] },
  };
  try {
    const result = compile(fixture);
    assert.strictEqual(result.ok, false);
    assert.match(errorText(result), /maps to more than one package path for owner entry-owner/);
  } finally {
    removeFixture(fixture);
  }
});

test('rejects non-normalized inventory skill paths', () => {
  const fixture = makeFixture();
  fixture.inventory.skills[0].path = 'skills/../outside';
  try {
    const result = compile(fixture);
    assert.strictEqual(result.ok, false);
    assert.match(errorText(result), /entry-owner inventory path must be a normalized relative path/);
  } finally {
    removeFixture(fixture);
  }
});

test('rejects a declared ignored file outside an explicit source allowlist', () => {
  const fixture = makeFixture();
  fixture.inventory.standalone_dependencies = {
    'package-owner': { files: [{ source: '.env', destination: 'credentials.md' }] },
  };
  fs.writeFileSync(path.join(fixture.root, '.env'), 'SECRET=fixture-only\n');
  const sourceFileAllowlist = new Set([
    'skills/package-owner/SKILL.md',
    'skills/package-owner/notes.md',
    'skills/child-guide/SKILL.md',
    'skills/child-guide/notes.md',
  ]);
  try {
    const result = compile(fixture, { sourceFileAllowlist });
    assert.strictEqual(result.ok, false);
    assert.match(errorText(result), /\.env.*source file allowlist/i);
    assert.ok(!result.files.some((file) => file.path.includes('credentials')));
  } finally {
    removeFixture(fixture);
  }
});

test('rejects ignored files when compiling directly from a Git checkout', () => {
  const fixture = makeFixture();
  const runGit = (args) => {
    const result = spawnSync('git', args, { cwd: fixture.root, encoding: 'utf8' });
    assert.strictEqual(result.status, 0, result.stderr);
  };
  fs.writeFileSync(path.join(fixture.root, '.gitignore'), '.env\n');
  runGit(['init']);
  runGit(['config', 'user.name', 'Fixture']);
  runGit(['config', 'user.email', 'fixture@example.test']);
  runGit(['add', '.']);
  runGit(['commit', '-m', 'fixture source']);
  fixture.inventory.standalone_dependencies = {
    'package-owner': { files: [{ source: '.env', destination: 'credentials.md' }] },
  };
  fs.writeFileSync(path.join(fixture.root, '.env'), 'SECRET=fixture-only\n');
  try {
    const result = compile(fixture);
    assert.strictEqual(result.ok, false);
    assert.match(errorText(result), /\.env.*source file allowlist/i);
  } finally {
    removeFixture(fixture);
  }
});

test('records each original source file Git blob digest before relocation', () => {
  const fixture = makeFixture({ ownerBody: 'Read [the child guide](../child-guide/SKILL.md).' });
  try {
    const result = compile(fixture);
    assert.strictEqual(result.ok, true, errorText(result));
    const sourceBytes = fs.readFileSync(path.join(fixture.root, 'skills', 'package-owner', 'SKILL.md'));
    const gitBlobDigest = crypto.createHash('sha1')
      .update(Buffer.concat([Buffer.from(`blob ${sourceBytes.length}\0`), sourceBytes]))
      .digest('hex');
    const record = result.provenance.bundleProvenance.sourceToDestination.find((item) => (
      item.ownerId === 'entry-owner' && item.source === 'skills/package-owner/SKILL.md'
    ));
    assert.strictEqual(record.originalGitBlobDigest, gitBlobDigest);
  } finally {
    removeFixture(fixture);
  }
});

test('preserves executable mode on selected source files', () => {
  const fixture = makeFixture();
  const script = path.join(fixture.root, 'skills', 'package-owner', 'run.sh');
  fs.writeFileSync(script, '#!/bin/sh\nprintf fixture\n');
  fs.chmodSync(script, 0o755);
  try {
    const result = compile(fixture);
    assert.strictEqual(result.ok, true, errorText(result));
    assert.strictEqual(fileByPath(result, 'skills/package-owner/run.sh').mode, 0o755);
  } finally {
    removeFixture(fixture);
  }
});

test('records a stable generator identity in package provenance', () => {
  const fixture = makeFixture();
  try {
    const result = compile(fixture);
    assert.strictEqual(result.ok, true, errorText(result));
    assert.deepStrictEqual(result.provenance.generator, { id: 'openai-submission-package', version: '1' });
  } finally {
    removeFixture(fixture);
  }
});

test('rejects a declared standalone dependency that is absent from the source root', () => {
  const fixture = makeFixture();
  fixture.inventory.standalone_dependencies = {
    'package-owner': {
      files: [{ source: 'rules/tool-routing.md', destination: 'rules/tool-routing.md' }],
    },
  };
  try {
    const result = compile(fixture);
    assert.strictEqual(result.ok, false);
    assert.match(errorText(result), /tool-routing\.md/);
    assert.match(errorText(result), /missing|unavailable|not found/i);
  } finally {
    removeFixture(fixture);
  }
});

test('rejects duplicate destination paths rather than overwriting selected content', () => {
  const fixture = makeFixture();
  fixture.inventory.standalone_dependencies = {
    'package-owner': {
      files: [
        { source: 'rules/first.md', destination: 'rules/shared.md' },
        { source: 'rules/second.md', destination: 'rules/shared.md' },
      ],
    },
  };
  fs.mkdirSync(path.join(fixture.root, 'rules'), { recursive: true });
  fs.writeFileSync(path.join(fixture.root, 'rules', 'first.md'), 'First source.\n');
  fs.writeFileSync(path.join(fixture.root, 'rules', 'second.md'), 'Second source.\n');
  try {
    const result = compile(fixture);
    assert.strictEqual(result.ok, false);
    assert.match(errorText(result), /collision|duplicate/);
    assert.match(errorText(result), /rules\/shared\.md/);
  } finally {
    removeFixture(fixture);
  }
});

test('accepts listing values at final-submission limits', () => {
  const fixture = makeFixture({ manifest: listingManifest({
    displayName: 'D'.repeat(30),
    shortDescription: 'S'.repeat(30),
    longDescription: 'L'.repeat(4000),
    developerName: 'N'.repeat(80),
  }) });
  try {
    const accepted = compile(fixture);
    assert.strictEqual(accepted.ok, true, errorText(accepted));
  } finally {
    removeFixture(fixture);
  }
});

test('packages passive listing SVGs with their source fingerprint and Git blob provenance', () => {
  const iconPath = 'skills/package-owner/assets/dhpk-icon.svg';
  const iconBytes = Buffer.from([
    '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">',
    '<rect width="48" height="48" fill="#ffffff"/>',
    '</svg>',
    '',
  ].join('\n'));
  const fixture = makeFixture({ manifest: listingManifest({
    composerIcon: `./${iconPath}`,
    logo: `./${iconPath}`,
  }) });
  fs.mkdirSync(path.dirname(path.join(fixture.root, iconPath)), { recursive: true });
  fs.writeFileSync(path.join(fixture.root, iconPath), iconBytes);
  try {
    const result = compile(fixture);
    assert.strictEqual(result.ok, true, errorText(result));
    const packagedIcon = fileByPath(result, iconPath);
    assert.deepStrictEqual(packagedIcon.bytes, iconBytes);
    assert.strictEqual(
      result.provenance.fileFingerprints[iconPath],
      crypto.createHash('sha256').update(iconBytes).digest('hex'),
    );
    const record = result.provenance.bundleProvenance.sourceToDestination.find((item) => (
      item.source === iconPath && item.destination === iconPath
    ));
    const expectedBlob = crypto.createHash('sha1')
      .update(Buffer.concat([Buffer.from(`blob ${iconBytes.length}\0`), iconBytes]))
      .digest('hex');
    assert.strictEqual(record.originalGitBlobDigest, expectedBlob);
  } finally {
    removeFixture(fixture);
  }
});

test('rejects a listing icon that is missing from the compiled package', () => {
  const fixture = makeFixture({ manifest: listingManifest({
    composerIcon: './skills/package-owner/assets/missing.svg',
  }) });
  try {
    const result = compile(fixture);
    assert.strictEqual(result.ok, false, 'a listing reference must resolve to a bundled file');
    assert.match(errorText(result), /composerIcon|missing|asset/i);
  } finally {
    removeFixture(fixture);
  }
});

test('rejects listing icon paths that escape the compiled package', () => {
  const fixture = makeFixture({ manifest: listingManifest({ logo: '../../outside.svg' }) });
  try {
    const result = compile(fixture);
    assert.strictEqual(result.ok, false, 'listing asset paths must remain inside the package');
    assert.match(errorText(result), /logo|path|contained|traversal/i);
  } finally {
    removeFixture(fixture);
  }
});

test('rejects screenshots supplied by the skills-only submission profile', () => {
  const fixture = makeFixture({ manifest: listingManifest({
    screenshots: ['./skills/package-owner/assets/preview.png'],
  }) });
  try {
    const result = compile(fixture);
    assert.strictEqual(result.ok, false, 'skills-only listing metadata must not include screenshots');
    assert.match(errorText(result), /screenshot|unsupported|skills.only/i);
  } finally {
    removeFixture(fixture);
  }
});

test('rejects a listing display name beyond the final-submission limit', () => {
  const fixture = makeFixture({ manifest: listingManifest({ displayName: 'D'.repeat(31) }) });
  try {
    const result = compile(fixture);
    assert.strictEqual(result.ok, false);
    assert.match(errorText(result), /displayName|display name/i);
  } finally {
    removeFixture(fixture);
  }
});

test('rejects an OpenAI category outside the supported set', () => {
  const fixture = makeFixture({ manifest: listingManifest({ category: 'Developer' }) });
  try {
    const result = compile(fixture);
    assert.strictEqual(result.ok, false);
    assert.match(errorText(result), /OpenAI interface category must be one of/);
  } finally {
    removeFixture(fixture);
  }
});

test('rejects multiline listing fields that must remain single-line', () => {
  const fixture = makeFixture({ manifest: listingManifest({ shortDescription: 'First line\nsecond line' }) });
  try {
    const result = compile(fixture);
    assert.strictEqual(result.ok, false);
    assert.match(errorText(result), /shortDescription must be a single line/);
  } finally {
    removeFixture(fixture);
  }
});

test('rejects malformed source commit and tree identities', () => {
  const fixture = makeFixture();
  fixture.sourceIdentity = { version: SOURCE_VERSION, commit: 'ABC123', tree: 'not-a-tree' };
  try {
    const result = compile(fixture);
    assert.strictEqual(result.ok, false);
    assert.match(errorText(result), /sourceIdentity\.commit must be a lowercase Git object ID/);
    assert.match(errorText(result), /sourceIdentity\.tree must be a lowercase Git object ID/);
  } finally {
    removeFixture(fixture);
  }
});

test('preserves an optional source tree identity in provenance', () => {
  const fixture = makeFixture();
  fixture.sourceIdentity.tree = 'abcdefabcdefabcdefabcdefabcdefabcdefabcd';
  try {
    const result = compile(fixture);
    assert.strictEqual(result.ok, true, errorText(result));
    assert.strictEqual(result.provenance.sourceIdentity.tree, fixture.sourceIdentity.tree);
  } finally {
    removeFixture(fixture);
  }
});

test('rejects a listing that omits a required long description', () => {
  const fixture = makeFixture({ manifest: listingManifest({ longDescription: '' }) });
  try {
    const result = compile(fixture);
    assert.strictEqual(result.ok, false);
    assert.match(errorText(result), /longDescription/);
  } finally {
    removeFixture(fixture);
  }
});

test('rejects a catalog selection that omits a selected inventory row', () => {
  const fixture = makeFixture();
  fixture.selection = {
    ...fixture.selection,
    skills: fixture.selection.skills.filter((row) => row.id !== 'child-guide'),
  };
  try {
    const result = compile(fixture);
    assert.strictEqual(result.ok, false);
    assert.match(errorText(result), /child-guide/);
    assert.match(errorText(result), /missing|selection/i);
  } finally {
    removeFixture(fixture);
  }
});

test('returns a structured failure when compiler input is missing', () => {
  const result = compileOpenaiSubmissionPackage();
  assert.strictEqual(result.ok, false);
  assert.ok(Array.isArray(result.errors) && result.errors.length > 0);
  assert.deepStrictEqual(result.files, []);
});

test('produces identical file bytes when only source modification times change', () => {
  const fixture = makeFixture();
  try {
    const first = compile(fixture);
    assert.strictEqual(first.ok, true, errorText(first));
    const source = path.join(fixture.root, 'skills', 'package-owner', 'SKILL.md');
    fs.utimesSync(source, new Date('2001-01-01T00:00:00Z'), new Date('2001-01-01T00:00:00Z'));
    const second = compile(fixture);
    assert.strictEqual(second.ok, true, errorText(second));
    assert.deepStrictEqual(
      second.files.map(({ path: filePath, bytes, mode }) => ({ path: filePath, bytes: Buffer.from(bytes), mode })),
      first.files.map(({ path: filePath, bytes, mode }) => ({ path: filePath, bytes: Buffer.from(bytes), mode })),
    );
  } finally {
    removeFixture(fixture);
  }
});

test('changes file provenance when selected source content changes', () => {
  const fixture = makeFixture();
  try {
    const first = compile(fixture);
    assert.strictEqual(first.ok, true, errorText(first));
    fs.writeFileSync(path.join(fixture.root, 'skills', 'package-owner', 'SKILL.md'), sourceSkill('package-owner', 'Changed instructions.'));
    const second = compile(fixture);
    assert.strictEqual(second.ok, true, errorText(second));
    assert.notDeepStrictEqual(first.provenance.fileFingerprints, second.provenance.fileFingerprints);
  } finally {
    removeFixture(fixture);
  }
});

run('openai-submission-package');
