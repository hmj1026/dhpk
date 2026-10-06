'use strict';

// Task 6.3 acceptance through retained generators. The real catalog selects
// controlled physical skill trees; expected identities do not use its compiler.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const { materializeAgentPluginPackage } = require('../scripts/lib/agent-plugin-package');
const { materializeNativePackage } = require('../scripts/lib/codex-native-package');
const { materializeCursorPackage } = require('../scripts/lib/cursor-plugin-package');
const { materializeAgyPluginPackage } = require('../scripts/lib/agy-plugin-package');
const claude = require('../scripts/ci/gen-claude-marketplace-package');
const { loadMarketplaceHostPublication } = require('../scripts/lib/marketplace-host-publication');

const ROOT = path.resolve(__dirname, '..');
const readJson = (relative) => JSON.parse(fs.readFileSync(path.join(ROOT, relative), 'utf8'));
const INVENTORY = readJson('manifests/distribution-inventory.json');
const SELECTION = readJson('manifests/marketplace-selection.json');
const COMMON_IDS = [
  'change-verdict', 'code-trace', 'create-pr', 'dep-audit', 'flow-drive',
  'flow-guide', 'git-smart-commit', 'git-worktree', 'precommit',
  'proposal-analyze', 'release-creator', 'repo-verify', 'tdd',
  'ui-ux-verify', 'update-docs',
];
const HOSTS = [
  { name: 'Agent', surface: 'agent-plugin', generate: materializeAgentPluginPackage },
  { name: 'Codex', surface: 'codex-native', generate: materializeNativePackage },
  { name: 'Cursor', surface: 'cursor-plugin', generate: materializeCursorPackage },
  { name: 'AGY', surface: 'agy-plugin', generate: materializeAgyPluginPackage },
  { name: 'Claude', surface: 'claude-core', generate: (options) => claude.materialize({ root: options.root, out: options.outDir }) },
];
const inventoryById = new Map(INVENTORY.skills.map((skill) => [skill.id, skill]));
const CHILDREN = SELECTION.skills.filter((row) => row.selection === 'common' && row.kind !== 'entry');

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function fixture() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-host-catalog-'));
  const root = path.join(temp, 'source');
  const outDir = path.join(temp, 'package');
  for (const directory of ['agent-traps', 'agents', 'commands', 'docs', 'hooks', 'manifests', 'modules', 'rules', 'scripts', 'skills', 'templates']) {
    fs.mkdirSync(path.join(root, directory), { recursive: true });
  }
  write(path.join(root, 'manifests/distribution-inventory.json'), `${JSON.stringify(INVENTORY, null, 2)}\n`);
  write(path.join(root, 'manifests/marketplace-selection.json'), `${JSON.stringify(SELECTION, null, 2)}\n`);
  write(path.join(root, '.claude-plugin/plugin.json'), fs.readFileSync(path.join(ROOT, '.claude-plugin/plugin.json')));
  write(path.join(root, 'skills/flow-guide/references/codex-usage-catalog.json'), fs.readFileSync(path.join(ROOT, 'skills/flow-guide/references/codex-usage-catalog.json')));
  for (const skill of INVENTORY.skills) {
    const ownedChildren = CHILDREN.filter((child) => child.owner === skill.id);
    const links = ownedChildren.map((child) => {
      const relative = path.posix.relative(skill.path, `${inventoryById.get(child.id).path}/SKILL.md`);
      return `[${child.id}](${relative})`;
    });
    write(path.join(root, skill.path, 'SKILL.md'), [
      '---', `name: ${skill.name}`, 'description: Catalog projection fixture.',
      'allowed-tools: Read', 'context: fork', 'argument-hint: <input>',
      'metadata:', '  dhpk-invocation-class: implicit-eligible', '---', '',
      `# Catalog source ${skill.id}`, '[local resource](references/catalog-probe.txt)',
      ...links, '',
    ].join('\n'));
    write(path.join(root, skill.path, 'references/catalog-probe.txt'), `raw resource for ${skill.id}\n`);
    write(path.join(root, skill.path, 'scripts/catalog-probe.cjs'), "'use strict';\nmodule.exports = 'catalog-child-sentinel';\n");
  }
  for (const name of INVENTORY.agy_plugin.agents) {
    write(path.join(root, 'agents', name), `---\nname: ${name.replace(/\.md$/, '')}\ndescription: Retained agent fixture.\ntools: ["view_file"]\nmodel: inherit\n---\n# Retained agent\n`);
  }
  for (const relative of INVENTORY.agy_plugin.rules) write(path.join(root, relative), '# Retained rule\n');
  for (const declaration of Object.values(INVENTORY.standalone_dependencies || {})) {
    for (const dependency of declaration.files || []) {
      const file = path.join(root, dependency.source);
      if (!fs.existsSync(file)) write(file, 'Declared dependency fixture.\n');
    }
  }
  write(path.join(root, 'commands/catalog-route.md'), '---\ndescription: Retained command fixture.\n---\n# Retained command\n');
  return { temp, root, outDir };
}

