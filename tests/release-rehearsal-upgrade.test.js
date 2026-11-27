'use strict';

// End-to-end TDD coverage for cross-version release rehearsal (#1587):
// automatic v(N-1) resolution from full git history, baseline materialization,
// v(N-1) -> HEAD upgrades, idempotent reruns, rollbacks, generated/ -> dist/
// marketplace migration, Cursor local plugin link validation, AGY Package
// Receipt update/rollback, dual-layer Duplicate Discovery, honest
// NOT_RUN/UNAVAILABLE live states, and non-masking failure/timeout propagation.

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const { makeTempDir } = require('./_lib/temp-dir');

const ROOT = path.join(__dirname, '..');
const REHEARSAL_LIB = path.join(ROOT, 'scripts', 'lib', 'release-rehearsal.js');
const REHEARSAL_CLI = path.join(ROOT, 'scripts', 'release', 'release-rehearsal.js');
const RELEASE_VERIFY_SH = path.join(ROOT, 'scripts', 'release', 'release-verify.sh');

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function writeFile(target, content, mode = 0o644) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, { mode });
}

function writeJson(target, value, mode = 0o644) {
  writeFile(target, `${JSON.stringify(value, null, 2)}\n`, mode);
}

function copyFromRoot(repo, relative) {
  const src = path.join(ROOT, relative);
  const dest = path.join(repo, relative);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function copyLocalModuleClosure(repo, entrypoints) {
  const queue = entrypoints.map((rel) => path.resolve(ROOT, rel));
  const seen = new Set();
  const requireRe = /require\(\s*['"](\.[^'"]+)['"]\s*\)/g;
  while (queue.length > 0) {
    const file = queue.pop();
    if (seen.has(file) || !fs.existsSync(file)) continue;
    seen.add(file);
    const rel = path.relative(ROOT, file);
    if (!rel.startsWith('..')) copyFromRoot(repo, rel);
    if (!file.endsWith('.js') && !file.endsWith('.cjs')) continue;
    const src = fs.readFileSync(file, 'utf8');
    let match;
    while ((match = requireRe.exec(src)) !== null) {
      const base = path.resolve(path.dirname(file), match[1]);
      for (const candidate of [base, `${base}.js`, `${base}.json`, path.join(base, 'index.js')]) {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          queue.push(candidate);
          break;
        }
      }
    }
  }
}

