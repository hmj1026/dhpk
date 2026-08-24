'use strict';

// Coverage for scripts/agy-adapt-agents.js — rewrites agent frontmatter
// `tools: [...]` lines to AGY-compatible tool names and strips `color:`
// metadata. Always run against a temp fixture dir, never the repo's real
// native plugin package.

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'agy-adapt-agents.js');

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agy-adapt-'));
}

function createStagingPackage(tmp) {
  const packageRoot = path.join(tmp, 'staging-package');
  for (const directory of ['agents', 'rules', 'skills']) fs.mkdirSync(path.join(packageRoot, directory), { recursive: true });
  const plugin = {
    name: 'dhpk',
    version: '1.0.0',
    agents: ['./agents/'],
    skills: ['./skills/'],
    rules: ['./rules/'],
  };
  const pluginText = `${JSON.stringify(plugin)}\n`;
  const pluginFingerprint = crypto.createHash('sha256').update(pluginText).digest('hex');
  const fingerprints = { 'plugin.json': pluginFingerprint };
  const provenance = {
    schema: 'dhpk.agy-plugin.v1',
    provenanceSchema: 'dhpk.platform-provenance.v1',
    owner: 'plugins/dhpk-agy',
    packageRoot: 'plugins/dhpk-agy',
    fingerprints,
  };
  fs.writeFileSync(path.join(packageRoot, 'plugin.json'), pluginText);
  fs.writeFileSync(path.join(packageRoot, 'provenance.json'), `${JSON.stringify(provenance)}\n`);
  fs.writeFileSync(path.join(packageRoot, 'fingerprints.json'), `${JSON.stringify({ schema: 'dhpk.agy-plugin.v1', files: fingerprints })}\n`);
  return packageRoot;
}

function refreshStagingReceipt(packageRoot) {
  const files = {};
  const walk = (directory, relative = '') => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const child = path.join(directory, entry.name);
      const childRelative = path.posix.join(relative, entry.name);
      if (entry.isDirectory()) walk(child, childRelative);
      else if (entry.isFile() && !['provenance.json', 'fingerprints.json'].includes(childRelative)) {
        files[childRelative] = crypto.createHash('sha256').update(fs.readFileSync(child)).digest('hex');
      }
    }
  };
  walk(packageRoot);
  const provenancePath = path.join(packageRoot, 'provenance.json');
  const provenance = JSON.parse(fs.readFileSync(provenancePath, 'utf8'));
  provenance.fingerprints = files;
  fs.writeFileSync(provenancePath, `${JSON.stringify(provenance)}\n`);
  fs.writeFileSync(path.join(packageRoot, 'fingerprints.json'), `${JSON.stringify({ schema: 'dhpk.agy-plugin.v1', files })}\n`);
}

function runScript(args) {
  return spawnSync('node', [SCRIPT, ...args], { encoding: 'utf8', timeout: 10000 });
}

test('--help prints usage and exits 0', () => {
  const res = runScript(['--help']);
  assert.strictEqual(res.status, 0, res.stderr);
  assert.ok(res.stdout.includes('Usage:'), res.stdout);
});

