'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const { compileSkillUsageCatalog } = require('../scripts/lib/skill-usage');
const selectionApi = require('../scripts/lib/marketplace-selection');
const root = path.join(__dirname, '..');
const read = (file) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const inventory = read('manifests/distribution-inventory.json');
const selection = read('manifests/marketplace-selection.json');
const publicNames = [
  'change-verdict', 'code-trace', 'create-pr', 'dep-audit', 'flow-drive',
  'flow-guide', 'git-smart-commit', 'git-worktree', 'precommit',
  'proposal-analyze', 'release-creator', 'repo-verify', 'tdd-workflow',
  'ui-ux-verify', 'update-docs',
];
function view() {
  assert.strictEqual(typeof selectionApi.compileMarketplacePublicationView, 'function');
  return selectionApi.compileMarketplacePublicationView({ inventory, selection });
}

test('official usage lists exactly the fifteen approved public owners', () => {
  const catalog = compileSkillUsageCatalog({ inventory, publicationView: view() });
  assert.deepStrictEqual(catalog.entries.map((entry) => entry.name).sort(), publicNames);
});

test('known children and Host-only skills remain non-invokable diagnostic targets', () => {
  const publicationView = view();
  const catalog = compileSkillUsageCatalog({ inventory, publicationView });
  const owners = new Set(publicationView.publicEntries.map((entry) => entry.id));
  for (const skill of inventory.skills) {
    assert.strictEqual(catalog.runtimeIndex.targets[skill.id].codexInvokable, owners.has(skill.id), skill.id);
  }
  assert.strictEqual(catalog.runtimeIndex.targets['unknown-skill'], undefined);
});

test('usage provenance is bound to the accepted selection', () => {
  const publicationView = view();
  const catalog = compileSkillUsageCatalog({ inventory, publicationView });
  assert.strictEqual(catalog.sourceSelectionDigest, publicationView.selectionDigest);
  assert.match(catalog.sourceSelectionDigest, /^[a-f0-9]{64}$/);
});

test('an invalid publication view cannot fall back to legacy membership', () => {
  assert.throws(() => compileSkillUsageCatalog({
    inventory,
    publicationView: { errors: ['invalid owner'], publicEntries: [] },
  }), /invalid owner/);
});

test('callers without an official publication view retain legacy fixture behavior', () => {
  const catalog = compileSkillUsageCatalog({ inventory });
  assert.ok(catalog.entries.length > publicNames.length);
  assert.strictEqual(catalog.sourceSelectionDigest, undefined);
});

test('the canonical generator uses the selection and refuses a missing selection before writing', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'marketplace-usage-'));
  try {
    fs.mkdirSync(path.join(directory, 'manifests'));
    fs.writeFileSync(path.join(directory, 'manifests/distribution-inventory.json'), JSON.stringify(inventory));
    fs.writeFileSync(path.join(directory, 'manifests/marketplace-selection.json'), JSON.stringify(selection));
    const execute = () => spawnSync(process.execPath, [
      path.join(root, 'scripts/ci/gen-skill-usage.js'), '--root', directory, '--write',
    ], { encoding: 'utf8' });
    const first = execute();
    assert.strictEqual(first.status, 0, first.stderr);
    const output = path.join(directory, 'skills/flow-guide/references/codex-usage-catalog.json');
    const bytes = fs.readFileSync(output);
    assert.deepStrictEqual(JSON.parse(bytes).entries.map((entry) => entry.name).sort(), publicNames);
    assert.strictEqual(execute().status, 0);
    assert.deepStrictEqual(fs.readFileSync(output), bytes);
    fs.unlinkSync(path.join(directory, 'manifests/marketplace-selection.json'));
    const failed = execute();
    assert.notStrictEqual(failed.status, 0);
    assert.match(failed.stderr, /selection/i);
    assert.deepStrictEqual(fs.readFileSync(output), bytes);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

run('marketplace-usage-catalog');