function seedFixtureRepo({
  versions = ['1.0.0', '1.1.0'],
  headVersion = '1.2.0',
  headMarketplaceBase = 'dist',
  unmergedTag = 'v9.9.9',
  nonSemverTag = 'release-candidate-1',
} = {}) {
  const tmp = makeTempDir('dhpk-rehearsal-e2e-');
  const repo = path.join(tmp, 'repo');
  const stubs = path.join(tmp, 'stubs');
  fs.mkdirSync(repo, { recursive: true });
  fs.mkdirSync(stubs, { recursive: true });

  // Copy real AGY, Duplicate Discovery, and install-health closures from ROOT.
  copyLocalModuleClosure(repo, [
    'scripts/ci/install-agy-plugin.js',
    'scripts/ci/check-duplicate-discovery.js',
  ]);
  copyFromRoot(repo, 'scripts/hooks/_lib/install-health.sh');
  copyFromRoot(repo, 'scripts/hooks/_lib/advise-once.sh');
  copyFromRoot(repo, 'scripts/hooks/_lib/detect-stack-hints.sh');
  copyFromRoot(repo, 'scripts/hooks/_lib/session-env.sh');

  writeJson(path.join(repo, 'manifests', 'distribution-inventory.json'), {
    schema: 'dhpk.distribution-inventory.v2',
    skills: [
      { id: 'flow-guide', name: 'flow-guide', path: 'skills/flow-guide', lifecycle: 'promoted', surfaces: ['claude-core', 'codex-sync', 'cursor-sync', 'agent-plugin', 'agy-plugin'] },
      { id: 'tdd-workflow', name: 'tdd-workflow', path: 'skills/tdd-workflow', lifecycle: 'promoted', surfaces: ['claude-core', 'codex-sync', 'cursor-sync', 'agent-plugin', 'agy-plugin'] },
    ],
    surface_membership: {
      'agent-plugin': ['flow-guide', 'tdd-workflow'],
      'agy-plugin': ['flow-guide'],
      'cursor-plugin': [],
    },
    agy_plugin: {
      install_paths: {
        schema: 'dhpk.agy-install-path.v1',
        plugin_name: 'dhpk',
        canonical_relative: '.gemini/antigravity-cli/plugins/dhpk',
        legacy_relatives: ['.gemini/config/plugins/dhpk'],
        sandbox_home: '/home/agy',
      },
    },
  });

  // Shared helper script for fixture codex/cursor installers and distribution build.
  writeFile(path.join(repo, 'bin', 'dhpk'), `#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const args = process.argv.slice(2);
const root = path.resolve(__dirname, '..');
const pkgVersion = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;

if (args[0] === 'distribution' && args[1] === 'build') {
  const surface = args[2];
  let output = null;
  let version = pkgVersion;
  for (let i = 3; i < args.length; i += 1) {
    if (args[i] === '--output') output = args[++i];
    else if (args[i] === '--version') version = args[++i];
  }
  if (!output) {
    const names = { 'agent-plugin': 'dhpk-agent', 'cursor-plugin': 'dhpk-cursor', 'agy-plugin': 'dhpk-agy' };
    output = path.join(root, 'dist', 'on-demand', names[surface]);
  }
  fs.rmSync(output, { recursive: true, force: true });
  fs.mkdirSync(output, { recursive: true });
  const write = (rel, text) => {
    const dest = path.join(output, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, text);
  };
  const commit = 'a'.repeat(40);
  if (surface === 'agent-plugin') {
    write('plugin.json', JSON.stringify({
      $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json',
      name: 'dhpk',
      version,
      description: 'fixture agent plugin',
    }, null, 2) + '\\n');
    write('skills/flow-guide/SKILL.md', '---\\nname: flow-guide\\ndescription: flow\\n---\\n# flow-guide v' + version + '\\n');
    write('provenance.json', JSON.stringify({ schema: 'dhpk.platform-provenance.v1', surface: 'agent-plugin', sourceVersion: version, sourceCommit: commit, fingerprintAlgorithm: 'tree-merkle-v1' }) + '\\n');
  } else if (surface === 'cursor-plugin') {
    write('.cursor-plugin/plugin.json', JSON.stringify({
      name: 'dhpk-cursor',
      version,
      description: 'fixture cursor plugin',
      license: 'MIT',
      variables: { type: 'object', properties: {} },
    }, null, 2) + '\\n');
    write('.cursor-plugin/marketplace.json', JSON.stringify({
      name: 'dhpk',
      owner: { name: 'hmj1026' },
      plugins: [{ name: 'dhpk-cursor', source: '.' }],
    }, null, 2) + '\\n');
    write('rules/policy.mdc', '---\\nname: policy\\ndescription: policy\\nalwaysApply: true\\n---\\n# policy v' + version + '\\n');
    write('provenance.json', JSON.stringify({ schema: 'dhpk.platform-provenance.v1', surface: 'cursor-plugin', sourceVersion: version, sourceCommit: commit, fingerprintAlgorithm: 'tree-merkle-v1' }) + '\\n');
  } else if (surface === 'agy-plugin') {
    const { adaptFrontmatter } = require(path.join(root, 'scripts', 'agy-adapt-agents'));
    const { serializePackageReceipt } = require(path.join(root, 'scripts', 'lib', 'platform-provenance'));
    const manifestBody = JSON.stringify({ name: 'dhpk', version, description: 'fixture agy plugin', skills: ['./skills/'] }, null, 2) + '\\n';
    const skillBody = '---\\nname: flow-guide\\ndescription: "flow"\\n---\\n# agy v' + version + '\\n';
    const agentBody = adaptFrontmatter('---\\nname: sample\\ndescription: "sample agent"\\ntools: Read\\n---\\n# sample v' + version + '\\n', { filePath: 'agents/sample.md' }).text;
    const ruleBody = '# rule v' + version + '\\n';
    const files = {
      'plugin.json': manifestBody,
      'agents/sample.md': agentBody,
      'skills/flow-guide/SKILL.md': skillBody,
      'rules/policy.md': ruleBody,
    };
    const fingerprints = {};
    for (const [rel, body] of Object.entries(files)) {
      write(rel, body);
      fingerprints[rel] = crypto.createHash('sha256').update(body).digest('hex');
    }
    const serialized = serializePackageReceipt('agy-plugin', {
      provenance: {
        schema: 'dhpk.agy-plugin.v1',
        provenanceSchema: 'dhpk.platform-provenance.v1',
        surface: 'agy-plugin',
        owner: 'plugins/dhpk-agy',
        packageRoot: 'plugins/dhpk-agy',
        sourceVersion: version,
        sourceCommit: commit,
        inventoryDigest: crypto.createHash('sha256').update('inventory').digest('hex'),
        fingerprintAlgorithm: 'tree-merkle-v1',
        fingerprints,
      },
      fingerprints,
    });
    write('fingerprints.json', serialized.fingerprints);
    write('provenance.json', serialized.provenance);
  }
  console.log(JSON.stringify({ surface, operation: 'build', verdict: 'PASS', output }));
  process.exit(0);
}

if (args[0] === 'distribution' && (args[2] === 'validate' || args[2] === 'verify')) {
  const surface = args[1];
  let output = null;
  for (let i = 3; i < args.length; i += 1) {
    if (args[i] === '--output') output = args[++i];
  }
  if (!output || !fs.existsSync(output)) {
    console.error('missing output dir');
    process.exit(1);
  }
  if (surface === 'agent-plugin' && !fs.existsSync(path.join(output, 'plugin.json'))) process.exit(1);
  if (surface === 'cursor-plugin' && !fs.existsSync(path.join(output, '.cursor-plugin', 'plugin.json'))) process.exit(1);
  console.log(JSON.stringify({ surface, operation: args[2], verdict: 'PASS', output }));
  process.exit(0);
}

process.exit(1);
`, 0o755);

  const installerScript = (host) => `#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const root = process.env.DHPK_INSTALLER_ROOT || path.resolve(__dirname, '../..');
const project = process.cwd();
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const hostDir = '${host === 'codex' ? '.codex' : '.cursor'}';
const receiptPath = path.join(project, hostDir, '.dhpk-installed.json');
const sharedReceiptPath = path.join(project, '.agents', '.dhpk-installed.json');

if (process.env.DHPK_TEST_FAIL_INSTALLER === '${host}') {
  process.stderr.write('simulated ${host} installer failure\\n');
  process.exit(Number(process.env.DHPK_TEST_FAIL_CODE || '7'));
}

if (args.includes('--plan') && args.includes('--json')) {
  const home = process.env.HOME || '';
  const localAgent = path.join(home, '.cursor', 'plugins', 'local', 'dhpk-agent', 'plugin.json');
  const cacheDir = path.join(home, '.cursor', 'plugins', 'cache', 'dhpk', 'dhpk');
  const warnings = [];
  if (fs.existsSync(localAgent) && fs.existsSync(cacheDir)) {
    const localVer = JSON.parse(fs.readFileSync(localAgent, 'utf8')).version;
    for (const hash of fs.readdirSync(cacheDir)) {
      const cp = path.join(cacheDir, hash, 'plugin.json');
      if (fs.existsSync(cp) && JSON.parse(fs.readFileSync(cp, 'utf8')).version !== localVer) {
        warnings.push({ code: 'cursor_marketplace_hash_cache_drift', cachedVersion: JSON.parse(fs.readFileSync(cp, 'utf8')).version, localVersion: localVer });
      }
    }
  }
  console.log(JSON.stringify({ verdict: 'READY', plugin_version: version, warnings }));
  process.exit(0);
}

if (args.includes('--uninstall')) {
  if (fs.existsSync(receiptPath)) fs.rmSync(receiptPath);
  const managedSkill = path.join(project, hostDir, 'skills', 'flow-guide');
  if (fs.existsSync(managedSkill)) fs.rmSync(managedSkill, { recursive: true, force: true });
  if (fs.existsSync(sharedReceiptPath)) {
    const shared = JSON.parse(fs.readFileSync(sharedReceiptPath, 'utf8'));
    if (shared.hostBindings) delete shared.hostBindings['${host}'];
    if (!shared.hostBindings || Object.keys(shared.hostBindings).length === 0) {
      fs.rmSync(path.join(project, '.agents'), { recursive: true, force: true });
    } else {
      fs.writeFileSync(sharedReceiptPath, JSON.stringify(shared, null, 2) + '\\n');
    }
  }
  process.exit(0);
}

if (args.includes('--update')) {
  if (!fs.existsSync(receiptPath)) {
    process.stderr.write('missing baseline receipt for --update\\n');
    process.exit(1);
  }
}

const sharedSkillDir = path.join(project, '.agents', 'skills', 'flow-guide');
fs.mkdirSync(sharedSkillDir, { recursive: true });
fs.writeFileSync(path.join(sharedSkillDir, 'SKILL.md'), '# flow-guide v' + version + '\\n');
const prevShared = fs.existsSync(sharedReceiptPath) ? JSON.parse(fs.readFileSync(sharedReceiptPath, 'utf8')) : { hostBindings: {} };
prevShared.entries = [{ name: 'flow-guide', stableId: 'flow-guide' }];
prevShared.hostBindings = prevShared.hostBindings || {};
prevShared.hostBindings['${host}'] = {
  bindingShape: '${host === 'codex' ? 'direct' : 'native-link'}',
  bindings: '${host}' === 'codex'
    ? [{ shape: 'direct', name: 'flow-guide' }]
    : [{ shape: 'native-link', path: '.cursor/skills/flow-guide', target: '../../.agents/skills/flow-guide' }],
};
fs.mkdirSync(path.dirname(sharedReceiptPath), { recursive: true });
fs.writeFileSync(sharedReceiptPath, JSON.stringify(prevShared, null, 2) + '\\n');

if ('${host}' === 'cursor') {
  const linkPath = path.join(project, '.cursor', 'skills', 'flow-guide');
  fs.mkdirSync(path.dirname(linkPath), { recursive: true });
  try { fs.unlinkSync(linkPath); } catch (_) {}
  fs.symlinkSync('../../.agents/skills/flow-guide', linkPath);
} else {
  // Simulate #1582 retirement of overlapping .codex/skills/flow-guide on update.
  const oldLink = path.join(project, '.codex', 'skills', 'flow-guide');
  if (!args.includes('--update')) {
    fs.mkdirSync(oldLink, { recursive: true });
    fs.writeFileSync(path.join(oldLink, 'SKILL.md'), '# legacy codex copy v' + version + '\\n');
  } else if (fs.existsSync(oldLink)) {
    fs.rmSync(oldLink, { recursive: true, force: true });
  }
}

fs.mkdirSync(path.join(project, hostDir), { recursive: true });
fs.writeFileSync(receiptPath, JSON.stringify({
  schema_version: 3,
  state: 'current',
  plugin_version: version,
  managed_entries: { skills: {}, agents: { sample: { destination: 'agents/sample.md' } }, supporting_assets: { doc: { destination: 'doc.md' } } },
}, null, 2) + '\\n');
`;

  writeFile(path.join(repo, 'scripts', 'hooks', '_lib', 'fixture-codex.js'), installerScript('codex'), 0o755);
  writeFile(path.join(repo, 'scripts', 'hooks', '_lib', 'fixture-cursor.js'), installerScript('cursor'), 0o755);
  writeFile(path.join(repo, 'scripts', 'hooks', 'install-codex-skills.sh'), '#!/usr/bin/env bash\nset -euo pipefail\nHERE="$(cd "$(dirname "$0")" && pwd)"\nexec node "$HERE/_lib/fixture-codex.js" "$@"\n', 0o755);
  writeFile(path.join(repo, 'scripts', 'hooks', 'install-cursor-harness.sh'), '#!/usr/bin/env bash\nset -euo pipefail\nHERE="$(cd "$(dirname "$0")" && pwd)"\nexec node "$HERE/_lib/fixture-cursor.js" "$@"\n', 0o755);

  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'user.name', 'tester');
  git(repo, 'config', 'user.email', 'tester@example.invalid');

  const commitRelease = (version, marketplaceBase, message) => {
    const pkgBase = `${marketplaceBase}/claude-marketplace`;
    // Clean old generated/dist marketplace dir in fixture so each commit accurately reflects its path layout.
    fs.rmSync(path.join(repo, 'generated'), { recursive: true, force: true });
    fs.rmSync(path.join(repo, 'dist'), { recursive: true, force: true });
    writeJson(path.join(repo, 'package.json'), { name: 'dhpk', version });
    writeJson(path.join(repo, '.claude-plugin', 'plugin.json'), { name: 'dhpk', version });
    writeJson(path.join(repo, '.claude-plugin', 'marketplace.json'), {
      name: 'dhpk',
      owner: { name: 'hmj1026' },
      plugins: [
        { name: 'dhpk', source: `./${pkgBase}/package` },
        { name: 'dhpk-stacks', source: `./${pkgBase}/stacks-package` },
      ],
    });
    writeJson(path.join(repo, pkgBase, 'package', '.claude-plugin', 'plugin.json'), { name: 'dhpk', version });
    writeJson(path.join(repo, pkgBase, 'stacks-package', '.claude-plugin', 'plugin.json'), { name: 'dhpk-stacks', version });
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', message);
  };

  for (const ver of versions) {
    commitRelease(ver, 'generated', `release v${ver}`);
    git(repo, 'tag', '-a', `v${ver}`, '-m', `v${ver}`);
  }
  if (versions.length > 0 && nonSemverTag) {
    git(repo, 'tag', nonSemverTag);
  }
  if (versions.length > 0 && unmergedTag) {
    git(repo, 'checkout', '-q', '-b', 'unmerged-future');
    commitRelease('9.9.9', 'dist', 'unmerged future tag');
    git(repo, 'tag', unmergedTag);
    git(repo, 'checkout', '-q', 'main');
    git(repo, 'branch', '-D', 'unmerged-future');
  }

  commitRelease(headVersion, headMarketplaceBase, `prepare v${headVersion}`);
  if (versions.length === 0 && nonSemverTag) {
    git(repo, 'tag', nonSemverTag);
  }

  return { tmp, repo, stubs };
}

