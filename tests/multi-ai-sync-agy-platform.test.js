'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'skills/dhpk-cross-agent-sync/scripts/multi_ai_sync.py');

function tempRoot(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `dhpk-${prefix}-`));
}

function write(filePath, content, mode) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, mode ? { mode } : undefined);
}

function agyPackage(root) {
  const packageRoot = path.join(root, 'plugins/dhpk-agy');
  write(path.join(packageRoot, 'plugin.json'), JSON.stringify({
    name: 'dhpk',
    version: '0.39.0',
    agents: ['./agents/'],
    rules: ['./rules/'],
    skills: ['./skills/'],
  }));
  write(path.join(packageRoot, 'agents/sample.md'), [
    '---',
    'name: sample',
    'description: Sample AGY agent',
    'tools: ["read_file", "invoke_subagent"]',
    'model: inherit',
    '---',
    '',
    '# Sample',
    '',
  ].join('\n'));
  write(path.join(packageRoot, 'agents/INDEX.md'), '# navigation only\n');
  write(path.join(packageRoot, 'agents/README.md'), '# navigation only\n');
  write(path.join(packageRoot, 'rules/sample.md'), '# rule\n');
  write(path.join(packageRoot, 'skills/dhpk-sample/SKILL.md'), '# skill\n');

  const files = {};
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const filePath = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(filePath);
      else if (entry.isFile() && !['provenance.json', 'fingerprints.json'].includes(path.relative(packageRoot, filePath))) {
        const relative = path.relative(packageRoot, filePath).split(path.sep).join('/');
        files[relative] = crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
      }
    }
  };
  walk(packageRoot);
  write(path.join(packageRoot, 'fingerprints.json'), JSON.stringify({ schema: 'dhpk.agy-plugin.v1', files }));
  write(path.join(packageRoot, 'provenance.json'), JSON.stringify({
    surface: 'agy-plugin',
    schema: 'dhpk.agy-plugin.v1',
    provenanceSchema: 'dhpk.platform-provenance.v1',
    owner: 'plugins/dhpk-agy',
    packageRoot: 'plugins/dhpk-agy',
    sourceVersion: '0.39.0',
    sourceCommit: 'c'.repeat(40),
    inventoryDigest: 'd'.repeat(64),
    generatorVersion: '1.0.0',
    transform: { id: 'agy-agent-frontmatter-v1', version: '1' },
    fingerprints: files,
    selectedIds: { agents: ['sample.md'], rules: ['rules/sample.md'], skills: ['sample'] },
  }));
}

function validate(root, extra = [], env = process.env) {
  return spawnSync('python3', ['-B', SCRIPT, '--root', root, 'validate', '--targets', 'agy', '--format', 'json', ...extra], {
    encoding: 'utf8',
    timeout: 20000,
    env,
  });
}

