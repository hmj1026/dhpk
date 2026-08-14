'use strict';

// CLI-level coverage for scripts/release/consumer-gate.js. Stubs the `claude`
// and `codex` binaries (same pattern as tests/release-runner.test.js) so
// this suite NEVER touches the real global Claude plugin cache or a real
// Codex install — consumer-gate.js is only ever run for real inside the
// tag-triggered release.yml job, on an ephemeral, clean CI runner.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'scripts', 'release', 'consumer-gate.js');
const { discoverCodexSurface, evaluateCodexSurfaceMatrix, fingerprintDir, fingerprintPath, redactEvidence } = require(CLI);

function mkBinStub(dir, name, body) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), body, { mode: 0o755 });
}

// PATH containing real node/bash but deliberately excluding wherever the
// real `claude` CLI lives, so "claude absent" is genuinely absent rather
// than relying on ordering against the host's real PATH.
const NODE_BASH_ONLY_PATH = [path.dirname(process.execPath), '/usr/bin', '/bin'].join(path.delimiter);

// The codex-sync check verifies the installed manifest version against the
// target; use the real repo's own current version so these tests don't
// depend on a fixture package tree.
const REAL_VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8')).version;

function runCli(env) {
  return spawnSync('node', [CLI, '--version', REAL_VERSION, '--repo-root', ROOT], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

test('reports Codex sync PASS and Claude/native-marketplace as UNAVAILABLE when claude CLI is absent', () => {
  const res = runCli({ PATH: NODE_BASH_ONLY_PATH });
  const stage = JSON.parse(res.stdout);
  assert.strictEqual(stage.verdict, 'UNAVAILABLE', JSON.stringify(stage));
  assert.ok(stage.failureReasons.some((r) => /claude/i.test(r)));
  assert.ok(stage.artifacts.some((a) => /claude.*official.*NOT RUN|official.*NOT RUN.*claude/i.test(a)), JSON.stringify(stage));
  assert.ok(stage.artifacts.some((a) => /native.*experimental|experimental.*native/i.test(a)));
});

test('reports overall PASS when the supported Codex sync check succeeds and a stubbed claude CLI reports the install', () => {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-consumer-gate-bin-'));
  mkBinStub(bin, 'claude', `#!/bin/sh
if [ "$1 $2" = "plugin marketplace" ]; then exit 0; fi
if [ "$1 $2" = "plugin install" ]; then exit 0; fi
if [ "$1 $2" = "plugin validate" ]; then exit 0; fi
if [ "$1 $2" = "plugin list" ]; then echo '[{"id":"dhpk@dhpk","version":"${REAL_VERSION}"}]'; exit 0; fi
exit 0
`);
  const res = runCli({ PATH: `${bin}:${NODE_BASH_ONLY_PATH}` });
  const stage = JSON.parse(res.stdout);
  assert.strictEqual(stage.verdict, 'PASS', JSON.stringify(stage));
  assert.strictEqual(res.status, 0);
  assert.ok(stage.artifacts.some((a) => /claude.*official.*PASS|official.*PASS.*claude/i.test(a)), JSON.stringify(stage));
  assert.ok(stage.commands.some((c) => /claude plugin validate .* --strict/.test(c.cmd) && c.exitCode === 0), JSON.stringify(stage));
});

test('fails when the stubbed claude CLI reports a version mismatch after install', () => {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-consumer-gate-bin-'));
  mkBinStub(bin, 'claude', `#!/bin/sh
if [ "$1 $2" = "plugin marketplace" ]; then exit 0; fi
if [ "$1 $2" = "plugin install" ]; then exit 0; fi
if [ "$1 $2" = "plugin validate" ]; then exit 0; fi
if [ "$1 $2" = "plugin list" ]; then echo '[{"id":"dhpk@dhpk","version":"0.0.1"}]'; exit 0; fi
exit 0
`);
  const res = runCli({ PATH: `${bin}:${NODE_BASH_ONLY_PATH}` });
  assert.notStrictEqual(res.status, 0);
  const stage = JSON.parse(res.stdout);
  assert.strictEqual(stage.verdict, 'FAIL');
  assert.ok(stage.failureReasons.some((r) => /0\.0\.1/.test(r)));
});

test('blocks the consumer gate when official Claude strict validation fails', () => {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-consumer-gate-bin-'));
  mkBinStub(bin, 'claude', `#!/bin/sh
if [ "$1" = "--version" ]; then echo '2.1.223'; exit 0; fi
if [ "$1 $2" = "plugin marketplace" ]; then exit 0; fi
if [ "$1 $2" = "plugin install" ]; then exit 0; fi
if [ "$1 $2" = "plugin validate" ]; then echo 'skills/dhpk-ios-platform/SKILL.md: YAML frontmatter failed to parse' >&2; exit 1; fi
if [ "$1 $2" = "plugin list" ]; then echo '[{"id":"dhpk@dhpk","version":"${REAL_VERSION}"}]'; exit 0; fi
exit 0
`);
  const res = runCli({ PATH: `${bin}:${NODE_BASH_ONLY_PATH}` });
  assert.notStrictEqual(res.status, 0);
  const stage = JSON.parse(res.stdout);
  assert.strictEqual(stage.verdict, 'FAIL', JSON.stringify(stage));
  assert.ok(stage.failureReasons.some((r) => /official.*strict|claude.*validate|ios-platform/i.test(r)), JSON.stringify(stage));
  assert.ok(stage.commands.some((c) => /claude plugin validate .* --strict/.test(c.cmd) && c.exitCode !== 0), JSON.stringify(stage));
});

test('duplicate Codex surfaces use the deterministic PASS/WARN/BLOCKED matrix', () => {
  const base = { id: 'dhpk:demo', version: '1.0.0', owned: true, current: true };
  assert.strictEqual(evaluateCodexSurfaceMatrix({
    project: { ...base, fingerprint: 'same' },
    native: { ...base, fingerprint: 'same' },
    precedence: 'project-local',
    nativeExperimental: true,
  }).verdict, 'PASS');
  assert.strictEqual(evaluateCodexSurfaceMatrix({
    project: { ...base, fingerprint: 'project' },
    native: { ...base, fingerprint: 'native' },
    precedence: 'project-local',
    nativeExperimental: true,
  }).verdict, 'WARN');
  assert.strictEqual(evaluateCodexSurfaceMatrix({
    project: { ...base, owned: false, fingerprint: 'same' },
    native: { ...base, fingerprint: 'same' },
    precedence: 'project-local',
    nativeExperimental: true,
  }).verdict, 'BLOCKED');
  assert.strictEqual(evaluateCodexSurfaceMatrix({
    project: { ...base, fingerprint: 'same' },
    native: { ...base, fingerprint: 'same' },
    precedence: null,
    nativeExperimental: true,
  }).verdict, 'BLOCKED');
  assert.strictEqual(evaluateCodexSurfaceMatrix({
    project: { ...base, fingerprint: 'same' },
    native: { ...base, current: false, fingerprint: 'same' },
    precedence: 'project-local',
    nativeExperimental: true,
  }).verdict, 'BLOCKED');
});

test('consumer gate resolves a relative repository root before entering its sandbox', () => {
  const res = spawnSync('node', [CLI, '--version', REAL_VERSION, '--repo-root', '.'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, PATH: NODE_BASH_ONLY_PATH },
  });
  assert.strictEqual(res.status, 0, `${res.stdout}\n${res.stderr}`);
  const stage = JSON.parse(res.stdout);
  assert.ok(['PASS', 'UNAVAILABLE'].includes(stage.verdict), JSON.stringify(stage));
});

test('Codex surface discovery includes both skill and agent inventories', () => {
  const surfaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-consumer-surface-'));
  try {
    fs.mkdirSync(path.join(surfaceRoot, 'skills', 'demo-skill'), { recursive: true });
    fs.writeFileSync(path.join(surfaceRoot, 'skills', 'demo-skill', 'SKILL.md'), 'skill\n');
    fs.mkdirSync(path.join(surfaceRoot, 'agents', 'demo-agent'), { recursive: true });
    fs.writeFileSync(path.join(surfaceRoot, 'agents', 'demo-agent', 'AGENT.md'), 'agent\n');
    const entries = discoverCodexSurface({
      root: surfaceRoot,
      surfaceRoot,
      label: 'project-local',
      version: '1.0.0',
      manifest: {
        schema_version: 2,
        plugin_version: '1.0.0',
        managed_entries: {
          skills: { 'demo-skill': { destination_fingerprint: require(CLI).fingerprintPath(path.join(surfaceRoot, 'skills', 'demo-skill')) } },
          agents: { 'demo-agent': { destination_fingerprint: require(CLI).fingerprintPath(path.join(surfaceRoot, 'agents', 'demo-agent')) } },
        },
      },
    });
    assert.deepStrictEqual(entries.map((entry) => `${entry.kind}:${entry.id}`), ['agents:demo-agent', 'skills:demo-skill']);
    assert.ok(entries.every((entry) => entry.owned && entry.current));
  } finally {
    fs.rmSync(surfaceRoot, { recursive: true, force: true });
  }
});

test('consumer Codex fingerprints include destination Python bytecode integrity', () => {
  const surfaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-consumer-bytecode-'));
  try {
    const target = path.join(surfaceRoot, 'skills', 'demo-skill');
    const cache = path.join(target, '__pycache__');
    fs.mkdirSync(cache, { recursive: true });
    fs.writeFileSync(path.join(target, 'SKILL.md'), 'skill\n');
    const bytecode = path.join(cache, 'fixture.pyc');
    fs.writeFileSync(bytecode, Buffer.from('bytecode-v1'));
    const before = fingerprintPath(target);
    fs.writeFileSync(bytecode, Buffer.from('bytecode-v2'));
    assert.notStrictEqual(fingerprintPath(target), before,
      'consumer ownership must detect a changed destination bytecode file');
    assert.notStrictEqual(before, '');
  } finally {
    fs.rmSync(surfaceRoot, { recursive: true, force: true });
  }
});

test('project-local fingerprinting rejects symlinks that resolve outside approved roots', () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-consumer-project-link-'));
  const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-consumer-outside-link-'));
  try {
    const target = path.join(projectRoot, '.codex', 'skills', 'demo-skill');
    const outside = path.join(outsideRoot, 'demo-skill');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.mkdirSync(outside, { recursive: true });
    fs.writeFileSync(path.join(outside, 'SKILL.md'), 'outside\n');
    fs.symlinkSync(outside, target, 'dir');
    const entries = discoverCodexSurface({
      root: projectRoot,
      surfaceRoot: path.join(projectRoot, '.codex'),
      label: 'project-local',
      version: '1.0.0',
      allowedRoots: [projectRoot],
    });
    assert.strictEqual(entries.length, 1);
    assert.match(entries[0].fingerprintError, /approved root|outside|symlink/i);
    assert.strictEqual(entries[0].owned, false);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
    fs.rmSync(outsideRoot, { recursive: true, force: true });
  }
});