test('missing directory errors and exits 1', () => {
  const tmp = mkTmp();
  try {
    const missing = path.join(tmp, 'nope');
    const res = runScript(['--staging-root', missing]);
    assert.strictEqual(res.status, 1);
    assert.ok(res.stderr.includes('staging package directory not found'), res.stderr);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('too many positional args throws and exits 1', () => {
  const res = runScript(['dirA', 'dirB']);
  assert.strictEqual(res.status, 1);
  assert.ok(res.stderr.includes('--staging-root'), res.stderr);
});

test('rewrites tools list to AGY names, dedupes, strips color, and reports counts', () => {
  const tmp = mkTmp();
  try {
    const packageRoot = createStagingPackage(tmp);
    const agentsDir = path.join(packageRoot, 'agents');
    const src = [
      '---',
      'name: sample',
      'color: blue',
      "tools: ['Read', 'Write', 'Read', 'mcp__foo__bar']",
      '---',
      '',
      'Body text.',
      '',
    ].join('\n');
    fs.writeFileSync(path.join(agentsDir, 'sample.md'), src);
    fs.writeFileSync(path.join(agentsDir, 'no-frontmatter.md'), 'Just a plain markdown file.\n');
    refreshStagingReceipt(packageRoot);

    const res = runScript(['--staging-root', packageRoot]);
    assert.strictEqual(res.status, 0, res.stderr);
    assert.ok(res.stdout.includes('Updated 1 agent file(s); 1 already compatible'), res.stdout);

    const rewritten = fs.readFileSync(path.join(agentsDir, 'sample.md'), 'utf8');
    assert.ok(!rewritten.includes('color:'), rewritten);
    assert.ok(rewritten.includes('tools: ["read_file", "write_to_file", "mcp_foo_bar"]'), rewritten);
    assert.ok(rewritten.includes('Body text.'), rewritten);

    const adaptedDigest = crypto.createHash('sha256').update(rewritten).digest('hex');
    const provenance = JSON.parse(fs.readFileSync(path.join(packageRoot, 'provenance.json'), 'utf8'));
    const fingerprints = JSON.parse(fs.readFileSync(path.join(packageRoot, 'fingerprints.json'), 'utf8'));
    assert.strictEqual(provenance.fingerprints['agents/sample.md'], adaptedDigest, JSON.stringify(provenance));
    assert.deepStrictEqual(provenance.fingerprints, fingerprints.files);

    const untouched = fs.readFileSync(path.join(agentsDir, 'no-frontmatter.md'), 'utf8');
    assert.strictEqual(untouched, 'Just a plain markdown file.\n');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('already-compatible tools line is left unchanged (idempotent, reported as unchanged)', () => {
  const tmp = mkTmp();
  try {
    const packageRoot = createStagingPackage(tmp);
    const agentsDir = path.join(packageRoot, 'agents');
    const src = ['---', 'name: sample', 'tools: ["read_file", "write_to_file"]', 'model: inherit', '---', '', 'Body.', ''].join('\n');
    fs.writeFileSync(path.join(agentsDir, 'sample.md'), src);
    refreshStagingReceipt(packageRoot);

    const res = runScript(['--staging-root', packageRoot]);
    assert.strictEqual(res.status, 0, res.stderr);
    assert.ok(res.stdout.includes('Updated 0 agent file(s); 1 already compatible'), res.stdout);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('rejects direct agents-directory and install-root usage', () => {
  const tmp = mkTmp();
  try {
    const agentsDir = path.join(tmp, 'agents');
    fs.mkdirSync(agentsDir, { recursive: true });
    const positional = runScript([agentsDir]);
    assert.strictEqual(positional.status, 1);
    assert.match(positional.stderr, /--staging-root/);

    const packageRoot = createStagingPackage(tmp);
    const installRoot = path.join(packageRoot, '.gemini', 'config', 'plugins', 'dhpk');
    fs.mkdirSync(path.join(installRoot, 'agents'), { recursive: true });
    for (const file of ['plugin.json', 'provenance.json', 'fingerprints.json']) {
      fs.copyFileSync(path.join(packageRoot, file), path.join(installRoot, file));
    }
    const install = runScript(['--staging-root', installRoot]);
    assert.strictEqual(install.status, 1);
    assert.match(install.stderr, /installation target|staging package/i);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('rejects symlinked staging roots and agents directories', () => {
  const tmp = mkTmp();
  try {
    const packageRoot = createStagingPackage(tmp);
    const linkedRoot = path.join(tmp, 'linked-package');
    fs.symlinkSync(packageRoot, linkedRoot, 'dir');
    const rootResult = runScript(['--staging-root', linkedRoot]);
    assert.strictEqual(rootResult.status, 1);
    assert.match(rootResult.stderr, /symlinked staging package/i);

    const packageWithLinkedAgents = path.join(tmp, 'package-with-linked-agents');
    fs.cpSync(packageRoot, packageWithLinkedAgents, { recursive: true, dereference: true });
    const realAgents = path.join(tmp, 'real-agents');
    fs.rmSync(path.join(packageWithLinkedAgents, 'agents'), { recursive: true, force: true });
    fs.mkdirSync(realAgents, { recursive: true });
    fs.symlinkSync(realAgents, path.join(packageWithLinkedAgents, 'agents'), 'dir');
    const agentsResult = runScript(['--staging-root', packageWithLinkedAgents]);
    assert.strictEqual(agentsResult.status, 1);
    assert.match(agentsResult.stderr, /symlinked staging package/i);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('rejects a tampered staging package before rewriting any file', () => {
  const tmp = mkTmp();
  try {
    const packageRoot = createStagingPackage(tmp);
    const agentsDir = path.join(packageRoot, 'agents');
    fs.writeFileSync(path.join(agentsDir, 'sample.md'), ['---', 'name: sample', 'tools: [Read]', '---', '', 'Body.', ''].join('\n'));
    refreshStagingReceipt(packageRoot);
    const agentPath = path.join(agentsDir, 'sample.md');
    fs.appendFileSync(agentPath, 'tampered\n');
    const before = Object.fromEntries(['plugin.json', 'provenance.json', 'fingerprints.json', 'agents/sample.md'].map((relative) => [relative, fs.readFileSync(path.join(packageRoot, relative), 'utf8')]));

    const result = runScript(['--staging-root', packageRoot]);
    assert.strictEqual(result.status, 1);
    assert.match(result.stderr, /fingerprint mismatch|fingerprints do not cover/i);
    for (const [relative, content] of Object.entries(before)) {
      assert.strictEqual(fs.readFileSync(path.join(packageRoot, relative), 'utf8'), content, relative);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

run('agy-adapt-agents');
