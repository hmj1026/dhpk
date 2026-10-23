'use strict';

const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const fixtures = require('./_lib/install-codex-skills-fixtures');
const { parseFrontmatter } = require('../scripts/lib/agent-plugin-package');
const { extractMetadata } = require('../scripts/ci/_lib/frontmatter');
const { validateRelocatableAgentsSkillsProjection } = require('../scripts/lib/project-agent-projection-publisher');

const { ROOT, HOOK, runInstaller, projectRoot, completeTreeFingerprint, copyDistributionInventory } = fixtures;
const CURSOR_HOOK = path.join(ROOT, 'scripts', 'hooks', 'install-cursor-harness.sh');
const SKILL_NAME = 'change-verdict';

const HOSTS = [
  {
    name: 'Codex',
    source: 'codex',
    destination: '.codex',
    env: { DHPK_HARNESS_KIND: 'codex' },
  },
  {
    name: 'Cursor',
    source: 'cursor',
    destination: '.cursor',
    env: {
      DHPK_HARNESS_KIND: 'cursor',
      DHPK_SRC_REL: 'cursor',
      DHPK_DEST_REL: '.cursor',
      DHPK_SOURCE_KINDS: 'skills,agents,rules,commands',
    },
  },
];

function installDefault(host, project, pluginRoot = ROOT) {
  if (host.name === 'Codex') {
    return runInstaller(project, ['--force'], pluginRoot);
  }
  return spawnSync('bash', [CURSOR_HOOK, '--force'], {
    cwd: project,
    env: { ...process.env, ...host.env, CLAUDE_PLUGIN_ROOT: pluginRoot },
    encoding: 'utf8',
    timeout: fixtures.INSTALLER_CHILD_TIMEOUT_MS,
  });
}

function skillPaths(host, project) {
  return {
    source: path.join(ROOT, host.source, 'skills', SKILL_NAME),
    installed: path.join(project, '.agents', 'skills', SKILL_NAME),
    binding: path.join(project, host.destination, 'skills', SKILL_NAME),
    receipt: path.join(project, '.agents', '.dhpk-installed.json'),
  };
}

function legacyPluginRoot(host) {
  const pluginRoot = fs.realpathSync(fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'dhpk-legacy-metadata-plugin-')));
  fs.cpSync(path.join(ROOT, host.source), path.join(pluginRoot, host.source), { recursive: true, dereference: true });
  fs.mkdirSync(path.join(pluginRoot, '.claude-plugin'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), path.join(pluginRoot, '.claude-plugin', 'plugin.json'));
  copyDistributionInventory(pluginRoot);
  fs.rmSync(path.join(pluginRoot, 'manifests', 'profile-projection-sets.json'), { force: true });
  return pluginRoot;
}

function assertNoSymlinksRecursively(directory) {
  const pending = [directory];
  while (pending.length) {
    const current = pending.pop();
    for (const name of fs.readdirSync(current)) {
      const child = path.join(current, name);
      const stat = fs.lstatSync(child);
      assert.ok(!stat.isSymbolicLink(), `copied skill descendant must be physical: ${child}`);
      if (stat.isDirectory()) pending.push(child);
    }
  }
}