function generate(host, state) {
  if (host.name !== 'AGY') fs.mkdirSync(state.outDir, { recursive: true });
  return host.generate({
    root: state.root,
    outDir: state.outDir,
    inventory: INVENTORY,
    version: '1.2.3',
    sourceVersion: '1.2.3',
    sourceCommit: host.name === 'AGY' ? 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' : 'fixture-source',
  });
}

function withFixture(fn) {
  const state = fixture();
  try { return fn(state); } finally { fs.rmSync(state.temp, { recursive: true, force: true }); }
}

function filesUnder(root, relative = '') {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const child = path.posix.join(relative, entry.name);
    assert.ok(!entry.isSymbolicLink(), `generated content must be physical: ${child}`);
    return entry.isDirectory() ? filesUnder(path.join(root, entry.name), child) : [child];
  }).sort();
}

function rootSkillNames(packageRoot) {
  const skills = path.join(packageRoot, 'skills');
  if (!fs.existsSync(skills)) return [];
  return fs.readdirSync(skills).filter((name) => fs.existsSync(path.join(skills, name, 'SKILL.md'))).sort();
}

function expectedHostOnly(host) {
  return SELECTION.skills.filter((row) => row.selection === 'host-only'
    && inventoryById.get(row.id).surfaces.includes(host.surface)).map((row) => inventoryById.get(row.id));
}

function readReceipt(packageRoot) {
  return JSON.parse(fs.readFileSync(path.join(packageRoot, 'provenance.json'), 'utf8'));
}

function provenanceRecords(value) {
  if (Array.isArray(value)) return value.flatMap(provenanceRecords);
  if (!value || typeof value !== 'object') return [];
  return [value, ...Object.values(value).flatMap(provenanceRecords)];
}