function writeClaudeStub(stubs) {
  const claudeStub = `#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const logFile = process.env.CLAUDE_CALL_LOG;
if (logFile) fs.appendFileSync(logFile, JSON.stringify(args) + '\\n');
const home = process.env.HOME;
const stateFile = path.join(home, '.claude', 'stub-state.json');
const readState = () => (fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : { marketplace: null, installed: null });
const writeState = (s) => { fs.mkdirSync(path.dirname(stateFile), { recursive: true }); fs.writeFileSync(stateFile, JSON.stringify(s)); };

if (args[0] === '--version') {
  if (process.env.STUB_CLAUDE_VERSION_EXIT) process.exit(Number(process.env.STUB_CLAUDE_VERSION_EXIT));
  console.log('2.1.332 (Claude Code)');
  process.exit(0);
}
if (args[0] === 'plugin' && args[1] === 'validate') {
  if (process.env.STUB_CLAUDE_VALIDATE_EXIT) process.exit(Number(process.env.STUB_CLAUDE_VALIDATE_EXIT));
  console.log('Validation passed');
  process.exit(0);
}
if (args[0] === 'plugin' && args[1] === 'marketplace' && args[2] === 'add') {
  const s = readState();
  s.marketplace = path.resolve(args[3]);
  writeState(s);
  process.exit(0);
}
if (args[0] === 'plugin' && args[1] === 'marketplace' && args[2] === 'remove') {
  const s = readState();
  s.marketplace = null;
  writeState(s);
  process.exit(0);
}
if (args[0] === 'plugin' && args[1] === 'install') {
  if (process.env.STUB_CLAUDE_INSTALL_EXIT) process.exit(Number(process.env.STUB_CLAUDE_INSTALL_EXIT));
  const s = readState();
  if (!s.marketplace) process.exit(1);
  const mkt = JSON.parse(fs.readFileSync(path.join(s.marketplace, '.claude-plugin', 'marketplace.json'), 'utf8'));
  const entry = mkt.plugins.find((p) => p.name === 'dhpk');
  const pkgRoot = path.resolve(s.marketplace, entry.source);
  const ver = JSON.parse(fs.readFileSync(path.join(pkgRoot, '.claude-plugin', 'plugin.json'), 'utf8')).version;
  s.installed = { id: 'dhpk@dhpk', version: ver, scope: 'project', enabled: true, projectPath: process.cwd(), readFromFolder: pkgRoot, installPath: pkgRoot };
  writeState(s);
  process.exit(0);
}
if (args[0] === 'plugin' && args[1] === 'uninstall') {
  const s = readState();
  s.installed = null;
  writeState(s);
  process.exit(0);
}
if (args[0] === 'plugin' && args[1] === 'list' && args[2] === '--json') {
  if (process.env.STUB_CLAUDE_LIST_EXIT) process.exit(Number(process.env.STUB_CLAUDE_LIST_EXIT));
  if (process.env.STUB_CLAUDE_DUPLICATE === '1') {
    console.log(JSON.stringify([
      { id: 'dhpk@dhpk', enabled: true, scope: 'user', installPath: '/tmp/full' },
      { id: 'dhpk-lite@claude-plugins-official', enabled: true, scope: 'user', installPath: '/tmp/lite' },
    ]));
    process.exit(0);
  }
  const s = readState();
  console.log(JSON.stringify(s.installed ? [s.installed] : []));
  process.exit(0);
}
process.exit(2);
`;
  writeFile(path.join(stubs, 'claude'), claudeStub, 0o755);
}

