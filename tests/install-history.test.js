'use strict';

// TDD suite for #1588: user-local, append-only, de-identified Install History
// JSONL logging across installation lifecycle entrypoints.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const { makeTempDir } = require('./_lib/temp-dir');
const { fakePlugin } = require('./_lib/shared-projection-plugin');
const { CODEX_STUB_BIN } = require('./_lib/install-codex-skills-fixtures');
const { materializeAgyPluginPackage } = require('../scripts/lib/agy-plugin-package');

const ROOT = path.join(__dirname, '..');
const PKG_VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const DHPK_INSTALL = path.join(ROOT, 'scripts', 'dhpk-install.js');
const CODEX_HOOK = path.join(ROOT, 'scripts', 'hooks', 'install-codex-skills.sh');
const CURSOR_HOOK = path.join(ROOT, 'scripts', 'hooks', 'install-cursor-harness.sh');
const AGY_CLI = path.join(ROOT, 'scripts', 'ci', 'install-agy-plugin.js');
const ASSETS_SH = path.join(ROOT, 'scripts', 'setup', 'install-assets.sh');
const INSTALL_SH = path.join(ROOT, 'scripts', 'install.sh');

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf8');
  return raw.split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

function makeRestrictedBin(tools, extraFiles = {}) {
  const bin = makeTempDir('dhpk-history-bin-');
  const search = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const name of tools) {
    let resolved = null;
    for (const dir of search) {
      const candidate = path.join(dir, name);
      try {
        if (fs.statSync(candidate).isFile()) {
          fs.accessSync(candidate, fs.constants.X_OK);
          resolved = fs.realpathSync(candidate);
          break;
        }
      } catch (_) { /* try next */ }
    }
    assert.ok(resolved, `required tool unavailable for restricted PATH: ${name}`);
    fs.symlinkSync(resolved, path.join(bin, name));
  }
  for (const [name, content] of Object.entries(extraFiles)) {
    const dest = path.join(bin, name);
    fs.writeFileSync(dest, content, { mode: 0o755 });
  }
  return bin;
}

function makeAgyPackage(dir, version = '0.39.0') { // dhpk:historical-version-fixture
  const src = path.join(dir, 'agy-src');
  const pkg = path.join(dir, 'agy-pkg');
  fs.mkdirSync(path.join(src, 'agents'), { recursive: true });
  fs.mkdirSync(path.join(src, 'rules'), { recursive: true });
  fs.mkdirSync(path.join(src, 'skills', 'dhpk-sample'), { recursive: true });
  fs.writeFileSync(path.join(src, 'agents', 'sample.md'), '---\nname: sample\ndescription: Sample\ntools: ["view_file"]\nmodel: inherit\n---\n\n# Agent\n');
  fs.writeFileSync(path.join(src, 'rules', 'sample.md'), '# Rule\n');
  fs.writeFileSync(path.join(src, 'skills', 'dhpk-sample', 'SKILL.md'), '---\nname: dhpk-sample\ndescription: Sample\n---\n# Skill\n');
  const inventory = {
    schema: 'dhpk.distribution-inventory.v2',
    skills: [{ id: 'sample', path: 'skills/dhpk-sample', surfaces: ['agy-plugin'] }],
    modules: [],
    surface_membership: { 'agy-plugin': ['sample'] },
    agy_plugin: { agents: ['sample.md'], rules: ['rules/sample.md'] },
  };
  materializeAgyPluginPackage({
    root: src,
    inventory,
    outDir: pkg,
    version,
    sourceVersion: version,
    sourceCommit: 'b'.repeat(40),
  });
  return pkg;
}

function assertDeidentifiedRecord(record, { rawPaths = [], secrets = [], usernames = [] } = {}) {
  assert.strictEqual(record.schema, 'dhpk.install-history.v1');
  assert.match(record.timestamp, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/);
  assert.strictEqual(typeof record.surface, 'string');
  assert.strictEqual(typeof record.action, 'string');
  assert.ok(record.scope === null || typeof record.scope === 'string');
  assert.ok(record.sourceVersion === null || typeof record.sourceVersion === 'string');
  assert.strictEqual(typeof record.exitCode, 'number');
  assert.strictEqual(typeof record.verdict, 'string');
  assert.ok(Array.isArray(record.reasonCodes));
  assert.ok(record.versions && typeof record.versions === 'object');
  assert.ok(record.versions.before && typeof record.versions.before === 'object');
  assert.ok(record.versions.after && typeof record.versions.after === 'object');
  if (record.projectId !== null) {
    assert.match(record.projectId, /^sha256:[a-f0-9]{64}$/);
  }
  const serialized = JSON.stringify(record);
  for (const raw of rawPaths) {
    if (raw) assert.strictEqual(serialized.includes(raw), false, `record leaked raw path: ${raw}`);
  }
  for (const secret of secrets) {
    if (secret) assert.strictEqual(serialized.includes(secret), false, `record leaked secret: ${secret}`);
  }
  for (const name of usernames) {
    if (name) assert.strictEqual(serialized.includes(name), false, `record leaked username: ${name}`);
  }
}