for (const host of HOSTS) {
  test(`${host.name} default generation publishes 15 common owners and only its supported Host-only identities`, () => withFixture((state) => {
    generate(host, state);
    const hostOnly = expectedHostOnly(host);
    const commonNames = COMMON_IDS.map((id) => inventoryById.get(id).name).sort();
    assert.strictEqual(commonNames.length, 15);
    if (host.name === 'Cursor') {
      const receipt = readReceipt(state.outDir);
      assert.deepStrictEqual(receipt.sharedSkillIds.slice().sort(), COMMON_IDS);
      assert.strictEqual(receipt.sharedSkillSurface, 'agent-plugin');
      assert.deepStrictEqual(rootSkillNames(state.outDir), hostOnly.map((skill) => skill.name).sort());
      assert.ok(fs.existsSync(path.join(state.outDir, '.cursor-plugin/plugin.json')));
    } else {
      assert.deepStrictEqual(rootSkillNames(state.outDir), [...commonNames, ...hostOnly.map((skill) => skill.name)].sort());
    }
    for (const row of SELECTION.skills.filter((candidate) => candidate.selection === 'withdrawn')) {
      assert.ok(!rootSkillNames(state.outDir).includes(inventoryById.get(row.id).name), `${row.id} must remain withdrawn`);
    }
  }));

  test(`${host.name} preserves all 45 owned child trees, contained references and resource provenance`, () => withFixture((state) => {
    generate(host, state);
    // Cursor's common content is physically owned by its Agent Plugin dependency.
    const commonRoot = host.name === 'Cursor' ? path.join(state.temp, 'shared-agent') : state.outDir;
    if (host.name === 'Cursor') generate(HOSTS[0], { ...state, outDir: commonRoot });
    const children = filesUnder(commonRoot).filter((relative) => /^skills\/[^/]+\/references\/[^/]+\/SKILL\.md$/.test(relative));
    assert.strictEqual(children.length, 45);
    const provenance = provenanceRecords(readReceipt(commonRoot));
    for (const child of CHILDREN) {
      const owner = inventoryById.get(child.owner);
      const source = inventoryById.get(child.id);
      const destination = `skills/${owner.name}/references/${source.name}`;
      assert.strictEqual(fs.readFileSync(path.join(commonRoot, destination, 'references/catalog-probe.txt'), 'utf8'), `raw resource for ${child.id}\n`);
      assert.strictEqual(fs.readFileSync(path.join(commonRoot, destination, 'scripts/catalog-probe.cjs'), 'utf8'), "'use strict';\nmodule.exports = 'catalog-child-sentinel';\n");
      const ownerContent = fs.readFileSync(path.join(commonRoot, 'skills', owner.name, 'SKILL.md'), 'utf8');
      assert.ok(ownerContent.includes(`](references/${source.name}/SKILL.md)`), `${child.id} owner link must resolve inside ${owner.name}`);
      assert.ok(provenance.some((record) => {
        const fields = Object.values(record).filter((value) => typeof value === 'string');
        return fields.some((value) => value === child.id || value.includes(`:${child.id}:`))
          && fields.includes(child.owner)
          && fields.some((value) => value === source.path || value === `${source.path}/SKILL.md`)
          && fields.includes(`${destination}/SKILL.md`);
      }), `${child.id} provenance must associate its identity, canonical source, owner and emitted document`);
    }
    const content = fs.readFileSync(path.join(commonRoot, 'skills/flow-drive/SKILL.md'), 'utf8');
    assert.strictEqual(content.split('# Catalog source flow-drive').length - 1, 1, 'Host adaptation must preserve the body exactly once');
    assert.ok(content.includes('](references/catalog-probe.txt)'), 'local resources must not become remote links');
    assert.strictEqual((content.match(/^---$/gm) || []).length, 2, 'Host adaptation must emit one frontmatter block');
    if (host.name === 'Agent' || host.name === 'Cursor') {
      assert.ok(!/^allowed-tools:|^context:|^argument-hint:/m.test(content), 'portable common content must omit client policy');
    }
  }));

  test(`${host.name} rejects a malformed owned child before replacing an existing package`, () => withFixture((state) => {
    generate(host, state);
    const before = Object.fromEntries(filesUnder(state.outDir).map((relative) => [
      relative, fs.readFileSync(path.join(state.outDir, relative)).toString('hex'),
    ]));
    const child = inventoryById.get('phpunit');
    write(path.join(state.root, child.path, 'SKILL.md'), '---\nname: WRONG-NAME\ndescription: Invalid selected child.\n---\n# Invalid child\n');
    assert.throws(() => generate(host, state), /phpunit|WRONG-NAME/i);
    const after = Object.fromEntries(filesUnder(state.outDir).map((relative) => [
      relative, fs.readFileSync(path.join(state.outDir, relative)).toString('hex'),
    ]));
    assert.deepStrictEqual(after, before, 'failed child validation must preserve the previous owned package bytes');
  }));
}

test('rejects an oversized selection manifest before reading its content', () => withFixture((state) => {
  const selectionPath = path.join(state.root, 'manifests/marketplace-selection.json');
  const fd = fs.openSync(selectionPath, 'w');
  fs.ftruncateSync(fd, 4 * 1024 * 1024 + 1);
  fs.closeSync(fd);
  const readFile = fs.readFileSync;
  let contentReads = 0;
  fs.readFileSync = function (file, ...options) {
    if (file === selectionPath || typeof file === 'number') contentReads += 1;
    return readFile.call(this, file, ...options);
  };
  try {
    assert.throws(() => loadMarketplaceHostPublication({ root: state.root, inventory: INVENTORY, hostSurface: 'codex-native' }), /exceed|budget|size/i);
    assert.strictEqual(contentReads, 0, 'large manifest must fail before allocation');
  } finally { fs.readFileSync = readFile; }
}));

run('marketplace-host-catalog');
