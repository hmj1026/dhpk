'use strict';

// Cross-file contract for the platform installation SSOT. This deliberately
// checks links and status vocabulary rather than attempting to prove a live
// Codex or Cursor consumer from repository prose.

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const CURRENT_VERSION = JSON.parse(read('.claude-plugin/plugin.json')).version;
const STATUS = ['PASS', 'FAIL', 'NOT_RUN', 'NOT_CONFIGURED', 'SKIP_INCOMPATIBLE', 'BLOCKED', 'UNAVAILABLE'];

function section(text, heading) {
  const start = text.indexOf(heading);
  assert.ok(start >= 0, `missing section ${heading}`);
  const next = text.indexOf('\n## ', start + heading.length);
  return text.slice(start, next >= 0 ? next : text.length);
}

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

test('bilingual SSOT documents the read-only unified lifecycle slice without claiming write support', () => {
  for (const relative of ['docs/platform-installation.md', 'docs/platform-installation.zh-TW.md']) {
    const text = read(relative);
    const compact = text.replace(/\s+/g, ' ');
    assert.ok(text.includes('dhpk-install cursor plan --scope project --json'), `${relative} must document the JSON plan command`);
    assert.ok(text.includes('NOT_IMPLEMENTED'), `${relative} must disclose unavailable write actions`);
    assert.ok(compact.includes('INSTALL_PASS + CONSUMER_BLOCKED'), `${relative} must distinguish lifecycle aggregate from consumer evidence`);
  }
});

test('bilingual SSOT pins Codex collision exit and AGY import-only discovery', () => {
  for (const relative of ['docs/platform-installation.md', 'docs/platform-installation.zh-TW.md']) {
    const text = read(relative);
    assert.ok(
      text.includes('exits non-zero') || text.includes('非零'),
      `${relative} must say --update without --adopt exits non-zero while a collision remains`,
    );
    assert.ok(
      text.includes('import-only') || text.includes('只列 import') || text.includes('只列出 import'),
      `${relative} must say agy plugins list is import-only`,
    );
    assert.ok(
      text.includes('isolated `agy agents`') || text.includes('隔離 HOME 的 `agy agents`'),
      `${relative} must say isolated agy agents is the native load signal`,
    );
  }
});

test('installation routes remain separate and point to the SSOT', () => {
  const docs = [
    'README.md', 'README.zh-TW.md',
    'docs/basic-operations.md', 'docs/basic-operations.zh-TW.md',
    'docs/configuration.md', 'docs/configuration.zh-TW.md',
    'docs/distribution-surfaces.md', 'docs/distribution-surfaces.zh-TW.md',
    'docs/skill-platform-migration.md', 'docs/skill-platform-migration.zh-TW.md',
    'codex/README.md', 'codex/README.zh-TW.md', 'codex/AGENTS.md',
    'cursor/AGENTS.md',
    '.codex-plugin/README.md', 'plugins/dhpk/README.md', 'plugins/dhpk/README.zh-TW.md',
  ];
  for (const rel of docs) {
    const text = read(rel);
    assert.match(text, /platform-installation(?:\.zh-TW)?\.md/, `${rel} must link the canonical guide`);
  }
  const english = read('docs/platform-installation.md');
  for (const token of [
    'install-codex-skills.sh',
    'install-cursor-harness.sh',
    '.cursor/.dhpk-installed.json',
    'schema-v3',
    'codex plugin marketplace add',
    'plugins/dhpk-agent/',
    'plugins/dhpk-cursor/',
    'Cursor CLI',
    '--plugin-dir',
    'cursor-agent status',
    'Authentication required',
    'non-interactive `plugin install`',
    'experimental/conditional',
    'mcp.json',
    'plugins/dhpk-agy/',
    'install-agy-plugin.js',
    'install-agy-plugin.js plan',
    'install-agy-plugin.js status',
    'FOREIGN_CHECKOUT',
    `--version=${CURRENT_VERSION}`,
    '--trust',
    'ignores stdin',
    'exits non-zero',
    'import-only',
    'isolated `agy agents`',
    '--targets agy',
    '--agy-runtime-probe',
    'agy plugins list',
    'SKIP_INCOMPATIBLE',
    'UNAVAILABLE',
  ]) assert.ok(english.includes(token), `SSOT missing ${token}`);
});

test('bilingual SSOT pins gen-agy-plugin-package.js to the current plugin version', () => {
  const expected = `gen-agy-plugin-package.js plugins/dhpk-agy --version=${CURRENT_VERSION}`;
  for (const relative of ['docs/platform-installation.md', 'docs/platform-installation.zh-TW.md']) {
    const text = read(relative);
    assert.ok(
      text.includes(expected),
      `${relative} must document ${expected}`,
    );
  }
});

