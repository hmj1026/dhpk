'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const { fingerprintPath } = require('../scripts/release/consumer-gate');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'scripts', 'ci', 'check-codex-discovery.js');

// Stub `codex plugin list --json` on PATH so activation-gated tests never
// reach a real Codex CLI. Mirrors the stub in tests/install-codex-skills.test.js.
const CODEX_STUB_BIN = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-discovery-codex-stub-')));
fs.writeFileSync(path.join(CODEX_STUB_BIN, 'codex'), `#!/bin/sh
if [ "$1" = "plugin" ] && [ "$2" = "list" ] && [ "$3" = "--json" ]; then
  if [ -n "\${DHPK_TEST_CODEX_PLUGIN_LIST_JSON:-}" ]; then
    printf '%s\\n' "\${DHPK_TEST_CODEX_PLUGIN_LIST_JSON}"
  else
    printf '%s\\n' '{"installed":[],"available":[]}'
  fi
  exit "\${DHPK_TEST_CODEX_PLUGIN_LIST_EXIT:-0}"
fi
exit 2
`, { mode: 0o755 });
process.on('exit', () => fs.rmSync(CODEX_STUB_BIN, { recursive: true, force: true }));

function withCodexStub(env = {}) {
  return { ...process.env, ...env, PATH: `${CODEX_STUB_BIN}${path.delimiter}${process.env.PATH || ''}` };
}

function withoutCodexOnPath(env = {}) {
  const filtered = String(process.env.PATH || '')
    .split(path.delimiter)
    .filter((entry) => entry && entry !== CODEX_STUB_BIN)
    .join(path.delimiter);
  return { ...process.env, ...env, PATH: filtered };
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-discovery-cli-'));
  const project = path.join(root, 'project');
  const native = path.join(root, 'native');
  fs.mkdirSync(path.join(project, '.codex', 'skills', 'demo'), { recursive: true });
  fs.mkdirSync(native, { recursive: true });
  fs.writeFileSync(path.join(project, '.codex', 'skills', 'demo', 'SKILL.md'), '# demo\n');
  return { root, project, native };
}

test('check-codex-discovery reports a read-only PASS for a single surface', () => {
  const paths = fixture();
  try {
    const result = spawnSync(process.execPath, [CLI, '--repo-root', paths.root, '--project-root', paths.project, '--native-root', paths.native], {
      cwd: ROOT,
      encoding: 'utf8',
      env: withCodexStub(),
    });
    assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const report = JSON.parse(result.stdout);
    assert.strictEqual(report.verdict, 'PASS');
    assert.strictEqual(report.effective.length, 1);
    assert.strictEqual(report.effective[0].name, 'demo');
    assert.strictEqual(report.providers.native.length, 0);
    assert.ok(report.activation);
  } finally {
    fs.rmSync(paths.root, { recursive: true, force: true });
  }
});

test('check-codex-discovery blocks duplicate runtime providers while preserving PASS integrity evidence', () => {
  const project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-discovery-dual-')));
  const native = path.join(ROOT, 'plugins', 'dhpk');
  const version = JSON.parse(fs.readFileSync(path.join(native, '.codex-plugin', 'plugin.json'), 'utf8')).version;
  const skillName = 'flow-drive';
  const destination = path.join(project, '.codex', 'skills', skillName);
  try {
    fs.cpSync(path.join(native, 'skills', skillName), destination, { recursive: true, dereference: true });
    fs.writeFileSync(path.join(project, '.codex', '.dhpk-installed.json'), `${JSON.stringify({
      schema_version: 3,
      plugin_version: version,
      managed_entries: {
        skills: {
          [skillName]: { destination_fingerprint: fingerprintPath(destination) },
        },
      },
    })}\n`);
    const result = spawnSync(process.execPath, [
      CLI,
      '--repo-root', ROOT,
      '--project-root', project,
      '--native-root', native,
      '--version', version,
    ], {
      cwd: ROOT,
      encoding: 'utf8',
      env: withCodexStub({
        DHPK_TEST_CODEX_PLUGIN_LIST_JSON: JSON.stringify({
          installed: [{ pluginId: 'dhpk@dhpk', enabled: true, version }],
          available: [],
        }),
      }),
    });
    assert.strictEqual(result.status, 1, `${result.stdout}\n${result.stderr}`);
    const report = JSON.parse(result.stdout);
    assert.strictEqual(report.verdict, 'BLOCKED');
    assert.strictEqual(report.integrityVerdict, 'PASS');
    assert.strictEqual(report.reasonCode, 'DUPLICATE_CODEX_PROVIDER');
    assert.deepStrictEqual(report.duplicateInvokableNames, [skillName]);
    assert.strictEqual(report.activation.status, 'ENABLED');
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
  }
});