test('install-history module resolves XDG default, DHPK_INSTALL_HISTORY_FILE override, and opt-out', () => {
  const history = require('../scripts/lib/install-history');
  const root = makeTempDir('dhpk-hist-unit-');
  const xdgState = path.join(root, 'xdg-state');
  const customFile = path.join(root, 'custom', 'history.jsonl');
  const fakeHome = path.join(root, 'Users', 'alice_secret_user');

  assert.strictEqual(
    history.resolveHistoryFile({ HOME: fakeHome }),
    path.join(fakeHome, '.local', 'state', 'dhpk', 'install-history.jsonl'),
  );
  assert.strictEqual(
    history.resolveHistoryFile({ HOME: fakeHome, XDG_STATE_HOME: xdgState }),
    path.join(xdgState, 'dhpk', 'install-history.jsonl'),
  );
  assert.strictEqual(
    history.resolveHistoryFile({ HOME: fakeHome, XDG_STATE_HOME: xdgState, DHPK_INSTALL_HISTORY_FILE: customFile }),
    customFile,
  );

  const disabled = history.appendInstallHistory(
    { surface: 'codex-sync', action: 'install', scope: 'project', exitCode: 0, verdict: 'INSTALL_PASS' },
    { env: { HOME: fakeHome, DHPK_INSTALL_HISTORY_FILE: customFile, DHPK_NO_INSTALL_HISTORY: '1' } },
  );
  assert.strictEqual(disabled.written, false);
  assert.strictEqual(disabled.skipped, true);
  assert.strictEqual(fs.existsSync(customFile), false);

  const secretToken = 'ghp_' + 'a'.repeat(24);
  const projectDir = path.join(fakeHome, 'projects', 'secret-app');
  const written = history.appendInstallHistory(
    {
      surface: 'codex-sync',
      action: 'install',
      scope: 'project',
      sourceVersion: `1.0.0-${secretToken}`,
      projectRoot: projectDir,
      exitCode: 0,
      verdict: 'INSTALL_PASS',
      reasonCodes: [`token=${secretToken}`, `/Users/alice_secret_user/secret-app`],
      beforeVersion: null,
      afterVersion: { version: '1.0.0', state: 'current' },
    },
    {
      env: {
        HOME: fakeHome,
        USER: 'alice_secret_user',
        DHPK_INSTALL_HISTORY_FILE: customFile,
        GITHUB_TOKEN: secretToken,
        COOKIE: 'session=topsecretcookie123',
      },
    },
  );
  assert.strictEqual(written.written, true);
  const records = readJsonl(customFile);
  assert.strictEqual(records.length, 1);
  assertDeidentifiedRecord(records[0], {
    rawPaths: [fakeHome, projectDir],
    secrets: [secretToken, 'topsecretcookie123'],
    usernames: ['alice_secret_user'],
  });
});