function writeCodexStub(stubs) {
  const codexStub = `#!/usr/bin/env node
'use strict';
const args = process.argv.slice(2);
if (args[0] === '--version') {
  if (process.env.STUB_CODEX_VERSION_EXIT) process.exit(Number(process.env.STUB_CODEX_VERSION_EXIT));
  console.log('codex-cli 0.172.0');
  process.exit(0);
}
if (args[0] === 'debug' && args[1] === 'prompt-input') {
  if (process.env.STUB_CODEX_DUP === '1') {
    const text = '<skills_instructions>\\n### Skill roots\\n- \`r0\` = \`/tmp/a\`\\n- \`r1\` = \`/tmp/b\`\\n### Available skills\\n- flow-guide: d (file: r0/flow-guide/SKILL.md)\\n- flow-guide: d (file: r1/flow-guide/SKILL.md)\\n</skills_instructions>';
    console.log(JSON.stringify([{ type: 'message', content: [{ type: 'input_text', text }] }]));
    process.exit(0);
  }
  const text = '<skills_instructions>\\n### Skill roots\\n- \`r0\` = \`/tmp/a\`\\n### Available skills\\n- flow-guide: d (file: r0/flow-guide/SKILL.md)\\n</skills_instructions>';
  console.log(JSON.stringify([{ type: 'message', content: [{ type: 'input_text', text }] }]));
  process.exit(0);
}
process.exit(2);
`;
  writeFile(path.join(stubs, 'codex'), codexStub, 0o755);
}