test('project-local fingerprinting rejects a symlinked surface ancestor', () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-consumer-project-ancestor-'));
  const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-consumer-outside-ancestor-'));
  try {
    const outsideSkills = path.join(outsideRoot, 'skills');
    fs.mkdirSync(path.join(outsideSkills, 'demo-skill'), { recursive: true });
    fs.writeFileSync(path.join(outsideSkills, 'demo-skill', 'SKILL.md'), 'outside\n');
    fs.mkdirSync(path.join(projectRoot, '.codex'), { recursive: true });
    fs.symlinkSync(outsideSkills, path.join(projectRoot, '.codex', 'skills'), 'dir');
    assert.throws(() => discoverCodexSurface({
      root: projectRoot,
      surfaceRoot: path.join(projectRoot, '.codex'),
      label: 'project-local',
      version: '1.0.0',
      allowedRoots: [projectRoot],
    }), /approved root|outside|symlink/i);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
    fs.rmSync(outsideRoot, { recursive: true, force: true });
  }
});

test('native surface fingerprinting rejects a symlinked skill root', () => {
  const nativeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-consumer-native-link-'));
  const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-consumer-native-outside-'));
  try {
    const target = path.join(nativeRoot, 'skills', 'demo-native');
    const outside = path.join(outsideRoot, 'demo-native');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.mkdirSync(outside, { recursive: true });
    fs.writeFileSync(path.join(outside, 'SKILL.md'), 'outside\n');
    fs.symlinkSync(outside, target, 'dir');
    const entries = discoverCodexSurface({
      root: nativeRoot,
      surfaceRoot: nativeRoot,
      label: 'native-experimental',
      version: '1.0.0',
      fingerprintFn: fingerprintDir,
      expectedFingerprintFn: fingerprintDir,
    });
    assert.strictEqual(entries.length, 1);
    assert.match(entries[0].fingerprintError, /symlink/i);
    assert.strictEqual(entries[0].owned, false);
  } finally {
    fs.rmSync(nativeRoot, { recursive: true, force: true });
    fs.rmSync(outsideRoot, { recursive: true, force: true });
  }
});