test('dhpk-install appends exactly one record per passing or blocked lifecycle run without double-logging codex-cli', () => {
  const root = makeTempDir('dhpk-hist-cli-');
  const project = path.join(root, 'my-project');
  const xdgState = path.join(root, 'state');
  const historyFile = path.join(xdgState, 'dhpk', 'install-history.jsonl');
  fs.mkdirSync(path.join(project, '.git'), { recursive: true });

  const env = {
    ...process.env,
    PATH: `${CODEX_STUB_BIN}:${process.env.PATH || ''}`,
    HOME: root,
    XDG_STATE_HOME: xdgState,
  };

  // 1. Passing install (delegates to codex-cli in-process: must write ONE record, not two)
  const installRes = spawnSync(process.execPath, [DHPK_INSTALL, 'codex-sync', 'install', '--project-root', project, '--mode', 'copy', '--json'], {
    cwd: ROOT, encoding: 'utf8', env, timeout: 90_000,
  });
  assert.strictEqual(installRes.status, 0, installRes.stderr);

  // 2. Blocked --plan --json exit 2 (missing fingerprint_algorithm on 0.66.6-style partial receipt)
  const receiptPath = path.join(project, '.codex', '.dhpk-installed.json');
  const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
  delete receipt.fingerprint_algorithm;
  receipt.plugin_version = '0.66.6'; // dhpk:historical-version-fixture
  receipt.state = 'partial';
  fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2));

  const blockedPlan = spawnSync(process.execPath, [DHPK_INSTALL, 'codex-sync', 'plan', '--project-root', project, '--mode', 'copy', '--json'], {
    cwd: ROOT, encoding: 'utf8', env, timeout: 90_000,
  });
  assert.strictEqual(blockedPlan.status, 2, blockedPlan.stderr);
  assert.strictEqual(JSON.parse(blockedPlan.stdout).verdict, 'BLOCKED');

  const records = readJsonl(historyFile);
  assert.strictEqual(records.length, 2, `expected 2 records (no double-logging), got ${records.length}: ${JSON.stringify(records)}`);
  assert.strictEqual(records[0].surface, 'codex-sync');
  assert.strictEqual(records[0].action, 'install');
  assert.strictEqual(records[0].scope, 'project');
  assert.strictEqual(records[0].sourceVersion, PKG_VERSION);
  assert.strictEqual(records[0].exitCode, 0);
  assert.strictEqual(records[0].verdict, 'INSTALL_PASS');
  assert.strictEqual(records[0].versions.before.version, null);
  assert.strictEqual(records[0].versions.before.state, 'absent');
  assert.strictEqual(records[0].versions.after.version, PKG_VERSION);
  assertDeidentifiedRecord(records[0], { rawPaths: [root, project] });

  assert.strictEqual(records[1].surface, 'codex-sync');
  assert.strictEqual(records[1].action, 'plan');
  assert.strictEqual(records[1].exitCode, 2);
  assert.strictEqual(records[1].verdict, 'BLOCKED');
  assert.ok(records[1].reasonCodes.includes('MISSING_FINGERPRINT_ALGORITHM'), JSON.stringify(records[1].reasonCodes));
  assert.strictEqual(records[1].versions.before.version, '0.66.6'); // dhpk:historical-version-fixture
  assert.strictEqual(records[1].versions.after.version, '0.66.6'); // dhpk:historical-version-fixture
  assertDeidentifiedRecord(records[1], { rawPaths: [root, project] });
});

test('codex and cursor shell hooks record install history via codex-cli and honor opt-out and delegation marker', () => {
  const root = makeTempDir('dhpk-hist-hooks-');
  const plugin = fakePlugin();
  const project = path.join(root, 'proj');
  const historyFile = path.join(root, 'hist.jsonl');
  fs.mkdirSync(path.join(project, '.git'), { recursive: true });
  try {
    const baseEnv = {
      ...process.env,
      PATH: `${CODEX_STUB_BIN}:${process.env.PATH || ''}`,
      HOME: root,
      DHPK_INSTALLER_ROOT: plugin,
      DHPK_INSTALL_HISTORY_FILE: historyFile,
    };

    const codexRes = spawnSync('bash', [CODEX_HOOK, '--copy'], { cwd: project, encoding: 'utf8', env: baseEnv, timeout: 90_000 });
    assert.strictEqual(codexRes.status, 0, codexRes.stderr);

    const cursorPlanPending = spawnSync('bash', [CURSOR_HOOK, '--copy', '--plan', '--json'], { cwd: project, encoding: 'utf8', env: baseEnv, timeout: 90_000 });
    assert.strictEqual(cursorPlanPending.status, 1, cursorPlanPending.stderr);

    const cursorInstall = spawnSync('bash', [CURSOR_HOOK, '--copy'], { cwd: project, encoding: 'utf8', env: baseEnv, timeout: 90_000 });
    assert.strictEqual(cursorInstall.status, 0, cursorInstall.stderr);

    const optOutRes = spawnSync('bash', [CODEX_HOOK, '--copy', '--update'], {
      cwd: project, encoding: 'utf8', env: { ...baseEnv, DHPK_NO_INSTALL_HISTORY: '1' }, timeout: 90_000,
    });
    assert.strictEqual(optOutRes.status, 0, optOutRes.stderr);

    const delegatedRes = spawnSync('bash', [CODEX_HOOK, '--copy', '--update'], {
      cwd: project, encoding: 'utf8', env: { ...baseEnv, DHPK_INSTALL_HISTORY_DELEGATED: '1' }, timeout: 90_000,
    });
    assert.strictEqual(delegatedRes.status, 0, delegatedRes.stderr);

    const records = readJsonl(historyFile);
    assert.strictEqual(records.length, 3);
    assert.strictEqual(records[0].surface, 'codex-sync');
    assert.strictEqual(records[0].action, 'install');
    assert.strictEqual(records[0].exitCode, 0);
    assert.strictEqual(records[0].verdict, 'INSTALL_PASS');
    assert.strictEqual(records[1].surface, 'cursor');
    assert.strictEqual(records[1].action, 'plan');
    assert.strictEqual(records[1].exitCode, 1);
    assert.strictEqual(records[1].verdict, 'CHANGES_PENDING');
    assert.strictEqual(records[2].surface, 'cursor');
    assert.strictEqual(records[2].action, 'install');
    assert.strictEqual(records[2].exitCode, 0);
    assert.strictEqual(records[2].verdict, 'INSTALL_PASS');
    for (const rec of records) {
      assertDeidentifiedRecord(rec, { rawPaths: [root, project, plugin] });
    }
  } finally {
    fs.rmSync(plugin, { recursive: true, force: true });
  }
});