function minimalPathWithoutHosts(extraDir) {
  const safeBin = path.join(extraDir, '.node-bin');
  fs.mkdirSync(safeBin, { recursive: true });
  const nodeLink = path.join(safeBin, 'node');
  try { fs.unlinkSync(nodeLink); } catch (_) { /* ignore */ }
  fs.symlinkSync(process.execPath, nodeLink);
  const essential = ['/usr/bin', '/bin'].filter((d) => fs.existsSync(d));
  return [extraDir, safeBin, ...essential].filter(Boolean).join(path.delimiter);
}

test('cross-version rehearsal resolves v(N-1), upgrades, reruns, rolls back, migrates, and preserves honest UNAVAILABLE/NOT_RUN states', () => {
  const { rehearseReleaseUpgrade } = require(REHEARSAL_LIB);
  const { repo, stubs } = seedFixtureRepo({ versions: ['1.0.0', '1.1.0'], headVersion: '1.2.0', headMarketplaceBase: 'dist' });
  const report = rehearseReleaseUpgrade({
    repoRoot: repo,
    env: { ...process.env, PATH: minimalPathWithoutHosts(stubs) },
  });
  assert.strictEqual(report.schema, 'dhpk.release-rehearsal.v1');
  assert.strictEqual(report.verdict, 'PASS', JSON.stringify(report.diagnostics));
  assert.strictEqual(report.exitCode, 0);
  assert.strictEqual(report.priorTag, 'v1.1.0');
  assert.strictEqual(report.priorVersion, '1.1.0');
  assert.strictEqual(report.targetVersion, '1.2.0');

  assert.strictEqual(report.stages.codexSync.status, 'PASS');
  assert.strictEqual(report.stages.codexSync.baseline.version, '1.1.0');
  assert.strictEqual(report.stages.codexSync.upgrade.version, '1.2.0');
  assert.strictEqual(report.stages.codexSync.rerun.version, '1.2.0');
  assert.strictEqual(report.stages.codexSync.rollback.thirdPartyPreserved, true);

  assert.strictEqual(report.stages.cursorSync.status, 'PASS');
  assert.strictEqual(report.stages.cursorSync.baseline.version, '1.1.0');
  assert.strictEqual(report.stages.cursorSync.upgrade.version, '1.2.0');
  assert.strictEqual(report.stages.cursorSync.rollback.thirdPartyPreserved, true);

  assert.strictEqual(report.stages.cursorLocalPlugins.status, 'PASS');
  assert.deepStrictEqual(report.stages.cursorLocalPlugins.baseline.versions, { agent: '1.1.0', cursor: '1.1.0' });
  assert.deepStrictEqual(report.stages.cursorLocalPlugins.upgrade.versions, { agent: '1.2.0', cursor: '1.2.0' });
  assert.strictEqual(report.stages.cursorLocalPlugins.rollback.foreignPreserved, true);
  assert.deepStrictEqual(report.stages.cursorLocalPlugins.rollback.restoredVersions, { agent: '1.1.0', cursor: '1.1.0' });

  assert.strictEqual(report.stages.agyPlugin.status, 'PASS');
  assert.strictEqual(report.stages.agyPlugin.baseline.receiptVersion, '1.1.0');
  assert.strictEqual(report.stages.agyPlugin.upgrade.receiptVersion, '1.2.0');
  assert.strictEqual(report.stages.agyPlugin.upgrade.userFilePreserved, true);
  assert.strictEqual(report.stages.agyPlugin.rollback.receiptRemoved, true);
  assert.strictEqual(report.stages.agyPlugin.rollback.userFilePreserved, true);

  assert.strictEqual(report.stages.claudeMarketplaceMigration.status, 'PASS');
  assert.strictEqual(report.stages.claudeMarketplaceMigration.structuralMigration.status, 'PASS');
  assert.strictEqual(report.stages.claudeMarketplaceMigration.cliMigration.status, 'UNAVAILABLE');

  assert.strictEqual(report.stages.duplicateDiscovery.status, 'PASS');
  assert.strictEqual(report.stages.duplicateDiscovery.report.hosts.codex.baseline.verdict, 'PASS');
  assert.strictEqual(report.stages.duplicateDiscovery.report.hosts.claude.baseline.verdict, 'PASS');
  assert.strictEqual(report.stages.duplicateDiscovery.report.hosts.codex.live.verdict, 'UNAVAILABLE');
  assert.strictEqual(report.stages.duplicateDiscovery.report.hosts.claude.live.verdict, 'UNAVAILABLE');

  for (const host of ['claude', 'codex', 'cursor', 'agy']) {
    assert.strictEqual(report.stages.liveFreshSession.hosts[host].status, 'UNAVAILABLE');
    assert.notStrictEqual(report.stages.liveFreshSession.hosts[host].status, 'PASS');
  }
});

