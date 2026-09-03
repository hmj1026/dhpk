'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const {
  materializeCursorSyncTree,
  validateCursorSyncTree,
} = require('../scripts/lib/cursor-sync-package');

const ROOT = path.join(__dirname, '..');
const PLUGIN_ROOT_TOKEN = '${' + 'CLAUDE_PLUGIN_ROOT}';

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function fixtureInventory() {
  return {
    schema: 'dhpk.distribution-inventory.v2',
    skills: [
      {
        id: 'portable',
        name: 'dhpk-portable',
        path: 'skills/dhpk-portable',
        lifecycle: 'promoted',
        surfaces: ['cursor-sync'],
      },
    ],
    surface_membership: { 'cursor-sync': ['portable'] },
  };
}

function makeFixture() {
  const root = tmpDir('dhpk-cursor-sync-src-');
  write(path.join(root, 'skills', 'dhpk-portable', 'SKILL.md'), [
    '---',
    'name: dhpk-portable',
    "description: 'Portable skill for Cursor sync.'",
    '---',
    '# Portable',
    '',
  ].join('\n'));
  write(path.join(root, 'agents', 'reviewer.md'), [
    '---',
    'name: reviewer',
    "description: 'Review fixture changes.'",
    'tools: Read, Bash',
    'model: sonnet',
    '---',
    '# Reviewer',
    '',
    `Load ${PLUGIN_ROOT_TOKEN}/agent-traps/_common/prompt-defense.md`,
    '',
    `See ${PLUGIN_ROOT_TOKEN}/rules/model-economics.md and ${PLUGIN_ROOT_TOKEN}/agents/reviewer.md`,
    '',
    `Bare token remains only as ${PLUGIN_ROOT_TOKEN} in this fixture.`,
    '',
  ].join('\n'));
  write(path.join(root, 'rules', 'prefer-const.md'), [
    '---',
    'name: prefer-const',
    "description: 'Prefer const in fixture code.'",
    'alwaysApply: false',
    '---',
    '# Prefer const',
    '',
    `See ${PLUGIN_ROOT_TOKEN}/rules/execution-policy.md`,
    '',
  ].join('\n'));
  write(path.join(root, 'commands', 'review.md'), [
    '---',
    "description: 'Review the fixture.'",
    '---',
    '# Review command',
    '',
  ].join('\n'));
  return root;
}