test('install-agy-plugin records passing and blocked runs including --plan --json exit 2', () => {
  const root = makeTempDir('dhpk-hist-agy-');
  const pkgV1 = makeAgyPackage(path.join(root, 'v1'), '0.39.0'); // dhpk:historical-version-fixture
  const target = path.join(root, 'agy-target');
  const historyFile = path.join(root, 'agy-history.jsonl');
  const env = { ...process.env, HOME: root, DHPK_INSTALL_HISTORY_FILE: historyFile };

  const installRes = spawnSync(process.execPath, [AGY_CLI, 'install', '--source', pkgV1, '--target', target, '--json'], {
    cwd: ROOT, encoding: 'utf8', env,
  });
  assert.strictEqual(installRes.status, 0, installRes.stderr);

  // Corrupt provenance to trigger blocked plan exit 2
  fs.writeFileSync(path.join(target, 'provenance.json'), '{"sourceVersion":"0.39.0"'); // dhpk:historical-version-fixture
  const planRes = spawnSync(process.execPath, [AGY_CLI, 'plan', '--source', pkgV1, '--target', target, '--json'], {
    cwd: ROOT, encoding: 'utf8', env,
  });
  assert.strictEqual(planRes.status, 2, planRes.stderr);
  assert.strictEqual(JSON.parse(planRes.stdout).verdict, 'BLOCKED');

  const records = readJsonl(historyFile);
  assert.strictEqual(records.length, 2);
  assert.strictEqual(records[0].surface, 'agy-plugin');
  assert.strictEqual(records[0].action, 'install');
  assert.strictEqual(records[0].exitCode, 0);
  assert.strictEqual(records[0].verdict, 'INSTALL_PASS');
  assert.strictEqual(records[0].versions.before.version, null);
  assert.strictEqual(records[0].versions.after.version, '0.39.0'); // dhpk:historical-version-fixture

  assert.strictEqual(records[1].surface, 'agy-plugin');
  assert.strictEqual(records[1].action, 'plan');
  assert.strictEqual(records[1].exitCode, 2);
  assert.strictEqual(records[1].verdict, 'BLOCKED');
  assert.ok(records[1].reasonCodes.includes('INVALID_RECEIPT'));
  assertDeidentifiedRecord(records[0], { rawPaths: [root, target, pkgV1] });
  assertDeidentifiedRecord(records[1], { rawPaths: [root, target, pkgV1] });
});