test('stubbed Host CLIs verify generated/ -> dist/ marketplace migration, live discovery PASS, and NOT_RUN fresh-session state', () => {
  const { rehearseReleaseUpgrade } = require(REHEARSAL_LIB);
  const { tmp, repo, stubs } = seedFixtureRepo({ versions: ['1.0.0'], headVersion: '1.1.0', headMarketplaceBase: 'dist' });
  writeClaudeStub(stubs);
  writeCodexStub(stubs);
  const callLog = path.join(tmp, 'claude-calls.log');

  const report = rehearseReleaseUpgrade({
    repoRoot: repo,
    env: { ...process.env, PATH: minimalPathWithoutHosts(stubs), CLAUDE_CALL_LOG: callLog },
  });
  assert.strictEqual(report.verdict, 'PASS', JSON.stringify(report.diagnostics));
  assert.strictEqual(report.stages.claudeMarketplaceMigration.cliMigration.status, 'PASS');
  const calls = fs.readFileSync(callLog, 'utf8');
  assert.match(calls, /legacy-marketplace/);
  assert.match(calls, /"validate"/);
  assert.match(calls, /"uninstall"/);

  assert.strictEqual(report.stages.duplicateDiscovery.report.hosts.codex.live.verdict, 'PASS');
  assert.strictEqual(report.stages.duplicateDiscovery.report.hosts.claude.live.verdict, 'PASS');
  assert.strictEqual(report.stages.liveFreshSession.hosts.claude.status, 'NOT_RUN');
  assert.strictEqual(report.stages.liveFreshSession.hosts.codex.status, 'NOT_RUN');
  assert.strictEqual(report.stages.liveFreshSession.hosts.cursor.status, 'UNAVAILABLE');
  assert.strictEqual(report.stages.liveFreshSession.hosts.agy.status, 'UNAVAILABLE');
});

test('offline mode keeps duplicate discovery live checks and fresh-session checks strictly NOT_RUN', () => {
  const { rehearseReleaseUpgrade } = require(REHEARSAL_LIB);
  const { repo, stubs } = seedFixtureRepo({ versions: ['1.0.0'], headVersion: '1.1.0' });
  writeClaudeStub(stubs);
  writeCodexStub(stubs);

  const report = rehearseReleaseUpgrade({
    repoRoot: repo,
    offline: true,
    env: { ...process.env, PATH: minimalPathWithoutHosts(stubs) },
  });
  assert.strictEqual(report.verdict, 'PASS', JSON.stringify(report.diagnostics));
  assert.strictEqual(report.stages.claudeMarketplaceMigration.cliMigration.status, 'NOT_RUN');
  assert.strictEqual(report.stages.duplicateDiscovery.report.hosts.codex.live.verdict, 'NOT_RUN');
  assert.strictEqual(report.stages.duplicateDiscovery.report.hosts.claude.live.verdict, 'NOT_RUN');
  assert.strictEqual(report.stages.liveFreshSession.status, 'NOT_RUN');
});

