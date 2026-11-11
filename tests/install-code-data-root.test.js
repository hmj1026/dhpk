'use strict';

// js-projection-journal stage 5 (task 5.1): the installer's code and the
// artifact it installs from are different roots. The artifact (the plugin tree
// or a --source-artifact) is data: manifests, codex/, cursor/, skills/. The
// installer's own modules come from the installer itself -- the checkout, or
// the generated bundle in a packaged Skill -- and never from the artifact, so
// a user-supplied artifact cannot make the installer execute its JavaScript.

const { test, run, assert } = require('./_lib/tinytest');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { fakePlugin, write, REPO } = require('./_lib/shared-projection-plugin');
const { CODEX_STUB_BIN } = require('./_lib/install-codex-skills-fixtures');

const HOOKS = {
  codex: path.join(REPO, 'scripts', 'hooks', 'install-codex-skills.sh'),
  cursor: path.join(REPO, 'scripts', 'hooks', 'install-cursor-harness.sh'),
};

const SCRIPTS_TREE = path.join(REPO, 'scripts');
const SHELL_CANARY = '#!/bin/sh\nprintf "executed $0\\n" >> "$DHPK_CANARY_MARKER"\nexit 0\n';
const JS_CANARY = [
  '\'use strict\';',
  'require(\'node:fs\').appendFileSync(process.env.DHPK_CANARY_MARKER, `executed ${__filename}\\n`);',
  'module.exports = {};',
  '',
].join('\n');

// Every script of the real scripts/ tree, by its own relative path.
function scriptPaths(directory = SCRIPTS_TREE, prefix = 'scripts') {
  const found = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const relative = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) found.push(...scriptPaths(path.join(directory, entry.name), relative));
    else if (/\.(?:js|cjs|sh)$/.test(entry.name)) found.push(relative);
  }
  return found;
}

// Plants a canary where the installer's code, or a bundle, could be looked up under the artifact.
function plantCanaries(artifact) {
  const planted = [...scriptPaths(), 'dhpk-installer.cjs', 'scripts/hooks/dhpk-installer.cjs', 'scripts/lib/dhpk-installer.cjs'];
  for (const relative of planted) write(path.join(artifact, relative), relative.endsWith('.sh') ? SHELL_CANARY : JS_CANARY);
  return planted.length;
}

function tempDir(prefix) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

for (const host of ['codex', 'cursor']) {
  test(`testInstaller_${host}_neverExecutesJavaScriptFromTheArtifact`, () => {
    const artifact = fakePlugin();
    const project = tempDir('dhpk-code-data-project-');
    const scratch = tempDir('dhpk-code-data-scratch-');
    const marker = path.join(scratch, 'canary-marker');
    try {
      fs.mkdirSync(path.join(project, '.git'));
      assert.ok(plantCanaries(artifact) > 100, 'canaries must cover the whole scripts tree');
      // The packaged Skill pins both roots to the artifact (install-codex-project.sh).
      const result = spawnSync('bash', [HOOKS[host], '--copy', '--force'], {
        cwd: project,
        env: {
          ...process.env,
          PATH: `${CODEX_STUB_BIN}:${process.env.PATH || ''}`,
          CLAUDE_PLUGIN_ROOT: artifact,
          DHPK_INSTALLER_ROOT: artifact,
          DHPK_CANARY_MARKER: marker,
        },
        encoding: 'utf8',
        timeout: 90_000,
      });
      const executed = fs.existsSync(marker) ? fs.readFileSync(marker, 'utf8') : '';
      assert.strictEqual(executed, '', `the installer executed artifact code:\n${executed}`);
      assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
      assert.ok(fs.existsSync(path.join(project, host === 'codex' ? '.codex' : '.cursor', '.dhpk-installed.json')));
      assert.ok(fs.existsSync(path.join(project, '.agents', '.dhpk-installed.json')), 'the Shared Project Projection must be published by the installer\'s own code');
    } finally {
      for (const directory of [artifact, project, scratch]) fs.rmSync(directory, { recursive: true, force: true });
    }
  });
}

test('testPackagedHarnessSetup_neverExecutesJavaScriptFromTheArtifact', () => {
  const { materialize } = require('../scripts/ci/gen-claude-marketplace-package');
  const sandbox = tempDir('dhpk-code-data-packaged-');
  const artifact = fakePlugin();
  const project = path.join(sandbox, 'consumer project');
  const marker = path.join(sandbox, 'canary-marker');
  try {
    fs.mkdirSync(path.join(project, '.git'), { recursive: true });
    materialize({ root: REPO, out: path.join(sandbox, 'package') });
    plantCanaries(artifact);
    const adapter = path.join(sandbox, 'package', 'skills', 'harness-setup', 'scripts', 'install-codex-project.sh');
    const result = spawnSync('bash', [adapter, '--source-artifact', artifact, '--copy'], {
      cwd: project,
      env: { ...process.env, PATH: `${CODEX_STUB_BIN}:${process.env.PATH || ''}`, DHPK_CANARY_MARKER: marker },
      encoding: 'utf8',
      timeout: 90_000,
    });
    const executed = fs.existsSync(marker) ? fs.readFileSync(marker, 'utf8') : '';
    assert.strictEqual(executed, '', `the packaged installer executed artifact code:\n${executed}`);
    assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.ok(fs.existsSync(path.join(project, '.codex', '.dhpk-installed.json')));
    assert.ok(fs.existsSync(path.join(project, '.agents', '.dhpk-installed.json')), 'the Shared Project Projection must be published by the bundled installer');
  } finally {
    for (const directory of [sandbox, artifact]) fs.rmSync(directory, { recursive: true, force: true });
  }
});

run('install-code-data-root');