test('native surface fingerprinting rejects a symlinked ancestor', () => {
  const nativeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-consumer-native-ancestor-'));
  const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-consumer-native-outside-ancestor-'));
  try {
    const outsideSkills = path.join(outsideRoot, 'skills');
    fs.mkdirSync(path.join(outsideSkills, 'demo-native'), { recursive: true });
    fs.writeFileSync(path.join(outsideSkills, 'demo-native', 'SKILL.md'), 'outside\n');
    fs.symlinkSync(outsideSkills, path.join(nativeRoot, 'skills'), 'dir');
    assert.throws(() => discoverCodexSurface({
      root: nativeRoot,
      surfaceRoot: nativeRoot,
      label: 'native-experimental',
      version: '1.0.0',
      fingerprintFn: fingerprintDir,
      expectedFingerprintFn: fingerprintDir,
    }), /symlink/i);
  } finally {
    fs.rmSync(nativeRoot, { recursive: true, force: true });
    fs.rmSync(outsideRoot, { recursive: true, force: true });
  }
});

test('consumer fingerprint traversal rejects excessive directory depth before unbounded recursion', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-consumer-fingerprint-depth-'));
  try {
    let current = root;
    for (let depth = 0; depth < 4; depth += 1) {
      current = path.join(current, `level-${depth}`);
      fs.mkdirSync(current);
    }
    fs.writeFileSync(path.join(current, 'SKILL.md'), 'bounded\n');
    assert.throws(
      () => fingerprintPath(root, { maxDepth: 2 }),
      /maximum directory depth/i,
    );
    assert.throws(
      () => fingerprintPath(root, { maxBytes: 1 }),
      /byte budget/i,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('native surface ownership requires a tracked content fingerprint, not provenance shape alone', () => {
  const surfaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-consumer-native-surface-'));
  try {
    const target = path.join(surfaceRoot, 'skills', 'demo-native');
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, 'SKILL.md'), 'native\n');
    const actual = fingerprintDir(target);
    const valid = discoverCodexSurface({
      root: surfaceRoot,
      surfaceRoot,
      label: 'native-experimental',
      version: '1.0.0',
      provenance: { valid: true, current: true },
      expectedFingerprints: { 'demo-native': actual },
      fingerprintFn: fingerprintPath,
      expectedFingerprintFn: fingerprintDir,
    });
    assert.strictEqual(valid[0].owned, true);
    const tampered = discoverCodexSurface({
      root: surfaceRoot,
      surfaceRoot,
      label: 'native-experimental',
      version: '1.0.0',
      provenance: { valid: true, current: true },
      expectedFingerprints: { 'demo-native': '0'.repeat(64) },
      fingerprintFn: fingerprintPath,
      expectedFingerprintFn: fingerprintDir,
    });
    assert.strictEqual(tampered[0].owned, false);
  } finally {
    fs.rmSync(surfaceRoot, { recursive: true, force: true });
  }
});

test('consumer failure evidence redacts sandbox and repository paths', () => {
  const privateText = `installer failed at ${path.join(os.tmpdir(), 'private-project')} from ${ROOT}/plugins/dhpk Authorization: Bearer AUTH_MARKER_SHOULD_NOT_LEAK postgres://u:DB_MARKER@db.example`;
  const redacted = redactEvidence(privateText, ROOT);
  assert.doesNotMatch(redacted, new RegExp(os.tmpdir().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(redacted, new RegExp(ROOT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(redacted, /<sandbox>/);
  assert.match(redacted, /<repo>/);
  assert.doesNotMatch(redacted, /AUTH_MARKER_SHOULD_NOT_LEAK|DB_MARKER/);
});

run('consumer-gate-cli');