test('non-zero inner exits, exit 124 timeouts, duplicate discovery, and un-migrated marketplace fail closed without masking', () => {
  const { rehearseReleaseUpgrade } = require(REHEARSAL_LIB);
  const { repo, stubs } = seedFixtureRepo({ versions: ['1.0.0'], headVersion: '1.1.0' });
  writeClaudeStub(stubs);
  writeCodexStub(stubs);

  // 1. claude plugin install fails with exit 7
  const installFail = rehearseReleaseUpgrade({
    repoRoot: repo,
    env: { ...process.env, PATH: minimalPathWithoutHosts(stubs), STUB_CLAUDE_INSTALL_EXIT: '7' },
  });
  assert.strictEqual(installFail.verdict, 'FAIL');
  assert.strictEqual(installFail.exitCode, 1);
  assert.strictEqual(installFail.stages.claudeMarketplaceMigration.status, 'FAIL');
  assert.ok(installFail.stages.claudeMarketplaceMigration.cliMigration.probes.some((p) => p.exitCode === 7));

  // 2. claude plugin validate times out with exit 124
  const timeoutFail = rehearseReleaseUpgrade({
    repoRoot: repo,
    env: { ...process.env, PATH: minimalPathWithoutHosts(stubs), STUB_CLAUDE_VALIDATE_EXIT: '124' },
  });
  assert.strictEqual(timeoutFail.verdict, 'FAIL');
  assert.strictEqual(timeoutFail.exitCode, 1);
  assert.ok(timeoutFail.stages.claudeMarketplaceMigration.cliMigration.probes.some((p) => p.exitCode === 124 && p.timedOut === true));

  // 3. codex --version times out with exit 124 (never masked as UNAVAILABLE or PASS)
  const codexTimeout = rehearseReleaseUpgrade({
    repoRoot: repo,
    env: { ...process.env, PATH: minimalPathWithoutHosts(stubs), STUB_CODEX_VERSION_EXIT: '124' },
  });
  assert.strictEqual(codexTimeout.verdict, 'FAIL');
  assert.strictEqual(codexTimeout.stages.liveFreshSession.hosts.codex.status, 'FAIL');
  assert.strictEqual(codexTimeout.stages.liveFreshSession.hosts.codex.probe.exitCode, 124);
  assert.strictEqual(codexTimeout.stages.liveFreshSession.hosts.codex.probe.timedOut, true);

  // 4. Duplicate discovery reports live duplicate -> FAIL
  const dupFail = rehearseReleaseUpgrade({
    repoRoot: repo,
    env: { ...process.env, PATH: minimalPathWithoutHosts(stubs), STUB_CODEX_DUP: '1' },
  });
  assert.strictEqual(dupFail.verdict, 'FAIL');
  assert.strictEqual(dupFail.stages.duplicateDiscovery.status, 'FAIL');
  assert.strictEqual(dupFail.stages.duplicateDiscovery.report.hosts.codex.live.verdict, 'DUPLICATE');

  // 5. Codex installer fails with exit 9
  const installerFail = rehearseReleaseUpgrade({
    repoRoot: repo,
    offline: true,
    env: { ...process.env, PATH: minimalPathWithoutHosts(stubs), DHPK_TEST_FAIL_INSTALLER: 'codex', DHPK_TEST_FAIL_CODE: '9' },
  });
  assert.strictEqual(installerFail.verdict, 'FAIL');
  assert.strictEqual(installerFail.stages.codexSync.status, 'FAIL');

  // 6. HEAD marketplace still pointing at generated/ fails migration check
  const unmigrated = seedFixtureRepo({ versions: ['1.0.0'], headVersion: '1.1.0', headMarketplaceBase: 'generated' });
  const unmigratedReport = rehearseReleaseUpgrade({
    repoRoot: unmigrated.repo,
    offline: true,
    env: { ...process.env, PATH: minimalPathWithoutHosts(unmigrated.stubs) },
  });
  assert.strictEqual(unmigratedReport.verdict, 'FAIL');
  assert.strictEqual(unmigratedReport.stages.claudeMarketplaceMigration.status, 'FAIL');
});

test('missing prior release tag fails closed and leaks nothing in TMPDIR', () => {
  const { rehearseReleaseUpgrade } = require(REHEARSAL_LIB);
  const { tmp, repo, stubs } = seedFixtureRepo({ versions: [], headVersion: '0.1.0' });
  const privateTmp = path.join(tmp, 'private-tmp');
  fs.mkdirSync(privateTmp, { recursive: true });

  const res = spawnSync(process.execPath, [REHEARSAL_CLI, '--repo-root', repo, '--offline', '--json'], {
    encoding: 'utf8',
    env: { ...process.env, TMPDIR: privateTmp, PATH: minimalPathWithoutHosts(stubs) },
  });
  assert.strictEqual(res.status, 1, res.stderr);
  const parsed = JSON.parse(res.stdout);
  assert.strictEqual(parsed.verdict, 'BLOCKED');
  assert.deepStrictEqual(fs.readdirSync(privateTmp), [], 'TMPDIR must be empty after BLOCKED rehearsal');

  const okRepo = seedFixtureRepo({ versions: ['1.0.0'], headVersion: '1.1.0' });
  const okRes = spawnSync(process.execPath, [REHEARSAL_CLI, '--repo-root', okRepo.repo, '--offline', '--json'], {
    encoding: 'utf8',
    env: { ...process.env, TMPDIR: privateTmp, PATH: minimalPathWithoutHosts(okRepo.stubs) },
  });
  assert.strictEqual(okRes.status, 0, okRes.stdout + okRes.stderr);
  assert.deepStrictEqual(fs.readdirSync(privateTmp), [], 'TMPDIR must be empty after PASS rehearsal');
  void rehearseReleaseUpgrade;
});

