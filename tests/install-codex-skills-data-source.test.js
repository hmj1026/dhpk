'use strict';

// ADR 0038 / issue #1446: the installer's data source is chosen only by the
// explicit DHPK_INSTALLER_ROOT (else the installer's own package). The
// CLAUDE_PLUGIN_ROOT environment value never selects a root, and an invalid
// explicit source stops the installation with no fallback search.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const { fakePlugin } = require('./_lib/shared-projection-plugin');
const { ROOT, HOOK, CODEX_STUB_BIN, projectRoot } = require('./_lib/install-codex-skills-fixtures');

function install(project, env) {
  const base = { ...process.env, PATH: `${CODEX_STUB_BIN}:${process.env.PATH || ''}` };
  delete base.CLAUDE_PLUGIN_ROOT;
  delete base.DHPK_INSTALLER_ROOT;
  delete base.DHPK_PLUGIN_ROOT;
  return spawnSync('bash', [HOOK, '--copy', '--force'], {
    cwd: project, env: { ...base, ...env }, encoding: 'utf8', timeout: 90_000,
  });
}

function cleanup(...dirs) {
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
}

function assertNothingWritten(project) {
  for (const name of ['.codex', '.agents']) {
    assert.ok(!fs.existsSync(path.join(project, name)), `${name} must not be written`);
  }
}

test('a foreign CLAUDE_PLUGIN_ROOT is ignored; the installer package is the data source', () => {
  const foreign = fakePlugin();
  const project = projectRoot();
  try {
    const result = install(project, { CLAUDE_PLUGIN_ROOT: foreign });
    assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.ok(fs.existsSync(path.join(project, '.agents', 'skills', 'flow-drive')), 'own package payload installed');
    assert.ok(!fs.existsSync(path.join(project, '.agents', 'skills', 'dhpk-codex-only')), 'foreign payload must not be installed');
  } finally {
    cleanup(foreign, project);
  }
});

test('a valid explicit DHPK_INSTALLER_ROOT selects both payload and validation source', () => {
  const explicit = fakePlugin();
  const project = projectRoot();
  try {
    const result = install(project, { DHPK_INSTALLER_ROOT: explicit, CLAUDE_PLUGIN_ROOT: ROOT });
    assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.ok(fs.existsSync(path.join(project, '.agents', 'skills', 'dhpk-codex-only')), 'explicit payload installed');
    assert.ok(!fs.existsSync(path.join(project, '.agents', 'skills', 'flow-drive')), 'own package payload must not leak in');
  } finally {
    cleanup(explicit, project);
  }
});

test('a nonexistent explicit DHPK_INSTALLER_ROOT fails without fallback or writes', () => {
  const project = projectRoot();
  try {
    const missing = path.join(os.tmpdir(), 'dhpk-no-such-installer-root-1446');
    const result = install(project, { DHPK_INSTALLER_ROOT: missing, CLAUDE_PLUGIN_ROOT: ROOT });
    assert.notStrictEqual(result.status, 0, 'must fail');
    assertNothingWritten(project);
  } finally {
    cleanup(project);
  }
});

test('an incomplete explicit DHPK_INSTALLER_ROOT fails without fallback or writes', () => {
  const empty = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-empty-installer-root-')));
  const project = projectRoot();
  try {
    const result = install(project, { DHPK_INSTALLER_ROOT: empty, CLAUDE_PLUGIN_ROOT: ROOT });
    assert.notStrictEqual(result.status, 0, 'must fail');
    assertNothingWritten(project);
  } finally {
    cleanup(empty, project);
  }
});

test('an empty DHPK_INSTALLER_ROOT string is not an explicit source and does not select a root', () => {
  const foreign = fakePlugin();
  const project = projectRoot();
  try {
    const result = install(project, { DHPK_INSTALLER_ROOT: '', CLAUDE_PLUGIN_ROOT: foreign });
    assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.ok(!fs.existsSync(path.join(project, '.codex', 'skills', 'dhpk-codex-only')));
  } finally {
    cleanup(foreign, project);
  }
});

test('a relative DHPK_INSTALLER_ROOT is resolved against cwd, never through CDPATH', () => {
  const plugin = fakePlugin();
  const cdpathDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-cdpath-'));
  const project = projectRoot();
  try {
    fs.symlinkSync(plugin, path.join(cdpathDir, 'sub'));
    const result = install(project, { DHPK_INSTALLER_ROOT: 'sub', CDPATH: cdpathDir });
    assert.notStrictEqual(result.status, 0, 'a name found only via CDPATH must be rejected');
    assert.match(result.stderr, /DHPK_INSTALLER_ROOT is not an existing directory/);
    assertNothingWritten(project);
  } finally {
    cleanup(plugin, cdpathDir, project);
  }
});

run('install-codex-skills-data-source');
