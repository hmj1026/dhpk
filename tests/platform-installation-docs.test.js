'use strict';

// Cross-file contract for the platform installation SSOT. This deliberately
// checks links and status vocabulary rather than attempting to prove a live
// Codex or Cursor consumer from repository prose.

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const STATUS = ['PASS', 'FAIL', 'NOT_RUN', 'NOT_CONFIGURED', 'SKIP_INCOMPATIBLE', 'BLOCKED', 'UNAVAILABLE'];

function currentCodexRoleCounts() {
  const roles = fs.readdirSync(path.join(ROOT, 'codex', 'agents'))
    .filter((entry) => entry.endsWith('.toml'));
  const projection = JSON.parse(read('codex/agent-projection-manifest.json'));
  return {
    direct: roles.length,
    generated: projection.generated_roles.length,
  };
}

test('bilingual installation SSOT exists and exposes every canonical status', () => {
  const english = read('docs/platform-installation.md');
  const chinese = read('docs/platform-installation.zh-TW.md');
  for (const status of STATUS) {
    assert.ok(english.includes(`\`${status}\``), `English SSOT missing ${status}`);
    assert.ok(chinese.includes(`\`${status}\``), `Traditional Chinese SSOT missing ${status}`);
  }
  assert.ok(english.includes('platform-installation.zh-TW.md'));
  assert.ok(chinese.includes('platform-installation.md'));
});

test('installation routes remain separate and point to the SSOT', () => {
  const docs = [
    'README.md', 'README.zh-TW.md',
    'docs/basic-operations.md', 'docs/basic-operations.zh-TW.md',
    'docs/configuration.md', 'docs/configuration.zh-TW.md',
    'docs/distribution-surfaces.md', 'docs/distribution-surfaces.zh-TW.md',
    'docs/skill-platform-migration.md', 'docs/skill-platform-migration.zh-TW.md',
    'codex/README.md', 'codex/README.zh-TW.md', 'codex/AGENTS.md',
    '.codex-plugin/README.md', 'plugins/dhpk/README.md', 'plugins/dhpk/README.zh-TW.md',
  ];
  for (const rel of docs) {
    const text = read(rel);
    assert.match(text, /platform-installation(?:\.zh-TW)?\.md/, `${rel} must link the canonical guide`);
  }
  const english = read('docs/platform-installation.md');
  for (const token of [
    'install-codex-skills.sh',
    'schema-v3',
    'codex plugin marketplace add',
    'plugins/dhpk-agent/',
    'plugins/dhpk-cursor/',
    'mcp.json',
    'SKIP_INCOMPATIBLE',
    'UNAVAILABLE',
  ]) assert.ok(english.includes(token), `SSOT missing ${token}`);
});

test('Codex verification commands declare consumer and checkout roots', () => {
  for (const relative of ['docs/platform-installation.md', 'docs/platform-installation.zh-TW.md']) {
    const text = read(relative);
    assert.ok(text.includes('test -f .codex/.dhpk-installed.json'),
      `${relative} must keep the consumer-root receipt check`);
    assert.ok(text.includes('DHPK_ROOT=/absolute/path/to/dhpk'),
      `${relative} must declare the dhpk checkout root`);
    assert.ok(text.includes('node "$DHPK_ROOT/scripts/ci/validate-openai-metadata.js" --root "$DHPK_ROOT"'),
      `${relative} must qualify the metadata validator with DHPK_ROOT`);
    assert.ok(text.includes('node "$DHPK_ROOT/tests/install-codex-skills.test.js"'),
      `${relative} must qualify the installer test with DHPK_ROOT`);
    assert.ok(!text.includes('node scripts/ci/validate-openai-metadata.js --root .'),
      `${relative} must not run the source validator from the consumer root`);
    assert.ok(!text.includes('node tests/install-codex-skills.test.js'),
      `${relative} must not run the source test from the consumer root`);
  }
});

test('current Codex operational docs match the projection role counts', () => {
  const { direct, generated } = currentCodexRoleCounts();
  for (const relative of [
    'docs/basic-operations.md',
    'docs/basic-operations.zh-TW.md',
    'docs/configuration.md',
    'docs/configuration.zh-TW.md',
  ]) {
    const text = read(relative);
    assert.ok(text.includes('codex/agents/'), `${relative} must identify the Codex agent projection`);
    assert.match(text, new RegExp(`${direct}[\\s\\S]{0,120}(?:direct\\s+roles?|個\\s+direct\\s+role)`, 'i'),
      `${relative} must document ${direct} direct Codex roles`);
    assert.match(text, new RegExp(`${generated}[\\s\\S]{0,120}(?:generated|產生)`, 'i'),
      `${relative} must document ${generated} generated Codex roles`);
  }
});