test('install-assets.sh logs history standalone without node and handles conflict exit 3', () => {
  const root = makeTempDir('dhpk-hist-assets-');
  const source = path.join(root, 'source');
  const target = path.join(root, 'project', '.claude', 'dhpk');
  const historyFile = path.join(root, 'assets-history.jsonl');
  fs.mkdirSync(path.join(source, 'hooks'), { recursive: true });
  fs.mkdirSync(path.join(source, 'scripts', 'hooks'), { recursive: true });
  fs.writeFileSync(path.join(source, 'package.json'), JSON.stringify({ name: 'dhpk', version: '1.2.3' }));
  fs.writeFileSync(path.join(source, 'hooks', 'hooks.json'), '{"hooks":{}}\n');
  fs.writeFileSync(path.join(source, 'scripts', 'hooks', 'guard.sh'), '#!/usr/bin/env bash\necho ok\n');

  // Restricted PATH with python3 and NO node
  const bin = makeRestrictedBin(['bash', 'dirname', 'find', 'cmp', 'mkdir', 'cp', 'chmod', 'mktemp', 'rm', 'cat', 'python3']);
  const env = { ...process.env, PATH: bin, HOME: root, DHPK_INSTALL_HISTORY_FILE: historyFile };

  const okRes = spawnSync('bash', [ASSETS_SH, '--source', source, '--target', target, '--install', 'hooks'], {
    encoding: 'utf8', env,
  });
  assert.strictEqual(okRes.status, 0, `${okRes.stdout}\n${okRes.stderr}`);

  // Introduce local edit to trigger conflict exit 3 on --plan --json
  fs.writeFileSync(path.join(target, 'hooks', 'hooks.json'), '{"hooks":{"edited":true}}\n');
  const conflictPlan = spawnSync('bash', [ASSETS_SH, '--source', source, '--target', target, '--install', 'hooks', '--plan', '--json'], {
    encoding: 'utf8', env,
  });
  assert.strictEqual(conflictPlan.status, 3, `${conflictPlan.stdout}\n${conflictPlan.stderr}`);
  assert.strictEqual(JSON.parse(conflictPlan.stdout).verdict, 'CONFLICT');

  const records = readJsonl(historyFile);
  assert.strictEqual(records.length, 2);
  assert.strictEqual(records[0].surface, 'claude-assets');
  assert.strictEqual(records[0].action, 'install');
  assert.strictEqual(records[0].sourceVersion, '1.2.3');
  assert.strictEqual(records[0].exitCode, 0);
  assert.strictEqual(records[0].verdict, 'INSTALL_PASS');
  assert.strictEqual(records[0].versions.before.version, null);
  assert.strictEqual(records[0].versions.after.version, '1.2.3');

  assert.strictEqual(records[1].surface, 'claude-assets');
  assert.strictEqual(records[1].action, 'plan');
  assert.strictEqual(records[1].exitCode, 3);
  assert.strictEqual(records[1].verdict, 'BLOCKED');
  assert.ok(records[1].reasonCodes.includes('CONFLICT'));
  assertDeidentifiedRecord(records[0], { rawPaths: [root, source, target] });
  assertDeidentifiedRecord(records[1], { rawPaths: [root, source, target] });
});

test('install.sh logs dry-run and install attempts without altering exit codes', () => {
  const root = makeTempDir('dhpk-hist-install-sh-');
  const historyFile = path.join(root, 'install-sh-history.jsonl');
  const claudeBin = makeRestrictedBin(['bash', 'git', 'dirname', 'sed', 'cat', 'head', 'tail', 'tr', 'seq', 'awk', 'grep', 'cut', 'python3'], {
    claude: '#!/usr/bin/env bash\nif [[ "${1:-}" == plugin && "${2:-}" == install && "$*" == *"--help"* ]]; then echo "-s, --scope <scope> (default: \\"user\\")"; exit 0; fi\nif [[ "${1:-}" == plugin && "${2:-}" == list ]]; then echo "[]"; exit 0; fi\nexit 0\n',
  });
  const env = { ...process.env, PATH: claudeBin, HOME: root, DHPK_INSTALL_HISTORY_FILE: historyFile };

  const dryRes = spawnSync('bash', [INSTALL_SH, '--dry-run', '--non-interactive'], { encoding: 'utf8', env });
  assert.strictEqual(dryRes.status, 0, `${dryRes.stdout}\n${dryRes.stderr}`);

  const applyRes = spawnSync('bash', [INSTALL_SH, '--non-interactive', '--yes'], { encoding: 'utf8', env });
  assert.strictEqual(applyRes.status, 0, `${applyRes.stdout}\n${applyRes.stderr}`);

  const records = readJsonl(historyFile);
  assert.strictEqual(records.length, 2);
  assert.strictEqual(records[0].surface, 'claude');
  assert.strictEqual(records[0].action, 'plan');
  assert.strictEqual(records[0].exitCode, 0);
  assert.strictEqual(records[0].verdict, 'NOT_RUN');
  assert.strictEqual(records[1].surface, 'claude');
  assert.strictEqual(records[1].action, 'install');
  assert.strictEqual(records[1].exitCode, 0);
  assert.strictEqual(records[1].verdict, 'INSTALL_PASS');
});