test('release rehearsal uses shared host-cli-probe runner and integrates with release-verify.sh', () => {
  const libSource = fs.readFileSync(REHEARSAL_LIB, 'utf8');
  const cliSource = fs.readFileSync(REHEARSAL_CLI, 'utf8');
  assert.match(libSource, /require\(['"]\.\/host-cli-probe['"]\)/);
  assert.doesNotMatch(libSource, /node:child_process|require\(['"]child_process['"]\)/);
  assert.doesNotMatch(cliSource, /node:child_process|require\(['"]child_process['"]\)/);
  const verifySh = fs.readFileSync(RELEASE_VERIFY_SH, 'utf8');
  assert.match(verifySh, /--rehearse-upgrade/);
  assert.match(verifySh, /release-rehearsal\.js/);

  // Exercise release-verify.sh --mode dry-run --rehearse-upgrade end-to-end on a fixture repo.
  const { tmp, repo, stubs } = seedFixtureRepo({ versions: ['1.0.0'], headVersion: '1.1.0' });
  copyFromRoot(repo, 'scripts/release/release-verify.sh');
  copyFromRoot(repo, 'scripts/release/extract-notes.sh');
  copyFromRoot(repo, 'scripts/release/release-rehearsal.js');
  copyFromRoot(repo, 'scripts/lib/release-rehearsal.js');
  writeFile(path.join(repo, 'CHANGELOG.md'), '# Changelog\n\n## 1.1.0 — 2026-11-27 — fixture\n\n- note\n');
  writeFile(path.join(repo, 'scripts', 'release', 'verify-publication-bundle.js'), '// stub\n');
  writeFile(path.join(repo, 'scripts', 'ci', 'verify-release-parity.js'), '// stub\n');
  writeFile(path.join(repo, 'scripts', 'ci', 'verify-platform-packages.js'), '// stub\n');
  writeFile(path.join(repo, 'scripts', 'release', 'release-artifact-manifest.js'), "const fs=require('fs');const i=process.argv.indexOf('--output');fs.writeFileSync(process.argv[i+1],'{}');\n");
  writeFile(path.join(repo, 'scripts', 'release', 'release-publication-bundle.js'), "const fs=require('fs');const n=process.argv[process.argv.indexOf('--notes-file')+1];fs.copyFileSync(n,process.argv[process.argv.indexOf('--output')+1]);fs.writeFileSync(process.argv[process.argv.indexOf('--digest-output')+1],'{}');\n");
  writeFile(path.join(repo, 'scripts', 'release', 'verify-publication-bundle.js'), "const fs=require('fs');const b=process.argv[process.argv.indexOf('--bundle')+1];fs.copyFileSync(b,process.argv[process.argv.indexOf('--notes-output')+1]);\n");
  const prevBin = fs.readFileSync(path.join(repo, 'bin', 'dhpk'), 'utf8');
  const withHarness = prevBin.replace(/\nprocess\.exit\(1\);\s*$/, `
if (args[0] === 'harness') { console.log(JSON.stringify({ outcome: 'PASS' })); process.exit(0); }
process.exit(1);
`);
  const patchedBin = withHarness.replace(
    "console.log(JSON.stringify({ surface, operation: 'build', verdict: 'PASS', output }));",
    "const arch = output + '-' + version + '.tar.gz'; fs.writeFileSync(arch, 'archive'); console.log(JSON.stringify({ surface, operation: 'build', verdict: 'PASS', output, archive: arch }));",
  );
  writeFile(path.join(repo, 'bin', 'dhpk'), patchedBin, 0o755);
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'add release-verify fixture files');

  const outDir = path.join(tmp, 'verify-out');
  const res = spawnSync('bash', [path.join(repo, 'scripts', 'release', 'release-verify.sh'), '--mode', 'dry-run', '--out-dir', outDir, '--rehearse-upgrade'], {
    cwd: repo,
    encoding: 'utf8',
    env: { ...process.env, PATH: minimalPathWithoutHosts(stubs), GITHUB_RUN_ID: '9999' },
  });
  assert.strictEqual(res.status, 0, res.stderr + res.stdout);
  assert.match(res.stdout, /::group::release-verify \[dry-run\] upgrade-rehearsal/);
  const rehearsalReport = JSON.parse(fs.readFileSync(path.join(outDir, 'dhpk-release-rehearsal.json'), 'utf8'));
  assert.strictEqual(rehearsalReport.verdict, 'PASS');
  assert.strictEqual(rehearsalReport.priorTag, 'v1.0.0');
});

test('real repository checkout rehearses v(N-1) -> HEAD upgrade offline cleanly', () => {
  const { rehearseReleaseUpgrade } = require(REHEARSAL_LIB);
  const tmp = makeTempDir('dhpk-rehearsal-real-');
  const cleanClone = path.join(tmp, 'clean-repo');
  git(ROOT, 'clone', '--quiet', '--config', 'advice.detachedHead=false', ROOT, cleanClone);
  const report = rehearseReleaseUpgrade({ repoRoot: cleanClone, offline: true });
  assert.strictEqual(report.verdict, 'PASS', JSON.stringify(report.diagnostics));
  assert.match(report.priorTag, /^v\d+\.\d+\.\d+$/);
  assert.strictEqual(report.stages.duplicateDiscovery.report.hosts.codex.baseline.verdict, 'PASS');
  assert.strictEqual(report.stages.duplicateDiscovery.report.hosts.claude.baseline.verdict, 'PASS');
  assert.strictEqual(report.stages.liveFreshSession.status, 'NOT_RUN');
});

run('release-rehearsal-upgrade');
