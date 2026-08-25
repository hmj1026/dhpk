'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const { networkSandboxProbe, runCursorConsumerProbe } = require('../scripts/lib/cursor-plugin-package');

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function write(file, content, mode) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, mode ? { mode } : undefined);
}

function writeCursorAuthHome(root) {
  const home = path.join(root, 'host-home');
  write(path.join(home, '.config', 'cursor', 'auth.json'), '{"token":"fixture"}\n', 0o600);
  return home;
}

function writeCursorPackage(root) {
  for (const component of ['skills', 'commands', 'agents', 'rules']) {
    fs.mkdirSync(path.join(root, component), { recursive: true });
  }
}

function writeCursorAgent(bin) {
  write(path.join(bin, 'cursor-agent'), [
    '#!/usr/bin/env node',
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    "const cp = require('node:child_process');",
    'const args = process.argv.slice(2);',
    "const roots = args.filter((arg, index) => args[index - 1] === '--plugin-dir');",
    'for (const root of roots) {',
    '  const hooks = JSON.parse(fs.readFileSync(path.join(root, \'hooks\', \'hooks.json\'), \'utf8\'));',
    '  for (const hook of hooks.hooks.sessionStart || []) cp.execFileSync(path.resolve(root, hook.command), [], { cwd: root });',
    '}',
    "const root = roots[0];",
    "const attestation = JSON.parse(fs.readFileSync(path.join(root, 'hooks', '.dhpk-probe-attestation.json'), 'utf8'));",
    "process.stdout.write(JSON.stringify({ response: 'dhpk skills commands agents rules were discovered.', dhpkProbe: { challenge: attestation.challenge, packageFingerprint: attestation.packageFingerprint, loaded: true, components: attestation.components } }));",
    '',
  ].join('\n'), 0o755);
}

test('Cursor authenticated shared-network runtime probes use bwrap --share-net with a disposable session HOME', () => {
  if (process.platform !== 'linux' || !networkSandboxProbe(process.env.PATH, 'shared', true)) return;
  const root = tempDir('dhpk-issue-237-cursor-shared-network-');
  const packageRoot = path.join(root, 'cursor-package');
  const bin = path.join(root, 'bin');
  const hostHome = writeCursorAuthHome(root);
  try {
    fs.mkdirSync(bin, { recursive: true });
    writeCursorPackage(packageRoot);
    writeCursorAgent(bin);
    const probe = runCursorConsumerProbe({
      packageRoot,
      pathValue: process.env.PATH,
      executable: path.join(bin, 'cursor-agent'),
      args: ['--plugin-dir', packageRoot, '--output-format', 'json'],
      timeoutMs: 500,
      requireOutput: true,
      requireJson: true,
      requireDiscovery: true,
      requirePackageChallenge: true,
      networkMode: 'shared',
      hostHome,
    });
    assert.strictEqual(probe.status, 'PASS', JSON.stringify(probe));
    assert.strictEqual(probe.network, 'shared', JSON.stringify(probe));
    assert.strictEqual(probe.challenge_verified, true, JSON.stringify(probe));
    assert.ok(probe.session_files.includes('.config/cursor/auth.json'), JSON.stringify(probe));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(hostHome, { recursive: true, force: true });
  }
});

run('issue-237-cursor-runtime-contract');