test('read-only history path emits warning to stderr only and never fails or alters exit code', () => {
  const root = makeTempDir('dhpk-hist-ro-');
  const roDir = path.join(root, 'readonly');
  const badHistory = path.join(roDir, 'nested', 'history.jsonl');
  const project = path.join(root, 'project');
  fs.mkdirSync(roDir, { mode: 0o555, recursive: true });
  fs.mkdirSync(path.join(project, '.git'), { recursive: true });

  const env = {
    ...process.env,
    PATH: `${CODEX_STUB_BIN}:${process.env.PATH || ''}`,
    HOME: root,
    DHPK_INSTALL_HISTORY_FILE: badHistory,
  };

  try {
    // 1. Passing dhpk-install run still exits 0 and emits valid JSON on stdout
    const okRes = spawnSync(process.execPath, [DHPK_INSTALL, 'codex-sync', 'plan', '--scope', 'project', '--json'], {
      cwd: ROOT, encoding: 'utf8', env,
    });
    assert.strictEqual(okRes.status, 0, okRes.stderr);
    assert.strictEqual(JSON.parse(okRes.stdout).lifecycle.verdict, 'NOT_RUN');
    assert.match(okRes.stderr, /warning/i);

    // 2. Blocked --plan --json still exits 2 (not altered to 1 or 0)
    const missingProj = path.join(root, 'not-a-project');
    fs.mkdirSync(missingProj, { recursive: true });
    const blockedRes = spawnSync(process.execPath, [DHPK_INSTALL, 'codex-sync', 'plan', '--project-root', missingProj, '--json'], {
      cwd: ROOT, encoding: 'utf8', env,
    });
    assert.strictEqual(blockedRes.status, 2, blockedRes.stderr);
    assert.strictEqual(JSON.parse(blockedRes.stdout).verdict, 'BLOCKED');
    assert.match(blockedRes.stderr, /warning/i);

    // 3. install-assets.sh still succeeds on read-only history path
    const assetsTarget = path.join(root, 'assets-proj', '.claude', 'dhpk');
    const assetsRes = spawnSync('bash', [ASSETS_SH, '--source', ROOT, '--target', assetsTarget, '--install', 'hooks'], {
      encoding: 'utf8', env,
    });
    assert.strictEqual(assetsRes.status, 0, `${assetsRes.stdout}\n${assetsRes.stderr}`);
    assert.match(assetsRes.stderr, /warning/i);

    // 4. install-agy-plugin still succeeds on read-only history path and preserves JSON stdout
    const agyPkg = makeAgyPackage(path.join(root, 'agy'), '0.39.0'); // dhpk:historical-version-fixture
    const agyTarget = path.join(root, 'agy-target');
    const agyRes = spawnSync(process.execPath, [AGY_CLI, 'install', '--source', agyPkg, '--target', agyTarget, '--json'], {
      cwd: ROOT, encoding: 'utf8', env,
    });
    assert.strictEqual(agyRes.status, 0, `${agyRes.stdout}\n${agyRes.stderr}`);
    assert.strictEqual(JSON.parse(agyRes.stdout).surface, 'agy-plugin');
    assert.match(agyRes.stderr, /warning/i);

    // 5. install.sh still succeeds on read-only history path
    const claudeBin = makeRestrictedBin(['bash', 'git', 'dirname', 'sed', 'cat', 'head', 'tail', 'tr', 'seq', 'awk', 'grep', 'cut', 'python3'], {
      claude: '#!/usr/bin/env bash\nexit 0\n',
    });
    const installShRes = spawnSync('bash', [INSTALL_SH, '--dry-run', '--non-interactive'], {
      encoding: 'utf8', env: { ...env, PATH: claudeBin },
    });
    assert.strictEqual(installShRes.status, 0, `${installShRes.stdout}\n${installShRes.stderr}`);
    assert.match(installShRes.stderr, /warning/i);
  } finally {
    fs.chmodSync(roDir, 0o755);
  }
});

run('install-history');
