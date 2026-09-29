'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');

test('candidate generator validates the authoritative source without activating it', () => {
  const manifestPath = path.join(ROOT, '.claude-plugin/plugin.json');
  const activeBefore = fs.readFileSync(manifestPath);
  const result = spawnSync(process.execPath, [path.join(ROOT, 'scripts/ci/gen-claude-user-config.js'), '--check'], { encoding: 'utf8' });
  assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const fingerprint = result.stdout.match(/candidate fingerprint ([a-f0-9]{64})/i);
  assert.ok(fingerprint, `candidate fingerprint must be reported: ${result.stdout}`);
  assert.deepStrictEqual(fs.readFileSync(manifestPath), activeBefore, '--check must leave the active manifest byte-identical');

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-user-config-malformed-source-'));
  try {
    for (const relative of [
      'scripts/lib',
      'scripts/ci/gen-claude-user-config.js',
      'scripts/release/claude-user-config-probe.js',
      'manifests/claude-user-config-metadata.json',
      '.claude-plugin/plugin.json',
      'docs/configuration.md',
    ]) {
      const source = path.join(ROOT, relative);
      const destination = path.join(temp, relative);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.cpSync(source, destination, { recursive: true });
    }
    const metadataPath = path.join(temp, 'manifests/claude-user-config-metadata.json');
    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    metadata.schema = 'dhpk.invalid-user-config-metadata.v1';
    fs.writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);

    const malformed = spawnSync(process.execPath, [path.join(temp, 'scripts/ci/gen-claude-user-config.js'), '--check'], { encoding: 'utf8' });
    assert.strictEqual(malformed.status, 1, `${malformed.stdout}\n${malformed.stderr}`);
    assert.match(`${malformed.stdout}\n${malformed.stderr}`, /metadata source schema must be dhpk\.plugin-user-config-metadata\.v1/);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

run('gen-claude-user-config');