test('source-tree native artifact without an enabled Codex plugin passes', () => {
  const project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-discovery-inactive-')));
  const native = path.join(ROOT, 'plugins', 'dhpk');
  const version = JSON.parse(fs.readFileSync(path.join(native, '.codex-plugin', 'plugin.json'), 'utf8')).version;
  const skillName = 'flow-drive';
  const destination = path.join(project, '.codex', 'skills', skillName);
  try {
    fs.cpSync(path.join(native, 'skills', skillName), destination, { recursive: true, dereference: true });
    fs.writeFileSync(path.join(project, '.codex', '.dhpk-installed.json'), `${JSON.stringify({
      schema_version: 3,
      plugin_version: version,
      managed_entries: {
        skills: {
          [skillName]: { destination_fingerprint: fingerprintPath(destination) },
        },
      },
    })}\n`);
    const result = spawnSync(process.execPath, [
      CLI,
      '--repo-root', ROOT,
      '--project-root', project,
      '--native-root', native,
      '--version', version,
    ], { cwd: ROOT, encoding: 'utf8', env: withCodexStub() });
    assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const report = JSON.parse(result.stdout);
    assert.strictEqual(report.verdict, 'PASS');
    assert.strictEqual(report.reasonCode, null);
    assert.deepStrictEqual(report.duplicateInvokableNames, []);
    assert.deepStrictEqual(report.inactiveDuplicateInvokableNames, [skillName]);
    assert.ok(report.providers.native.length > 0);
    assert.ok(report.providers.native.every((provider) => provider.active === false));
    assert.strictEqual(report.activation.status, 'AVAILABLE');
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
  }
});

test('disabled native Codex plugin passes', () => {
  const project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-discovery-disabled-')));
  const native = path.join(ROOT, 'plugins', 'dhpk');
  const version = JSON.parse(fs.readFileSync(path.join(native, '.codex-plugin', 'plugin.json'), 'utf8')).version;
  const skillName = 'flow-drive';
  const destination = path.join(project, '.codex', 'skills', skillName);
  try {
    fs.cpSync(path.join(native, 'skills', skillName), destination, { recursive: true, dereference: true });
    fs.writeFileSync(path.join(project, '.codex', '.dhpk-installed.json'), `${JSON.stringify({
      schema_version: 3,
      plugin_version: version,
      managed_entries: {
        skills: {
          [skillName]: { destination_fingerprint: fingerprintPath(destination) },
        },
      },
    })}\n`);
    const result = spawnSync(process.execPath, [
      CLI,
      '--repo-root', ROOT,
      '--project-root', project,
      '--native-root', native,
      '--version', version,
    ], {
      cwd: ROOT,
      encoding: 'utf8',
      env: withCodexStub({
        DHPK_TEST_CODEX_PLUGIN_LIST_JSON: JSON.stringify({ installed: [{ pluginId: 'dhpk@dhpk', enabled: false }], available: [] }),
      }),
    });
    assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const report = JSON.parse(result.stdout);
    assert.strictEqual(report.verdict, 'PASS');
    assert.strictEqual(report.activation.status, 'DISABLED');
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
  }
});

test('indeterminate Codex activation warns without blocking', () => {
  const project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-discovery-unknown-')));
  const native = path.join(ROOT, 'plugins', 'dhpk');
  const version = JSON.parse(fs.readFileSync(path.join(native, '.codex-plugin', 'plugin.json'), 'utf8')).version;
  const skillName = 'flow-drive';
  const destination = path.join(project, '.codex', 'skills', skillName);
  try {
    fs.cpSync(path.join(native, 'skills', skillName), destination, { recursive: true, dereference: true });
    fs.writeFileSync(path.join(project, '.codex', '.dhpk-installed.json'), `${JSON.stringify({
      schema_version: 3,
      plugin_version: version,
      managed_entries: {
        skills: {
          [skillName]: { destination_fingerprint: fingerprintPath(destination) },
        },
      },
    })}\n`);
    const result = spawnSync(process.execPath, [
      CLI,
      '--repo-root', ROOT,
      '--project-root', project,
      '--native-root', native,
      '--version', version,
    ], { cwd: ROOT, encoding: 'utf8', env: withCodexStub({ DHPK_TEST_CODEX_PLUGIN_LIST_EXIT: '1' }) });
    assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const report = JSON.parse(result.stdout);
    assert.strictEqual(report.verdict, 'WARN');
    assert.strictEqual(report.ok, true);
    assert.strictEqual(report.reasonCode, 'CODEX_ACTIVATION_UNKNOWN');
    assert.deepStrictEqual(report.inactiveDuplicateInvokableNames, [skillName]);
    assert.match(report.nextAction, /codex plugin list/);
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
  }
});

