'use strict';

// Behavioral coverage for install-codex-skills.sh. The fixtures deliberately
// exercise ownership boundaries rather than only checking shell syntax.

const fs = require('node:fs');
const crypto = require('node:crypto');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
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

test('bash -n syntax check passes', () => {
  const res = spawnSync('bash', ['-n', HOOK], { encoding: 'utf8' });
  assert.strictEqual(res.status, 0, `syntax error: ${res.stderr}`);
});

test('--help invocation is a safe no-op (no .codex/ created, exit 0)', () => {
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-ics-')));
  try {
    const env = { ...process.env };
    const res = spawnSync('bash', [HOOK, '--help'], {
      cwd: scratch,
      env,
      encoding: 'utf8',
      timeout: 10000,
    });
    assert.strictEqual(res.status, 0, `expected exit 0: ${res.stderr}`);
    assert.match(res.stdout, /--migrate/);
    assert.match(res.stdout, /--uninstall/);
    assert.ok(!fs.existsSync(path.join(scratch, '.codex')),
      'expected --help to provably no-op: no .codex/ directory created');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

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

test('installer child timeout stays bounded for parallel CI package setup', () => {
  assert.strictEqual(INSTALLER_CHILD_TIMEOUT_MS, 60_000);
});

test('enabled dhpk native plugin blocks project sync before writes even with --force', () => {
  const scratch = projectRoot();
  try {
    const result = runInstaller(scratch, ['--copy', '--force', '--json'], ROOT, {
      DHPK_TEST_CODEX_PLUGIN_LIST_JSON: JSON.stringify({
        installed: [{ pluginId: 'dhpk@dhpk', enabled: true, version: '0.53.0' }],
        available: [],
      }),
    });
    assert.strictEqual(result.status, 2, `${result.stdout}\n${result.stderr}`);
    const report = JSON.parse(result.stdout);
    assert.strictEqual(report.state, 'blocked');
    assert.strictEqual(report.reasonCode, 'CODEX_NATIVE_PLUGIN_ENABLED');
    assert.deepStrictEqual(report.providerCheck, {
      status: 'ENABLED',
      pluginId: 'dhpk@dhpk',
      enabled: true,
      version: '0.53.0',
    });
    assert.ok(!fs.existsSync(path.join(scratch, '.codex')),
      'provider conflict must block before creating the project-local Codex root');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('enabled provider reports stale receipt and owned broken links before migration', () => {
  const scratch = projectRoot();
  const fakePlugin = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-ics-provider-receipt-plugin-')));
  const unrelatedRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-ics-provider-receipt-unrelated-')));
  try {
    fs.cpSync(path.join(ROOT, 'codex'), path.join(fakePlugin, 'codex'), { recursive: true, dereference: true });
    fs.mkdirSync(path.join(fakePlugin, '.claude-plugin'), { recursive: true });
    fs.copyFileSync(
      path.join(ROOT, '.claude-plugin', 'plugin.json'),
      path.join(fakePlugin, '.claude-plugin', 'plugin.json'),
    );
    const sourceVersion = JSON.parse(fs.readFileSync(
      path.join(fakePlugin, '.claude-plugin', 'plugin.json'),
      'utf8',
    )).version;
    copyDistributionInventory(fakePlugin);

    const installed = runInstaller(scratch, ['--force'], fakePlugin);
    assert.strictEqual(installed.status, 0, `${installed.stdout}\n${installed.stderr}`);

    const retired = 'dhpk-tdd-workflow';
    const inventoryPath = path.join(fakePlugin, 'manifests', 'distribution-inventory.json');
    const inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
    const retiredEntry = inventory.skills.find((entry) => entry.name === retired);
    const replacement = inventory.skills.find((entry) => entry.id !== retiredEntry.id);
    assert.ok(retiredEntry && replacement, 'fixture needs a retired skill and active replacement');
    inventory.skills = inventory.skills.filter((entry) => entry.name !== retired);
    inventory.retired_skills = [
      {
        id: retiredEntry.id,
        name: retiredEntry.name,
        canonicalPath: retiredEntry.path,
        retiredIn: '0.54.1',
        reasonCode: 'provider-diagnostic-test',
        priorSurfaces: retiredEntry.surfaces,
        replacements: [{ kind: 'skill', id: replacement.id, mode: 'test-successor' }],
        rollback: { release: '0.54.0' },
      },
    ];
    fs.writeFileSync(inventoryPath, `${JSON.stringify(inventory, null, 2)}\n`);
    fs.rmSync(path.join(fakePlugin, 'codex', 'skills', retired), { recursive: true, force: true });

    const retiredTarget = path.join(scratch, '.codex', 'skills', retired);
    assert.ok(fs.lstatSync(retiredTarget).isSymbolicLink(), 'retired fixture must be a project symlink');
    const unrelatedTarget = path.join(scratch, '.codex', 'skills', 'user-owned-link');
    fs.symlinkSync(unrelatedRoot, unrelatedTarget, 'dir');

    const receiptPath = path.join(scratch, '.codex', '.dhpk-installed.json');
    const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    receipt.plugin_version = '0.53.0';
    fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
    const receiptBeforeBlocked = fs.readFileSync(receiptPath, 'utf8');
    const retiredLinkBeforeBlocked = fs.readlinkSync(retiredTarget);
    const unrelatedLinkBeforeBlocked = fs.readlinkSync(unrelatedTarget);

    const enabled = runInstaller(scratch, ['--migrate', '--update', '--force', '--json'], fakePlugin, {
      DHPK_TEST_CODEX_PLUGIN_LIST_JSON: JSON.stringify({
        installed: [{ pluginId: 'dhpk@dhpk', enabled: true, version: sourceVersion }],
        available: [],
      }),
    });
    assert.strictEqual(enabled.status, 2, `${enabled.stdout}\n${enabled.stderr}`);
    const blocked = JSON.parse(enabled.stdout);
    assert.strictEqual(blocked.state, 'blocked');
    assert.strictEqual(blocked.reasonCode, 'CODEX_NATIVE_PLUGIN_ENABLED');
    assert.strictEqual(blocked.receiptCheck.status, 'FOUND');
    assert.strictEqual(blocked.receiptCheck.pluginVersion, '0.53.0');
    assert.deepStrictEqual(blocked.receiptCheck.brokenSymlinkPaths, [`skills/${retired}`]);
    assert.strictEqual(fs.readFileSync(receiptPath, 'utf8'), receiptBeforeBlocked,
      'provider conflict must leave the stale receipt untouched');
    assert.strictEqual(fs.readlinkSync(retiredTarget), retiredLinkBeforeBlocked,
      'provider conflict must leave the broken owned link untouched');
    assert.strictEqual(fs.readlinkSync(unrelatedTarget), unrelatedLinkBeforeBlocked,
      'provider conflict must leave unrelated links untouched');

    const disabled = runInstaller(scratch, ['--migrate', '--update', '--force'], fakePlugin, {
      DHPK_TEST_CODEX_PLUGIN_LIST_JSON: JSON.stringify({
        installed: [{ pluginId: 'dhpk@dhpk', enabled: false, version: sourceVersion }],
        available: [],
      }),
    });
    assert.strictEqual(disabled.status, 0, `${disabled.stdout}\n${disabled.stderr}`);
    assert.throws(() => fs.lstatSync(retiredTarget), /ENOENT/,
      'disabled migration must remove the owned retired link');
    assert.ok(fs.lstatSync(unrelatedTarget).isSymbolicLink(),
      'disabled migration must preserve an unrelated symlink');
    assert.strictEqual(fs.readlinkSync(unrelatedTarget), unrelatedLinkBeforeBlocked);
    const migrated = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    assert.strictEqual(migrated.plugin_version, sourceVersion);
    assert.ok(!migrated.managed_entries.skills[retired],
      'disabled migration must remove the retired entry from managed ownership');
    assert.ok(migrated.reconciliation.retired >= 1, JSON.stringify(migrated.reconciliation));
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(fakePlugin, { recursive: true, force: true });
    fs.rmSync(unrelatedRoot, { recursive: true, force: true });
  }
});

test('enabled provider keeps blocked JSON intact for malformed receipt entries', () => {
  const scratch = projectRoot();
  try {
    const codexRoot = path.join(scratch, '.codex');
    const brokenTarget = path.join(codexRoot, 'skills', 'malformed-entry');
    fs.mkdirSync(path.dirname(brokenTarget), { recursive: true });
    fs.symlinkSync('missing-target', brokenTarget, 'dir');
    const receiptPath = path.join(codexRoot, '.dhpk-installed.json');
    const malformedEntryReceipt = {
      schema_version: 3,
      plugin_version: '0.53.0',
      managed_entries: {
        skills: {
          malformed: {
            source: 7,
            destination: 'skills/malformed-entry',
            mode: 'symlink',
            ownership_marker: 'symlink:7',
          },
        },
        agents: {},
        supporting_assets: {},
      },
    };
    fs.writeFileSync(receiptPath, `${JSON.stringify(malformedEntryReceipt, null, 2)}\n`);
    const receiptBefore = fs.readFileSync(receiptPath, 'utf8');

    const result = runInstaller(scratch, ['--update', '--force', '--json'], ROOT, {
      DHPK_TEST_CODEX_PLUGIN_LIST_JSON: JSON.stringify({
        installed: [{ pluginId: 'dhpk@dhpk', enabled: true, version: '0.54.1' }],
        available: [],
      }),
    });
    assert.strictEqual(result.status, 2, `${result.stdout}\n${result.stderr}`);
    const blocked = JSON.parse(result.stdout);
    assert.strictEqual(blocked.state, 'blocked');
    assert.strictEqual(blocked.reasonCode, 'CODEX_NATIVE_PLUGIN_ENABLED');
    assert.strictEqual(blocked.receiptCheck.status, 'FOUND');
    assert.strictEqual(blocked.receiptCheck.pluginVersion, '0.53.0');
    assert.deepStrictEqual(blocked.receiptCheck.brokenSymlinkPaths, []);
    assert.strictEqual(fs.readFileSync(receiptPath, 'utf8'), receiptBefore);
    assert.strictEqual(fs.readlinkSync(brokenTarget), 'missing-target');

    const deeplyNestedReceipt = `${'['.repeat(12000)}${']'.repeat(12000)}`;
    fs.writeFileSync(receiptPath, deeplyNestedReceipt);
    const nestedReceiptBefore = fs.readFileSync(receiptPath, 'utf8');
    const nestedResult = runInstaller(scratch, ['--update', '--force', '--json'], ROOT, {
      DHPK_TEST_CODEX_PLUGIN_LIST_JSON: JSON.stringify({
        installed: [{ pluginId: 'dhpk@dhpk', enabled: true, version: '0.54.1' }],
        available: [],
      }),
    });
    assert.strictEqual(nestedResult.status, 2, `${nestedResult.stdout}\n${nestedResult.stderr}`);
    const nestedBlocked = JSON.parse(nestedResult.stdout);
    assert.strictEqual(nestedBlocked.state, 'blocked');
    assert.strictEqual(nestedBlocked.reasonCode, 'CODEX_NATIVE_PLUGIN_ENABLED');
    assert.strictEqual(nestedBlocked.receiptCheck.status, 'MALFORMED');
    assert.strictEqual(fs.readFileSync(receiptPath, 'utf8'), nestedReceiptBefore);
    assert.strictEqual(fs.readlinkSync(brokenTarget), 'missing-target');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('enabled provider evidence wins over malformed or earlier disabled plugin-list entries', () => {
  const payloads = [
    { installed: [{ broken: true }, { pluginId: 'dhpk@dhpk', enabled: true }], available: [] },
    {
      installed: [
        { pluginId: 'dhpk@dhpk', enabled: false },
        { pluginId: 'dhpk@dhpk', enabled: true },
      ],
      available: [],
    },
  ];
  for (const payload of payloads) {
    const scratch = projectRoot();
    try {
      const result = runInstaller(scratch, ['--copy', '--force', '--json'], ROOT, {
        DHPK_TEST_CODEX_PLUGIN_LIST_JSON: JSON.stringify(payload),
      });
      assert.strictEqual(result.status, 2, `${result.stdout}\n${result.stderr}`);
      assert.strictEqual(JSON.parse(result.stdout).providerCheck.status, 'ENABLED');
      assert.ok(!fs.existsSync(path.join(scratch, '.codex')),
        'all plugin-list entries must be inspected before project-local writes');
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  }
});

test('unavailable Codex provider query is reported but does not block planning', () => {
  const scratch = projectRoot();
  try {
    const result = runInstaller(scratch, ['--copy', '--force', '--plan', '--json'], ROOT, {
      DHPK_TEST_CODEX_PLUGIN_LIST_EXIT: '1',
    });
    assert.strictEqual(result.status, 1, `${result.stdout}\n${result.stderr}`);
    const report = JSON.parse(result.stdout);
    assert.strictEqual(report.providerCheck.status, 'UNAVAILABLE');
    assert.notStrictEqual(report.state, 'blocked');
    assert.ok(!fs.existsSync(path.join(scratch, '.codex')),
      '--plan must remain read-only when the provider query is unavailable');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('oversized provider output is capped before the child command finishes', () => {
  const scratch = projectRoot();
  try {
    const startedAt = Date.now();
    const result = runInstaller(scratch, ['--copy', '--force', '--plan', '--json'], ROOT, {
      DHPK_TEST_CODEX_PLUGIN_LIST_OVERSIZED: '1',
    });
    const elapsedMs = Date.now() - startedAt;
    assert.strictEqual(result.status, 1, `${result.stdout}\n${result.stderr}`);
    assert.strictEqual(JSON.parse(result.stdout).providerCheck.status, 'UNAVAILABLE');
    assert.ok(elapsedMs < 2000, `expected capped output to terminate promptly, took ${elapsedMs}ms`);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('provider timeout terminates descendants after the direct Codex process exits', () => {
  const scratch = projectRoot();
  const marker = path.join(scratch, 'background-survived');
  try {
    const result = runInstaller(scratch, ['--copy', '--force', '--plan', '--json'], ROOT, {
      DHPK_TEST_CODEX_BACKGROUND_MARKER: marker,
    });
    assert.strictEqual(result.status, 1, `${result.stdout}\n${result.stderr}`);
    assert.strictEqual(JSON.parse(result.stdout).providerCheck.status, 'UNAVAILABLE');
    spawnSync('sleep', ['1.5']);
    assert.ok(!fs.existsSync(marker), 'timed-out provider query must terminate its whole process group');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('--uninstall remains available when the dhpk native plugin is enabled', () => {
  const scratch = projectRoot();
  try {
    const installed = runInstaller(scratch, ['--copy', '--force']);
    assert.strictEqual(installed.status, 0, `${installed.stdout}\n${installed.stderr}`);
    const removed = runInstaller(scratch, ['--uninstall'], ROOT, {
      DHPK_TEST_CODEX_PLUGIN_LIST_JSON: JSON.stringify({
        installed: [{ pluginId: 'dhpk@dhpk', enabled: true, version: '0.53.0' }],
        available: [],
      }),
    });
    assert.strictEqual(removed.status, 0, `${removed.stdout}\n${removed.stderr}`);
    assert.ok(!fs.existsSync(path.join(scratch, '.codex', '.dhpk-installed.json')),
      'uninstall should remove the project receipt without requiring native-plugin removal');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('successful update emits no deprecation warning and preserves UTC receipt timestamps', () => {
  const scratch = projectRoot();
  try {
    const res = runInstaller(scratch, ['--copy', '--update'], ROOT, {
      PYTHONWARNINGS: 'error::DeprecationWarning',
    });
    assert.strictEqual(res.status, 0, `${res.stdout}\n${res.stderr}`);
    assert.doesNotMatch(res.stderr, /DeprecationWarning/);
    const receipt = JSON.parse(fs.readFileSync(
      path.join(scratch, '.codex', '.dhpk-installed.json'),
      'utf8',
    ));
    assert.match(receipt.installed_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('Codex sync installs its transport runtime without granting it profile capability', () => {
  const scratch = projectRoot();
  try {
    const result = runInstaller(scratch, ['--copy', '--force']);
    assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const receipt = JSON.parse(fs.readFileSync(path.join(scratch, '.codex', '.dhpk-installed.json'), 'utf8'));
    assert.ok(!receipt.selectedStableIds.includes('cli-dispatch-context'));
    assert.ok(!receipt.selectedStableIds.includes('cli-transport'));
    assert.ok(!receipt.emittedStableIds.includes('cli-dispatch-context'));
    assert.ok(!receipt.emittedStableIds.includes('cli-transport'));
    assert.deepStrictEqual(receipt.runtimeSupportStableIds, ['cli-dispatch-context', 'cli-transport']);
    assert.ok(receipt.managed_entries.skills['dhpk-cli-dispatch-context']);
    assert.ok(receipt.managed_entries.skills['dhpk-cli-transport']);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

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

test('copy and symlink installs do not require descriptor pseudo-path child traversal', () => {
  for (const args of [['--copy', '--force'], ['--force']]) {
    const scratch = projectRoot();
    const shim = descriptorPseudoPathBlocker();
    const cwdAudit = path.join(shim, 'cwd-audit.txt');
    try {
      const pythonPath = [shim, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter);
      const result = runInstaller(scratch, args, ROOT, {
        PYTHONPATH: pythonPath,
        DHPK_TEST_CWD_AUDIT_FILE: cwdAudit,
      });
      assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
      assert.strictEqual(fs.readFileSync(cwdAudit, 'utf8'), scratch,
        'materialization must restore the installer working directory');
      const receipt = JSON.parse(
        fs.readFileSync(path.join(scratch, '.codex', '.dhpk-installed.json'), 'utf8'),
      );
      assert.strictEqual(receipt.mode, args.includes('--copy') ? 'copy' : 'symlink');
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
      fs.rmSync(shim, { recursive: true, force: true });
    }
  }
});

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

test('copy failure restores the installer working directory before reporting failure', () => {
  const scratch = projectRoot();
  const shim = materializationFailureShim();
  const cwdAudit = path.join(shim, 'cwd-audit.txt');
  try {
    const pythonPath = [shim, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter);
    const result = runInstaller(scratch, ['--copy', '--force'], ROOT, {
      PYTHONPATH: pythonPath,
      DHPK_TEST_CWD_AUDIT_FILE: cwdAudit,
    });
    assert.notStrictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(`${result.stdout}\n${result.stderr}`, /controlled materialization failure/);
    assert.strictEqual(fs.readFileSync(cwdAudit, 'utf8'), scratch,
      'failed materialization must restore the installer working directory');
    assert.ok(!fs.existsSync(path.join(scratch, '.codex', '.dhpk-installed.json')),
      'failed materialization must not publish a receipt');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(shim, { recursive: true, force: true });
  }
});

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

test('parent-path replacement cannot redirect a pinned update into an external tree', () => {
  const scratch = projectRoot();
  const plugin = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-parent-gate-plugin-')));
  const external = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-parent-gate-external-')));
  const shim = parentReplacementGate();
  let watcher;
  try {
    fs.cpSync(path.join(ROOT, 'codex'), path.join(plugin, 'codex'), { recursive: true, dereference: true });
    fs.mkdirSync(path.join(plugin, '.claude-plugin'), { recursive: true });
    fs.copyFileSync(
      path.join(ROOT, '.claude-plugin', 'plugin.json'),
      path.join(plugin, '.claude-plugin', 'plugin.json'),
    );
    copyDistributionInventory(plugin);

    const installed = runInstaller(scratch, ['--copy', '--force'], plugin);
    assert.strictEqual(installed.status, 0, `${installed.stdout}\n${installed.stderr}`);
    const changed = fs.readdirSync(path.join(plugin, 'codex', 'skills')).sort()[0];
    const changedSource = path.join(plugin, 'codex', 'skills', changed);
    if (fs.lstatSync(changedSource).isSymbolicLink()) {
      const canonicalSource = fs.realpathSync(changedSource);
      fs.rmSync(changedSource, { recursive: true, force: true });
      fs.cpSync(canonicalSource, changedSource, { recursive: true, dereference: true });
    }
    fs.appendFileSync(path.join(changedSource, 'SKILL.md'), '\nparent replacement fixture\n');

    fs.writeFileSync(path.join(external, 'keep.txt'), 'external sentinel\n');
    const externalBefore = completeTreeFingerprint(external);
    const receiptPath = path.join(scratch, '.codex', '.dhpk-installed.json');
    const receiptBefore = fs.readFileSync(receiptPath, 'utf8');
    const ready = path.join(shim, 'ready');
    const release = path.join(shim, 'release');
    const done = path.join(shim, 'done');
    const watcherError = path.join(shim, 'watcher-error');
    const skills = path.join(scratch, '.codex', 'skills');
    const pinnedSkills = path.join(scratch, '.codex', 'skills-pinned');
    const watcherScript = path.join(shim, 'replace-parent.js');
    fs.writeFileSync(watcherScript, [
      "'use strict';",
      "const fs = require('node:fs');",
      "const [ready, parent, pinned, external, release, done, errorFile] = process.argv.slice(2);",
      'const signal = new Int32Array(new SharedArrayBuffer(4));',
      'const deadline = Date.now() + 10000;',
      'try {',
      '  while (!fs.existsSync(ready) && Date.now() < deadline) Atomics.wait(signal, 0, 0, 10);',
      "  if (!fs.existsSync(ready)) throw new Error('ready marker timed out');",
      '  fs.renameSync(parent, pinned);',
      "  fs.symlinkSync(external, parent, 'dir');",
      "  fs.writeFileSync(release, 'release');",
      "  fs.writeFileSync(done, 'done');",
      '} catch (error) {',
      '  fs.writeFileSync(errorFile, error.stack || String(error));',
      "  fs.writeFileSync(release, 'release');",
      '  process.exitCode = 1;',
      '}',
      '',
    ].join('\n'));
    watcher = spawn(process.execPath, [
      watcherScript,
      ready,
      skills,
      pinnedSkills,
      external,
      release,
      done,
      watcherError,
    ], { stdio: 'ignore' });

    const pythonPath = [shim, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter);
    const result = runInstaller(scratch, ['--copy', '--update', '--force'], plugin, {
      PYTHONPATH: pythonPath,
      DHPK_TEST_PARENT_OPEN_READY_FILE: ready,
      DHPK_TEST_PARENT_OPEN_RELEASE_FILE: release,
    });
    assert.ok(waitForFile(done),
      fs.existsSync(watcherError) ? fs.readFileSync(watcherError, 'utf8') : 'parent watcher did not complete');
    assert.notStrictEqual(result.status, 0,
      'a replaced public parent must fail closed instead of publishing a success receipt');
    assert.strictEqual(completeTreeFingerprint(external), externalBefore,
      'descriptor-pinned work must not mutate the replacement target');
    assert.strictEqual(fs.readFileSync(receiptPath, 'utf8'), receiptBefore,
      'a replaced parent must not publish a receipt for the wrong directory identity');
  } finally {
    if (watcher && watcher.exitCode === null) watcher.kill('SIGKILL');
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(plugin, { recursive: true, force: true });
    fs.rmSync(external, { recursive: true, force: true });
    fs.rmSync(shim, { recursive: true, force: true });
  }
});

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

test('copy mode materializes skills/agents and records the install manifest', () => {
  const scratch = projectRoot();
  try {
    const res = runInstaller(scratch, ['--copy', '--force']);
    assert.strictEqual(res.status, 0, `${res.stdout}\n${res.stderr}`);
    const codex = path.join(scratch, '.codex');
    const skills = fs.readdirSync(path.join(codex, 'skills'));
    const agents = fs.readdirSync(path.join(codex, 'agents'));
    assert.ok(skills.length > 0, 'expected copied Codex skills');
    assert.ok(agents.length > 0, 'expected copied Codex agents');
    assert.ok(!fs.lstatSync(path.join(codex, 'skills', skills[0])).isSymbolicLink(), 'copy mode must materialize files');
    const manifest = JSON.parse(fs.readFileSync(path.join(codex, '.dhpk-installed.json'), 'utf8'));
    assert.strictEqual(manifest.schema_version, 3);
    assert.ok(manifest.managed_entries && manifest.managed_entries.skills);
    assert.ok(manifest.managed_entries && manifest.managed_entries.agents);
    assert.ok(manifest.managed_entries && manifest.managed_entries.supporting_assets);
    const supporting = manifest.managed_entries.supporting_assets['dhpk/agent-traps/_common/prompt-defense.md'];
    assert.ok(supporting, 'expected the Codex prompt-defense trap sheet to be receipt-managed');
    assert.strictEqual(supporting.destination, 'dhpk/agent-traps/_common/prompt-defense.md');
    assert.strictEqual(supporting.source, 'dhpk/agent-traps/_common/prompt-defense.md');
    assert.strictEqual(supporting.mode, 'copy');
    assert.ok(fs.existsSync(path.join(codex, supporting.destination)),
      'receipt-managed Codex supporting assets must materialize in the clean project');
    assert.match(supporting.source_fingerprint, /^[a-f0-9]{64}$/);
    const skillEntry = manifest.managed_entries.skills[skills[0]];
    assert.strictEqual(skillEntry.destination, `skills/${skills[0]}`);
    assert.strictEqual(skillEntry.source, `skills/${skills[0]}`);
    assert.strictEqual(skillEntry.mode, 'copy');
    assert.match(skillEntry.source_fingerprint, /^[a-f0-9]{64}$/);
    assert.match(skillEntry.destination_fingerprint, /^[a-f0-9]{64}$/);
    assert.match(skillEntry.fingerprint, /^[a-f0-9]{64}$/);
    assert.ok(typeof skillEntry.id === 'string' && skillEntry.id.length > 0);
    assert.strictEqual(skillEntry.name, skills[0]);
    assert.ok(skillEntry.ownership_marker);
    assert.strictEqual(manifest.mode, 'copy');
    assert.strictEqual(manifest.plugin_version, JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin/plugin.json'))).version);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('default mode keeps skills linked but materializes Codex agent role files', () => {
  const scratch = projectRoot();
  try {
    const res = runInstaller(scratch, ['--force']);
    assert.strictEqual(res.status, 0, `${res.stdout}\n${res.stderr}`);

    const codex = path.join(scratch, '.codex');
    const skillName = fs.readdirSync(path.join(codex, 'skills'))[0];
    const agentName = fs.readdirSync(path.join(codex, 'agents'))[0];
    const receipt = JSON.parse(fs.readFileSync(path.join(codex, '.dhpk-installed.json'), 'utf8'));

    assert.ok(fs.lstatSync(path.join(codex, 'skills', skillName)).isSymbolicLink(),
      'default mode must preserve linked Codex skills');
    assert.ok(fs.lstatSync(path.join(codex, 'agents', agentName)).isFile(),
      'Codex agent role TOMLs must be physical files for runtime discovery');
    assert.strictEqual(receipt.mode, 'symlink');
    assert.strictEqual(receipt.managed_entries.skills[skillName].mode, 'symlink');
    assert.strictEqual(receipt.managed_entries.agents[agentName].mode, 'copy');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('ordinary update migrates a historical managed agent symlink only once', () => {
  const scratch = projectRoot();
  try {
    const installed = runInstaller(scratch, ['--force']);
    assert.strictEqual(installed.status, 0, `${installed.stdout}\n${installed.stderr}`);
    const codex = path.join(scratch, '.codex');
    const agentName = fs.readdirSync(path.join(codex, 'agents'))[0];
    const skillName = fs.readdirSync(path.join(codex, 'skills'))[0];
    const skillTarget = path.join(codex, 'skills', skillName);
    const skillSource = fs.realpathSync(skillTarget);
    const historical = rewriteAgentAsHistoricalManagedSymlink(scratch, agentName);

    const planned = runInstaller(scratch, ['--update', '--plan', '--json', '--force']);
    assert.strictEqual(planned.status, 1, `${planned.stdout}\n${planned.stderr}`);
    const plan = JSON.parse(planned.stdout);
    assert.deepStrictEqual(plan.updates.map((entry) => entry.path), [historical.relative]);
    assert.deepStrictEqual(plan.collisions, []);

    const updated = runInstaller(scratch, ['--update', '--force']);
    assert.strictEqual(updated.status, 0, `${updated.stdout}\n${updated.stderr}`);
    assert.ok(fs.lstatSync(historical.destination).isFile(), 'managed role must migrate to a physical file');
    assert.strictEqual(fs.readFileSync(historical.destination, 'utf8'), fs.readFileSync(historical.source, 'utf8'));
    assert.strictEqual(fs.realpathSync(skillTarget), skillSource, 'unrelated skill symlink must remain unchanged');
    const receipt = JSON.parse(fs.readFileSync(historical.receiptPath, 'utf8'));
    assert.strictEqual(receipt.mode, 'symlink');
    assert.strictEqual(receipt.managed_entries.agents[agentName].mode, 'copy');
    assert.strictEqual(receipt.reconciliation.updated, 1);

    const repeated = runInstaller(scratch, ['--update', '--force']);
    assert.strictEqual(repeated.status, 0, `${repeated.stdout}\n${repeated.stderr}`);
    const repeatedReceipt = JSON.parse(fs.readFileSync(historical.receiptPath, 'utf8'));
    assert.strictEqual(repeatedReceipt.reconciliation.updated, 0);
    assert.strictEqual(repeatedReceipt.reconciliation.backed_up, 0);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('explicit legacy migration rematerializes exact agent symlinks as physical files', () => {
  const scratch = projectRoot();
  try {
    const installed = runInstaller(scratch, ['--force']);
    assert.strictEqual(installed.status, 0, `${installed.stdout}\n${installed.stderr}`);
    const agentName = fs.readdirSync(path.join(scratch, '.codex', 'agents'))[0];
    const historical = rewriteAgentAsHistoricalManagedSymlink(scratch, agentName);
    const legacyReceipt = JSON.parse(fs.readFileSync(historical.receiptPath, 'utf8'));
    legacyReceipt.schema_version = 2;
    legacyReceipt.plugin_version = 'legacy';
    legacyReceipt.source_fingerprint = 'legacy';
    fs.writeFileSync(historical.receiptPath, `${JSON.stringify(legacyReceipt, null, 2)}\n`);

    const migrated = runInstaller(scratch, ['--migrate', '--update', '--force']);
    assert.strictEqual(migrated.status, 0, `${migrated.stdout}\n${migrated.stderr}`);
    assert.ok(fs.lstatSync(historical.destination).isFile(),
      'legacy migration must not record copy ownership while leaving an agent symlink');
    const receipt = JSON.parse(fs.readFileSync(historical.receiptPath, 'utf8'));
    assert.strictEqual(receipt.schema_version, 3);
    assert.strictEqual(receipt.managed_entries.agents[agentName].mode, 'copy');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('ordinary update preserves a retargeted historical agent symlink as a collision', () => {
  const scratch = projectRoot();
  const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-agent-retarget-')));
  try {
    const installed = runInstaller(scratch, ['--force']);
    assert.strictEqual(installed.status, 0, `${installed.stdout}\n${installed.stderr}`);
    const agentName = fs.readdirSync(path.join(scratch, '.codex', 'agents'))[0];
    const source = path.join(ROOT, 'codex', 'agents', agentName);
    const replacement = path.join(outside, agentName);
    fs.copyFileSync(source, replacement);
    const historical = rewriteAgentAsHistoricalManagedSymlink(scratch, agentName, replacement);

    const planned = runInstaller(scratch, ['--update', '--plan', '--json', '--force']);
    assert.strictEqual(planned.status, 1, `${planned.stdout}\n${planned.stderr}`);
    const collision = JSON.parse(planned.stdout).collisions.find((entry) => entry.path === historical.relative);
    assert.ok(collision, planned.stdout);
    assert.strictEqual(collision.ownership, 'unowned-collision');

    const updated = runInstaller(scratch, ['--update', '--force']);
    assert.notStrictEqual(updated.status, 0, `${updated.stdout}\n${updated.stderr}`);
    assert.match(`${updated.stdout}\n${updated.stderr}`, /--adopt/);
    assert.ok(fs.lstatSync(historical.destination).isSymbolicLink());
    assert.strictEqual(fs.realpathSync(historical.destination), replacement);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('copy-mode legacy migration preserves a receipt-owned retargeted symlink with identical content', () => {
  const scratch = projectRoot();
  const userOwned = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-ics-migrate-identical-target-')));
  try {
    const first = runInstaller(scratch, ['--copy', '--force']);
    assert.strictEqual(first.status, 0, `${first.stdout}\n${first.stderr}`);
    const currentName = 'dhpk-tdd-workflow';
    const legacyName = 'tdd';
    const currentTarget = path.join(scratch, '.codex', 'skills', currentName);
    const legacyTarget = path.join(scratch, '.codex', 'skills', legacyName);
    const source = path.join(ROOT, 'codex', 'skills', currentName);
    const replacement = path.join(userOwned, currentName);
    const receiptPath = path.join(scratch, '.codex', '.dhpk-installed.json');
    const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    const currentEntry = receipt.managed_entries.skills[currentName];
    assert.ok(currentEntry, `expected initial receipt entry for ${currentName}`);

    fs.renameSync(currentTarget, legacyTarget);
    fs.cpSync(source, replacement, { recursive: true, dereference: true });
    fs.rmSync(legacyTarget, { recursive: true, force: true });
    fs.symlinkSync(replacement, legacyTarget, 'dir');
    delete receipt.managed_entries.skills[currentName];
    currentEntry.destination = `skills/${legacyName}`;
    currentEntry.source = `skills/${legacyName}`;
    currentEntry.ownership_marker = `copy:skills/${legacyName}`;
    receipt.schema_version = 2;
    receipt.plugin_version = 'legacy';
    receipt.source_fingerprint = 'legacy';
    receipt.managed_entries.skills[legacyName] = currentEntry;
    fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);

    const migrated = runInstaller(scratch, ['--copy', '--migrate', '--force']);
    assert.strictEqual(migrated.status, 0, `${migrated.stdout}\n${migrated.stderr}`);
    assert.ok(fs.lstatSync(legacyTarget).isSymbolicLink(), 'retargeted legacy symlink must be preserved');
    assert.strictEqual(fs.realpathSync(legacyTarget), fs.realpathSync(replacement));
    const after = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    assert.ok(after.orphaned_entries[`skills/${legacyName}`], 'retargeted legacy path must be recorded as orphaned');
    assert.match(`${migrated.stdout}\n${migrated.stderr}`, /legacy conflict|orphaned|preserved/i);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(userOwned, { recursive: true, force: true });
  }
});

test('skill sources fail closed when distribution metadata is missing', () => {
  const scratch = projectRoot();
  const fakePlugin = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-ics-missing-metadata-plugin-')));
  try {
    fs.cpSync(path.join(ROOT, 'codex'), path.join(fakePlugin, 'codex'), { recursive: true, dereference: true });
    fs.mkdirSync(path.join(fakePlugin, '.claude-plugin'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), path.join(fakePlugin, '.claude-plugin', 'plugin.json'));
    const res = runInstaller(scratch, ['--copy', '--force'], fakePlugin);
    assert.notStrictEqual(res.status, 0, `${res.stdout}\n${res.stderr}`);
    assert.match(`${res.stdout}\n${res.stderr}`, /skill metadata|distribution inventory|id|name/i);
    assert.ok(!fs.existsSync(path.join(scratch, '.codex', '.dhpk-installed.json')),
      'metadata validation must fail before writing a schema-v3 receipt');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(fakePlugin, { recursive: true, force: true });
  }
});

test('skill sources fail closed when distribution metadata is incomplete', () => {
  const scratch = projectRoot();
  const fakePlugin = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-ics-incomplete-metadata-plugin-')));
  try {
    fs.cpSync(path.join(ROOT, 'codex'), path.join(fakePlugin, 'codex'), { recursive: true, dereference: true });
    fs.mkdirSync(path.join(fakePlugin, '.claude-plugin'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), path.join(fakePlugin, '.claude-plugin', 'plugin.json'));
    fs.mkdirSync(path.join(fakePlugin, 'manifests'), { recursive: true });
    fs.writeFileSync(path.join(fakePlugin, 'manifests', 'distribution-inventory.json'), JSON.stringify({
      skills: [{ name: 'dhpk-tdd-workflow', legacy_names: ['tdd'] }],
      supporting_assets: [],
    }));
    const res = runInstaller(scratch, ['--copy', '--force'], fakePlugin);
    assert.notStrictEqual(res.status, 0, `${res.stdout}\n${res.stderr}`);
    assert.match(`${res.stdout}\n${res.stderr}`, /skill metadata|id|incomplete|distribution inventory/i);
    assert.ok(!fs.existsSync(path.join(scratch, '.codex', '.dhpk-installed.json')),
      'incomplete metadata must fail before writing a schema-v3 receipt');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(fakePlugin, { recursive: true, force: true });
  }
});

test('external source symlink is rejected before an owned retirement prune', () => {
  const scratch = projectRoot();
  const fakePlugin = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-ics-source-symlink-plugin-')));
  const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-ics-source-symlink-outside-')));
  try {
    fs.cpSync(path.join(ROOT, 'codex'), path.join(fakePlugin, 'codex'), { recursive: true, dereference: true });
    fs.mkdirSync(path.join(fakePlugin, '.claude-plugin'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), path.join(fakePlugin, '.claude-plugin', 'plugin.json'));
    copyDistributionInventory(fakePlugin);

    const first = runInstaller(scratch, ['--copy', '--force'], fakePlugin);
    assert.strictEqual(first.status, 0, `${first.stdout}\n${first.stderr}`);
    const sourceNames = fs.readdirSync(path.join(fakePlugin, 'codex', 'skills')).sort();
    assert.ok(sourceNames.length >= 2, 'fixture needs a retired and active skill');
    const retired = sourceNames.find((name) => name === 'dhpk-tdd-workflow');
    const malicious = sourceNames.find((name) => name === 'dhpk-yii1-security-audit');
    assert.ok(retired && malicious, 'fixture needs prefixed retired and active skills');
    const inventoryPath = path.join(fakePlugin, 'manifests', 'distribution-inventory.json');
    const inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
    const retiredEntry = inventory.skills.find((entry) => entry.name === retired);
    assert.ok(retiredEntry, `missing fixture inventory entry for ${retired}`);
    inventory.skills = inventory.skills.filter((entry) => entry.name !== retired);
    inventory.retired_skills = [{
      id: retiredEntry.id,
      name: retiredEntry.name,
      canonicalPath: retiredEntry.path,
      retiredIn: '0.47.0',
      reasonCode: 'test-retirement',
      priorSurfaces: retiredEntry.surfaces,
      replacements: [{ kind: 'skill', id: 'code-trace', mode: 'test-successor' }],
      rollback: { release: '0.46.1' },
    }];
    fs.writeFileSync(inventoryPath, `${JSON.stringify(inventory, null, 2)}\n`);
    fs.rmSync(path.join(fakePlugin, 'codex', 'skills', retired), { recursive: true, force: true });

    const outsideSource = path.join(outside, malicious);
    fs.mkdirSync(outsideSource, { recursive: true });
    fs.writeFileSync(path.join(outsideSource, 'escaped.txt'), 'outside source\n');
    const maliciousSource = path.join(fakePlugin, 'codex', 'skills', malicious);
    fs.rmSync(maliciousSource, { recursive: true, force: true });
    fs.symlinkSync(outsideSource, maliciousSource, 'dir');

    const retiredTarget = path.join(scratch, '.codex', 'skills', retired);
    const receiptBefore = fs.readFileSync(path.join(scratch, '.codex', '.dhpk-installed.json'), 'utf8');
    const updated = runInstaller(scratch, ['--copy', '--update', '--force'], fakePlugin);
    assert.notStrictEqual(updated.status, 0, `${updated.stdout}\n${updated.stderr}`);
    assert.match(`${updated.stdout}\n${updated.stderr}`, /(source|symlink|outside|escape)/i);
    assert.ok(fs.existsSync(retiredTarget), 'retirement target must remain when source validation fails');
    assert.strictEqual(
      fs.readFileSync(path.join(scratch, '.codex', '.dhpk-installed.json'), 'utf8'),
      receiptBefore,
      'source validation must fail before receipt mutation',
    );
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(fakePlugin, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('malformed retirement metadata fails closed before receipt mutation', () => {
  const scratch = projectRoot();
  const fakePlugin = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-ics-retirement-metadata-plugin-')));
  try {
    fs.cpSync(path.join(ROOT, 'codex'), path.join(fakePlugin, 'codex'), { recursive: true, dereference: true });
    fs.mkdirSync(path.join(fakePlugin, '.claude-plugin'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), path.join(fakePlugin, '.claude-plugin', 'plugin.json'));
    copyDistributionInventory(fakePlugin);
    const first = runInstaller(scratch, ['--copy', '--force'], fakePlugin);
    assert.strictEqual(first.status, 0, `${first.stdout}\n${first.stderr}`);

    const inventoryPath = path.join(fakePlugin, 'manifests', 'distribution-inventory.json');
    const inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
    inventory.retired_skills = [{
      id: 'retired-helper',
      name: 'dhpk-retired-helper',
      canonicalPath: 'skills/dhpk-retired-helper',
      retiredIn: '0.47.0',
      reasonCode: 'test-retirement',
      priorSurfaces: ['claude-core'],
      replacements: [{ kind: 'skill', id: 'tdd', mode: 'test-successor', unexpected: 'must-not-leak' }],
      rollback: { release: '0.46.1' },
    }];
    fs.writeFileSync(inventoryPath, `${JSON.stringify(inventory, null, 2)}\n`);

    const receiptPath = path.join(scratch, '.codex', '.dhpk-installed.json');
    const receiptBefore = fs.readFileSync(receiptPath, 'utf8');
    const updated = runInstaller(scratch, ['--copy', '--update', '--force'], fakePlugin);
    assert.notStrictEqual(updated.status, 0, `${updated.stdout}\n${updated.stderr}`);
    assert.match(`${updated.stdout}\n${updated.stderr}`, /(retirement|metadata|unknown|not allowed)/i);
    assert.strictEqual(fs.readFileSync(receiptPath, 'utf8'), receiptBefore, 'malformed metadata must not mutate the receipt');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(fakePlugin, { recursive: true, force: true });
  }
});

test('agent retirement successors must exist in the inventory-owned roster', () => {
  const scratch = projectRoot();
  const fakePlugin = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-ics-agent-roster-plugin-')));
  try {
    fs.cpSync(path.join(ROOT, 'codex'), path.join(fakePlugin, 'codex'), { recursive: true, dereference: true });
    fs.mkdirSync(path.join(fakePlugin, '.claude-plugin'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), path.join(fakePlugin, '.claude-plugin', 'plugin.json'));
    copyDistributionInventory(fakePlugin);
    const first = runInstaller(scratch, ['--copy', '--force'], fakePlugin);
    assert.strictEqual(first.status, 0, `${first.stdout}\n${first.stderr}`);

    const inventoryPath = path.join(fakePlugin, 'manifests', 'distribution-inventory.json');
    const inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
    inventory.retired_skills = [{
      id: 'retired-helper',
      name: 'dhpk-retired-helper',
      canonicalPath: 'skills/dhpk-retired-helper',
      retiredIn: '0.47.0',
      reasonCode: 'test-retirement',
      priorSurfaces: ['claude-core'],
      replacements: [{ kind: 'agent', id: 'not-an-agent', mode: 'playwright-journey' }],
      rollback: { release: '0.46.1' },
    }];
    fs.writeFileSync(inventoryPath, `${JSON.stringify(inventory, null, 2)}\n`);

    const receiptPath = path.join(scratch, '.codex', '.dhpk-installed.json');
    const receiptBefore = fs.readFileSync(receiptPath, 'utf8');
    const updated = runInstaller(scratch, ['--copy', '--update', '--force'], fakePlugin);
    assert.notStrictEqual(updated.status, 0, `${updated.stdout}\n${updated.stderr}`);
    assert.match(`${updated.stdout}\n${updated.stderr}`, /inventory-owned active agent|agent.*roster/i);
    assert.strictEqual(fs.readFileSync(receiptPath, 'utf8'), receiptBefore, 'invalid agent successor must not mutate the receipt');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(fakePlugin, { recursive: true, force: true });
  }
});

test('retirement prune rolls back when a later destination path fails preflight', () => {
  const scratch = projectRoot();
  const fakePlugin = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-ics-prune-rollback-plugin-')));
  const external = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-ics-prune-rollback-outside-')));
  try {
    fs.cpSync(path.join(ROOT, 'codex'), path.join(fakePlugin, 'codex'), { recursive: true, dereference: true });
    fs.mkdirSync(path.join(fakePlugin, '.claude-plugin'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), path.join(fakePlugin, '.claude-plugin', 'plugin.json'));
    copyDistributionInventory(fakePlugin);
    const first = runInstaller(scratch, ['--copy', '--force'], fakePlugin);
    assert.strictEqual(first.status, 0, `${first.stdout}\n${first.stderr}`);

    const retired = fs.readdirSync(path.join(fakePlugin, 'codex', 'skills')).sort()[0];
    const inventoryPath = path.join(fakePlugin, 'manifests', 'distribution-inventory.json');
    const inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
    const retiredEntry = inventory.skills.find((entry) => entry.name === retired);
    inventory.skills = inventory.skills.filter((entry) => entry.name !== retired);
    inventory.retired_skills = [{
      id: retiredEntry.id,
      name: retiredEntry.name,
      canonicalPath: retiredEntry.path,
      retiredIn: '0.47.0',
      reasonCode: 'test-retirement',
      priorSurfaces: retiredEntry.surfaces,
      replacements: [{ kind: 'skill', id: 'tdd', mode: 'test-successor' }],
      rollback: { release: '0.46.1' },
    }];
    fs.writeFileSync(inventoryPath, `${JSON.stringify(inventory, null, 2)}\n`);
    fs.rmSync(path.join(fakePlugin, 'codex', 'skills', retired), { recursive: true, force: true });

    const externalDhpk = path.join(external, 'dhpk');
    fs.mkdirSync(externalDhpk, { recursive: true });
    fs.writeFileSync(path.join(externalDhpk, 'keep.txt'), 'external keep\n');
    fs.rmSync(path.join(scratch, '.codex', 'dhpk'), { recursive: true, force: true });
    fs.symlinkSync(externalDhpk, path.join(scratch, '.codex', 'dhpk'), 'dir');
    const retiredTarget = path.join(scratch, '.codex', 'skills', retired);
    const receiptPath = path.join(scratch, '.codex', '.dhpk-installed.json');
    const receiptBefore = fs.readFileSync(receiptPath, 'utf8');

    const updated = runInstaller(scratch, ['--copy', '--update', '--force'], fakePlugin);
    assert.notStrictEqual(updated.status, 0, `${updated.stdout}\n${updated.stderr}`);
    assert.ok(fs.existsSync(retiredTarget), 'retirement target must be restored after later preflight failure');
    assert.strictEqual(fs.readFileSync(receiptPath, 'utf8'), receiptBefore, 'failed transaction must retain the prior receipt');
    assert.strictEqual(fs.readFileSync(path.join(externalDhpk, 'keep.txt'), 'utf8'), 'external keep\n');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(fakePlugin, { recursive: true, force: true });
    fs.rmSync(external, { recursive: true, force: true });
  }
});

test('receipt failure rolls back ordinary updates and recovers the transaction journal', () => {
  const scratch = projectRoot();
  const fakePlugin = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-ics-receipt-rollback-plugin-')));
  try {
    fs.cpSync(path.join(ROOT, 'codex'), path.join(fakePlugin, 'codex'), { recursive: true, dereference: true });
    fs.mkdirSync(path.join(fakePlugin, '.claude-plugin'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), path.join(fakePlugin, '.claude-plugin', 'plugin.json'));
    copyDistributionInventory(fakePlugin);
    const first = runInstaller(scratch, ['--copy', '--force'], fakePlugin);
    assert.strictEqual(first.status, 0, `${first.stdout}\n${first.stderr}`);

    const changed = fs.readdirSync(path.join(fakePlugin, 'codex', 'skills')).sort()[0];
    const changedSource = path.join(fakePlugin, 'codex', 'skills', changed);
    // The canonical Codex tree contains symlink projections. Materialize this
    // fixture entry before mutating it so the test never edits the canonical
    // source skill through a symlink.
    if (fs.lstatSync(changedSource).isSymbolicLink()) {
      const canonicalSource = fs.realpathSync(changedSource);
      fs.rmSync(changedSource, { recursive: true, force: true });
      fs.cpSync(canonicalSource, changedSource, { recursive: true, dereference: true });
    }
    fs.appendFileSync(path.join(changedSource, 'SKILL.md'), '\nreceipt rollback fixture\n');
    const target = path.join(scratch, '.codex', 'skills', changed);
    const receiptPath = path.join(scratch, '.codex', '.dhpk-installed.json');
    const targetBefore = completeTreeFingerprint(target);
    const receiptBefore = fs.readFileSync(receiptPath, 'utf8');
    const failed = runInstaller(
      scratch,
      ['--copy', '--update', '--force'],
      fakePlugin,
      { DHPK_TEST_FAIL_RECEIPT: '1' },
    );
    assert.notStrictEqual(failed.status, 0, `${failed.stdout}\n${failed.stderr}`);
    assert.match(`${failed.stdout}\n${failed.stderr}`, /receipt|rollback/i);
    assert.strictEqual(completeTreeFingerprint(target), targetBefore, 'failed receipt must restore the prior target');
    assert.strictEqual(fs.readFileSync(receiptPath, 'utf8'), receiptBefore, 'failed receipt must retain the prior manifest');

    const recovered = runInstaller(scratch, ['--copy', '--update', '--force'], fakePlugin);
    assert.strictEqual(recovered.status, 0, `${recovered.stdout}\n${recovered.stderr}`);
    assert.match(`${recovered.stdout}\n${recovered.stderr}`, /synced|reconcili/i);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(fakePlugin, { recursive: true, force: true });
  }
});

test('supporting-only installs remain compatible without skill metadata', () => {
  const scratch = projectRoot();
  const fakePlugin = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-ics-supporting-only-plugin-')));
  try {
    fs.cpSync(path.join(ROOT, 'codex'), path.join(fakePlugin, 'codex'), { recursive: true, dereference: true });
    fs.rmSync(path.join(fakePlugin, 'codex', 'skills'), { recursive: true, force: true });
    fs.mkdirSync(path.join(fakePlugin, '.claude-plugin'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), path.join(fakePlugin, '.claude-plugin', 'plugin.json'));
    const res = runInstaller(scratch, ['--copy', '--force'], fakePlugin);
    assert.strictEqual(res.status, 0, `${res.stdout}\n${res.stderr}`);
    const receipt = JSON.parse(fs.readFileSync(path.join(scratch, '.codex', '.dhpk-installed.json'), 'utf8'));
    assert.deepStrictEqual(receipt.managed_entries.skills, {});
    assert.ok(Object.keys(receipt.managed_entries.agents).length > 0);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(fakePlugin, { recursive: true, force: true });
  }
});

test('copy mode excludes ignored Python bytecode from projection and fingerprints', () => {
  const scratch = projectRoot();
  const fakePlugin = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-ics-bytecode-plugin-')));
  const bytecodeDir = path.join(
    fakePlugin,
    'codex',
    'skills',
    'harness-govern',
    'scripts',
    'multi_ai_sync_lib',
    '__pycache__',
  );
  const bytecode = path.join(bytecodeDir, 'fixture.pyc');
  const standaloneBytecode = path.join(
    fakePlugin,
    'codex',
    'skills',
    'harness-govern',
    'scripts',
    'multi_ai_sync_lib',
    'standalone-fixture.pyc',
  );
  try {
    fs.cpSync(path.join(ROOT, 'codex'), path.join(fakePlugin, 'codex'), { recursive: true, dereference: true });
    fs.mkdirSync(path.join(fakePlugin, '.claude-plugin'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), path.join(fakePlugin, '.claude-plugin', 'plugin.json'));
    copyDistributionInventory(fakePlugin);
    fs.mkdirSync(bytecodeDir, { recursive: true });
    fs.writeFileSync(bytecode, 'fixture-bytecode-v1\n');
    fs.writeFileSync(standaloneBytecode, 'standalone-bytecode-v1\n');

    const first = runInstaller(scratch, ['--copy', '--force'], fakePlugin);
    assert.strictEqual(first.status, 0, `${first.stdout}\n${first.stderr}`);
    const receiptPath = path.join(scratch, '.codex', '.dhpk-installed.json');
    const before = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    const copiedBytecode = path.join(
      scratch,
      '.codex',
      'skills',
      'harness-govern',
      'scripts',
      'multi_ai_sync_lib',
      '__pycache__',
      'fixture.pyc',
    );
    const copiedStandaloneBytecode = path.join(
      scratch,
      '.codex',
      'skills',
      'harness-govern',
      'scripts',
      'multi_ai_sync_lib',
      'standalone-fixture.pyc',
    );
    assert.ok(!fs.existsSync(copiedBytecode), 'copy mode must omit ignored Python bytecode');
    assert.ok(!fs.existsSync(copiedStandaloneBytecode), 'copy mode must omit standalone .pyc files');

    fs.writeFileSync(bytecode, 'fixture-bytecode-v2\n');
    fs.writeFileSync(standaloneBytecode, 'standalone-bytecode-v2\n');
    const second = runInstaller(scratch, ['--copy', '--update', '--force'], fakePlugin);
    assert.strictEqual(second.status, 0, `${second.stdout}\n${second.stderr}`);
    const after = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    assert.strictEqual(after.source_fingerprint, before.source_fingerprint,
      'ignored bytecode changes must not alter the source fingerprint');
    assert.ok(!fs.existsSync(copiedBytecode), 'update mode must continue omitting ignored Python bytecode');
    assert.ok(!fs.existsSync(copiedStandaloneBytecode), 'update mode must continue omitting standalone .pyc files');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(fakePlugin, { recursive: true, force: true });
  }
});

test('copy update cleans legacy bytecode while preserving receipt ownership', () => {
  const scratch = projectRoot();
  try {
    const first = runInstaller(scratch, ['--copy', '--force']);
    assert.strictEqual(first.status, 0, `${first.stdout}\n${first.stderr}`);
    const receiptPath = path.join(scratch, '.codex', '.dhpk-installed.json');
    const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    const skillTarget = path.join(scratch, '.codex', 'skills', 'harness-govern');
    const legacyBytecode = path.join(skillTarget, 'scripts', 'multi_ai_sync_lib', '__pycache__', 'legacy.pyc');
    fs.mkdirSync(path.dirname(legacyBytecode), { recursive: true });
    fs.writeFileSync(legacyBytecode, 'legacy-bytecode\n');

    const entry = receipt.managed_entries.skills['harness-govern'];
    assert.ok(entry, 'expected the harness-govern receipt entry to exist');
    const legacyDestinationFingerprint = completeTreeFingerprint(skillTarget);
    entry.destination_fingerprint = legacyDestinationFingerprint;
    entry.fingerprint = legacyDestinationFingerprint;
    fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);

    const updated = runInstaller(scratch, ['--copy', '--update', '--force']);
    assert.strictEqual(updated.status, 0, `${updated.stdout}\n${updated.stderr}`);
    assert.ok(!fs.existsSync(legacyBytecode), 'legacy ignored bytecode must be removed by a managed update');
    const after = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    assert.strictEqual(after.reconciliation.state, 'current');
    assert.strictEqual(after.reconciliation.skipped_collision, 0);
    assert.ok(after.reconciliation.updated >= 1, 'legacy bytecode should trigger a clean destination refresh');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('symlink mode links the target and --update preserves edited copied content', () => {
  const scratch = projectRoot();
  try {
    const linked = runInstaller(scratch, ['--force']);
    assert.strictEqual(linked.status, 0, `${linked.stdout}\n${linked.stderr}`);
    const skillName = fs.readdirSync(path.join(scratch, '.codex', 'skills'))[0];
    assert.ok(fs.lstatSync(path.join(scratch, '.codex', 'skills', skillName)).isSymbolicLink());

    const copied = runInstaller(scratch, ['--copy', '--update', '--force']);
    assert.strictEqual(copied.status, 0, `${copied.stdout}\n${copied.stderr}`);
    const skillFile = path.join(scratch, '.codex', 'skills', skillName, 'SKILL.md');
    fs.writeFileSync(skillFile, 'stale target\n');
    const updated = runInstaller(scratch, ['--copy', '--update', '--force']);
    assert.notStrictEqual(updated.status, 0, `${updated.stdout}\n${updated.stderr}`);
    assert.match(`${updated.stdout}\n${updated.stderr}`, /--adopt/);
    assert.strictEqual(fs.readFileSync(skillFile, 'utf8'), 'stale target\n',
      'edited copied content must be preserved as a remaining collision, not overwritten');
    const manifest = JSON.parse(fs.readFileSync(path.join(scratch, '.codex', '.dhpk-installed.json'), 'utf8'));
    assert.strictEqual(manifest.mode, 'copy');
    assert.notStrictEqual(manifest.reconciliation.state, 'current');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('same plugin version but changed source content is not treated as up-to-date', () => {
  const scratch = projectRoot();
  const fakePlugin = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-ics-plugin-')));
  try {
    fs.cpSync(path.join(ROOT, 'codex'), path.join(fakePlugin, 'codex'), { recursive: true, dereference: true });
    fs.rmSync(path.join(fakePlugin, 'codex', 'skills'), { recursive: true, force: true });
    fs.cpSync(
      path.join(ROOT, 'skills', 'dhpk-tdd-workflow'),
      path.join(fakePlugin, 'codex', 'skills', 'dhpk-tdd-workflow'),
      { recursive: true, dereference: true }
    );
    fs.mkdirSync(path.join(fakePlugin, '.claude-plugin'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), path.join(fakePlugin, '.claude-plugin', 'plugin.json'));
    copyDistributionInventory(fakePlugin);
    const first = runInstaller(scratch, ['--copy', '--force'], fakePlugin);
    assert.strictEqual(first.status, 0, `${first.stdout}\n${first.stderr}`);

    const sourceFiles = [];
    function collect(dir) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fp = path.join(dir, entry.name);
        if (entry.isDirectory()) collect(fp);
        else if (entry.isFile()) sourceFiles.push(fp);
      }
    }
    collect(path.join(fakePlugin, 'codex', 'skills'));
    assert.ok(sourceFiles.length > 0, 'fixture plugin must contain a regular Codex skill file');
    const sourceFile = sourceFiles[0];
    fs.appendFileSync(sourceFile, '\nsource changed without version bump\n');
    const relative = path.relative(path.join(fakePlugin, 'codex', 'skills'), sourceFile);
    const targetFile = path.join(scratch, '.codex', 'skills', relative);
    const second = runInstaller(scratch, ['--copy', '--force'], fakePlugin);
    assert.strictEqual(second.status, 0, `${second.stdout}\n${second.stderr}`);
    assert.strictEqual(fs.readFileSync(targetFile, 'utf8'), fs.readFileSync(sourceFile, 'utf8'));
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(fakePlugin, { recursive: true, force: true });
  }
});

test('re-running without --update when version and source fingerprint are unchanged is a reported no-op', () => {
  const scratch = projectRoot();
  try {
    const first = runInstaller(scratch, ['--copy', '--force']);
    assert.strictEqual(first.status, 0, `${first.stdout}\n${first.stderr}`);
    const manifestPath = path.join(scratch, '.codex', '.dhpk-installed.json');
    const before = fs.readFileSync(manifestPath, 'utf8');

    // No --update this time — the idempotency check should short-circuit
    // before touching .codex/ at all.
    const second = runInstaller(scratch, ['--copy']);
    assert.strictEqual(second.status, 0, `${second.stdout}\n${second.stderr}`);
    assert.match(second.stdout, /already up-to-date/);
    assert.strictEqual(fs.readFileSync(manifestPath, 'utf8'), before, 'manifest must be untouched by a reported no-op run');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('--update does not back up unchanged receipt-owned destinations', () => {
  const scratch = projectRoot();
  try {
    const first = runInstaller(scratch, ['--copy', '--force']);
    assert.strictEqual(first.status, 0, `${first.stdout}\n${first.stderr}`);
    const second = runInstaller(scratch, ['--copy', '--update', '--force']);
    assert.strictEqual(second.status, 0, `${second.stdout}\n${second.stderr}`);
    const manifest = JSON.parse(fs.readFileSync(path.join(scratch, '.codex', '.dhpk-installed.json'), 'utf8'));
    assert.strictEqual(manifest.reconciliation.updated, 0, JSON.stringify(manifest.reconciliation));
    assert.strictEqual(manifest.reconciliation.backed_up, 0, JSON.stringify(manifest.reconciliation));
    assert.deepStrictEqual(manifest.reconciliation.evidence.backups, []);
    assert.strictEqual(manifest.reconciliation.state, 'current');
    assert.strictEqual(manifest.reconciliation.complete, true);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('managed-target replacement: re-sync replaces a dhpk-managed target regardless of whether it is currently a file or a symlink', () => {
  const scratch = projectRoot();
  try {
    const symlinked = runInstaller(scratch, ['--force']);
    assert.strictEqual(symlinked.status, 0, `${symlinked.stdout}\n${symlinked.stderr}`);
    const skillName = fs.readdirSync(path.join(scratch, '.codex', 'skills'))[0];
    const target = path.join(scratch, '.codex', 'skills', skillName);
    assert.ok(fs.lstatSync(target).isSymbolicLink(), 'first sync (symlink mode) must produce a symlink target');

    // Switching to copy --update must replace that exact managed symlink
    // target with a real materialized directory, not merge into it or fail
    // because a symlink already occupies the path.
    const copied = runInstaller(scratch, ['--copy', '--update', '--force']);
    assert.strictEqual(copied.status, 0, `${copied.stdout}\n${copied.stderr}`);
    assert.ok(!fs.lstatSync(target).isSymbolicLink(), 'copy --update must replace the prior symlink target with a real directory');
    assert.ok(fs.existsSync(path.join(target, 'SKILL.md')), 'replaced managed target must contain real skill content');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('hybrid mode adopts a new plugin root while keeping agent roles physical', () => {
  const scratch = projectRoot();
  const firstPlugin = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-ics-plugin-v1-')));
  const secondPlugin = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-ics-plugin-v2-')));
  const preparePlugin = (plugin) => {
    fs.cpSync(path.join(ROOT, 'codex'), path.join(plugin, 'codex'), { recursive: true, dereference: true });
    fs.mkdirSync(path.join(plugin, '.claude-plugin'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), path.join(plugin, '.claude-plugin', 'plugin.json'));
    copyDistributionInventory(plugin);
  };
  try {
    preparePlugin(firstPlugin);
    preparePlugin(secondPlugin);
    const first = runInstaller(scratch, ['--force'], firstPlugin);
    assert.strictEqual(first.status, 0, `${first.stdout}\n${first.stderr}`);
    const skillName = fs.readdirSync(path.join(scratch, '.codex', 'skills'))[0];
    const skillTarget = path.join(scratch, '.codex', 'skills', skillName);
    const agentName = fs.readdirSync(path.join(scratch, '.codex', 'agents'))[0];
    const target = path.join(scratch, '.codex', 'agents', agentName);
    assert.strictEqual(fs.realpathSync(skillTarget), fs.realpathSync(path.join(firstPlugin, 'codex', 'skills', skillName)));
    assert.ok(fs.lstatSync(target).isFile(), 'agent role must be a physical file');
    const secondAgent = path.join(secondPlugin, 'codex', 'agents', agentName);
    fs.appendFileSync(secondAgent, '\n# second plugin source\n');
    const second = runInstaller(scratch, ['--update', '--force'], secondPlugin);
    assert.strictEqual(second.status, 0, `${second.stdout}\n${second.stderr}`);
    assert.strictEqual(fs.realpathSync(skillTarget), fs.realpathSync(path.join(secondPlugin, 'codex', 'skills', skillName)));
    assert.ok(fs.lstatSync(target).isFile(), 'updated agent role must remain a physical file');
    assert.strictEqual(fs.readFileSync(target, 'utf8'), fs.readFileSync(secondAgent, 'utf8'));
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(firstPlugin, { recursive: true, force: true });
    fs.rmSync(secondPlugin, { recursive: true, force: true });
  }
});

test('path-safe install handles apostrophes in plugin and project roots', () => {
  const baseProject = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-ics-apostrophe-project-')));
  const basePlugin = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-ics-apostrophe-plugin-')));
  const scratch = `${baseProject}'project`;
  const fakePlugin = `${basePlugin}'plugin`;
  fs.renameSync(baseProject, scratch);
  fs.renameSync(basePlugin, fakePlugin);
  fs.mkdirSync(path.join(scratch, '.git'));
  try {
    fs.cpSync(path.join(ROOT, 'codex'), path.join(fakePlugin, 'codex'), { recursive: true, dereference: true });
    fs.mkdirSync(path.join(fakePlugin, '.claude-plugin'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), path.join(fakePlugin, '.claude-plugin', 'plugin.json'));
    copyDistributionInventory(fakePlugin);
    const first = runInstaller(scratch, ['--copy', '--force'], fakePlugin);
    assert.strictEqual(first.status, 0, `${first.stdout}\n${first.stderr}`);
    const second = runInstaller(scratch, ['--copy'], fakePlugin);
    assert.strictEqual(second.status, 0, `${second.stdout}\n${second.stderr}`);
    assert.match(second.stdout, /already up-to-date/);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(fakePlugin, { recursive: true, force: true });
  }
});

test('inventory supporting sources reject unsafe paths before materialization', () => {
  const scratch = projectRoot();
  const fakePlugin = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-ics-inventory-')));
  try {
    fs.cpSync(path.join(ROOT, 'codex'), path.join(fakePlugin, 'codex'), { recursive: true, dereference: true });
    fs.mkdirSync(path.join(fakePlugin, '.claude-plugin'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), path.join(fakePlugin, '.claude-plugin', 'plugin.json'));
    copyDistributionInventory(fakePlugin);
    fs.mkdirSync(path.join(fakePlugin, 'manifests'), { recursive: true });
    fs.writeFileSync(path.join(fakePlugin, 'private.txt'), 'must not escape the mapped file boundary\n');
    for (const source of ['.', 'codex\\supporting']) {
      const inventory = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests', 'distribution-inventory.json'), 'utf8'));
      inventory.supporting_assets = [{ id: 'bad-source', source, destination: 'dhpk/root-copy' }];
      fs.writeFileSync(path.join(fakePlugin, 'manifests', 'distribution-inventory.json'), JSON.stringify(inventory));
      const res = runInstaller(scratch, ['--copy', '--force'], fakePlugin);
      assert.notStrictEqual(res.status, 0, `${source}: ${res.stdout}\n${res.stderr}`);
      assert.ok(!fs.existsSync(path.join(scratch, '.codex', 'dhpk', 'root-copy', 'private.txt')),
        `${source} must never copy outside the mapped file boundary`);
    }
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(fakePlugin, { recursive: true, force: true });
  }
});

test('fresh sync preserves an unowned copy collision and continues with other entries', () => {
  const scratch = projectRoot();
  try {
    const skillName = fs.readdirSync(path.join(ROOT, 'codex', 'skills'))[0];
    const target = path.join(scratch, '.codex', 'skills', skillName);
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, 'user-owned.txt'), 'keep me\n');
    const res = runInstaller(scratch, ['--copy', '--force']);
    assert.strictEqual(res.status, 0, `${res.stdout}\n${res.stderr}`);
    assert.match(`${res.stdout}\n${res.stderr}`, /collision/i);
    assert.strictEqual(fs.readFileSync(path.join(target, 'user-owned.txt'), 'utf8'), 'keep me\n');
    const manifest = JSON.parse(fs.readFileSync(path.join(scratch, '.codex', '.dhpk-installed.json'), 'utf8'));
    assert.ok(!manifest.managed_entries.skills[skillName], 'unowned collision must not enter receipt inventory');
    const other = Object.keys(manifest.managed_entries.skills).find((name) => name !== skillName);
    assert.ok(other, 'non-conflicting skill should still be installed');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('fresh sync beside generic global skill names installs public dhpk names without creating aliases', () => {
  const scratch = projectRoot();
  try {
    const generic = path.join(scratch, '.codex', 'skills', 'tdd');
    fs.mkdirSync(generic, { recursive: true });
    fs.writeFileSync(path.join(generic, 'global.md'), 'Matt/global skill\n');
    const res = runInstaller(scratch, ['--copy', '--force']);
    assert.strictEqual(res.status, 0, `${res.stdout}\n${res.stderr}`);
    assert.strictEqual(fs.readFileSync(path.join(generic, 'global.md'), 'utf8'), 'Matt/global skill\n');
    assert.ok(fs.existsSync(path.join(scratch, '.codex', 'skills', 'dhpk-tdd-workflow', 'SKILL.md')));
    assert.ok(!fs.existsSync(path.join(scratch, '.codex', 'skills', 'tdd', 'SKILL.md')));
    assert.match(`${res.stdout}\n${res.stderr}`, /legacy conflict|collision/i);
    const receipt = JSON.parse(fs.readFileSync(path.join(scratch, '.codex', '.dhpk-installed.json'), 'utf8'));
    assert.ok(!receipt.managed_entries.skills.tdd, 'generic legacy alias must never enter the dhpk receipt');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('a resolved collision is retried on the next idempotent sync', () => {
  const scratch = projectRoot();
  try {
    const skillName = fs.readdirSync(path.join(ROOT, 'codex', 'skills'))[0];
    const target = path.join(scratch, '.codex', 'skills', skillName);
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, 'user-owned.txt'), 'resolve me\n');
    const first = runInstaller(scratch, ['--copy', '--force']);
    assert.strictEqual(first.status, 0, `${first.stdout}\n${first.stderr}`);
    fs.rmSync(target, { recursive: true, force: true });
    const second = runInstaller(scratch, ['--copy', '--force']);
    assert.strictEqual(second.status, 0, `${second.stdout}\n${second.stderr}`);
    assert.ok(fs.existsSync(path.join(target, 'SKILL.md')));
    const manifest = JSON.parse(fs.readFileSync(path.join(scratch, '.codex', '.dhpk-installed.json'), 'utf8'));
    assert.ok(manifest.managed_entries.skills[skillName]);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('legacy receipt and unowned symlink are fail-closed until explicit --migrate --update', () => {
  const scratch = projectRoot();
  const external = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-ics-external-')));
  try {
    const skillName = fs.readdirSync(path.join(ROOT, 'codex', 'skills'))[0];
    const target = path.join(scratch, '.codex', 'skills', skillName);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.symlinkSync(external, target, 'dir');
    fs.writeFileSync(path.join(scratch, '.codex', '.dhpk-installed.json'), JSON.stringify({
      plugin_version: '0.1.0', mode: 'symlink', installed_at: '2020-01-01T00:00:00Z',
    }));
    const before = fs.readFileSync(path.join(scratch, '.codex', '.dhpk-installed.json'), 'utf8');
    const res = runInstaller(scratch, ['--force']);
    assert.notStrictEqual(res.status, 0, `${res.stdout}\n${res.stderr}`);
    assert.match(`${res.stdout}\n${res.stderr}`, /stale.*receipt|STALE_RECEIPT/i);
    assert.match(`${res.stdout}\n${res.stderr}`, /--migrate --update/);
    assert.ok(fs.lstatSync(target).isSymbolicLink());
    assert.strictEqual(fs.realpathSync(target), external);
    assert.strictEqual(fs.readFileSync(path.join(scratch, '.codex', '.dhpk-installed.json'), 'utf8'), before);
    const migrated = runInstaller(scratch, ['--migrate', '--update', '--force']);
    assert.notStrictEqual(migrated.status, 0, `${migrated.stdout}\n${migrated.stderr}`);
    assert.match(`${migrated.stdout}\n${migrated.stderr}`, /--adopt/);
    const manifest = JSON.parse(fs.readFileSync(path.join(scratch, '.codex', '.dhpk-installed.json'), 'utf8'));
    assert.strictEqual(manifest.schema_version, 3);
    assert.ok(!manifest.managed_entries.skills[skillName]);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(external, { recursive: true, force: true });
  }
});

test('--update prunes only unchanged removed sources and preserves edited/unrelated targets', () => {
  const scratch = projectRoot();
  const fakePlugin = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-ics-prune-plugin-')));
  try {
    fs.cpSync(path.join(ROOT, 'codex'), path.join(fakePlugin, 'codex'), { recursive: true, dereference: true });
    fs.mkdirSync(path.join(fakePlugin, '.claude-plugin'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), path.join(fakePlugin, '.claude-plugin', 'plugin.json'));
    copyDistributionInventory(fakePlugin);
    const first = runInstaller(scratch, ['--copy', '--force'], fakePlugin);
    assert.strictEqual(first.status, 0, `${first.stdout}\n${first.stderr}`);
    const skills = fs.readdirSync(path.join(fakePlugin, 'codex', 'skills'));
    assert.ok(skills.length >= 3, 'fixture needs at least three skills');
    const removed = skills[0];
    const edited = skills[1];
    const unrelated = 'project-owned-skill';
    fs.rmSync(path.join(fakePlugin, 'codex', 'skills', removed), { recursive: true, force: true });
    const editedTarget = path.join(scratch, '.codex', 'skills', edited);
    fs.writeFileSync(path.join(editedTarget, 'user-edit.txt'), 'edited\n');
    const unrelatedTarget = path.join(scratch, '.codex', 'skills', unrelated);
    fs.mkdirSync(unrelatedTarget, { recursive: true });
    fs.writeFileSync(path.join(unrelatedTarget, 'keep.txt'), 'keep\n');
    const updated = runInstaller(scratch, ['--copy', '--update', '--force'], fakePlugin);
    assert.notStrictEqual(updated.status, 0, `${updated.stdout}\n${updated.stderr}`);
    assert.match(`${updated.stdout}\n${updated.stderr}`, /--adopt/);
    assert.match(`${updated.stdout}\n${updated.stderr}`, /pruned/i);
    assert.ok(!fs.existsSync(path.join(scratch, '.codex', 'skills', removed)), 'unchanged removed source should be pruned');
    assert.strictEqual(fs.readFileSync(path.join(editedTarget, 'user-edit.txt'), 'utf8'), 'edited\n');
    assert.strictEqual(fs.readFileSync(path.join(unrelatedTarget, 'keep.txt'), 'utf8'), 'keep\n');
    const manifest = JSON.parse(fs.readFileSync(path.join(scratch, '.codex', '.dhpk-installed.json'), 'utf8'));
    assert.ok(!manifest.managed_entries.skills[removed]);
    assert.ok(manifest.managed_entries.skills[edited]);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(fakePlugin, { recursive: true, force: true });
  }
});

test('--migrate adopts exact legacy copies but never overwrites mismatches', () => {
  const scratch = projectRoot();
  try {
    const skillName = fs.readdirSync(path.join(ROOT, 'codex', 'skills'))[0];
    const source = path.join(ROOT, 'codex', 'skills', skillName);
    const exactTarget = path.join(scratch, '.codex', 'skills', skillName);
    fs.mkdirSync(path.dirname(exactTarget), { recursive: true });
    fs.cpSync(source, exactTarget, { recursive: true, dereference: true });
    const mismatch = fs.readdirSync(path.join(ROOT, 'codex', 'skills'))[1];
    const mismatchTarget = path.join(scratch, '.codex', 'skills', mismatch);
    fs.mkdirSync(mismatchTarget, { recursive: true });
    fs.writeFileSync(path.join(mismatchTarget, 'user-owned.txt'), 'do not replace\n');
    fs.writeFileSync(path.join(scratch, '.codex', '.dhpk-installed.json'), JSON.stringify({
      plugin_version: 'legacy', mode: 'copy', installed_at: '2020-01-01T00:00:00Z',
    }));
    const res = runInstaller(scratch, ['--copy', '--migrate', '--force']);
    assert.strictEqual(res.status, 0, `${res.stdout}\n${res.stderr}`);
    const manifest = JSON.parse(fs.readFileSync(path.join(scratch, '.codex', '.dhpk-installed.json'), 'utf8'));
    assert.strictEqual(manifest.schema_version, 3);
    assert.ok(manifest.managed_entries.skills[skillName], 'exact source match should be adopted');
    assert.ok(!manifest.managed_entries.skills[mismatch], 'mismatched legacy destination must remain unowned');
    assert.strictEqual(fs.readFileSync(path.join(mismatchTarget, 'user-owned.txt'), 'utf8'), 'do not replace\n');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('legacy migration remains available after stale inspection', () => {
  const scratch = projectRoot();
  try {
    const skillName = fs.readdirSync(path.join(ROOT, 'codex', 'skills'))[0];
    const source = path.join(ROOT, 'codex', 'skills', skillName);
    const target = path.join(scratch, '.codex', 'skills', skillName);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.cpSync(source, target, { recursive: true, dereference: true });
    fs.writeFileSync(path.join(scratch, '.codex', '.dhpk-installed.json'), JSON.stringify({
      plugin_version: 'legacy', mode: 'copy', installed_at: '2020-01-01T00:00:00Z',
    }));
    const normal = runInstaller(scratch, ['--copy', '--force']);
    assert.notStrictEqual(normal.status, 0, `${normal.stdout}\n${normal.stderr}`);
    assert.match(`${normal.stdout}\n${normal.stderr}`, /stale.*receipt|STALE_RECEIPT/i);
    const migrated = runInstaller(scratch, ['--copy', '--migrate', '--update', '--force']);
    assert.strictEqual(migrated.status, 0, `${migrated.stdout}\n${migrated.stderr}`);
    const manifest = JSON.parse(fs.readFileSync(path.join(scratch, '.codex', '.dhpk-installed.json'), 'utf8'));
    assert.ok(manifest.managed_entries.skills[skillName], 'exact legacy copy should become receipt-owned after explicit migration');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('--migrate renames a receipt-owned unchanged legacy skill destination to its current public name', () => {
  const scratch = projectRoot();
  const fakePlugin = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-ics-legacy-rename-plugin-')));
  try {
    fs.cpSync(path.join(ROOT, 'codex'), path.join(fakePlugin, 'codex'), { recursive: true, dereference: true });
    for (const name of fs.readdirSync(path.join(fakePlugin, 'codex', 'skills'))) {
      if (name !== 'dhpk-tdd-workflow') fs.rmSync(path.join(fakePlugin, 'codex', 'skills', name), { recursive: true, force: true });
    }
    fs.mkdirSync(path.join(fakePlugin, '.claude-plugin'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), path.join(fakePlugin, '.claude-plugin', 'plugin.json'));
    fs.mkdirSync(path.join(fakePlugin, 'manifests'), { recursive: true });
    fs.writeFileSync(path.join(fakePlugin, 'manifests', 'distribution-inventory.json'), JSON.stringify({
      skills: [{
        id: 'tdd',
        name: 'dhpk-tdd-workflow',
        legacy_names: ['tdd'],
        lifecycle: 'promoted',
        surfaces: ['codex-sync'],
      }],
      supporting_assets: [],
    }));

    const first = runInstaller(scratch, ['--copy', '--force'], fakePlugin);
    assert.strictEqual(first.status, 0, `${first.stdout}\n${first.stderr}`);
    const receiptPath = path.join(scratch, '.codex', '.dhpk-installed.json');
    const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    const currentName = 'dhpk-tdd-workflow';
    const legacyName = 'tdd';
    const currentEntry = receipt.managed_entries.skills[currentName];
    assert.ok(currentEntry, `expected initial receipt entry for ${currentName}`);
    fs.renameSync(
      path.join(scratch, '.codex', 'skills', currentName),
      path.join(scratch, '.codex', 'skills', legacyName)
    );
    const legacyBytecode = path.join(
      scratch,
      '.codex',
      'skills',
      legacyName,
      'scripts',
      'multi_ai_sync_lib',
      '__pycache__',
      'legacy.pyc',
    );
    fs.mkdirSync(path.dirname(legacyBytecode), { recursive: true });
    fs.writeFileSync(legacyBytecode, 'legacy-bytecode\n');
    delete receipt.managed_entries.skills[currentName];
    currentEntry.destination = `skills/${legacyName}`;
    currentEntry.source = `skills/${legacyName}`;
    currentEntry.ownership_marker = `copy:skills/${legacyName}`;
    currentEntry.destination_fingerprint = completeTreeFingerprint(
      path.join(scratch, '.codex', 'skills', legacyName),
    );
    currentEntry.fingerprint = currentEntry.destination_fingerprint;
    receipt.schema_version = 2;
    receipt.plugin_version = 'legacy';
    receipt.source_fingerprint = 'legacy';
    receipt.managed_entries.skills[legacyName] = currentEntry;
    fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);

    const migrated = runInstaller(scratch, ['--copy', '--migrate', '--force'], fakePlugin);
    assert.strictEqual(migrated.status, 0, `${migrated.stdout}\n${migrated.stderr}`);
    assert.ok(!fs.existsSync(path.join(scratch, '.codex', 'skills', legacyName)), 'unchanged legacy destination must be removed');
    assert.ok(!fs.existsSync(legacyBytecode), 'legacy migration must not preserve ignored bytecode');
    assert.ok(fs.existsSync(path.join(scratch, '.codex', 'skills', currentName, 'SKILL.md')));
    const after = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    assert.strictEqual(after.schema_version, 3);
    const entry = after.managed_entries.skills[currentName];
    assert.ok(entry, 'current public name must own the migrated destination');
    assert.strictEqual(entry.id, 'tdd');
    assert.strictEqual(entry.name, currentName);
    assert.strictEqual(entry.destination, `skills/${currentName}`);
    assert.strictEqual(after.reconciliation.state, 'current');
    assert.strictEqual(after.reconciliation.skipped_collision, 0);
    assert.ok(!after.managed_entries.skills[legacyName]);
    assert.match(`${migrated.stdout}\n${migrated.stderr}`, /migrat|updated/i);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(fakePlugin, { recursive: true, force: true });
  }
});

test('pre-consolidation receipts report an explicit stale state and stay untouched until migration/update', () => {
  const scratch = projectRoot();
  try {
    const first = runInstaller(scratch, ['--copy', '--force']);
    assert.strictEqual(first.status, 0, `${first.stdout}\n${first.stderr}`);
    const receiptPath = path.join(scratch, '.codex', '.dhpk-installed.json');
    const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    const currentName = 'dhpk-tdd-workflow';
    const legacyName = 'tdd';
    const currentTarget = path.join(scratch, '.codex', 'skills', currentName);
    const legacyTarget = path.join(scratch, '.codex', 'skills', legacyName);
    const currentEntry = receipt.managed_entries.skills[currentName];
    assert.ok(currentEntry, `expected initial receipt entry for ${currentName}`);

    fs.renameSync(currentTarget, legacyTarget);
    delete receipt.managed_entries.skills[currentName];
    currentEntry.destination = `skills/${legacyName}`;
    currentEntry.source = `skills/${legacyName}`;
    currentEntry.ownership_marker = `copy:skills/${legacyName}`;
    receipt.managed_entries.skills[legacyName] = currentEntry;
    receipt.schema_version = 2;
    receipt.plugin_version = 'pre-consolidation';
    receipt.source_fingerprint = 'pre-consolidation-fingerprint';
    fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
    const before = fs.readFileSync(receiptPath, 'utf8');

    const blocked = runInstaller(scratch, ['--copy', '--force']);
    assert.notStrictEqual(blocked.status, 0, `${blocked.stdout}\n${blocked.stderr}`);
    assert.match(`${blocked.stdout}\n${blocked.stderr}`, /stale.*receipt|STALE_RECEIPT/i);
    assert.match(`${blocked.stdout}\n${blocked.stderr}`, /--migrate --update/);
    assert.strictEqual(fs.readFileSync(receiptPath, 'utf8'), before,
      'stale inspection must not rewrite the receipt before explicit migration');
    assert.ok(fs.existsSync(legacyTarget), 'legacy destination must remain recoverable while stale');
    assert.ok(!fs.existsSync(currentTarget), 'canonical destination must not be created during stale inspection');

    const migrated = runInstaller(scratch, ['--copy', '--migrate', '--update', '--force']);
    assert.strictEqual(migrated.status, 0, `${migrated.stdout}\n${migrated.stderr}`);
    assert.ok(fs.existsSync(path.join(currentTarget, 'SKILL.md')));
    assert.ok(!fs.existsSync(legacyTarget));
    const after = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    assert.strictEqual(after.schema_version, 3);
    assert.strictEqual(after.reconciliation.state, 'current');
    assert.strictEqual(after.reconciliation.complete, true);
    assert.ok(after.reconciliation.migrated >= 1);
    assert.ok(JSON.stringify(after.reconciliation.evidence).includes('skills/tdd'));
    assert.ok(JSON.stringify(after.reconciliation.evidence).includes('skills/dhpk-tdd-workflow'));
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('reconciliation evidence records updates, retired entries, backups, and unowned collisions without overwriting', () => {
  const scratch = projectRoot();
  const fakePlugin = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-ics-evidence-plugin-')));
  try {
    fs.cpSync(path.join(ROOT, 'codex'), path.join(fakePlugin, 'codex'), { recursive: true, dereference: true });
    fs.mkdirSync(path.join(fakePlugin, '.claude-plugin'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), path.join(fakePlugin, '.claude-plugin', 'plugin.json'));
    copyDistributionInventory(fakePlugin);

    const first = runInstaller(scratch, ['--copy', '--force'], fakePlugin);
    assert.strictEqual(first.status, 0, `${first.stdout}\n${first.stderr}`);
    const inventoryPath = path.join(fakePlugin, 'manifests', 'distribution-inventory.json');
    const inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
    const codexRuntimeNames = new Set((inventory.internal_runtime_skills['codex-native'] || [])
      .map((stableId) => inventory.skills.find((entry) => entry.id === stableId))
      .filter(Boolean)
      .map((entry) => entry.name));
    const sourceSkills = fs.readdirSync(path.join(fakePlugin, 'codex', 'skills'))
      .filter((name) => name.startsWith('dhpk-') && !codexRuntimeNames.has(name))
      .sort();
    assert.ok(sourceSkills.length >= 4, 'fixture needs owned/modified retired, updated, and colliding skills');
    const retired = sourceSkills[0];
    const modifiedRetired = sourceSkills[1];
    const updated = sourceSkills[2];
    const collision = sourceSkills[3];
    fs.rmSync(path.join(fakePlugin, 'codex', 'skills', retired), { recursive: true, force: true });
    fs.rmSync(path.join(fakePlugin, 'codex', 'skills', modifiedRetired), { recursive: true, force: true });

    const retiredRows = inventory.skills.filter((entry) => entry.name === retired || entry.name === modifiedRetired);
    inventory.skills = inventory.skills.filter((entry) => entry.name !== retired && entry.name !== modifiedRetired);
    inventory.retired_skills = retiredRows.map((entry) => ({
      id: entry.id,
      name: entry.name,
      canonicalPath: entry.path,
      retiredIn: '0.47.0',
      reasonCode: 'test-retirement',
      priorSurfaces: entry.surfaces,
      replacements: [{ kind: 'skill', id: 'tdd', mode: 'test-successor' }],
      rollback: { release: '0.46.1' },
    }));
    fs.writeFileSync(inventoryPath, `${JSON.stringify(inventory, null, 2)}\n`);

    const modifiedRetiredTarget = path.join(scratch, '.codex', 'skills', modifiedRetired);
    const retiredUserMarker = path.join(modifiedRetiredTarget, 'user-retired-edit.txt');
    fs.writeFileSync(retiredUserMarker, 'preserve retired edit\n');
    const updatedPath = path.join(fakePlugin, 'codex', 'skills', updated);
    if (fs.lstatSync(updatedPath).isSymbolicLink()) {
      fs.rmSync(updatedPath, { recursive: true, force: true });
      fs.cpSync(path.join(ROOT, 'skills', updated), updatedPath, { recursive: true, dereference: true });
    }
    fs.appendFileSync(path.join(updatedPath, 'SKILL.md'), '\nsource update for evidence\n');

    const receiptPath = path.join(scratch, '.codex', '.dhpk-installed.json');
    const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    delete receipt.managed_entries.skills[collision];
    fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
    const collisionTarget = path.join(scratch, '.codex', 'skills', collision);
    const userMarker = path.join(collisionTarget, 'user-owned.txt');
    fs.writeFileSync(userMarker, 'do not overwrite\n');

    const receiptBeforePlan = fs.readFileSync(receiptPath, 'utf8');
    const planRun = runInstaller(scratch, ['--copy', '--update', '--plan', '--json', '--force'], fakePlugin);
    assert.notStrictEqual(planRun.status, 0, 'plan remains non-pass while an unowned collision requires adoption');
    const plan = JSON.parse(planRun.stdout);
    for (const name of [retired, modifiedRetired]) {
      const item = plan.retired.find((entry) => entry.name === name);
      assert.ok(item, `missing retired plan row for ${name}`);
      assert.strictEqual(item.retirement.retiredIn, '0.47.0');
      assert.strictEqual(item.retirement.reasonCode, 'test-retirement');
      assert.deepStrictEqual(item.retirement.replacements, [{ kind: 'skill', id: 'tdd', mode: 'test-successor' }]);
    }
    assert.strictEqual(fs.readFileSync(receiptPath, 'utf8'), receiptBeforePlan, 'retirement plan must not mutate receipt');
    assert.strictEqual(fs.readFileSync(retiredUserMarker, 'utf8'), 'preserve retired edit\n', 'retirement plan must not mutate destination');

    const updatedRun = runInstaller(scratch, ['--copy', '--update', '--force'], fakePlugin);
    assert.notStrictEqual(updatedRun.status, 0, `${updatedRun.stdout}\n${updatedRun.stderr}`);
    assert.match(`${updatedRun.stdout}\n${updatedRun.stderr}`, /--adopt/);
    assert.strictEqual(fs.readFileSync(userMarker, 'utf8'), 'do not overwrite\n');
    assert.ok(!fs.existsSync(path.join(scratch, '.codex', 'skills', retired)), 'unchanged receipt-owned retired entry must prune');
    assert.strictEqual(fs.readFileSync(retiredUserMarker, 'utf8'), 'preserve retired edit\n', 'modified retired entry must be preserved');
    const after = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    const reconciliation = after.reconciliation;
    assert.ok(reconciliation.updated >= 1, JSON.stringify(reconciliation));
    assert.ok(reconciliation.retired >= 1, JSON.stringify(reconciliation));
    assert.ok(reconciliation.backed_up >= 1, JSON.stringify(reconciliation));
    assert.ok(reconciliation.skipped_collision >= 1, JSON.stringify(reconciliation));
    assert.ok(reconciliation.collided >= 1, JSON.stringify(reconciliation));
    assert.strictEqual(reconciliation.state, 'partial');
    assert.strictEqual(reconciliation.complete, false);
    const evidence = reconciliation.evidence;
    assert.strictEqual(evidence.paths.destination_root, '.codex');
    assert.ok(evidence.paths.updated.includes(`skills/${updated}`));
    assert.ok(evidence.paths.retired.includes(`skills/${retired}`));
    assert.ok(evidence.paths.collisions.includes(`skills/${collision}`));
    assert.ok(evidence.fingerprints.source);
    assert.ok(evidence.fingerprints.destinations[`skills/${updated}`]);
    assert.ok(evidence.backups.length >= 1);
    for (const backup of evidence.backups) {
      assert.ok(backup.path && backup.path.startsWith('.codex/.dhpk-backups/'), JSON.stringify(backup));
      assert.match(backup.path, /^\.codex\/\.dhpk-backups\/\d{8}T\d{6}Z-\d+\/.+$/, JSON.stringify(backup));
      assert.ok(fs.existsSync(path.join(scratch, backup.path)), `backup path missing: ${backup.path}`);
    }
    assert.ok(!after.managed_entries.skills[collision], 'unowned collision must remain outside receipt ownership');
    assert.ok(after.orphaned_entries[`skills/${modifiedRetired}`], 'modified retired path must be receipt-tracked as orphaned');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(fakePlugin, { recursive: true, force: true });
  }
});

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

test('--plan --json reports collision evidence without mutating projection or receipt', () => {
  const fixture = collisionFixture();
  try {
    const beforeReceipt = fs.readFileSync(fixture.receiptPath, 'utf8');
    const beforeTarget = completeTreeFingerprint(fixture.target);
    const planned = runInstaller(fixture.scratch, ['--copy', '--update', '--plan', '--json', '--force'], fixture.fakePlugin);
    assert.notStrictEqual(planned.status, 0, `${planned.stdout}\n${planned.stderr}`);
    const report = JSON.parse(planned.stdout);
    const collision = report.collisions.find((entry) => entry.path === `skills/${fixture.collision}`);
    assert.ok(collision, planned.stdout);
    assert.strictEqual(collision.ownership, 'unowned-collision');
    assert.match(collision.source_fingerprint, /^[a-f0-9]{64}$/);
    assert.match(collision.destination_fingerprint, /^[a-f0-9]{64}$/);
    assert.strictEqual(report.receipt_state, 'partial');
    assert.strictEqual(report.reconciliation_state, 'partial');
    assert.strictEqual(
      collision.action,
      `--adopt=skills/${fixture.collision}@${collision.destination_fingerprint}@${collision.source_fingerprint}`,
    );
    assert.match(report.next_action, /--adopt/);
    assert.match(report.next_action, /source-fingerprint/);
    assert.strictEqual(fs.readFileSync(fixture.receiptPath, 'utf8'), beforeReceipt);
    assert.strictEqual(completeTreeFingerprint(fixture.target), beforeTarget);
  } finally {
    fs.rmSync(fixture.scratch, { recursive: true, force: true });
    fs.rmSync(fixture.fakePlugin, { recursive: true, force: true });
  }
});

test('--update without --adopt exits non-zero and preserves the unowned collision', () => {
  const fixture = collisionFixture();
  try {
    const beforeTarget = completeTreeFingerprint(fixture.target);
    const beforeReceipt = fs.readFileSync(fixture.receiptPath, 'utf8');
    const updated = runInstaller(fixture.scratch, ['--copy', '--update', '--force'], fixture.fakePlugin);
    assert.notStrictEqual(updated.status, 0, `${updated.stdout}\n${updated.stderr}`);
    assert.match(`${updated.stdout}\n${updated.stderr}`, /--adopt/);
    assert.match(`${updated.stdout}\n${updated.stderr}`, /collision preserved|unowned-collision|requires_adoption/i);
    assert.strictEqual(completeTreeFingerprint(fixture.target), beforeTarget);
    const receipt = JSON.parse(fs.readFileSync(fixture.receiptPath, 'utf8'));
    assert.ok(['partial', JSON.parse(beforeReceipt).state].includes(receipt.state));
    assert.notStrictEqual(receipt.state, 'current');
  } finally {
    fs.rmSync(fixture.scratch, { recursive: true, force: true });
    fs.rmSync(fixture.fakePlugin, { recursive: true, force: true });
  }
});

test('--plan --json reports a current projection without mutation', () => {
  const scratch = projectRoot();
  try {
    const first = runInstaller(scratch, ['--copy', '--force']);
    assert.strictEqual(first.status, 0, `${first.stdout}\n${first.stderr}`);
    const receiptPath = path.join(scratch, '.codex', '.dhpk-installed.json');
    const before = fs.readFileSync(receiptPath, 'utf8');
    const planned = runInstaller(scratch, ['--copy', '--update', '--plan', '--json', '--force']);
    assert.strictEqual(planned.status, 0, `${planned.stdout}\n${planned.stderr}`);
    const report = JSON.parse(planned.stdout);
    assert.strictEqual(report.state, 'current');
    assert.deepStrictEqual(report.collisions, []);
    assert.strictEqual(fs.readFileSync(receiptPath, 'utf8'), before);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

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

for (const drift of ['version', 'fingerprint', 'both']) {
  test(`metadata-only ${drift} provenance drift is stale, actionable, and read-only`, () => {
    const fixture = provenanceDriftPlanFixture(drift);
    try {
      assert.notStrictEqual(fixture.planned.status, 0,
        `provenance drift must not pass preflight: ${fixture.planned.stdout}\n${fixture.planned.stderr}`);
      const report = JSON.parse(fixture.planned.stdout);
      assert.strictEqual(report.state, 'stale');
      assert.strictEqual(report.receipt_state, 'current',
        'historical receipt state remains evidence but must not mask provenance drift');
      assert.deepStrictEqual(report.collisions, []);
      assert.deepStrictEqual(report.missing, []);
      assert.deepStrictEqual(report.updates, []);
      assert.deepStrictEqual(report.retired, []);
      assert.strictEqual(report.plugin_version, fixture.currentProvenance.pluginVersion);
      assert.strictEqual(report.source_fingerprint, fixture.currentProvenance.sourceFingerprint);
      assert.strictEqual(report.receipt_plugin_version, fixture.recordedProvenance.pluginVersion);
      assert.strictEqual(
        report.receipt_source_fingerprint,
        fixture.recordedProvenance.sourceFingerprint,
      );
      assert.ok(Array.isArray(report.reasons), JSON.stringify(report));
      if (drift === 'version' || drift === 'both') {
        assert.match(report.reasons.join('\n'), /receipt plugin version differs from source/);
      }
      if (drift === 'fingerprint' || drift === 'both') {
        assert.match(report.reasons.join('\n'), /receipt source fingerprint differs from the current Codex source/);
      }
      assert.match(report.next_action, /--migrate --update/);
      assert.strictEqual(fs.readFileSync(fixture.receiptPath, 'utf8'), fixture.before.receipt);
      assert.strictEqual(completeTreeFingerprint(fixture.codexRoot), fixture.before.projection);
      assert.deepStrictEqual(
        transactionMetadataSnapshot(fixture.codexRoot),
        fixture.before.transactionMetadata,
      );
    } finally {
      fs.rmSync(fixture.scratch, { recursive: true, force: true });
    }
  });
}

for (const nonFiniteLiteral of ['NaN', '1e10000']) {
  test(`non-finite receipt provenance ${nonFiniteLiteral} stays fail-closed with strict JSON plan output`, () => {
    const scratch = projectRoot();
    try {
      const first = runInstaller(scratch, ['--force']);
      assert.strictEqual(first.status, 0, `${first.stdout}\n${first.stderr}`);
      const codexRoot = path.join(scratch, '.codex');
      const receiptPath = path.join(codexRoot, '.dhpk-installed.json');
      const validReceipt = fs.readFileSync(receiptPath, 'utf8');
      const receiptBefore = validReceipt.replace(
        /"plugin_version": "[^"]+"/,
        `"plugin_version": ${nonFiniteLiteral}`,
      );
      assert.notStrictEqual(receiptBefore, validReceipt, 'fixture must replace plugin_version');
      fs.writeFileSync(receiptPath, receiptBefore);
      const projectionBefore = completeTreeFingerprint(codexRoot);
      const planned = runInstaller(scratch, ['--update', '--plan', '--json', '--force']);
      assert.notStrictEqual(planned.status, 0, planned.stdout);
      const report = JSON.parse(planned.stdout);
      assert.match(report.reasons.join('\n'), /invalid JSON/);
      assert.strictEqual(report.receipt_plugin_version, null);
      assert.strictEqual(fs.readFileSync(receiptPath, 'utf8'), receiptBefore);
      assert.strictEqual(completeTreeFingerprint(codexRoot), projectionBefore);
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  });
}

for (const drift of ['version', 'fingerprint', 'both']) {
  test(`explicit migration/update repairs ${drift} provenance drift`, () => {
    const fixture = provenanceDriftPlanFixture(drift);
    try {
      assert.notStrictEqual(fixture.planned.status, 0, fixture.planned.stdout);
      const beforeReceipt = JSON.parse(fixture.before.receipt);
      const beforeEntry = beforeReceipt.managed_entries.skills['dhpk-tdd-workflow'];
      const updated = runInstaller(fixture.scratch, ['--migrate', '--update', '--force']);
      assert.strictEqual(updated.status, 0, `${updated.stdout}\n${updated.stderr}`);
      const repaired = JSON.parse(fs.readFileSync(fixture.receiptPath, 'utf8'));
      const repairedEntry = repaired.managed_entries.skills['dhpk-tdd-workflow'];
      assert.strictEqual(repaired.plugin_version, fixture.currentProvenance.pluginVersion);
      assert.strictEqual(repaired.source_fingerprint, fixture.currentProvenance.sourceFingerprint);
      assert.strictEqual(repaired.mode, beforeReceipt.mode);
      assert.strictEqual(repairedEntry.mode, beforeEntry.mode);
      assert.strictEqual(repairedEntry.ownership_marker, beforeEntry.ownership_marker);

      const planned = runInstaller(fixture.scratch, [
        '--update', '--plan', '--json', '--force',
      ]);
      assert.strictEqual(planned.status, 0, `${planned.stdout}\n${planned.stderr}`);
      const report = JSON.parse(planned.stdout);
      assert.strictEqual(report.state, 'current');
      assert.deepStrictEqual(report.reasons, []);
      assert.deepStrictEqual(report.collisions, []);
      assert.deepStrictEqual(report.missing, []);
      assert.deepStrictEqual(report.updates, []);
      assert.deepStrictEqual(report.retired, []);
    } finally {
      fs.rmSync(fixture.scratch, { recursive: true, force: true });
    }
  });
}

test('--plan blocks on an interrupted transaction without recovering or mutating state', () => {
  const scratch = projectRoot();
  try {
    const first = runInstaller(scratch, ['--copy', '--force']);
    assert.strictEqual(first.status, 0, `${first.stdout}\n${first.stderr}`);
    const codexRoot = path.join(scratch, '.codex');
    const receiptPath = path.join(codexRoot, '.dhpk-installed.json');
    const target = path.join(codexRoot, 'skills', 'dhpk-tdd-workflow');
    const receiptBefore = fs.readFileSync(receiptPath, 'utf8');
    const targetBefore = completeTreeFingerprint(target);
    const receipt = JSON.parse(receiptBefore);
    const run = '20990101T000000Z-999999999';
    const journalPath = path.join(codexRoot, `.dhpk-transaction-${run}.json`);
    const journal = {
      run,
      pid: 2147483647,
      relative: `.dhpk-transaction-${run}.json`,
      phase: 'active',
      started: true,
      plugin_version: receipt.plugin_version,
      source_fingerprint: receipt.source_fingerprint,
      receipt_snapshot_present: true,
      receipt_snapshot: receipt,
      prunes: [],
      mutations: [],
      adoptions: [],
    };
    const journalBefore = `${JSON.stringify(journal, null, 2)}\n`;
    fs.writeFileSync(journalPath, journalBefore);

    const planned = runInstaller(scratch, ['--copy', '--update', '--plan', '--json', '--force']);
    assert.strictEqual(planned.status, 2, `${planned.stdout}\n${planned.stderr}`);
    const report = JSON.parse(planned.stdout);
    assert.strictEqual(report.state, 'blocked');
    assert.match(report.blocking_recovery.join('\n'), /interrupted transaction|recovery/i);
    assert.strictEqual(fs.readFileSync(receiptPath, 'utf8'), receiptBefore);
    assert.strictEqual(completeTreeFingerprint(target), targetBefore);
    assert.strictEqual(fs.readFileSync(journalPath, 'utf8'), journalBefore);

    const recovered = runInstaller(scratch, ['--copy', '--update', '--force']);
    assert.strictEqual(recovered.status, 0, `${recovered.stdout}\n${recovered.stderr}`);
    const recoveredJournal = JSON.parse(fs.readFileSync(journalPath, 'utf8'));
    assert.strictEqual(recoveredJournal.phase, 'rolled_back');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('--plan blocks on malformed terminal transaction metadata without mutation', () => {
  const scratch = projectRoot();
  try {
    const first = runInstaller(scratch, ['--copy', '--force']);
    assert.strictEqual(first.status, 0, `${first.stdout}\n${first.stderr}`);
    const codexRoot = path.join(scratch, '.codex');
    const receiptPath = path.join(codexRoot, '.dhpk-installed.json');
    const target = path.join(codexRoot, 'skills', 'dhpk-tdd-workflow');
    const receiptBefore = fs.readFileSync(receiptPath, 'utf8');
    const targetBefore = completeTreeFingerprint(target);
    const run = '20990101T000001Z-999999998';
    const journalPath = path.join(codexRoot, `.dhpk-transaction-${run}.json`);
    const journalBefore = `${JSON.stringify({
      run: 'different-run',
      relative: `.dhpk-transaction-${run}.json`,
      phase: 'committed',
    }, null, 2)}\n`;
    fs.writeFileSync(journalPath, journalBefore);

    const planned = runInstaller(scratch, ['--copy', '--update', '--plan', '--json', '--force']);
    assert.strictEqual(planned.status, 2, `${planned.stdout}\n${planned.stderr}`);
    const report = JSON.parse(planned.stdout);
    assert.strictEqual(report.state, 'blocked');
    assert.match(report.blocking_recovery.join('\n'), /malformed|self-bound|metadata/i);
    assert.strictEqual(fs.readFileSync(receiptPath, 'utf8'), receiptBefore);
    assert.strictEqual(completeTreeFingerprint(target), targetBefore);
    assert.strictEqual(fs.readFileSync(journalPath, 'utf8'), journalBefore);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('explicit adoption backs up and receipt-owns only the selected collision', () => {
  const fixture = collisionFixture();
  try {
    const sibling = 'dhpk-tdd-workflow';
    const siblingTarget = path.join(fixture.scratch, '.codex', 'skills', sibling);
    const siblingBefore = completeTreeFingerprint(siblingTarget);
    const plan = runInstaller(fixture.scratch, ['--copy', '--update', '--plan', '--json', '--force'], fixture.fakePlugin);
    assert.notStrictEqual(plan.status, 0);
    const collision = JSON.parse(plan.stdout).collisions.find((entry) => entry.path === `skills/${fixture.collision}`);
    const adopted = runInstaller(fixture.scratch, [
      '--update', `--adopt=skills/${fixture.collision}@${collision.destination_fingerprint}@${collision.source_fingerprint}`, '--force',
    ], fixture.fakePlugin);
    assert.strictEqual(adopted.status, 0, `${adopted.stdout}\n${adopted.stderr}`);
    const receipt = JSON.parse(fs.readFileSync(fixture.receiptPath, 'utf8'));
    assert.ok(receipt.managed_entries.skills[fixture.collision]);
    assert.ok(!fs.existsSync(path.join(fixture.target, 'user-owned.txt')));
    assert.ok(receipt.reconciliation.adopted >= 1, JSON.stringify(receipt.reconciliation));
    assert.ok(receipt.reconciliation.evidence.paths.adopted.includes(`skills/${fixture.collision}`));
    assert.strictEqual(completeTreeFingerprint(siblingTarget), siblingBefore,
      'path-scoped adoption must not rewrite an unrelated managed sibling');
    const backup = receipt.reconciliation.evidence.backups.find((item) => item.original === `skills/${fixture.collision}`);
    assert.ok(backup, JSON.stringify(receipt.reconciliation.evidence.backups));
    assert.strictEqual(backup.reason, 'explicit-adoption');
    assert.ok(fs.existsSync(path.join(fixture.scratch, backup.path)), `backup path missing: ${backup.path}`);
    assert.strictEqual(fs.readFileSync(path.join(fixture.scratch, backup.path, 'user-owned.txt'), 'utf8'), 'keep me\n');
  } finally {
    fs.rmSync(fixture.scratch, { recursive: true, force: true });
    fs.rmSync(fixture.fakePlugin, { recursive: true, force: true });
  }
});

test('adoption journal recovers a crash after quarantine before retrying the selected collision', () => {
  const fixture = collisionFixture();
  try {
    const plan = runInstaller(fixture.scratch, ['--copy', '--update', '--plan', '--json', '--force'], fixture.fakePlugin);
    assert.notStrictEqual(plan.status, 0);
    const collision = JSON.parse(plan.stdout).collisions.find((entry) => entry.path === `skills/${fixture.collision}`);
    const crashed = runInstaller(fixture.scratch, [
      '--copy', '--update', `--adopt=skills/${fixture.collision}@${collision.destination_fingerprint}@${collision.source_fingerprint}`, '--force',
    ], fixture.fakePlugin, { DHPK_TEST_ABORT_ADOPTION_PHASE: 'quarantine' });
    assert.strictEqual(crashed.status, 73, `${crashed.stdout}\n${crashed.stderr}`);
    assert.ok(!fs.existsSync(fixture.target), 'crash point should leave the target quarantined for recovery');
    const retried = runInstaller(fixture.scratch, [
      '--copy', '--update', `--adopt=skills/${fixture.collision}@${collision.destination_fingerprint}@${collision.source_fingerprint}`, '--force',
    ], fixture.fakePlugin);
    assert.strictEqual(retried.status, 0, `${retried.stdout}\n${retried.stderr}`);
    const receipt = JSON.parse(fs.readFileSync(fixture.receiptPath, 'utf8'));
    assert.ok(receipt.managed_entries.skills[fixture.collision], 'retry should publish ownership after recovery');
    assert.ok(!fs.existsSync(path.join(fixture.target, 'user-owned.txt')), 'recovered adoption should replace the selected collision');
  } finally {
    fs.rmSync(fixture.scratch, { recursive: true, force: true });
    fs.rmSync(fixture.fakePlugin, { recursive: true, force: true });
  }
});

test('adoption journal rolls back a crash after publication when the receipt still proves the old projection', () => {
  const fixture = collisionFixture();
  try {
    const plan = runInstaller(fixture.scratch, ['--copy', '--update', '--plan', '--json', '--force'], fixture.fakePlugin);
    assert.notStrictEqual(plan.status, 0);
    const collision = JSON.parse(plan.stdout).collisions.find((entry) => entry.path === `skills/${fixture.collision}`);
    const crashed = runInstaller(fixture.scratch, [
      '--copy', '--update', `--adopt=skills/${fixture.collision}@${collision.destination_fingerprint}@${collision.source_fingerprint}`, '--force',
    ], fixture.fakePlugin, { DHPK_TEST_ABORT_ADOPTION_PHASE: 'published' });
    assert.strictEqual(crashed.status, 73, `${crashed.stdout}\n${crashed.stderr}`);
    const retried = runInstaller(fixture.scratch, [
      '--copy', '--update', `--adopt=skills/${fixture.collision}@${collision.destination_fingerprint}@${collision.source_fingerprint}`, '--force',
    ], fixture.fakePlugin);
    assert.strictEqual(retried.status, 0, `${retried.stdout}\n${retried.stderr}`);
    const receipt = JSON.parse(fs.readFileSync(fixture.receiptPath, 'utf8'));
    assert.ok(receipt.managed_entries.skills[fixture.collision]);
    assert.strictEqual(receipt.transaction_final, true);
  } finally {
    fs.rmSync(fixture.scratch, { recursive: true, force: true });
    fs.rmSync(fixture.fakePlugin, { recursive: true, force: true });
  }
});

test('adoption recovery rolls forward a durable partial receipt after a receipt-persisted crash', () => {
  const fixture = collisionFixture();
  try {
    const plan = runInstaller(fixture.scratch, ['--copy', '--update', '--plan', '--json', '--force'], fixture.fakePlugin);
    assert.notStrictEqual(plan.status, 0);
    const collision = JSON.parse(plan.stdout).collisions.find((entry) => entry.path === `skills/${fixture.collision}`);
    const crashed = runInstaller(fixture.scratch, [
      '--copy', '--update', `--adopt=skills/${fixture.collision}@${collision.destination_fingerprint}@${collision.source_fingerprint}`, '--force',
    ], fixture.fakePlugin, { DHPK_TEST_ABORT_ADOPTION_PHASE: 'receipt_persisted' });
    assert.strictEqual(crashed.status, 73, `${crashed.stdout}\n${crashed.stderr}`);
    const partial = JSON.parse(fs.readFileSync(fixture.receiptPath, 'utf8'));
    assert.strictEqual(partial.transaction_final, false);
    assert.ok(partial.managed_entries.skills[fixture.collision]);
    const recovered = runInstaller(fixture.scratch, [
      '--copy', '--update', '--force',
    ], fixture.fakePlugin);
    assert.strictEqual(recovered.status, 0, `${recovered.stdout}\n${recovered.stderr}`);
    const receipt = JSON.parse(fs.readFileSync(fixture.receiptPath, 'utf8'));
    assert.strictEqual(receipt.transaction_final, true, 'recovery must finalize the proven partial receipt');
    assert.ok(receipt.managed_entries.skills[fixture.collision]);
    assert.ok(!fs.existsSync(path.join(fixture.target, 'user-owned.txt')));
  } finally {
    fs.rmSync(fixture.scratch, { recursive: true, force: true });
    fs.rmSync(fixture.fakePlugin, { recursive: true, force: true });
  }
});

test('adoption is path-scoped when multiple collisions are reported', () => {
  const fixture = collisionFixture();
  const second = 'dhpk-legacy-characterization-tests';
  try {
    const receipt = JSON.parse(fs.readFileSync(fixture.receiptPath, 'utf8'));
    assert.ok(receipt.managed_entries.skills[second], `expected fixture receipt entry for ${second}`);
    delete receipt.managed_entries.skills[second];
    fs.writeFileSync(fixture.receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
    const secondTarget = path.join(fixture.scratch, '.codex', 'skills', second);
    fs.writeFileSync(path.join(secondTarget, 'second-user-owned.txt'), 'keep second\n');

    const plan = runInstaller(fixture.scratch, ['--copy', '--update', '--plan', '--json', '--force'], fixture.fakePlugin);
    assert.notStrictEqual(plan.status, 0);
    const report = JSON.parse(plan.stdout);
    const firstCollision = report.collisions.find((entry) => entry.path === `skills/${fixture.collision}`);
    const secondCollision = report.collisions.find((entry) => entry.path === `skills/${second}`);
    assert.ok(firstCollision && secondCollision, plan.stdout);
    const adopted = runInstaller(fixture.scratch, [
      '--update', `--adopt=skills/${fixture.collision}@${firstCollision.destination_fingerprint}@${firstCollision.source_fingerprint}`, '--force',
    ], fixture.fakePlugin);
    assert.strictEqual(adopted.status, 0, `${adopted.stdout}\n${adopted.stderr}`);
    const after = JSON.parse(fs.readFileSync(fixture.receiptPath, 'utf8'));
    assert.ok(after.managed_entries.skills[fixture.collision]);
    assert.ok(!after.managed_entries.skills[second]);
    assert.ok(fs.existsSync(path.join(secondTarget, 'second-user-owned.txt')));
    assert.strictEqual(after.reconciliation.state, 'partial');
    assert.ok(after.reconciliation.evidence.paths.collisions.includes(`skills/${second}`));
  } finally {
    fs.rmSync(fixture.scratch, { recursive: true, force: true });
    fs.rmSync(fixture.fakePlugin, { recursive: true, force: true });
  }
});

test('explicit adoption defers a stale-owned sibling instead of updating it', () => {
  const fixture = collisionFixture();
  const sibling = 'dhpk-tdd-workflow';
  try {
    materializeFixtureSkill(fixture.fakePlugin, sibling);
    const siblingSource = path.join(fixture.fakePlugin, 'codex', 'skills', sibling, 'SKILL.md');
    const siblingTarget = path.join(fixture.scratch, '.codex', 'skills', sibling);
    const siblingBefore = completeTreeFingerprint(siblingTarget);
    const receiptBefore = JSON.parse(fs.readFileSync(fixture.receiptPath, 'utf8'));
    const siblingReceiptBefore = receiptBefore.managed_entries.skills[sibling];
    fs.appendFileSync(siblingSource, '\nstale sibling source\n');

    const plan = runInstaller(fixture.scratch, ['--copy', '--update', '--plan', '--json', '--force'], fixture.fakePlugin);
    assert.notStrictEqual(plan.status, 0);
    const report = JSON.parse(plan.stdout);
    const collision = report.collisions.find((entry) => entry.path === `skills/${fixture.collision}`);
    assert.ok(collision, plan.stdout);
    assert.ok(report.updates.some((entry) => entry.path === `skills/${sibling}`), plan.stdout);

    const adopted = runInstaller(fixture.scratch, [
      '--update', `--adopt=skills/${fixture.collision}@${collision.destination_fingerprint}@${collision.source_fingerprint}`, '--force',
    ], fixture.fakePlugin);
    assert.strictEqual(adopted.status, 0, `${adopted.stdout}\n${adopted.stderr}`);
    const after = JSON.parse(fs.readFileSync(fixture.receiptPath, 'utf8'));
    assert.strictEqual(completeTreeFingerprint(siblingTarget), siblingBefore,
      'stale managed sibling must remain unchanged during path-scoped adoption');
    assert.deepStrictEqual(after.managed_entries.skills[sibling], siblingReceiptBefore,
      'stale managed sibling receipt entry must remain unchanged');
    assert.strictEqual(after.reconciliation.state, 'partial');
    assert.ok(after.reconciliation.evidence.paths.deferred.includes(`skills/${sibling}`));
  } finally {
    fs.rmSync(fixture.scratch, { recursive: true, force: true });
    fs.rmSync(fixture.fakePlugin, { recursive: true, force: true });
  }
});

test('explicit adoption rejects a mode mismatch instead of rewriting the projection', () => {
  const fixture = collisionFixture();
  try {
    const receipt = JSON.parse(fs.readFileSync(fixture.receiptPath, 'utf8'));
    receipt.mode = 'symlink';
    fs.writeFileSync(fixture.receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
    const plan = runInstaller(fixture.scratch, ['--copy', '--update', '--plan', '--json', '--force'], fixture.fakePlugin);
    assert.notStrictEqual(plan.status, 0);
    const collision = JSON.parse(plan.stdout).collisions.find((entry) => entry.path === `skills/${fixture.collision}`);
    const rejected = runInstaller(fixture.scratch, [
      '--copy', '--update', `--adopt=skills/${fixture.collision}@${collision.destination_fingerprint}@${collision.source_fingerprint}`, '--force',
    ], fixture.fakePlugin);
    assert.strictEqual(rejected.status, 2, `${rejected.stdout}\n${rejected.stderr}`);
    assert.match(`${rejected.stdout}\n${rejected.stderr}`, /mode mismatch|omit --copy/i);
    assert.ok(fs.existsSync(path.join(fixture.target, 'user-owned.txt')));
  } finally {
    fs.rmSync(fixture.scratch, { recursive: true, force: true });
    fs.rmSync(fixture.fakePlugin, { recursive: true, force: true });
  }
});

test('adoption aborts when the planned collision changes before mutation', () => {
  const fixture = collisionFixture();
  try {
    const plan = runInstaller(fixture.scratch, ['--copy', '--update', '--plan', '--json', '--force'], fixture.fakePlugin);
    assert.notStrictEqual(plan.status, 0);
    const collision = JSON.parse(plan.stdout).collisions.find((entry) => entry.path === `skills/${fixture.collision}`);
    fs.writeFileSync(path.join(fixture.target, 'changed-after-plan.txt'), 'changed\n');
    const adopted = runInstaller(fixture.scratch, [
      '--update', `--adopt=skills/${fixture.collision}@${collision.destination_fingerprint}@${collision.source_fingerprint}`, '--force',
    ], fixture.fakePlugin);
    assert.notStrictEqual(adopted.status, 0, `${adopted.stdout}\n${adopted.stderr}`);
    assert.match(`${adopted.stdout}\n${adopted.stderr}`, /changed|fresh plan|preflight/i);
    assert.ok(fs.existsSync(path.join(fixture.target, 'changed-after-plan.txt')));
    const receipt = JSON.parse(fs.readFileSync(fixture.receiptPath, 'utf8'));
    assert.ok(!receipt.managed_entries.skills[fixture.collision]);
  } finally {
    fs.rmSync(fixture.scratch, { recursive: true, force: true });
    fs.rmSync(fixture.fakePlugin, { recursive: true, force: true });
  }
});

test('adoption aborts when the planned source changes before mutation', () => {
  const fixture = collisionFixture();
  try {
    const plan = runInstaller(fixture.scratch, ['--copy', '--update', '--plan', '--json', '--force'], fixture.fakePlugin);
    assert.notStrictEqual(plan.status, 0);
    const collision = JSON.parse(plan.stdout).collisions.find((entry) => entry.path === `skills/${fixture.collision}`);
    fs.appendFileSync(path.join(fixture.fakePlugin, 'codex', 'skills', fixture.collision, 'SKILL.md'), '\nsource changed after plan\n');
    const adopted = runInstaller(fixture.scratch, [
      '--update', `--adopt=skills/${fixture.collision}@${collision.destination_fingerprint}@${collision.source_fingerprint}`, '--force',
    ], fixture.fakePlugin);
    assert.notStrictEqual(adopted.status, 0, `${adopted.stdout}\n${adopted.stderr}`);
    assert.match(`${adopted.stdout}\n${adopted.stderr}`, /changed|fresh plan|preflight/i);
    assert.ok(fs.existsSync(path.join(fixture.target, 'user-owned.txt')));
  } finally {
    fs.rmSync(fixture.scratch, { recursive: true, force: true });
    fs.rmSync(fixture.fakePlugin, { recursive: true, force: true });
  }
});

test('--plan and --adopt cannot be combined, and adoption requires --update', () => {
  const fixture = collisionFixture();
  try {
    const token = `skills/${fixture.collision}@${'0'.repeat(64)}@${'0'.repeat(64)}`;
    const planned = runInstaller(fixture.scratch, ['--plan', '--json', `--adopt=${token}`, '--force'], fixture.fakePlugin);
    assert.strictEqual(planned.status, 2, `${planned.stdout}\n${planned.stderr}`);
    assert.match(`${planned.stdout}\n${planned.stderr}`, /cannot be combined|--plan.*--adopt/i);
    const withoutUpdate = runInstaller(fixture.scratch, ['--adopt', token, '--force'], fixture.fakePlugin);
    assert.strictEqual(withoutUpdate.status, 2, `${withoutUpdate.stdout}\n${withoutUpdate.stderr}`);
    assert.match(`${withoutUpdate.stdout}\n${withoutUpdate.stderr}`, /requires --update/i);
    assert.ok(fs.existsSync(path.join(fixture.target, 'user-owned.txt')));
  } finally {
    fs.rmSync(fixture.scratch, { recursive: true, force: true });
    fs.rmSync(fixture.fakePlugin, { recursive: true, force: true });
  }
});

test('adoption rejects a symlinked backup root without writing outside .codex', () => {
  const fixture = collisionFixture();
  const external = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-ics-backup-external-')));
  try {
    const plan = runInstaller(fixture.scratch, ['--copy', '--update', '--plan', '--json', '--force'], fixture.fakePlugin);
    assert.notStrictEqual(plan.status, 0);
    const collision = JSON.parse(plan.stdout).collisions.find((entry) => entry.path === `skills/${fixture.collision}`);
    const backupRoot = path.join(fixture.scratch, '.codex', '.dhpk-backups');
    fs.symlinkSync(external, backupRoot, 'dir');
    const adopted = runInstaller(fixture.scratch, [
      '--update', `--adopt=skills/${fixture.collision}@${collision.destination_fingerprint}@${collision.source_fingerprint}`, '--force',
    ], fixture.fakePlugin);
    assert.notStrictEqual(adopted.status, 0, `${adopted.stdout}\n${adopted.stderr}`);
    assert.match(`${adopted.stdout}\n${adopted.stderr}`, /escapes|containment|backup|symlink/i);
    assert.deepStrictEqual(fs.readdirSync(external), []);
    assert.ok(fs.existsSync(path.join(fixture.target, 'user-owned.txt')));
  } finally {
    fs.rmSync(fixture.scratch, { recursive: true, force: true });
    fs.rmSync(fixture.fakePlugin, { recursive: true, force: true });
    fs.rmSync(external, { recursive: true, force: true });
  }
});

test('planning rejects a symlinked destination ancestor even when it points inside the project', () => {
  const fixture = collisionFixture();
  const alias = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-ics-skills-alias-')));
  try {
    const originalSkills = path.join(fixture.scratch, '.codex', 'skills');
    const externalSkills = path.join(alias, 'skills');
    fs.renameSync(originalSkills, externalSkills);
    fs.symlinkSync(externalSkills, originalSkills, 'dir');
    const planned = runInstaller(fixture.scratch, ['--copy', '--update', '--plan', '--json', '--force'], fixture.fakePlugin);
    assert.notStrictEqual(planned.status, 0, `${planned.stdout}\n${planned.stderr}`);
    assert.match(`${planned.stdout}\n${planned.stderr}`, /symlinked parent|symlink|unsafe/i);
    assert.ok(fs.existsSync(path.join(externalSkills, fixture.collision, 'user-owned.txt')));
  } finally {
    fs.rmSync(fixture.scratch, { recursive: true, force: true });
    fs.rmSync(fixture.fakePlugin, { recursive: true, force: true });
    fs.rmSync(alias, { recursive: true, force: true });
  }
});

test('adoption rejects traversal paths before writing outside the Codex root', () => {
  const fixture = collisionFixture();
  const outside = path.join(fixture.scratch, 'outside-adoption.txt');
  try {
    const rejected = runInstaller(fixture.scratch, [
      '--copy', '--update', '--adopt=../outside-adoption.txt@0000000000000000000000000000000000000000000000000000000000000000', '--force',
    ], fixture.fakePlugin);
    assert.notStrictEqual(rejected.status, 0, `${rejected.stdout}\n${rejected.stderr}`);
    assert.ok(!fs.existsSync(outside));
    assert.ok(fs.existsSync(path.join(fixture.target, 'user-owned.txt')));
  } finally {
    fs.rmSync(fixture.scratch, { recursive: true, force: true });
    fs.rmSync(fixture.fakePlugin, { recursive: true, force: true });
  }
});

test('--uninstall removes only unchanged receipt-owned targets and retains orphaned/unrelated assets', () => {
  const scratch = projectRoot();
  try {
    const first = runInstaller(scratch, ['--copy', '--force']);
    assert.strictEqual(first.status, 0, `${first.stdout}\n${first.stderr}`);
    const skills = fs.readdirSync(path.join(scratch, '.codex', 'skills'));
    assert.ok(skills.length >= 2, 'fixture needs at least two installed skills');
    const edited = skills[0];
    const kept = skills[1];
    const editedTarget = path.join(scratch, '.codex', 'skills', edited);
    fs.writeFileSync(path.join(editedTarget, 'user-edit.txt'), 'edited\n');
    const unrelatedTarget = path.join(scratch, '.codex', 'skills', 'unrelated');
    fs.mkdirSync(unrelatedTarget, { recursive: true });
    fs.writeFileSync(path.join(unrelatedTarget, 'keep.txt'), 'keep\n');
    const res = runInstaller(scratch, ['--uninstall', '--force']);
    assert.strictEqual(res.status, 0, `${res.stdout}\n${res.stderr}`);
    assert.match(`${res.stdout}\n${res.stderr}`, /orphaned|preserved/i);
    assert.ok(fs.existsSync(editedTarget), 'edited owned target must be preserved');
    assert.ok(fs.existsSync(unrelatedTarget), 'unrelated target must be preserved');
    assert.ok(!fs.existsSync(path.join(scratch, '.codex', 'skills', kept)), 'unchanged owned target should be removed');
    const manifestPath = path.join(scratch, '.codex', '.dhpk-installed.json');
    assert.ok(fs.existsSync(manifestPath), 'receipt remains while orphaned content is retained');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('a normal install repopulates the project after uninstall', () => {
  const scratch = projectRoot();
  try {
    const first = runInstaller(scratch, ['--copy', '--force']);
    assert.strictEqual(first.status, 0, `${first.stdout}\n${first.stderr}`);
    const removed = runInstaller(scratch, ['--uninstall', '--force']);
    assert.strictEqual(removed.status, 0, `${removed.stdout}\n${removed.stderr}`);
    assert.strictEqual(fs.readdirSync(path.join(scratch, '.codex', 'skills')).length, 0);
    assert.ok(!fs.existsSync(path.join(scratch, '.codex', '.dhpk-installed.json')),
      'complete uninstall must remove the live receipt');
    const receiptBackups = fs.readdirSync(path.join(scratch, '.codex', '.dhpk-backups'))
      .map((run) => path.join(scratch, '.codex', '.dhpk-backups', run, 'receipt.json'))
      .filter((candidate) => fs.existsSync(candidate));
    assert.ok(receiptBackups.length >= 1, 'complete uninstall must retain an fsynced receipt quarantine');
    const restored = runInstaller(scratch, ['--copy', '--force']);
    assert.strictEqual(restored.status, 0, `${restored.stdout}\n${restored.stderr}`);
    assert.ok(fs.readdirSync(path.join(scratch, '.codex', 'skills')).length > 0);
    assert.doesNotMatch(restored.stdout, /already up-to-date/);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('complete uninstall restores the receipt when its quarantine fsync fails', () => {
  const scratch = projectRoot();
  try {
    const first = runInstaller(scratch, ['--copy', '--force']);
    assert.strictEqual(first.status, 0, `${first.stdout}\n${first.stderr}`);
    const receiptPath = path.join(scratch, '.codex', '.dhpk-installed.json');
    const failed = runInstaller(
      scratch,
      ['--uninstall', '--force'],
      ROOT,
      { DHPK_TEST_FAIL_UNINSTALL_RECEIPT_FSYNC: '1' },
    );
    assert.notStrictEqual(failed.status, 0, `${failed.stdout}\n${failed.stderr}`);
    assert.ok(fs.existsSync(receiptPath), 'failed uninstall must restore the live receipt');
    const managed = JSON.parse(fs.readFileSync(receiptPath, 'utf8')).managed_entries.skills;
    const restoredTarget = Object.values(managed)
      .map((entry) => path.join(scratch, '.codex', entry.destination))
      .find((candidate) => fs.existsSync(candidate));
    assert.ok(restoredTarget, 'failed uninstall must restore at least one managed target');

    const recovered = runInstaller(scratch, ['--uninstall', '--force']);
    assert.strictEqual(recovered.status, 0, `${recovered.stdout}\n${recovered.stderr}`);
    assert.ok(!fs.existsSync(receiptPath), 'recovered uninstall must remove the receipt');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('a deleted orphaned destination is restored to managed ownership on reinstall', () => {
  const scratch = projectRoot();
  try {
    const first = runInstaller(scratch, ['--copy', '--force']);
    assert.strictEqual(first.status, 0, `${first.stdout}\n${first.stderr}`);
    const skillName = fs.readdirSync(path.join(scratch, '.codex', 'skills'))[0];
    const target = path.join(scratch, '.codex', 'skills', skillName);
    fs.writeFileSync(path.join(target, 'user-edit.txt'), 'edited\n');
    const removed = runInstaller(scratch, ['--uninstall', '--force']);
    assert.strictEqual(removed.status, 0, `${removed.stdout}\n${removed.stderr}`);
    assert.ok(fs.existsSync(target), 'edited destination should be retained as orphaned');
    fs.rmSync(target, { recursive: true, force: true });

    const restored = runInstaller(scratch, ['--copy', '--force']);
    assert.strictEqual(restored.status, 0, `${restored.stdout}\n${restored.stderr}`);
    const manifest = JSON.parse(fs.readFileSync(path.join(scratch, '.codex', '.dhpk-installed.json'), 'utf8'));
    assert.ok(fs.existsSync(path.join(target, 'SKILL.md')));
    assert.strictEqual(Object.keys(manifest.orphaned_entries || {}).length, 0, JSON.stringify(manifest));
    assert.strictEqual(manifest.reconciliation.state, 'current');
    assert.strictEqual(manifest.reconciliation.complete, true);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('uninstall rejects receipt traversal paths without deleting outside .codex', () => {
  const scratch = projectRoot();
  const outside = path.join(scratch, 'outside-owned');
  try {
    fs.mkdirSync(outside, { recursive: true });
    fs.writeFileSync(path.join(outside, 'keep.txt'), 'keep me\n');
    fs.mkdirSync(path.join(scratch, '.codex'), { recursive: true });
    fs.writeFileSync(path.join(scratch, '.codex', '.dhpk-installed.json'), JSON.stringify({
      schema_version: 2,
      plugin_version: 'legacy',
      source_fingerprint: 'fixture',
      mode: 'copy',
      managed_entries: {
        skills: {
          evil: {
            destination: '../outside-owned',
            source: '../outside-owned',
            mode: 'copy',
            destination_fingerprint: 'fixture',
            ownership_marker: 'copy:../outside-owned',
          },
        },
        agents: {},
        supporting_assets: {},
      },
    }));
    const res = runInstaller(scratch, ['--uninstall', '--force']);
    assert.strictEqual(res.status, 0, `${res.stdout}\n${res.stderr}`);
    assert.strictEqual(fs.readFileSync(path.join(outside, 'keep.txt'), 'utf8'), 'keep me\n');
    assert.match(`${res.stdout}\n${res.stderr}`, /orphaned|unsafe|preserved/i);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('uninstall rejects symlinked .codex parents without deleting the external tree', () => {
  const scratch = projectRoot();
  const external = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-ics-external-codex-')));
  try {
    const first = runInstaller(scratch, ['--copy', '--force']);
    assert.strictEqual(first.status, 0, `${first.stdout}\n${first.stderr}`);
    const skillName = fs.readdirSync(path.join(scratch, '.codex', 'skills'))[0];
    const originalSkills = path.join(scratch, '.codex', 'skills');
    const externalSkills = path.join(external, 'skills');
    fs.renameSync(originalSkills, externalSkills);
    fs.symlinkSync(externalSkills, originalSkills, 'dir');
    const res = runInstaller(scratch, ['--uninstall', '--force']);
    assert.strictEqual(res.status, 0, `${res.stdout}\n${res.stderr}`);
    assert.ok(fs.existsSync(path.join(externalSkills, skillName, 'SKILL.md')));
    assert.match(`${res.stdout}\n${res.stderr}`, /orphaned|unsafe|preserved/i);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(external, { recursive: true, force: true });
  }
});

test('sync rejects a symlinked project .codex root before writing a receipt', () => {
  const scratch = projectRoot();
  const external = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-ics-external-root-')));
  try {
    fs.symlinkSync(external, path.join(scratch, '.codex'), 'dir');
    const res = runInstaller(scratch, ['--copy', '--force']);
    assert.notStrictEqual(res.status, 0);
    assert.ok(!fs.existsSync(path.join(external, '.dhpk-installed.json')));
    assert.match(`${res.stdout}\n${res.stderr}`, /symlink|refusing/i);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(external, { recursive: true, force: true });
  }
});

test('sync rejects a symlinked receipt without modifying the external target', () => {
  const scratch = projectRoot();
  const external = path.join(scratch, 'external-receipt.json');
  try {
    fs.mkdirSync(path.join(scratch, '.codex'), { recursive: true });
    fs.writeFileSync(external, 'keep external receipt\n');
    fs.symlinkSync(external, path.join(scratch, '.codex', '.dhpk-installed.json'));
    const res = runInstaller(scratch, ['--copy', '--force']);
    assert.notStrictEqual(res.status, 0);
    assert.strictEqual(fs.readFileSync(external, 'utf8'), 'keep external receipt\n');
    assert.ok(fs.lstatSync(path.join(scratch, '.codex', '.dhpk-installed.json')).isSymbolicLink());
    assert.match(`${res.stdout}\n${res.stderr}`, /receipt|symlink|refusing/i);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('uninstall preserves a retargeted symlink even when the replacement has identical content', () => {
  const scratch = projectRoot();
  const userOwned = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-ics-identical-target-')));
  try {
    const first = runInstaller(scratch, ['--force']);
    assert.strictEqual(first.status, 0, `${first.stdout}\n${first.stderr}`);
    const skillName = fs.readdirSync(path.join(ROOT, 'codex', 'skills'))[0];
    const source = path.join(ROOT, 'codex', 'skills', skillName);
    const target = path.join(scratch, '.codex', 'skills', skillName);
    const replacement = path.join(userOwned, skillName);
    fs.cpSync(source, replacement, { recursive: true, dereference: true });
    fs.unlinkSync(target);
    fs.symlinkSync(replacement, target, 'dir');

    const removed = runInstaller(scratch, ['--uninstall', '--force']);
    assert.strictEqual(removed.status, 0, `${removed.stdout}\n${removed.stderr}`);
    assert.ok(fs.lstatSync(target).isSymbolicLink(), 'retargeted symlink must be preserved');
    assert.strictEqual(fs.realpathSync(target), fs.realpathSync(replacement));
    const manifest = JSON.parse(fs.readFileSync(path.join(scratch, '.codex', '.dhpk-installed.json'), 'utf8'));
    assert.ok(manifest.orphaned_entries[`skills/${skillName}`]);
    assert.match(`${removed.stdout}\n${removed.stderr}`, /orphaned|preserved/i);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(userOwned, { recursive: true, force: true });
  }
});

run('install-codex-skills');