test('Cursor CLI documentation keeps authentication, launch scope, and UI routes distinct', () => {
  const english = read('docs/platform-installation.md');
  const chinese = read('docs/platform-installation.zh-TW.md');
  const cliSections = [
    section(english, '## Cursor CLI (launch-scoped probe)'),
    section(chinese, '## Cursor CLI（launch-scoped probe）'),
  ];
  for (const cli of cliSections) {
    assert.ok(cli.includes('--plugin-dir "$HOME/.cursor/plugins/local/dhpk-agent"'),
      'Cursor CLI probe must pass the portable Agent Plugin path');
    assert.ok(cli.includes('--plugin-dir "$HOME/.cursor/plugins/local/dhpk-cursor"'),
      'Cursor CLI probe must pass the native Cursor Plugin path');
    assert.ok(cli.includes('cursor-agent-probe.js'), 'Cursor CLI route must use the bounded wrapper');
    assert.ok(cli.includes('--timeout-ms 60000'), 'Cursor CLI route must declare a finite timeout');
    assert.ok(cli.includes('--max-output-bytes 262144'), 'Cursor CLI route must cap output');
    assert.ok(cli.includes('5-minute') || cli.includes('5 分鐘'), 'Cursor CLI route must state the timeout ceiling');
    assert.ok(cli.includes('4 MiB'), 'Cursor CLI route must state the output ceiling');
    assert.ok(cli.includes('timed_out: true'), 'Cursor CLI route must document timeout evidence');
    assert.ok(cli.includes('output_limited: true'), 'Cursor CLI route must document output-limit evidence');
    assert.ok(cli.includes('capability-negative') || cli.includes('capability 的'), 'Cursor CLI route must reject negative discovery evidence');
    assert.ok(cli.includes('--mode ask'), 'Cursor CLI route must be read-only for the verification probe');
    assert.ok(cli.includes('--trust'), 'Cursor CLI probe must skip the workspace trust prompt');
    assert.ok(cli.includes('stdin') || cli.includes('TTY'), 'Cursor CLI probe must document ignored stdin / no inherited TTY');
    assert.ok(cli.includes("-p 'List the dhpk skills, commands, agents, and rules you discover. Do not edit files.'"),
      'Cursor CLI probe must state its read-only discovery prompt');
    assert.ok(cli.includes('--output-format json'), 'Cursor CLI route must preserve machine-readable evidence');
    assert.ok(cli.includes('cursor-agent login'), 'Cursor CLI route must document authentication');
    assert.ok(cli.includes('cursor-agent status'), 'Cursor CLI route must document auth status');
    assert.ok(cli.includes('~/.cursor/plugins/local/'), 'Cursor persistent local route must remain documented');
    assert.ok(cli.includes('marketplace add'), 'Cursor marketplace route must remain distinct from install');
    assert.ok(cli.includes('launch-scoped'), 'Cursor CLI route must define its invocation scope');
  }
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

test('Cursor project-local verification commands declare consumer and checkout roots', () => {
  for (const relative of ['docs/platform-installation.md', 'docs/platform-installation.zh-TW.md']) {
    const text = read(relative);
    assert.ok(text.includes('test -f .cursor/.dhpk-installed.json'),
      `${relative} must keep the consumer-root Cursor receipt check`);
    assert.ok(text.includes('node "$DHPK_ROOT/scripts/ci/validate-cursor-sync.js"'),
      `${relative} must qualify the Cursor layout validator with DHPK_ROOT`);
    assert.ok(text.includes('node "$DHPK_ROOT/tests/install-cursor-harness.test.js"'),
      `${relative} must qualify the Cursor installer test with DHPK_ROOT`);
    assert.ok(!text.includes('node tests/install-cursor-harness.test.js'),
      `${relative} must not run the Cursor installer test from the consumer root`);
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
  assert.deepStrictEqual(inventory.surfaces.slice(-4), ['agent-plugin', 'cursor-plugin', 'cursor-sync', 'agy-plugin']);
  assert.ok(Array.isArray(inventory.surface_membership['agent-plugin']));
  assert.ok(Array.isArray(inventory.surface_membership['cursor-plugin']));
  assert.ok(Array.isArray(inventory.surface_membership['cursor-sync']));
  assert.ok(Array.isArray(inventory.surface_membership['agy-plugin']));
  assert.strictEqual(inventory.platform_matrix.schema, 'dhpk.platform-capability-matrix.v1');
  assert.ok(inventory.platform_matrix.entries.length >= 5);
  const agentSkills = inventory.platform_matrix.entries.find((entry) => entry.id === 'dhpk.platform.agent-plugin.skills');
  const cursorSkills = inventory.platform_matrix.entries.find((entry) => entry.id === 'dhpk.platform.cursor-plugin.skills');
  assert.strictEqual(agentSkills.projection_mode, 'owner');
  assert.strictEqual(cursorSkills.projection_mode, 'shared');
  assert.strictEqual(cursorSkills.shared_surface, 'agent-plugin');
  assert.strictEqual(cursorSkills.destination, 'plugins/dhpk-agent/skills/');
  const agy = inventory.platform_matrix.entries.find((entry) => entry.id === 'dhpk.platform.agy-plugin.native');
  assert.strictEqual(agy.surface, 'agy-plugin');
  assert.strictEqual(agy.destination, 'plugins/dhpk-agy/');
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
