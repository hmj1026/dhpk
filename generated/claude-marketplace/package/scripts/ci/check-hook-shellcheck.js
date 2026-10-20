#!/usr/bin/env node
'use strict';

// Bounded ShellCheck for hook scripts. Required CI fails closed when the
// pinned binary is missing, mismatched, or reports warning-or-higher.
// Optional local mode SKIPs instead of claiming PASS.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..', '..');
const SHELLCHECK_VERSION = '0.11.0';
const SHELLCHECK_LINUX_ASSET = 'shellcheck-v0.11.0.linux.x86_64.tar.xz';
const SHELLCHECK_LINUX_SHA256 = '8c3be12b05d5c177a04c29e3c78ce89ac86f1595681cab149b65b97c4e227198';
const SHELLCHECK_RELEASE = `https://github.com/koalaman/shellcheck/releases/download/v${SHELLCHECK_VERSION}/${SHELLCHECK_LINUX_ASSET}`;

function hookScripts(root) {
  const directories = [
    path.join(root, 'scripts', 'hooks'),
    path.join(root, 'scripts', 'hooks', '_lib'),
  ];
  const files = [];
  for (const directory of directories) {
    if (!fs.existsSync(directory)) continue;
    for (const name of fs.readdirSync(directory).sort()) {
      if (!name.endsWith('.sh')) continue;
      const candidate = path.join(directory, name);
      if (fs.statSync(candidate).isFile()) files.push(candidate);
    }
  }
  return files;
}

function parseArgs(argv) {
  const args = { mode: 'optional', expectVersion: SHELLCHECK_VERSION, root: ROOT };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--mode') args.mode = argv[++index];
    else if (arg === '--expect-version') args.expectVersion = argv[++index];
    else if (arg === '--root') args.root = path.resolve(argv[++index]);
    else throw new Error(`unknown argument '${arg}'`);
  }
  if (args.mode !== 'required' && args.mode !== 'optional') {
    throw new Error("mode must be 'required' or 'optional'");
  }
  if (!args.expectVersion) throw new Error('--expect-version requires a value');
  return args;
}

function findShellcheck(env) {
  const pathEnv = env && env.PATH;
  if (!pathEnv) return null;
  for (const directory of pathEnv.split(path.delimiter)) {
    if (!directory) continue;
    const candidate = path.join(directory, process.platform === 'win32' ? 'shellcheck.exe' : 'shellcheck');
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      }
    } catch (_) { /* try the next PATH entry */ }
  }
  return null;
}

function readVersion(bin) {
  const result = spawnSync(bin, ['--version'], { encoding: 'utf8' });
  if (result.status !== 0) return null;
  const match = `${result.stdout || ''}\n${result.stderr || ''}`.match(/version:\s*(\S+)/i);
  return match ? match[1] : null;
}

function installHint(version) {
  return [
    `Install ShellCheck ${version} and put it on PATH.`,
    `CI downloads ${SHELLCHECK_RELEASE} (sha256:${SHELLCHECK_LINUX_SHA256}).`,
    `Then: node scripts/ci/check-hook-shellcheck.js --mode optional --expect-version ${version}`,
  ].join(' ');
}

function main({
  root = ROOT,
  mode = 'optional',
  expectVersion = SHELLCHECK_VERSION,
  env = process.env,
} = {}) {
  const files = hookScripts(root);
  if (files.length === 0) {
    return {
      status: 'FAIL',
      errors: ['no hook scripts found under scripts/hooks/*.sh or scripts/hooks/_lib/*.sh'],
      files,
      version: null,
    };
  }

  const bin = findShellcheck(env);
  if (!bin) {
    const message = `shellcheck ${expectVersion} is not on PATH. ${installHint(expectVersion)}`;
    if (mode === 'required') return { status: 'FAIL', errors: [message], files, version: null };
    return { status: 'SKIP', errors: [], files, version: null, skipReason: message };
  }

  const version = readVersion(bin);
  if (version !== expectVersion) {
    const message = `shellcheck version is '${version || 'unknown'}'; expected ${expectVersion}. ${installHint(expectVersion)}`;
    if (mode === 'required') return { status: 'FAIL', errors: [message], files, version };
    return { status: 'SKIP', errors: [], files, version, skipReason: message };
  }

  const result = spawnSync(bin, ['--severity=warning', ...files], { encoding: 'utf8', cwd: root });
  const output = `${result.stdout || ''}${result.stderr || ''}`.trim();
  if (result.status !== 0) {
    return {
      status: 'FAIL',
      errors: [output || `shellcheck exited ${result.status}`],
      files,
      version,
    };
  }
  return { status: 'PASS', errors: [], files, version };
}

if (require.main === module) {
  try {
    const result = main(parseArgs(process.argv.slice(2)));
    if (result.status === 'SKIP') console.log(`SKIP: ${result.skipReason}`);
    else if (result.status === 'PASS') {
      console.log(`PASS: shellcheck ${result.version} checked ${result.files.length} hook script(s)`);
    } else {
      for (const error of result.errors) console.error(`hook-shellcheck: ${error}`);
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(`hook-shellcheck: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  main,
  hookScripts,
  SHELLCHECK_VERSION,
  SHELLCHECK_LINUX_ASSET,
  SHELLCHECK_LINUX_SHA256,
  SHELLCHECK_RELEASE,
};