for (const host of HOSTS) {
  test(`default ${host.name} install materializes a physical skill tree without descendant symlinks`, () => {
    const project = projectRoot();
    try {
      const installed = installDefault(host, project);
      assert.strictEqual(installed.status, 0, `${installed.stdout}\n${installed.stderr}`);

      const { installed: target, binding } = skillPaths(host, project);
      assert.ok(fs.existsSync(target), `default ${host.name} install must include ${SKILL_NAME}`);
      assert.ok(!fs.lstatSync(target).isSymbolicLink(), `default ${host.name} skill directory must be materialized`);
      assertNoSymlinksRecursively(target);
      assert.ok(fs.lstatSync(binding).isSymbolicLink(), `${host.name} discovery path must bind to the shared project projection`);
      assert.strictEqual(fs.readlinkSync(binding), `../../.agents/skills/${SKILL_NAME}`);
    } finally {
      fs.rmSync(project, { recursive: true, force: true });
    }
  });

  test(`default ${host.name} install transforms metadata in the destination while receipts bind raw source and projected bytes`, () => {
    const project = projectRoot();
    try {
      const { source, installed: target, receipt: receiptPath } = skillPaths(host, project);
      const sourceMarkdownPath = path.join(source, 'SKILL.md');
      const destinationMarkdownPath = path.join(target, 'SKILL.md');
      const rawSourceMarkdown = fs.readFileSync(sourceMarkdownPath, 'utf8');
      const sourceMetadata = extractMetadata(rawSourceMarkdown).values;
      assert.strictEqual(typeof sourceMetadata['dhpk-next'], 'object', 'fixture must include a metadata map');
      assert.ok(Array.isArray(sourceMetadata['dhpk-modes']), 'fixture must include a metadata list');

      const installed = installDefault(host, project);
      assert.strictEqual(installed.status, 0, `${installed.stdout}\n${installed.stderr}`);

      assert.strictEqual(fs.readFileSync(sourceMarkdownPath, 'utf8'), rawSourceMarkdown,
        'portable metadata projection must leave the packaged source bytes unchanged');
      const projected = parseFrontmatter(fs.readFileSync(destinationMarkdownPath, 'utf8'));
      assert.strictEqual(projected.metadata['dhpk-next'], JSON.stringify(sourceMetadata['dhpk-next']),
        'the skill next-map must be JSON text in the installed portable projection');
      assert.strictEqual(projected.metadata['dhpk-modes'], JSON.stringify(sourceMetadata['dhpk-modes']),
        'the skill modes list must be JSON text in the installed portable projection');

      const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
      const entry = receipt.entries.find((candidate) => candidate.stableId === SKILL_NAME);
      assert.ok(entry, `shared projection receipt must own ${SKILL_NAME}`);
      assert.match(entry.sourceFingerprint, /^[a-f0-9]{64}$/,
        'receipt must retain a fingerprint for canonical source bytes');
      assert.strictEqual(receipt.sourceFingerprints[`skill:${SKILL_NAME}`], entry.sourceFingerprint,
        'the receipt identity map must bind the raw source fingerprint');
      assert.strictEqual(receipt.generatedFingerprints[`${SKILL_NAME}/SKILL.md`],
        crypto.createHash('sha256').update(fs.readFileSync(destinationMarkdownPath)).digest('hex'),
        'the receipt must bind the projected installed SKILL.md bytes');
      const validation = validateRelocatableAgentsSkillsProjection({
        sourceRoot: ROOT,
        projectRoot: project,
        inventory: JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests', 'distribution-inventory.json'), 'utf8')),
        requestedHosts: [host.source],
      });
      assert.strictEqual(validation.ok, true, validation.errors.join('\n'));
    } finally {
      fs.rmSync(project, { recursive: true, force: true });
    }
  });
}

for (const host of HOSTS) {
  test(`legacy ${host.name} installer copies skills and records raw and projected fingerprints`, () => {
    const project = projectRoot();
    const pluginRoot = legacyPluginRoot(host);
    try {
      const source = path.join(pluginRoot, host.source, 'skills', SKILL_NAME);
      const target = path.join(project, host.destination, 'skills', SKILL_NAME);
      const receiptPath = path.join(project, host.destination, '.dhpk-installed.json');
      const rawSourceMarkdown = fs.readFileSync(path.join(source, 'SKILL.md'), 'utf8');
      const sourceMetadata = extractMetadata(rawSourceMarkdown).values;
      const installed = installDefault(host, project, pluginRoot);
      assert.strictEqual(installed.status, 0, `${installed.stdout}\n${installed.stderr}`);
      assert.ok(fs.existsSync(target), `legacy ${host.name} installer must materialize ${SKILL_NAME}`);
      assert.ok(!fs.lstatSync(target).isSymbolicLink(), 'legacy skill directory must be physical');
      assertNoSymlinksRecursively(target);
      assert.strictEqual(fs.readFileSync(path.join(source, 'SKILL.md'), 'utf8'), rawSourceMarkdown,
        'the staging transform must leave the source package unchanged');
      const projected = parseFrontmatter(fs.readFileSync(path.join(target, 'SKILL.md'), 'utf8'));
      assert.strictEqual(projected.metadata['dhpk-next'], JSON.stringify(sourceMetadata['dhpk-next']));
      assert.strictEqual(projected.metadata['dhpk-modes'], JSON.stringify(sourceMetadata['dhpk-modes']));
      const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
      const entry = receipt.managed_entries.skills[SKILL_NAME];
      assert.ok(entry, `legacy receipt must own ${SKILL_NAME}`);
      assert.strictEqual(entry.metadata_projection, 'portable-skill-metadata.v1');
      assert.strictEqual(entry.source_fingerprint, completeTreeFingerprint(source),
        'legacy receipt source fingerprint must describe the raw packaged skill');
      assert.strictEqual(entry.destination_fingerprint, completeTreeFingerprint(target),
        'legacy receipt destination fingerprint must verify transformed installed bytes');
      assert.notStrictEqual(entry.destination_fingerprint, entry.source_fingerprint,
        'the transformed destination must not reuse the raw source fingerprint');
    } finally {
      fs.rmSync(project, { recursive: true, force: true });
      fs.rmSync(pluginRoot, { recursive: true, force: true });
    }
  });
}

run('install-codex-project-metadata');
