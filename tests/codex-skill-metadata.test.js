'use strict';

const fs = require('node:fs');
// Consolidated import from codex-supporting-parity.test.js.
const crypto = require('node:crypto');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const INVENTORY = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests', 'distribution-inventory.json'), 'utf8'));
const INVENTORY_BY_NAME = new Map(INVENTORY.skills.map((entry) => [entry.name, entry]));

// Consolidated helpers from codex-skill-layout.test.js.
const ROOT_SKILLS = path.join(ROOT, 'skills');
const CODEX_SKILLS = path.join(ROOT, 'codex', 'skills');
const PHYSICAL_SKILLS = new Set();

function directoryEntries(dir) {
  return fs.readdirSync(dir).filter((name) => {
    const entry = path.join(dir, name);
    return fs.lstatSync(entry).isDirectory() || fs.lstatSync(entry).isSymbolicLink();
  });
}

// Consolidated helpers from codex-supporting-parity.test.js.
function projectionPath(entry) {
  if (entry.destination === 'config.toml.example') return path.join(ROOT, 'codex', 'config.toml.example');
  return path.join(ROOT, 'codex', 'supporting', entry.destination.replace(/^dhpk\//, ''));
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function projectedFiles(root) {
  const result = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      assert.ok(!entry.isSymbolicLink(), `${file} must be a materialized supporting file, not a symlink`);
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile()) result.push(path.relative(ROOT, file).split(path.sep).join('/'));
    }
  }
  walk(root);
  return result;
}

function findSkillDirs(root) {
  const result = [];
  const ignored = new Set(['node_modules', 'references', 'scripts', 'assets', 'evals']);

  function walk(dir) {
    const skillFile = path.join(dir, 'SKILL.md');
    if (fs.existsSync(skillFile)) {
      result.push(dir);
      return;
    }
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ignored.has(entry.name) || !entry.isDirectory()) continue;
      walk(path.join(dir, entry.name));
    }
  }

  walk(root);
  return result.sort();
}

function parseSkillName(skillDir) {
  const content = fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8');
  const match = content.match(/^name:\s*["']?([^"'\n]+?)["']?\s*$/m);
  assert.ok(match, `${skillDir} is missing frontmatter name`);
  return match[1].trim();
}

