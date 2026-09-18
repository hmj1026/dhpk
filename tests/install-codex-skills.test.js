'use strict';

// Behavioral coverage for the installer provider/bootstrap contract.
// Every installer invocation remains a real child process so exit status,
// stdout JSON, process-group cleanup, and cwd restoration stay under test.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const fixtures = require('./_lib/install-codex-skills-fixtures');

const {
  ROOT,
  HOOK,
  INSTALLER_CHILD_TIMEOUT_MS,
  runInstaller,
  projectRoot,
  copyDistributionInventory,
} = fixtures;

test('bash -n syntax check passes', () => {
  const res = spawnSync('bash', ['-n', HOOK], { encoding: 'utf8' });
  assert.strictEqual(res.status, 0, `syntax error: ${res.stderr}`);
});

test('shared surface diagnostics do not hard-code Codex wording', () => {
  const source = fs.readFileSync(HOOK, 'utf8');
  assert.doesNotMatch(source, /project \.codex (?:install lock|receipt) is not a regular file/);
  assert.doesNotMatch(source, /another Codex installer is already reconciling this project/);
  assert.doesNotMatch(source, /rollback backup symlink escapes the Codex root/);
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

run('install-codex-skills');