test('inventory declares explicit platform matrix and frontmatter ownership', () => {
  const inventory = JSON.parse(read('manifests/distribution-inventory.json'));
  assert.deepStrictEqual(inventory.surfaces.slice(-2), ['agent-plugin', 'cursor-plugin']);
  assert.ok(Array.isArray(inventory.surface_membership['agent-plugin']));
  assert.ok(Array.isArray(inventory.surface_membership['cursor-plugin']));
  assert.strictEqual(inventory.platform_matrix.schema, 'dhpk.platform-capability-matrix.v1');
  assert.ok(inventory.platform_matrix.entries.length >= 4);
  const agentSkills = inventory.platform_matrix.entries.find((entry) => entry.id === 'dhpk.platform.agent-plugin.skills');
  const cursorSkills = inventory.platform_matrix.entries.find((entry) => entry.id === 'dhpk.platform.cursor-plugin.skills');
  assert.strictEqual(agentSkills.projection_mode, 'owner');
  assert.strictEqual(cursorSkills.projection_mode, 'shared');
  assert.strictEqual(cursorSkills.shared_surface, 'agent-plugin');
  assert.strictEqual(cursorSkills.destination, 'plugins/dhpk-agent/skills/');
  assert.ok(inventory.portable_frontmatter.allowlist.includes('metadata'));
  assert.ok(inventory.portable_frontmatter.client_owned.includes('agents/openai.yaml'));
});

test('generated package READMEs point back to the bilingual installation SSOT', () => {
  for (const file of [
    'plugins/dhpk-agent/README.md',
    'plugins/dhpk-agent/README.zh-TW.md',
    'plugins/dhpk-cursor/README.md',
    'plugins/dhpk-cursor/README.zh-TW.md',
  ]) {
    const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
    assert.match(text, /platform-installation(?:\.zh-TW)?\.md/);
  }
});

test('package paths and marketplace entries are inventory-visible and exact', () => {
  const agent = JSON.parse(read('plugins/dhpk-agent/plugin.json'));
  const cursor = JSON.parse(read('plugins/dhpk-cursor/.cursor-plugin/plugin.json'));
  const marketplace = JSON.parse(read('plugins/dhpk-cursor/.cursor-plugin/marketplace.json'));
  assert.strictEqual(agent.name, 'dhpk');
  assert.strictEqual(cursor.name, 'dhpk-cursor');
  assert.strictEqual(cursor.skills, undefined);
  assert.strictEqual(cursor.hooks, './hooks/hooks.json');
  assert.ok(!fs.existsSync(path.join(ROOT, 'plugins', 'dhpk-cursor', 'skills')));
  const cursorProvenance = JSON.parse(fs.readFileSync(path.join(ROOT, 'plugins', 'dhpk-cursor', 'provenance.json'), 'utf8'));
  assert.strictEqual(cursorProvenance.skillProjectionMode, 'shared');
  assert.strictEqual(cursorProvenance.sharedSkillSurface, 'agent-plugin');
  assert.strictEqual(cursorProvenance.sharedSkillSource, 'plugins/dhpk-agent/skills/');
  assert.ok(cursorProvenance.sharedSkillIds.length > 0);
  assert.strictEqual(marketplace.plugins.length, 1);
  assert.strictEqual(marketplace.plugins[0].source, '.');
});

test('generated package Markdown has no broken relative links', () => {
  for (const packageRoot of ['plugins/dhpk-agent', 'plugins/dhpk-cursor']) {
    const broken = [];
    const walk = (directory) => {
      for (const entry of fs.readdirSync(path.join(ROOT, directory), { withFileTypes: true })) {
        const relative = path.join(directory, entry.name);
        const absolute = path.join(ROOT, relative);
        if (entry.isDirectory()) walk(relative);
        else if (/\.md$/i.test(entry.name)) {
          const content = fs.readFileSync(absolute, 'utf8');
          for (const match of content.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
            const target = match[1].trim();
            if (!target || target.startsWith('#') || /^(?:[A-Za-z][A-Za-z0-9+.-]*:|\/\/)/.test(target)) continue;
            const pathPart = target.split('#', 1)[0].trim();
            if (pathPart && !fs.existsSync(path.resolve(path.dirname(absolute), pathPart))) broken.push(`${relative} -> ${target}`);
          }
        }
      }
    };
    walk(packageRoot);
    assert.deepStrictEqual(broken, [], `${packageRoot} has broken links: ${broken.join(', ')}`);
  }
});

run('platform-installation-docs');
