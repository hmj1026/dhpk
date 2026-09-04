'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const { fingerprintPath } = require('../scripts/release/consumer-gate');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'scripts', 'ci', 'check-codex-discovery.js');

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
    });
    assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const report = JSON.parse(result.stdout);
    assert.strictEqual(report.verdict, 'PASS');
    assert.strictEqual(report.effective.length, 1);
    assert.strictEqual(report.effective[0].name, 'demo');
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
    ], { cwd: ROOT, encoding: 'utf8' });
    assert.strictEqual(result.status, 1, `${result.stdout}\n${result.stderr}`);
    const report = JSON.parse(result.stdout);
    assert.strictEqual(report.verdict, 'BLOCKED');
    assert.strictEqual(report.integrityVerdict, 'PASS');
    assert.strictEqual(report.reasonCode, 'DUPLICATE_CODEX_PROVIDER');
    assert.deepStrictEqual(report.duplicateInvokableNames, [skillName]);
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
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
