'use strict';

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');

const MACOS_INSTALLER_FILES = Object.freeze([
  { file: 'tests/physical-tmpdir.test.js' },
  { file: 'tests/macos-installer-darwin.test.js', env: { TMPDIR: '/private/tmp' } },
  { file: 'tests/install-codex-skills.test.js' },
  { file: 'tests/cli-dispatch-launcher.test.js' },
  { file: 'tests/run-bounded-node-test.test.js' },
  { file: 'tests/install-cursor-harness.test.js' },
  // 原 fixture 在大小寫不敏感檔案系統會碰撞，macOS 必須實際執行其指紋測試。
  { file: 'tests/content-fingerprint.test.js' },
  { file: 'tests/content-fingerprint-characterization.test.js' },
  { file: 'tests/content-fingerprint-tree-merkle.test.js' },
  { file: 'tests/receipt-primitives.test.js' },
]);

function runMacosInstallerSubset({
  execPath = process.execPath,
  cwd = ROOT,
  env = process.env,
  spawn = spawnSync,
} = {}) {
  for (const entry of MACOS_INSTALLER_FILES) {
    const result = spawn(execPath, [entry.file], {
      cwd,
      env: { ...env, ...(entry.env || {}) },
      stdio: 'inherit',
    });
    if (result.status !== 0) return result.status ?? 1;
  }
  return 0;
}

if (require.main === module) {
  process.exitCode = runMacosInstallerSubset();
}

module.exports = { MACOS_INSTALLER_FILES, runMacosInstallerSubset };