test('--native-activation override selects the runtime judgment without a CLI probe', () => {
  const project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-discovery-override-')));
  const native = path.join(ROOT, 'plugins', 'dhpk');
  const version = JSON.parse(fs.readFileSync(path.join(native, '.codex-plugin', 'plugin.json'), 'utf8')).version;
  const skillName = 'flow-drive';
  const destination = path.join(project, '.codex', 'skills', skillName);
  try {
    fs.cpSync(path.join(native, 'skills', skillName), destination, { recursive: true, dereference: true });
    fs.writeFileSync(path.join(project, '.codex', '.dhpk-installed.json'), `${JSON.stringify({
      schema_version: 3,
      plugin_version: version,
      managed_entries: {
        skills: {
          [skillName]: { destination_fingerprint: fingerprintPath(destination) },
        },
      },
    })}\n`);
    const enabled = spawnSync(process.execPath, [
      CLI,
      '--repo-root', ROOT,
      '--project-root', project,
      '--native-root', native,
      '--version', version,
      '--native-activation', 'enabled',
    ], { cwd: ROOT, encoding: 'utf8', env: withoutCodexOnPath() });
    assert.strictEqual(enabled.status, 1, `${enabled.stdout}\n${enabled.stderr}`);
    const enabledReport = JSON.parse(enabled.stdout);
    assert.strictEqual(enabledReport.reasonCode, 'DUPLICATE_CODEX_PROVIDER');
    assert.strictEqual(enabledReport.activation.source, 'override');

    const inactive = spawnSync(process.execPath, [
      CLI,
      '--repo-root', ROOT,
      '--project-root', project,
      '--native-root', native,
      '--version', version,
      '--native-activation', 'inactive',
    ], { cwd: ROOT, encoding: 'utf8', env: withoutCodexOnPath() });
    assert.strictEqual(inactive.status, 0, `${inactive.stdout}\n${inactive.stderr}`);
    const inactiveReport = JSON.parse(inactive.stdout);
    assert.strictEqual(inactiveReport.verdict, 'PASS');
    assert.strictEqual(inactiveReport.activation.status, 'INACTIVE');
    assert.strictEqual(inactiveReport.activation.source, 'override');

    const bogus = spawnSync(process.execPath, [
      CLI,
      '--repo-root', ROOT,
      '--project-root', project,
      '--native-root', native,
      '--native-activation', 'bogus',
    ], { cwd: ROOT, encoding: 'utf8', env: withoutCodexOnPath() });
    assert.strictEqual(bogus.status, 2);
    assert.match(bogus.stderr, /native-activation/);
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
  }
});