test('explicit AGY target without a marker is BLOCKED', () => {
  const root = tempRoot('agy-blocked');
  try {
    const result = validate(root);
    const report = JSON.parse(result.stdout);
    const row = report.results.find((item) => item.platform === 'agy');
    assert.strictEqual(row.final_status, 'BLOCKED');
    assert.notStrictEqual(result.status, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('valid package separates structural discovery from unavailable consumer CLI', () => {
  const root = tempRoot('agy-unavailable');
  try {
    agyPackage(root);
    const env = { ...process.env, PATH: '/usr/bin:/bin' };
    const result = validate(root, [], env);
    const report = JSON.parse(result.stdout);
    const row = report.results.find((item) => item.platform === 'agy');
    assert.strictEqual(row.capabilities.find((item) => item.id === 'agy.package.structure').status, 'PASS');
    assert.strictEqual(row.capabilities.find((item) => item.id === 'agy.discovery.plugins').status, 'UNAVAILABLE');
    assert.strictEqual(row.capabilities.find((item) => item.id === 'agy.runtime.subagent').status, 'NOT_RUN');
    assert.strictEqual(row.final_status, 'UNAVAILABLE');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('receipt-less or traversal-shaped AGY packages cannot claim structure PASS', () => {
  const root = tempRoot('agy-invalid-structure');
  try {
    const packageRoot = path.join(root, 'plugins/dhpk-agy');
    write(path.join(packageRoot, 'plugin.json'), JSON.stringify({
      name: 'dhpk', version: '0.39.0', agents: ['../../outside/'], rules: ['./rules/'], skills: ['./skills/'],
    }));
    write(path.join(packageRoot, 'agents/sample.md'), [
      '---', 'name: sample', 'description: Sample', 'tools: ["read_file"]', 'model: inherit', '---', '',
    ].join('\n'));
    const result = validate(root, [], { ...process.env, PATH: '/usr/bin:/bin' });
    const report = JSON.parse(result.stdout);
    const row = report.results.find((item) => item.platform === 'agy');
    assert.strictEqual(row.capabilities.find((item) => item.id === 'agy.package.structure').status, 'FAIL');
    assert.notStrictEqual(result.status, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('incomplete AGY provenance cannot claim structure PASS', () => {
  const root = tempRoot('agy-incomplete-receipt');
  try {
    agyPackage(root);
    const provenancePath = path.join(root, 'plugins/dhpk-agy/provenance.json');
    const provenance = JSON.parse(fs.readFileSync(provenancePath, 'utf8'));
    delete provenance.generatorVersion;
    fs.writeFileSync(provenancePath, JSON.stringify(provenance));
    const result = validate(root, [], { ...process.env, PATH: '/usr/bin:/bin' });
    const report = JSON.parse(result.stdout);
    const row = report.results.find((item) => item.platform === 'agy');
    assert.strictEqual(row.capabilities.find((item) => item.id === 'agy.package.structure').status, 'FAIL');
    assert.notStrictEqual(result.status, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('stubbed agy plugins/agents and bounded runtime probes remain distinct', () => {
  const root = tempRoot('agy-probe');
  const bin = path.join(root, 'bin');
  try {
    agyPackage(root);
    write(path.join(bin, 'agy'), [
      '#!/bin/sh',
      'if [ "$1" = "plugins" ] && [ "$2" = "list" ]; then echo "dhpk 0.39.0"; exit 0; fi',
      'if [ "$1" = "agents" ]; then echo "sample"; exit 0; fi',
      'if [ "$1" = "subagent" ]; then',
      '  if [ -e /var/run/docker.sock ] || [ -e /run/user/1000/bus ]; then exit 91; fi',
      '  if touch /workspace/plugins/dhpk-agy/agents/sandbox-write 2>/dev/null; then exit 92; fi',
      '  echo "AGY_SMOKE_OK"; exit 0;',
      'fi',
      'exit 2',
      '',
    ].join('\n'), 0o755);
    const env = { ...process.env, PATH: `${bin}:/usr/bin:/bin` };
    const discovery = JSON.parse(validate(root, [], env).stdout).results.find((item) => item.platform === 'agy');
    const discoveryPluginsStatus = discovery.capabilities.find((item) => item.id === 'agy.discovery.plugins').status;
    const discoveryAgentsStatus = discovery.capabilities.find((item) => item.id === 'agy.discovery.agents').status;
    assert.ok(['PASS', 'UNAVAILABLE'].includes(discoveryPluginsStatus), `unexpected plugin discovery status: ${discoveryPluginsStatus}`);
    assert.ok(['PASS', 'UNAVAILABLE'].includes(discoveryAgentsStatus), `unexpected agent discovery status: ${discoveryAgentsStatus}`);
    assert.strictEqual(discovery.capabilities.find((item) => item.id === 'agy.runtime.subagent').status, 'NOT_RUN');

    const runtime = JSON.parse(validate(root, ['--agy-runtime-probe'], env).stdout).results.find((item) => item.platform === 'agy');
    const runtimeStatus = runtime.capabilities.find((item) => item.id === 'agy.runtime.subagent').status;
    assert.ok(['PASS', 'UNAVAILABLE'].includes(runtimeStatus), `unexpected runtime probe status: ${runtimeStatus}`);
    assert.strictEqual(runtime.final_status, runtimeStatus === 'PASS' ? 'PASS' : 'UNAVAILABLE');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('import-only agy plugins list is not native plugin discovery PASS', () => {
  const root = tempRoot('agy-import-only');
  const bin = path.join(root, 'bin');
  try {
    agyPackage(root);
    write(path.join(bin, 'agy'), [
      '#!/bin/sh',
      'if [ "$1" = "plugins" ] && [ "$2" = "list" ]; then',
      '  printf \'%s\\n\' \'{"imports":[{"name":"dhpk","source":"claude-code","importedAt":"2026-08-07T07:51:05Z","components":["skills","agents"]}]}\'',
      '  exit 0',
      'fi',
      'if [ "$1" = "agents" ]; then printf \'%s\\n\' \'unrelated-host-agent\'; exit 0; fi',
      'exit 2',
      '',
    ].join('\n'), 0o755);
    const result = validate(root, [], { ...process.env, PATH: `${bin}:/usr/bin:/bin` });
    const row = JSON.parse(result.stdout).results.find((item) => item.platform === 'agy');
    const plugins = row.capabilities.find((item) => item.id === 'agy.discovery.plugins').status;
    const agents = row.capabilities.find((item) => item.id === 'agy.discovery.agents').status;
    assert.ok(['FAIL', 'UNAVAILABLE'].includes(plugins), `import-only plugins list must not PASS: ${plugins}`);
    assert.ok(['FAIL', 'UNAVAILABLE'].includes(agents), `unrelated agents must not PASS: ${agents}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('AGY sandbox binds the native package at the consumer plugin path', () => {
  const source = fs.readFileSync(path.join(ROOT, 'skills/dhpk-cross-agent-sync/scripts/multi_ai_sync_lib/validation.py'), 'utf8');
  assert.match(
    source,
    /"--ro-bind", os\.path\.realpath\(package_root\), "\/home\/agy\/\.gemini\/config\/plugins\/dhpk"/,
  );
  assert.doesNotMatch(source, /--ro-bind.*\/workspace\/plugins\/dhpk-agy/);
});

run('multi-ai-sync-agy-platform');
