'use strict';

// Behavioral coverage for install-codex-skills.sh. The fixtures deliberately
// exercise ownership boundaries rather than only checking shell syntax.

const fs = require('node:fs');
const crypto = require('node:crypto');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { assert } = require('./tinytest');

const ROOT = path.join(__dirname, '..', '..');
const HOOK = path.join(ROOT, 'scripts', 'hooks', 'install-codex-skills.sh');
const CODEX_STUB_BIN = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-codex-stub-')));
const CODEX_STUB = path.join(CODEX_STUB_BIN, 'codex');
fs.writeFileSync(CODEX_STUB, `#!/bin/sh
if [ "$1" = "plugin" ] && [ "$2" = "list" ] && [ "$3" = "--json" ]; then
  if [ "\${DHPK_TEST_CODEX_PLUGIN_LIST_OVERSIZED:-0}" = "1" ]; then
    head -c 2097152 /dev/zero | tr '\\0' x
    sleep 3
    exit 0
  fi
  if [ -n "\${DHPK_TEST_CODEX_BACKGROUND_MARKER:-}" ]; then
    (sleep 4; printf survived > "\${DHPK_TEST_CODEX_BACKGROUND_MARKER}") &
    exit 0
  fi
  if [ -n "\${DHPK_TEST_CODEX_PLUGIN_LIST_SLEEP_SECONDS:-}" ]; then
    sleep "\${DHPK_TEST_CODEX_PLUGIN_LIST_SLEEP_SECONDS}"
  fi
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
// Copy-mode fixture setup hashes a complete generated Codex package. Keep this
// bounded, while allowing four-way CI contention to complete that real work.
const INSTALLER_CHILD_TIMEOUT_MS = 60_000;


function runInstaller(project, args, pluginRoot = ROOT, envOverrides = {}) {
  return spawnSync('bash', [HOOK, ...args], {
    cwd: project,
    env: {
      ...process.env,
      PATH: `${CODEX_STUB_BIN}:${process.env.PATH || ''}`,
      CLAUDE_PLUGIN_ROOT: pluginRoot,
      ...envOverrides,
    },
    encoding: 'utf8',
    timeout: INSTALLER_CHILD_TIMEOUT_MS,
  });
}

function projectRoot() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-ics-behavior-')));
  fs.mkdirSync(path.join(dir, '.git'));
  return dir;
}

function copyDistributionInventory(plugin) {
  fs.cpSync(path.join(ROOT, 'manifests'), path.join(plugin, 'manifests'), { recursive: true, dereference: true });
  fs.cpSync(path.join(ROOT, 'agent-traps'), path.join(plugin, 'agent-traps'), { recursive: true, dereference: true });
  fs.mkdirSync(path.join(plugin, 'docs'), { recursive: true });
  fs.copyFileSync(
    path.join(ROOT, 'docs', 'subagent-prompt-template.md'),
    path.join(plugin, 'docs', 'subagent-prompt-template.md'),
  );
  fs.copyFileSync(
    path.join(ROOT, 'docs', 'docker-setup.md'),
    path.join(plugin, 'docs', 'docker-setup.md'),
  );
}

function completeTreeFingerprint(target) {
  const hashNode = (current) => {
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) return hashNode(fs.realpathSync(current));
    const digest = crypto.createHash('sha256');
    if (stat.isDirectory()) {
      digest.update('dir\0');
      for (const name of fs.readdirSync(current).sort()) {
        digest.update(name);
        digest.update('\0');
        digest.update(hashNode(path.join(current, name)));
        digest.update('\0');
      }
      return digest.digest('hex');
    }
    digest.update('file\0');
    digest.update(fs.readFileSync(current));
    return digest.digest('hex');
  };
  return hashNode(target);
}

function descriptorPseudoPathBlocker() {
  const shim = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-fd-path-shim-')));
  fs.writeFileSync(path.join(shim, 'sitecustomize.py'), [
    'import atexit',
    'import os',
    'import re',
    '',
    '_dhpk_original_isdir = os.path.isdir',
    '',
    'def _dhpk_isdir(candidate):',
    '    try:',
    '        rendered = os.fspath(candidate)',
    '    except TypeError:',
    '        return _dhpk_original_isdir(candidate)',
    "    if isinstance(rendered, str) and re.fullmatch(r'/(?:proc/self/fd|dev/fd)/[0-9]+', rendered):",
    '        return False',
    '    return _dhpk_original_isdir(candidate)',
    '',
    'os.path.isdir = _dhpk_isdir',
    '',
    "_dhpk_cwd_audit = os.environ.get('DHPK_TEST_CWD_AUDIT_FILE')",
    'if _dhpk_cwd_audit:',
    "    atexit.register(lambda: open(_dhpk_cwd_audit, 'w', encoding='utf-8').write(os.getcwd()))",
    '',
  ].join('\n'));
  return shim;
}

function materializationFailureShim() {
  const shim = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-copy-failure-shim-')));
  fs.writeFileSync(path.join(shim, 'sitecustomize.py'), [
    'import atexit',
    'import os',
    'import shutil',
    '',
    "_dhpk_cwd_audit = os.environ['DHPK_TEST_CWD_AUDIT_FILE']",
    "atexit.register(lambda: open(_dhpk_cwd_audit, 'w', encoding='utf-8').write(os.getcwd()))",
    '',
    'def _dhpk_fail_materialization(*args, **kwargs):',
    "    raise OSError('controlled materialization failure')",
    '',
    'shutil.copy2 = _dhpk_fail_materialization',
    'shutil.copytree = _dhpk_fail_materialization',
    '',
  ].join('\n'));
  return shim;
}

function parentReplacementGate() {
  const shim = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-parent-gate-shim-')));
  fs.writeFileSync(path.join(shim, 'sitecustomize.py'), [
    'import os',
    'import time',
    '',
    '_dhpk_original_open = os.open',
    '_dhpk_gate_used = False',
    '',
    'def _dhpk_open(candidate, flags, *args, **kwargs):',
    '    global _dhpk_gate_used',
    '    descriptor = _dhpk_original_open(candidate, flags, *args, **kwargs)',
    "    ready = os.environ.get('DHPK_TEST_PARENT_OPEN_READY_FILE')",
    "    release = os.environ.get('DHPK_TEST_PARENT_OPEN_RELEASE_FILE')",
    "    if (not _dhpk_gate_used and ready and release and isinstance(candidate, str)",
    "            and candidate.startswith('.dhpk-adopt-') and kwargs.get('dir_fd') is not None):",
    '        _dhpk_gate_used = True',
    "        with open(ready, 'w', encoding='utf-8') as marker:",
    "            marker.write('ready')",
    '        deadline = time.monotonic() + 10',
    '        while not os.path.exists(release):',
    '            if time.monotonic() >= deadline:',
    "                raise TimeoutError('parent replacement gate timed out')",
    '            time.sleep(0.01)',
    '    return descriptor',
    '',
    'os.open = _dhpk_open',
    '',
  ].join('\n'));
  return shim;
}

function waitForFile(file, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  const signal = new Int32Array(new SharedArrayBuffer(4));
  while (Date.now() < deadline) {
    if (fs.existsSync(file)) return true;
    Atomics.wait(signal, 0, 0, 20);
  }
  return fs.existsSync(file);
}

function rewriteAgentAsHistoricalManagedSymlink(scratch, agentName, targetOverride = null) {
  const codex = path.join(scratch, '.codex');
  const receiptPath = path.join(codex, '.dhpk-installed.json');
  const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
  const relative = `agents/${agentName}`;
  const source = path.join(ROOT, 'codex', 'agents', agentName);
  const destination = path.join(codex, relative);
  const linkTarget = targetOverride || source;

  fs.rmSync(destination, { force: true });
  fs.symlinkSync(linkTarget, destination);
  receipt.managed_entries.agents[agentName] = {
    ...receipt.managed_entries.agents[agentName],
    mode: 'symlink',
    ownership_marker: `symlink:${relative}`,
    destination_target: source,
  };
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  return { receiptPath, source, destination, relative };
}

function materializeFixtureSkill(fakePlugin, name) {
  const skillSource = path.join(fakePlugin, 'codex', 'skills', name);
  if (!fs.lstatSync(skillSource).isSymbolicLink()) {
    return;
  }
  const resolvedSource = fs.realpathSync(skillSource);
  fs.rmSync(skillSource, { recursive: true, force: true });
  fs.cpSync(resolvedSource, skillSource, { recursive: true, dereference: true });
}

function collisionFixture() {
  const scratch = projectRoot();
  const fakePlugin = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-ics-plan-plugin-')));
  fs.cpSync(path.join(ROOT, 'codex'), path.join(fakePlugin, 'codex'), { recursive: true, dereference: true });
  materializeFixtureSkill(fakePlugin, 'harness-govern');
  fs.mkdirSync(path.join(fakePlugin, '.claude-plugin'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), path.join(fakePlugin, '.claude-plugin', 'plugin.json'));
  copyDistributionInventory(fakePlugin);
  const first = runInstaller(scratch, ['--copy', '--force'], fakePlugin);
  assert.strictEqual(first.status, 0, `${first.stdout}\n${first.stderr}`);
  const collision = 'harness-govern';
  const receiptPath = path.join(scratch, '.codex', '.dhpk-installed.json');
  const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
  assert.ok(receipt.managed_entries.skills[collision], `expected fixture receipt entry for ${collision}`);
  delete receipt.managed_entries.skills[collision];
  receipt.reconciliation = {
    ...(receipt.reconciliation || {}),
    state: 'partial',
    status: 'partial',
    complete: false,
    skipped_collision: 1,
  };
  receipt.state = 'partial';
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  const target = path.join(scratch, '.codex', 'skills', collision);
  fs.writeFileSync(path.join(target, 'user-owned.txt'), 'keep me\n');
  return { scratch, fakePlugin, collision, receiptPath, target };
}

function transactionMetadataSnapshot(codexRoot) {
  return fs.readdirSync(codexRoot)
    .filter((name) => name.startsWith('.dhpk-transaction-'))
    .sort()
    .map((name) => [name, fs.readFileSync(path.join(codexRoot, name), 'utf8')]);
}

function provenanceDriftPlanFixture(drift) {
  const scratch = projectRoot();
  const first = runInstaller(scratch, ['--force']);
  assert.strictEqual(first.status, 0, `${first.stdout}\n${first.stderr}`);
  const codexRoot = path.join(scratch, '.codex');
  const receiptPath = path.join(codexRoot, '.dhpk-installed.json');
  const currentReceipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
  assert.strictEqual(currentReceipt.mode, 'symlink', 'fixture must reproduce the default projection mode');
  assert.strictEqual(currentReceipt.reconciliation.state, 'current',
    'fixture requires a historical current reconciliation state');
  const currentProvenance = {
    pluginVersion: currentReceipt.plugin_version,
    sourceFingerprint: currentReceipt.source_fingerprint,
  };
  const receipt = {
    ...currentReceipt,
    plugin_version: drift === 'version' || drift === 'both'
      ? '0.0.0-provenance-drift'
      : currentReceipt.plugin_version,
    source_fingerprint: drift === 'fingerprint' || drift === 'both'
      ? '0'.repeat(64)
      : currentReceipt.source_fingerprint,
  };
  const recordedProvenance = {
    pluginVersion: receipt.plugin_version,
    sourceFingerprint: receipt.source_fingerprint,
  };
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  const before = {
    receipt: fs.readFileSync(receiptPath, 'utf8'),
    projection: completeTreeFingerprint(codexRoot),
    transactionMetadata: transactionMetadataSnapshot(codexRoot),
  };
  const planned = runInstaller(scratch, [
    '--migrate', '--update', '--plan', '--json', '--force',
  ]);
  return {
    scratch,
    codexRoot,
    receiptPath,
    before,
    currentProvenance,
    recordedProvenance,
    planned,
  };
}

module.exports = {
  ROOT,
  HOOK,
  INSTALLER_CHILD_TIMEOUT_MS,
  runInstaller,
  projectRoot,
  copyDistributionInventory,
  completeTreeFingerprint,
  descriptorPseudoPathBlocker,
  materializationFailureShim,
  parentReplacementGate,
  waitForFile,
  rewriteAgentAsHistoricalManagedSymlink,
  materializeFixtureSkill,
  collisionFixture,
  transactionMetadataSnapshot,
  provenanceDriftPlanFixture,
};