function parseInterface(metadataPath) {
  const content = fs.readFileSync(metadataPath, 'utf8');
  const values = {};
  for (const key of ['display_name', 'short_description', 'default_prompt']) {
    const match = content.match(new RegExp(`^  ${key}: "((?:\\\\.|[^"\\\\])*)"\\s*$`, 'm'));
    assert.ok(match, `${metadataPath} is missing interface.${key}`);
    values[key] = match[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  return values;
}

test('every canonical skill package has valid Codex interface metadata', () => {
  const canonicalDirs = [
    ...findSkillDirs(path.join(ROOT, 'skills')),
    ...findSkillDirs(path.join(ROOT, 'modules')),
  ].filter((dir) => dir.includes(`${path.sep}modules${path.sep}`) || dir.includes(`${path.sep}skills${path.sep}`));

  const inventory = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests', 'distribution-inventory.json'), 'utf8'));
  assert.strictEqual(canonicalDirs.length, inventory.skills.length, 'canonical package tree drifted from the distribution inventory');
  assert.strictEqual(new Set(inventory.skills.map((entry) => entry.name)).size, inventory.skills.length, 'inventory skill names must be unique');
  assert.strictEqual(new Set(inventory.skills.map((entry) => entry.path)).size, inventory.skills.length, 'inventory skill paths must be unique');

  for (const skillDir of canonicalDirs) {
    const metadataPath = path.join(skillDir, 'agents', 'openai.yaml');
    assert.ok(fs.existsSync(metadataPath), `${skillDir} missing agents/openai.yaml`);
    const metadata = parseInterface(metadataPath);
    const skillName = parseSkillName(skillDir);
    const inventoryEntry = INVENTORY_BY_NAME.get(skillName);
    const skillPath = path.relative(ROOT, skillDir).split(path.sep).join('/');

    assert.ok(inventoryEntry, `${skillDir} is not registered in the inventory`);
    assert.strictEqual(inventoryEntry.path, skillPath, `${skillDir} must match the exact inventory path for ${skillName}`);
    assert.ok(metadata.display_name.length > 0, `${skillDir} display_name is empty`);
    assert.ok(metadata.short_description.length >= 25, `${skillDir} short_description is too short`);
    assert.ok(metadata.short_description.length <= 64, `${skillDir} short_description is too long`);
    if (inventoryEntry.invokable === false) {
      assert.ok(!metadata.default_prompt.includes(`$${skillName}`), `${skillDir} internal runtime prompt must not invite direct invocation`);
      assert.match(metadata.default_prompt, /internal|do not invoke/i, `${skillDir} internal runtime prompt must explain its boundary`);
    } else {
      assert.ok(metadata.default_prompt.includes(`$${skillName}`), `${skillDir} default_prompt must invoke $${skillName}`);
    }
  }
});

// Consolidated source cases from codex-skill-layout.test.js.
test('every Codex skill uses the root canonical skill', () => {
  const expectedNames = INVENTORY.skills
    .filter((entry) => entry.surfaces.includes('codex-sync'))
    .map((entry) => path.posix.basename(entry.path));
  const actualNames = directoryEntries(CODEX_SKILLS);
  assert.deepStrictEqual([...actualNames].sort(), [...expectedNames].sort(), 'Codex skill entries drifted from codex-sync inventory membership');

  const rootNames = new Set(directoryEntries(ROOT_SKILLS));

  for (const name of actualNames) {
    if (PHYSICAL_SKILLS.has(name) || !rootNames.has(name)) continue;

    const codexEntry = path.join(CODEX_SKILLS, name);
    const canonicalEntry = path.join(ROOT_SKILLS, name);
    assert.ok(fs.lstatSync(codexEntry).isSymbolicLink(), `${name} must be a symlink`);
    assert.strictEqual(fs.realpathSync(codexEntry), fs.realpathSync(canonicalEntry));
  }
});

test('Codex has no physical source mirrors', () => {
  const physicalNames = directoryEntries(CODEX_SKILLS)
    .filter((name) => !fs.lstatSync(path.join(CODEX_SKILLS, name)).isSymbolicLink())
    .sort();

  assert.deepStrictEqual(physicalNames, [...PHYSICAL_SKILLS].sort());
});

test('Codex plugin README reports the actual mirror entry count', () => {
  const count = directoryEntries(CODEX_SKILLS).length;
  const readme = fs.readFileSync(path.join(ROOT, '.codex-plugin', 'README.md'), 'utf8');
  assert.match(readme, new RegExp('`codex/skills/` mirror \\(' + count + ' entries\\)'));
});

// Consolidated source cases from codex-supporting-parity.test.js.
test('every inventory supporting asset has a unique id/destination and a materialized projection', () => {
  const entries = INVENTORY.supporting_assets || [];
  assert.strictEqual(new Set(entries.map((entry) => entry.id)).size, entries.length);
  assert.strictEqual(new Set(entries.map((entry) => entry.destination)).size, entries.length);
  const expectedPaths = entries.map((entry) => path.relative(ROOT, projectionPath(entry)).split(path.sep).join('/'));
  const configPath = path.join(ROOT, 'codex', 'config.toml.example');
  const configStat = fs.lstatSync(configPath);
  assert.ok(configStat.isFile() && !configStat.isSymbolicLink(), 'Codex config.toml.example must be a materialized file, not a symlink');
  const actualPaths = [
    ...projectedFiles(path.join(ROOT, 'codex', 'supporting')),
    ...(configStat.isFile() ? ['codex/config.toml.example'] : []),
  ];
  assert.deepStrictEqual([...actualPaths].sort(), [...expectedPaths].sort(), 'Codex supporting files drifted from the inventory projections');

  for (const entry of entries) {
    assert.ok(fs.existsSync(path.join(ROOT, entry.source)), `${entry.source} missing`);
    assert.ok(fs.existsSync(projectionPath(entry)), `${entry.destination} projection missing`);
  }
});

test('direct supporting assets stay byte-identical to canonical sources', () => {
  for (const entry of INVENTORY.supporting_assets || []) {
    if (entry.canonical_source) continue;
    const source = path.join(ROOT, entry.source);
    const projected = projectionPath(entry);
    assert.ok(Buffer.from(fs.readFileSync(source)).equals(Buffer.from(fs.readFileSync(projected))),
      `${entry.id} drifted from ${entry.source}`);
  }
});

test('transformed supporting assets declare canonical sources and remove Claude lifecycle mechanics', () => {
  for (const entry of INVENTORY.supporting_assets || []) {
    if (!entry.canonical_source) continue;
    const projected = fs.readFileSync(projectionPath(entry), 'utf8');
    const canonical = path.join(ROOT, entry.canonical_source);
    assert.ok(fs.existsSync(canonical), `${entry.canonical_source} missing`);
    assert.match(entry.canonical_digest || '', /^[a-f0-9]{64}$/, `${entry.id} needs a canonical digest`);
    assert.strictEqual(sha256(canonical), entry.canonical_digest, `${entry.id} canonical source drifted`);
    assert.match(entry.projection_digest || '', /^[a-f0-9]{64}$/, `${entry.id} needs a projection digest`);
    assert.strictEqual(sha256(projectionPath(entry)), entry.projection_digest, `${entry.id} projection drifted`);
    assert.doesNotMatch(projected, /\$\{CLAUDE_PLUGIN_ROOT\}|subagent-stop-verify|clear-sentinel|\.pending-/,
      `${entry.id} retains Claude lifecycle mechanics`);
    assert.doesNotMatch(projected, /\.claude\/|\bCLAUDE\.md\b/, `${entry.id} retains unreachable Claude references`);
  }
});

run('codex-skill-metadata');