test('check-codex-discovery blocks a dangling project-local skill with structured redacted evidence', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-discovery-dangling-'));
  const project = path.join(root, 'project');
  const native = path.join(root, 'native');
  const source = path.join(root, 'source', 'dangling-demo');
  const destination = path.join(project, '.codex', 'skills', 'dangling-demo');
  try {
    fs.mkdirSync(source, { recursive: true });
    fs.writeFileSync(path.join(source, 'SKILL.md'), '# dangling demo\n');
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.mkdirSync(native, { recursive: true });
    fs.symlinkSync(source, destination, 'dir');
    fs.rmSync(source, { recursive: true, force: true });
    assert.strictEqual(fs.lstatSync(destination).isSymbolicLink(), true);

    const result = spawnSync(process.execPath, [
      CLI,
      '--repo-root', root,
      '--project-root', project,
      '--native-root', native,
    ], { cwd: ROOT, encoding: 'utf8', env: withCodexStub() });
    assert.strictEqual(result.status, 1, `${result.stdout}\n${result.stderr}`);
    assert.strictEqual(result.stderr, '');
    assert.doesNotMatch(result.stderr, /usage:/i);
    const report = JSON.parse(result.stdout);
    assert.strictEqual(report.ok, false);
    assert.strictEqual(report.verdict, 'BLOCKED');
    assert.strictEqual(report.integrityVerdict, 'BLOCKED');
    assert.strictEqual(report.reasonCode, 'CODEX_PROVIDER_FINGERPRINT_ERROR');
    assert.strictEqual(report.effective.length, 0);
    assert.strictEqual(report.invalidProviders.length, 1);
    const invalid = report.invalidProviders[0];
    assert.strictEqual(invalid.name, 'dangling-demo');
    assert.strictEqual(invalid.surface, 'project-local');
    assert.strictEqual(invalid.fingerprint, '');
    assert.strictEqual(invalid.owned, false);
    assert.match(invalid.sourcePath, /project\/\.codex\/skills\/dangling-demo/);
    assert.match(invalid.fingerprintError, /ENOENT|no such file|dangling|missing/i);
    assert.doesNotMatch(result.stdout, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(report.nextAction, /--update/i);
    assert.match(report.nextAction, /(?:receipt[- ]owned|\b(?:if|when|only)\b)/i);
    assert.match(report.nextAction, /\bowned\b/i);
    assert.match(report.nextAction, /unowned/i);
    assert.match(report.nextAction, /manual/i);
    assert.match(report.nextAction, /inspect/i);
    assert.match(report.nextAction, /repair/i);
    assert.match(report.nextAction, /remov/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('check-codex-discovery blocks a dangling project-local agent with structured redacted evidence', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-discovery-dangling-agent-'));
  const project = path.join(root, 'project');
  const native = path.join(root, 'native');
  const source = path.join(root, 'source', 'dangling-agent');
  const destination = path.join(project, '.codex', 'agents', 'dangling-agent');
  try {
    fs.mkdirSync(source, { recursive: true });
    fs.writeFileSync(path.join(source, 'AGENT.md'), '# dangling agent\n');
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.mkdirSync(native, { recursive: true });
    fs.symlinkSync(source, destination, 'dir');
    fs.rmSync(source, { recursive: true, force: true });
    assert.strictEqual(fs.lstatSync(destination).isSymbolicLink(), true);

    const result = spawnSync(process.execPath, [
      CLI,
      '--repo-root', root,
      '--project-root', project,
      '--native-root', native,
    ], { cwd: ROOT, encoding: 'utf8', env: withCodexStub() });
    assert.strictEqual(result.status, 1, `${result.stdout}\n${result.stderr}`);
    assert.strictEqual(result.stderr, '');
    assert.doesNotMatch(result.stderr, /usage:/i);
    const report = JSON.parse(result.stdout);
    assert.strictEqual(report.ok, false);
    assert.strictEqual(report.verdict, 'BLOCKED');
    assert.strictEqual(report.integrityVerdict, 'BLOCKED');
    assert.strictEqual(report.reasonCode, 'CODEX_PROVIDER_FINGERPRINT_ERROR');
    assert.strictEqual(report.effective.length, 0);
    assert.strictEqual(report.invalidProviders.length, 1);
    const invalid = report.invalidProviders[0];
    assert.strictEqual(invalid.id, 'dangling-agent');
    assert.strictEqual(invalid.name, 'dangling-agent');
    assert.strictEqual(invalid.kind, 'agents');
    assert.strictEqual(invalid.surface, 'project-local');
    assert.strictEqual(invalid.fingerprint, '');
    assert.strictEqual(invalid.owned, false);
    assert.match(invalid.sourcePath, /project\/\.codex\/agents\/dangling-agent/);
    assert.match(invalid.fingerprintError, /ENOENT|no such file|dangling|missing/i);
    assert.doesNotMatch(result.stdout, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(report.nextAction, /--update/i);
    assert.match(report.nextAction, /(?:receipt[- ]owned|\b(?:if|when|only)\b)/i);
    assert.match(report.nextAction, /\bowned\b/i);
    assert.match(report.nextAction, /unowned/i);
    assert.match(report.nextAction, /manual/i);
    assert.match(report.nextAction, /inspect/i);
    assert.match(report.nextAction, /repair/i);
    assert.match(report.nextAction, /remov/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('check-codex-discovery exposes help and rejects unknown arguments', () => {
  const help = spawnSync(process.execPath, [CLI, '--help'], { cwd: ROOT, encoding: 'utf8' });
  assert.strictEqual(help.status, 0);
  assert.match(help.stdout, /check-codex-discovery\.js/);

  const invalid = spawnSync(process.execPath, [CLI, '--no-such-option'], { cwd: ROOT, encoding: 'utf8' });
  assert.strictEqual(invalid.status, 2);
  assert.match(invalid.stderr, /unknown argument/);
});

run('check-codex-discovery');
