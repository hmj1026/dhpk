'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const probe = require('../scripts/release/claude-profile-probe');

test('Claude profile probe keeps its closed status vocabulary and rejects unsafe aliases without leaking paths', () => {
  assert.deepStrictEqual(probe.STATUSES, [
    'PASS', 'FAIL', 'NOT_RUN', 'NOT_CONFIGURED', 'SKIP_INCOMPATIBLE', 'BLOCKED', 'UNAVAILABLE',
  ]);

  const result = probe.runClaudeProfileProbe({ profileId: '../unsafe', packageRoot: '/nonexistent/profile' });
  assert.strictEqual(result.status, 'BLOCKED');
  assert.doesNotMatch(JSON.stringify(result), /nonexistent|unsafe/);

  const missing = probe.runClaudeProfileProbe({ profileId: 'safe-profile', packageRoot: '/nonexistent/private-profile-root' });
  assert.strictEqual(missing.status, 'BLOCKED');
  assert.strictEqual(missing.packageRoot, '<profile-package>');
  assert.doesNotMatch(JSON.stringify(missing), /private-profile-root/);
});

test('profile tree digest rejects a symlinked entry', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-claude-profile-tree-'));
  const packageRoot = path.join(tempRoot, 'package');
  const outsideFile = path.join(tempRoot, 'outside.json');
  try {
    fs.mkdirSync(packageRoot);
    fs.writeFileSync(outsideFile, '{"private":true}\n');
    fs.symlinkSync(outsideFile, path.join(packageRoot, 'linked.json'));

    const result = probe.digestTree(packageRoot);
    assert.ok(result.error, 'a symlink inside the profile tree must be rejected');
    assert.match(result.error, /symlink/i);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('artifact digest rejects a receipt output that resolves outside the package root', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-claude-profile-artifact-'));
  const packageRoot = path.join(tempRoot, 'package');
  const outsideFile = path.join(tempRoot, 'outside.json');
  try {
    fs.mkdirSync(packageRoot);
    fs.writeFileSync(outsideFile, '{"valid":"outside artifact"}\n');
    assert.strictEqual(fs.existsSync(path.resolve(packageRoot, '../outside.json')), true);

    const result = probe.digestArtifact(packageRoot, {
      outputs: [{ stableId: 'outside-artifact', destination: '../outside.json' }],
    });
    assert.ok(result.error, 'an output ledger must not digest an existing file outside the package root');
    assert.match(result.error, /invalid|escapes/i);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

run('claude-profile-probe');