test('cursor-sync generator emits relative skill links, .mdc rules, and rewritten Cursor frontmatter', () => {
  const root = makeFixture();
  const out = tmpDir('dhpk-cursor-sync-out-');
  try {
    const result = materializeCursorSyncTree({ inventory: fixtureInventory(), root, outDir: out });
    assert.strictEqual(result.skills.length, 1);
    const skillLink = path.join(out, 'skills', 'dhpk-portable');
    assert.ok(fs.lstatSync(skillLink).isSymbolicLink());
    assert.ok(!path.isAbsolute(fs.readlinkSync(skillLink)));
    assert.strictEqual(fs.realpathSync(skillLink), fs.realpathSync(path.join(root, 'skills', 'dhpk-portable')));

    const rule = fs.readFileSync(path.join(out, 'rules', 'prefer-const.mdc'), 'utf8');
    assert.ok(!fs.existsSync(path.join(out, 'rules', 'prefer-const.md')));
    assert.match(rule, /^name: prefer-const$/m);
    assert.match(rule, /^alwaysApply: false$/m);
    assert.ok(!rule.includes(PLUGIN_ROOT_TOKEN));
    assert.match(rule, /\.cursor\/dhpk\/policies\/execution-policy\.md/);

    const agent = fs.readFileSync(path.join(out, 'agents', 'reviewer.md'), 'utf8');
    assert.match(agent, /^name: reviewer$/m);
    assert.match(agent, /^model: ["']?cursor-grok-4\.6-high["']?$/m);
    assert.match(agent, /^readonly: true$/m);
    assert.doesNotMatch(agent, /^tools:/m);
    assert.ok(!agent.includes(PLUGIN_ROOT_TOKEN));
    assert.match(agent, /\.cursor\/dhpk\/agent-traps\/_common\/prompt-defense\.md/);
    assert.match(agent, /\.cursor\/rules\/model-economics\.mdc/);
    assert.match(agent, /\.cursor\/agents\/reviewer\.md/);
    assert.doesNotMatch(agent, /\.cursor\/dhpk\/rules\/model-economics/);
    assert.doesNotMatch(agent, /\.cursor\/dhpk\/agents\//);
    assert.match(agent, /Bare token remains only as \.cursor\/dhpk in this fixture/);

    const command = fs.readFileSync(path.join(out, 'commands', 'review.md'), 'utf8');
    assert.match(command, /^name: review$/m);
    assert.match(command, /^description:/m);

    const validation = validateCursorSyncTree({ root, outDir: out, inventory: fixtureInventory() });
    assert.strictEqual(validation.ok, true, validation.errors.join('\n'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test('cursor-sync regeneration is byte-identical when sources are unchanged', () => {
  const root = makeFixture();
  const first = tmpDir('dhpk-cursor-sync-a-');
  const second = tmpDir('dhpk-cursor-sync-b-');
  try {
    materializeCursorSyncTree({ inventory: fixtureInventory(), root, outDir: first });
    materializeCursorSyncTree({ inventory: fixtureInventory(), root, outDir: second });
    for (const kind of ['agents', 'rules', 'commands']) {
      const names = fs.readdirSync(path.join(first, kind)).sort();
      assert.deepStrictEqual(fs.readdirSync(path.join(second, kind)).sort(), names);
      for (const name of names) {
        assert.strictEqual(
          fs.readFileSync(path.join(first, kind, name), 'utf8'),
          fs.readFileSync(path.join(second, kind, name), 'utf8'),
        );
      }
    }
    assert.strictEqual(
      fs.readlinkSync(path.join(first, 'skills', 'dhpk-portable')),
      fs.readlinkSync(path.join(second, 'skills', 'dhpk-portable')),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(first, { recursive: true, force: true });
    fs.rmSync(second, { recursive: true, force: true });
  }
});

test('cursor-sync layout validator rejects physical skill copies, .md rules, and plugin-root leftovers', () => {
  const root = makeFixture();
  const out = tmpDir('dhpk-cursor-sync-invalid-');
  try {
    materializeCursorSyncTree({ inventory: fixtureInventory(), root, outDir: out });
    fs.rmSync(path.join(out, 'skills', 'dhpk-portable'), { force: true });
    fs.cpSync(path.join(root, 'skills', 'dhpk-portable'), path.join(out, 'skills', 'dhpk-portable'), { recursive: true });
    fs.writeFileSync(path.join(out, 'rules', 'legacy.md'), '---\nname: legacy\ndescription: leftover\nalwaysApply: false\n---\n# leftover\n');
    fs.writeFileSync(path.join(out, 'agents', 'dirty.md'), `---\nname: dirty\ndescription: leftover plugin root\nmodel: inherit\nreadonly: true\n---\n${PLUGIN_ROOT_TOKEN}/docs/contracts/x.md\n`);
    const validation = validateCursorSyncTree({ root, outDir: out, inventory: fixtureInventory() });
    assert.strictEqual(validation.ok, false);
    const joined = validation.errors.join('\n');
    assert.match(joined, /must be a relative symlink/);
    assert.match(joined, /\.mdc extension/);
    assert.match(joined, /plugin-root interpolation/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test('checked-in cursor/ projection validates against the distribution inventory', () => {
  const inventory = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests', 'distribution-inventory.json'), 'utf8'));
  const result = validateCursorSyncTree({
    root: ROOT,
    outDir: path.join(ROOT, 'cursor'),
    inventory,
  });
  assert.strictEqual(result.ok, true, result.errors.join('\n'));
});

test('gen-cursor-sync CLI writes a valid tree', () => {
  const root = makeFixture();
  const out = path.join(root, 'cursor');
  write(path.join(root, 'manifests', 'distribution-inventory.json'), `${JSON.stringify(fixtureInventory(), null, 2)}\n`);
  try {
    const res = spawnSync('node', [
      path.join(ROOT, 'scripts', 'ci', 'gen-cursor-sync.js'),
      '--repo-root', root,
      '--out-dir', out,
    ], { encoding: 'utf8', timeout: 15000 });
    assert.strictEqual(res.status, 0, `${res.stdout}\n${res.stderr}`);
    assert.match(res.stdout, /wrote 1 skill links/);
    assert.ok(fs.lstatSync(path.join(out, 'skills', 'dhpk-portable')).isSymbolicLink());
    assert.ok(fs.existsSync(path.join(out, 'rules', 'prefer-const.mdc')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('skill-mirror reconciler emits Codex and Cursor links from one canonical package', () => {
  const root = makeFixture();
  const inventory = fixtureInventory();
  inventory.skills[0].surfaces = ['codex-sync', 'cursor-sync'];
  write(path.join(root, 'manifests', 'distribution-inventory.json'), `${JSON.stringify(inventory, null, 2)}\n`);
  try {
    const res = spawnSync(process.execPath, [
      path.join(ROOT, 'scripts', 'ci', 'reconcile-skill-mirrors.js'),
      '--repo-root', root,
      '--skill', 'dhpk-portable',
    ], { encoding: 'utf8', timeout: 15000 });
    assert.strictEqual(res.status, 0, `${res.stdout}\n${res.stderr}`);
    for (const surface of ['codex', 'cursor']) {
      const mirror = path.join(root, surface, 'skills', 'dhpk-portable');
      assert.ok(fs.lstatSync(mirror).isSymbolicLink(), `${surface} mirror must be a symlink`);
      assert.strictEqual(fs.readlinkSync(mirror), '../../skills/dhpk-portable');
      assert.strictEqual(fs.realpathSync(mirror), fs.realpathSync(path.join(root, 'skills', 'dhpk-portable')));
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('skill-mirror reconciler accepts reviewed portable-family names', () => {
  const root = makeFixture();
  const inventory = fixtureInventory();
  inventory.skills[0] = {
    id: 'skill-scope',
    name: 'skill-scope',
    path: 'skills/skill-scope',
    lifecycle: 'promoted',
    name_style: 'portable-family',
    invocation_class: 'task',
    surfaces: ['codex-sync', 'cursor-sync'],
  };
  fs.rmSync(path.join(root, 'skills', 'dhpk-portable'), { recursive: true, force: true });
  write(path.join(root, 'skills', 'skill-scope', 'SKILL.md'), [
    '---',
    'name: skill-scope',
    "description: 'Reviewed portable family fixture.'",
    '---',
    '# Skill scope',
    '',
  ].join('\n'));
  write(path.join(root, 'manifests', 'distribution-inventory.json'), `${JSON.stringify(inventory, null, 2)}\n`);
  try {
    const res = spawnSync(process.execPath, [
      path.join(ROOT, 'scripts', 'ci', 'reconcile-skill-mirrors.js'),
      '--repo-root', root,
      '--skill', 'skill-scope',
    ], { encoding: 'utf8', timeout: 15000 });
    assert.strictEqual(res.status, 0, `${res.stdout}\n${res.stderr}`);
    for (const surface of ['codex', 'cursor']) {
      const mirror = path.join(root, surface, 'skills', 'skill-scope');
      assert.ok(fs.lstatSync(mirror).isSymbolicLink(), `${surface} mirror must be a symlink`);
      assert.strictEqual(fs.readlinkSync(mirror), '../../skills/skill-scope');
      assert.strictEqual(fs.realpathSync(mirror), fs.realpathSync(path.join(root, 'skills', 'skill-scope')));
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('skill-mirror reconciler refuses a symlinked Codex or Cursor surface parent', () => {
  for (const surface of ['codex', 'cursor']) {
    const root = makeFixture();
    const outside = tmpDir(`dhpk-mirror-parent-${surface}-`);
    const surfaceTarget = path.join(outside, `${surface}-target`);
    fs.mkdirSync(surfaceTarget, { recursive: true });
    const inventory = fixtureInventory();
    inventory.skills[0].surfaces = ['codex-sync', 'cursor-sync'];
    write(path.join(root, 'manifests', 'distribution-inventory.json'), `${JSON.stringify(inventory, null, 2)}\n`);
    fs.symlinkSync(surfaceTarget, path.join(root, surface), 'dir');
    try {
      const res = spawnSync(process.execPath, [
        path.join(ROOT, 'scripts', 'ci', 'reconcile-skill-mirrors.js'),
        '--repo-root', root,
        '--skill', 'dhpk-portable',
      ], { encoding: 'utf8', timeout: 15000 });
      assert.notStrictEqual(res.status, 0, `${surface} parent symlink must fail closed`);
      assert.match(`${res.stdout}\n${res.stderr}`, new RegExp(`${surface}/skills.*physical directory|symlink`, 'i'));
      assert.ok(!fs.existsSync(path.join(surfaceTarget, 'skills')), `${surface} symlink target must not be populated`);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    }
  }
});

test('skill-mirror reconciler refuses an externally linked Codex skills directory', () => {
  const root = makeFixture();
  const outside = tmpDir('dhpk-mirror-skills-outside-');
  const inventory = fixtureInventory();
  inventory.skills[0].surfaces = ['codex-sync', 'cursor-sync'];
  write(path.join(root, 'manifests', 'distribution-inventory.json'), `${JSON.stringify(inventory, null, 2)}\n`);
  fs.mkdirSync(path.join(root, 'codex'), { recursive: true });
  fs.symlinkSync(outside, path.join(root, 'codex', 'skills'), 'dir');
  try {
    const res = spawnSync(process.execPath, [
      path.join(ROOT, 'scripts', 'ci', 'reconcile-skill-mirrors.js'),
      '--repo-root', root,
      '--skill', 'dhpk-portable',
    ], { encoding: 'utf8', timeout: 15000 });
    assert.notStrictEqual(res.status, 0, 'external Codex skills link must fail closed');
    assert.match(`${res.stdout}\n${res.stderr}`, /codex\/skills.*physical directory|symlink/i);
    assert.ok(!fs.existsSync(path.join(outside, 'dhpk-portable')), 'outside directory must not be populated');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('declared empty cursor-sync membership does not fall back to agent-plugin skills', () => {
  const root = makeFixture();
  const out = tmpDir('dhpk-cursor-sync-empty-membership-');
  try {
    const inventory = {
      skills: [
        {
          id: 'portable',
          name: 'dhpk-portable',
          path: 'skills/dhpk-portable',
          lifecycle: 'promoted',
          surfaces: ['agent-plugin'],
        },
      ],
      surface_membership: { 'cursor-sync': [] },
    };
    const result = materializeCursorSyncTree({ inventory, root, outDir: out });
    assert.strictEqual(result.skills.length, 0);
    assert.deepStrictEqual(fs.readdirSync(path.join(out, 'skills')), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test('cursor-sync generator refuses to wipe canonical source trees', () => {
  const root = makeFixture();
  try {
    assert.throws(
      () => materializeCursorSyncTree({ inventory: fixtureInventory(), root, outDir: root }),
      /canonical root|overlaps canonical source tree/,
    );
    assert.ok(fs.existsSync(path.join(root, 'skills', 'dhpk-portable', 'SKILL.md')));
    assert.ok(fs.existsSync(path.join(root, 'agents', 'reviewer.md')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('cursor-sync supporting assets are rewritten into cursor/dhpk', () => {
  const root = makeFixture();
  const out = tmpDir('dhpk-cursor-sync-support-');
  write(path.join(root, 'codex', 'supporting', 'agent-traps', '_common', 'loader.md'), [
    '# Loader',
    '',
    'Read .codex/dhpk/agent-traps/<agent-name>/<S>.md',
    `Also ${PLUGIN_ROOT_TOKEN}/agent-traps/_common/prompt-defense.md`,
    '',
  ].join('\n'));
  try {
    const inventory = fixtureInventory();
    inventory.supporting_assets = [
      {
        id: 'loader',
        source: 'codex/supporting/agent-traps/_common/loader.md',
        destination: 'dhpk/agent-traps/_common/loader.md',
      },
    ];
    const result = materializeCursorSyncTree({ inventory, root, outDir: out });
    assert.ok(result.supporting.includes('dhpk/agent-traps/_common/loader.md'));
    const loader = fs.readFileSync(path.join(out, 'dhpk', 'agent-traps', '_common', 'loader.md'), 'utf8');
    assert.match(loader, /\.cursor\/dhpk\/agent-traps\/<agent-name>\/<S>\.md/);
    assert.match(loader, /\.cursor\/dhpk\/agent-traps\/_common\/prompt-defense\.md/);
    assert.ok(!loader.includes(PLUGIN_ROOT_TOKEN));
    assert.ok(!loader.includes('.codex/dhpk'));
    const validation = validateCursorSyncTree({ root, outDir: out, inventory });
    assert.strictEqual(validation.ok, true, validation.errors.join('\n'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test('Cursor agent models map general roles to Grok 4.6 and doc roles to Composer', () => {
  const root = makeFixture();
  const out = tmpDir('dhpk-cursor-sync-models-');
  write(path.join(root, 'agents', 'doc-reviewer.md'), [
    '---',
    'name: doc-reviewer',
    "description: 'Lint fixture docs.'",
    'tools: Read',
    'model: haiku',
    '---',
    '# Doc reviewer',
    '',
  ].join('\n'));
  write(path.join(root, 'agents', 'docs-lookup.md'), [
    '---',
    'name: docs-lookup',
    "description: 'Look up fixture docs.'",
    'tools: Read',
    'model: haiku',
    '---',
    '# Docs lookup',
    '',
  ].join('\n'));
  write(path.join(root, 'agents', 'doc-updater.md'), [
    '---',
    'name: doc-updater',
    "description: 'Update fixture docs.'",
    'tools: Read, Write',
    'model: haiku',
    '---',
    '# Doc updater',
    '',
  ].join('\n'));
  try {
    materializeCursorSyncTree({ inventory: fixtureInventory(), root, outDir: out });
    const reviewer = fs.readFileSync(path.join(out, 'agents', 'reviewer.md'), 'utf8');
    const docReviewer = fs.readFileSync(path.join(out, 'agents', 'doc-reviewer.md'), 'utf8');
    const docsLookup = fs.readFileSync(path.join(out, 'agents', 'docs-lookup.md'), 'utf8');
    const docUpdater = fs.readFileSync(path.join(out, 'agents', 'doc-updater.md'), 'utf8');
    assert.match(reviewer, /^model: ["']?cursor-grok-4\.6-high["']?$/m);
    assert.match(docReviewer, /^model: ["']?composer-2\.5-fast["']?$/m);
    assert.match(docsLookup, /^model: ["']?composer-2\.5-fast["']?$/m);
    assert.match(docUpdater, /^model: ["']?composer-2\.5-fast["']?$/m);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test('rewritten Cursor harness paths resolve inside the generated cursor/ tree', () => {
  const inventory = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests', 'distribution-inventory.json'), 'utf8'));
  const cursorDir = path.join(ROOT, 'cursor');
  const referenced = new Set();
  for (const kind of ['agents', 'rules', 'commands', 'dhpk']) {
    const directory = path.join(cursorDir, kind);
    if (!fs.existsSync(directory)) continue;
    const walk = (current) => {
      for (const name of fs.readdirSync(current)) {
        const full = path.join(current, name);
        if (fs.statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        const content = fs.readFileSync(full, 'utf8');
        for (const match of content.matchAll(/\.cursor\/(?:dhpk|rules|agents|commands|skills)\/[A-Za-z0-9_./-]+/g)) {
          referenced.add(match[0]);
        }
      }
    };
    walk(directory);
  }
  const missing = [...referenced].sort().filter((ref) => {
    const relative = ref.replace(/^\.cursor\//, '');
    return !fs.existsSync(path.join(cursorDir, relative));
  });
  assert.deepStrictEqual(missing, [], missing.join('\n'));
  const validation = validateCursorSyncTree({ root: ROOT, outDir: cursorDir, inventory });
  assert.strictEqual(validation.ok, true, validation.errors.join('\n'));
});

run('gen-cursor-sync');
