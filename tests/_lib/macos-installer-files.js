'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
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

const APPLE_PYTHON = '/usr/bin/python3';

function hasCommandLineTools() {
  return spawnSync('xcode-select', ['-p'], { encoding: 'utf8', timeout: 10000 }).status === 0;
}

// Consumers with Command Line Tools run Apple's /usr/bin/python3, but a CI
// runner's PATH resolves another python3 first, so installer tests never met
// the interpreter that broke #1278. This puts a python3 shim to the system
// interpreter first on PATH. An unusable interpreter fails loudly: a skipped
// rerun would look like coverage it is not.
function prepareApplePythonPath({
  env = process.env,
  pythonPath = APPLE_PYTHON,
  probeTools = hasCommandLineTools,
  tmpdir = os.tmpdir(),
} = {}) {
  if (!fs.existsSync(pythonPath)) {
    throw new Error(`apple-python: ${pythonPath} is missing on this host`);
  }
  if (!probeTools()) {
    throw new Error(`apple-python: Command Line Tools are not installed; ${pythonPath} would open an install dialog`);
  }
  const shimDir = fs.mkdtempSync(path.join(tmpdir, 'dhpk-apple-python-'));
  try {
    fs.symlinkSync(pythonPath, path.join(shimDir, 'python3'));
  } catch (error) {
    fs.rmSync(shimDir, { recursive: true, force: true });
    throw error;
  }
  return {
    env: { ...env, PATH: [shimDir, env.PATH || ''].filter(Boolean).join(path.delimiter) },
    shimDir,
    cleanup: () => fs.rmSync(shimDir, { recursive: true, force: true }),
  };
}

function verifyApplePython(env, spawn) {
  const which = spawn('/bin/sh', ['-c', 'command -v python3'], { env, encoding: 'utf8' });
  const resolved = (which.stdout || '').trim();
  let real = resolved;
  try {
    real = resolved ? fs.realpathSync(resolved) : '';
  } catch (_error) {
    real = '';
  }
  if (which.status !== 0 || real !== fs.realpathSync(APPLE_PYTHON)) {
    throw new Error(`apple-python: python3 resolves to '${resolved || 'nothing'}', not ${APPLE_PYTHON}`);
  }
  const version = spawn('python3', ['--version'], { env, encoding: 'utf8' });
  const text = `${version.stdout || ''}${version.stderr || ''}`.trim();
  if (version.status !== 0 || !text) {
    throw new Error(`apple-python: '${APPLE_PYTHON} --version' failed (status ${version.status})`);
  }
  return text;
}

function runUnderApplePython({
  prepare = prepareApplePythonPath,
  verify = (env) => verifyApplePython(env, spawnSync),
  runSubset = runMacosInstallerSubset,
  log = console.log,
  logError = console.error,
} = {}) {
  let prepared;
  try {
    prepared = prepare();
  } catch (error) {
    logError(error.message);
    return 1;
  }
  try {
    log(`apple-python: python3 -> ${APPLE_PYTHON} (${verify(prepared.env)})`);
    return runSubset({ env: prepared.env });
  } catch (error) {
    logError(error.message);
    return 1;
  } finally {
    prepared.cleanup();
  }
}

function main(argv = process.argv.slice(2), deps = {}) {
  const unknown = argv.filter((arg) => arg !== '--apple-python');
  if (unknown.length) {
    (deps.logError || console.error)(`macos-installer-files: unknown argument(s): ${unknown.join(' ')}`);
    return 2;
  }
  return argv.includes('--apple-python')
    ? runUnderApplePython(deps)
    : (deps.runSubset || runMacosInstallerSubset)();
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = {
  MACOS_INSTALLER_FILES,
  runMacosInstallerSubset,
  prepareApplePythonPath,
  runUnderApplePython,
  main,
  APPLE_PYTHON,
};
