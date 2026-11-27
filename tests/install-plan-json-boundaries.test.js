'use strict';

// `--plan --json` on fail-closed policy and version boundaries (ADR-0031,
// ADR-0036; #1584). Every expected blocker reports a parseable envelope on
// stdout -- verdict BLOCKED, a stable reasonCode, the detected receipt or
// journal version, affected paths and structured remediation -- and exits 2,
// while the project stays byte-for-byte unchanged. The historical blockers are
// deterministic fixtures: a 0.66.6-style partial receipt without
// fingerprint_algorithm, the unfinished journals a 0.72/0.73 installer left,
// and a receipt of a retired named profile.

const { test, run, assert } = require('./_lib/tinytest');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { fakePlugin, write } = require('./_lib/shared-projection-plugin');
const { CODEX_STUB_BIN, snapshotTree } = require('./_lib/install-codex-skills-fixtures');
const { loadLegacyFixture, restoreTree } = require('./_lib/legacy-journal-fixtures');
const { materializeAgyPluginPackage } = require('../scripts/lib/agy-plugin-package');

const ROOT = path.join(__dirname, '..');
const HOOKS = {
  'codex-sync': { script: path.join(ROOT, 'scripts', 'hooks', 'install-codex-skills.sh'), dest: '.codex' },
  cursor: { script: path.join(ROOT, 'scripts', 'hooks', 'install-cursor-harness.sh'), dest: '.cursor' },
};
const AGY_CLI = path.join(ROOT, 'scripts', 'ci', 'install-agy-plugin.js');
const DHPK_INSTALL = path.join(ROOT, 'scripts', 'dhpk-install.js');
const PLAN = ['--copy', '--update', '--plan', '--json', '--force'];

const tempDir = (label) => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `dhpk-plan-json-${label}-`)));
const ISOLATED_STATE_HOME = tempDir('state');
process.on('exit', () => {
  fs.rmSync(ISOLATED_STATE_HOME, { recursive: true, force: true });
});
const output = (result) => `status=${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`;
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJson = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);

function runHook(surface, project, args, plugin) {
  return spawnSync('bash', [HOOKS[surface].script, ...args], {
    cwd: project,
    encoding: 'utf8',
    timeout: 90_000,
    env: { ...process.env, PATH: `${CODEX_STUB_BIN}:${process.env.PATH || ''}`, HOME: project, XDG_STATE_HOME: ISOLATED_STATE_HOME, DHPK_INSTALLER_ROOT: plugin },
  });
}

function runDhpkInstall(args, home) {
  return spawnSync(process.execPath, [DHPK_INSTALL, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 90_000,
    env: { ...process.env, PATH: `${CODEX_STUB_BIN}:${process.env.PATH || ''}`, HOME: home, XDG_STATE_HOME: ISOLATED_STATE_HOME },
  });
}

function runAgy(args) {
  return spawnSync(process.execPath, [AGY_CLI, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 30_000,
    env: { ...process.env, XDG_STATE_HOME: ISOLATED_STATE_HOME },
  });
}

function stdoutJson(result, label) {
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    assert.fail(`${label}: stdout is not one JSON document (${error.message})\n${output(result)}`);
  }
  return null;
}

// The envelope contract; `expected` holds the values a scenario pins.
function assertBlocked(result, expected, label) {
  assert.strictEqual(result.status, 2, `${label}\n${output(result)}`);
  const report = stdoutJson(result, label);
  const text = JSON.stringify(report, null, 2);
  assert.strictEqual(report.verdict, 'BLOCKED', `${label}\n${text}`);
  assert.strictEqual(report.reasonCode, expected.reasonCode, `${label}\n${text}`);
  for (const field of ['receiptVersion', 'journalVersion']) {
    if (Object.prototype.hasOwnProperty.call(expected, field)) assert.strictEqual(report[field], expected[field], `${label}: ${field}\n${text}`);
  }
  assert.ok(Array.isArray(report.affectedPaths) && report.affectedPaths.some((item) => item.includes(expected.affectedPath)),
    `${label}: affectedPaths must name ${expected.affectedPath}\n${text}`);
  assert.ok(Array.isArray(report.remediation) && report.remediation.length > 0, `${label}: remediation\n${text}`);
  for (const entry of report.remediation) {
    assert.deepStrictEqual(Object.keys(entry).sort(), ['command', 'kind', 'releasesEntries', 'summary', 'transitionVersion'], `${label}\n${text}`);
    assert.ok(entry.kind && entry.summary, `${label}: every remediation entry has a kind and a summary\n${text}`);
  }
  if (expected.transitionVersion) {
    assert.ok(report.remediation.some((entry) => entry.transitionVersion === expected.transitionVersion),
      `${label}: remediation must name transitionVersion ${expected.transitionVersion}\n${text}`);
  }
  if (expected.command) {
    assert.ok(report.remediation.some((entry) => typeof entry.command === 'string' && expected.command.test(entry.command)),
      `${label}: remediation command must match ${expected.command}\n${text}`);
  }
  return report;
}

// dhpk-install reports the installer's envelope at its own top level.
function planThroughDhpkInstall(surface, project) {
  return runDhpkInstall([surface, 'plan', '--project-root', project, '--json'], project);
}

function installedProject(surface, plugin) {
  const project = tempDir(`installed-${surface}`);
  fs.mkdirSync(path.join(project, '.git'));
  const installed = runHook(surface, project, ['--copy', '--force'], plugin);
  assert.strictEqual(installed.status, 0, output(installed));
  return project;
}

function withPlugin(body) {
  const plugin = fakePlugin();
  try {
    body(plugin);
  } finally {
    fs.rmSync(plugin, { recursive: true, force: true });
  }
}

function withProject(project, body) {
  try {
    body(project);
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
  }
}

test('a 0.66.6-style partial receipt without fingerprint_algorithm blocks the plan with JSON across Codex, Cursor and dhpk-install', () => {
  withPlugin((plugin) => {
    for (const surface of ['codex-sync', 'cursor']) {
      withProject(installedProject(surface, plugin), (project) => {
        const relative = `${HOOKS[surface].dest}/.dhpk-installed.json`;
        const receiptPath = path.join(project, relative);
        const receipt = readJson(receiptPath);
        delete receipt.fingerprint_algorithm;
        Object.assign(receipt, { plugin_version: '0.66.6', state: 'partial' });
        receipt.reconciliation = { ...(receipt.reconciliation || {}), state: 'partial' };
        writeJson(receiptPath, receipt);
        const before = snapshotTree(project);
        const expected = {
          reasonCode: 'MISSING_FINGERPRINT_ALGORITHM',
          receiptVersion: '0.66.6',
          journalVersion: null,
          affectedPath: relative,
          transitionVersion: '0.69.x',
          command: /uninstall/,
        };
        for (const [label, result] of [
          [`${surface} hook`, runHook(surface, project, PLAN, plugin)],
          [`${surface} dhpk-install`, planThroughDhpkInstall(surface, project)],
        ]) {
          const report = assertBlocked(result, expected, label);
          const uninstall = report.remediation.find((entry) => /uninstall/.test(entry.command || ''));
          assert.strictEqual(uninstall.releasesEntries, true, `${label}: --uninstall releases the entries into Released Entries`);
          assert.ok(report.remediation.some((entry) => entry.transitionVersion === '0.69.x' && /update|install/.test(entry.command || '')), label);
          assert.ok(!/legacy-v|sha256-tree/.test(JSON.stringify(report)), `${label}: no legacy fingerprint recipe is offered`);
        }
        assert.strictEqual(snapshotTree(project), before, `${surface}: planning changes nothing`);
        // Fail-closed stays intact: the update itself still refuses.
        const update = runHook(surface, project, ['--copy', '--update', '--force'], plugin);
        assert.strictEqual(update.status, 2, output(update));
        assert.strictEqual(snapshotTree(project), before);
      });
    }
  });
});

test('a receipt naming an unknown fingerprint algorithm blocks the plan with UNSUPPORTED_FINGERPRINT_ALGORITHM', () => {
  withPlugin((plugin) => {
    withProject(installedProject('codex-sync', plugin), (project) => {
      const receiptPath = path.join(project, '.codex', '.dhpk-installed.json');
      const receipt = readJson(receiptPath);
      receipt.fingerprint_algorithm = 'tree-merkle-v9';
      writeJson(receiptPath, receipt);
      assertBlocked(runHook('codex-sync', project, PLAN, plugin), {
        reasonCode: 'UNSUPPORTED_FINGERPRINT_ALGORITHM',
        receiptVersion: receipt.plugin_version,
        affectedPath: '.codex/.dhpk-installed.json',
        transitionVersion: '0.69.x',
      }, 'unknown algorithm');
    });
  });
});

test('a superseded generatorVersion in the Shared Projection receipt blocks the plan with JSON, as the update does', () => {
  withPlugin((plugin) => {
    withProject(installedProject('codex-sync', plugin), (project) => {
      const receiptPath = path.join(project, '.agents', '.dhpk-installed.json');
      const receipt = readJson(receiptPath);
      receipt.generatorVersion = '2.0.0';
      writeJson(receiptPath, receipt);
      const before = snapshotTree(project);
      const expected = {
        reasonCode: 'SUPERSEDED_GENERATOR_VERSION',
        receiptVersion: '2.0.0',
        journalVersion: null,
        affectedPath: '.agents/.dhpk-installed.json',
        transitionVersion: '0.69.x',
        command: /uninstall/,
      };
      assertBlocked(runHook('codex-sync', project, PLAN, plugin), expected, 'codex hook');
      assertBlocked(planThroughDhpkInstall('codex-sync', project), expected, 'dhpk-install');
      assert.strictEqual(snapshotTree(project), before);
      const update = runHook('codex-sync', project, ['--copy', '--update', '--force'], plugin);
      assert.notStrictEqual(update.status, 0, `the update refuses the same receipt\n${output(update)}`);
    });
  });
});

test('an unfinished 0.72/0.73 Host journal blocks the plan with JSON naming 0.74.x --recover across Codex, Cursor and dhpk-install', () => {
  withPlugin((plugin) => {
    for (const [surface, fixture] of [['codex-sync', 'python-codex-host-journal'], ['cursor', 'python-cursor-host-journal']]) {
      const project = tempDir(`host-journal-${surface}`);
      withProject(project, () => {
        restoreTree(loadLegacyFixture(fixture).interrupted, project, { '@@PROJECT@@': project, '@@PLUGIN@@': plugin });
        const before = snapshotTree(project);
        const expected = {
          reasonCode: 'LEGACY_HOST_JOURNAL',
          journalVersion: '9.9.9',
          affectedPath: `${HOOKS[surface].dest}/.dhpk-transaction-`,
          transitionVersion: '0.74.x',
          command: /--recover/,
        };
        for (const [label, result] of [
          [`${surface} hook`, runHook(surface, project, PLAN, plugin)],
          [`${surface} dhpk-install`, planThroughDhpkInstall(surface, project)],
        ]) {
          // dhpk-install nests the installer's own report under `plan`.
          const report = assertBlocked(result, expected, label);
          const installerReport = report.plan || report;
          assert.ok(installerReport.blocking_recovery.some((line) => /0\.72\/0\.73/.test(line)), label);
          if (surface === 'codex-sync') {
            assert.ok(installerReport.blockers.some((item) => item.reasonCode === 'HELD_PROJECTION_JOURNAL'), `${label}: the held publisher journal is listed too`);
          }
        }
        assert.strictEqual(snapshotTree(project), before, `${surface}: the journals are neither recovered nor rewritten`);
      });
    }
  });
});

test('a held v3 publisher journal blocks the plan with JSON naming its schema and 0.74.x --recover', () => {
  withPlugin((plugin) => {
    const project = tempDir('held-v3');
    withProject(project, () => {
      restoreTree(loadLegacyFixture('held-v3-install').held, project, {});
      const before = snapshotTree(project);
      const expected = {
        reasonCode: 'HELD_PROJECTION_JOURNAL',
        receiptVersion: null,
        journalVersion: 'dhpk.project-agent-projection-transaction.v3',
        affectedPath: '.agents/.dhpk-installed.transaction.json',
        transitionVersion: '0.74.x',
        command: /--recover/,
      };
      assertBlocked(runHook('codex-sync', project, PLAN, plugin), expected, 'codex hook');
      assertBlocked(planThroughDhpkInstall('codex-sync', project), expected, 'dhpk-install');
      assert.strictEqual(snapshotTree(project), before);
    });
  });
});

test('a retired named profile receipt blocks the plan with JSON and exit 2 across Codex, Cursor and dhpk-install', () => {
  withPlugin((plugin) => {
    writeJson(path.join(plugin, 'manifests', 'install-profiles.json'), {
      profiles: { common: { skillIds: ['codex-only', 'portable'] } },
      legacy_profiles: { full: { skillIds: ['codex-only', 'portable'] } },
    });
    for (const surface of ['codex-sync', 'cursor']) {
      withProject(installedProject(surface, plugin), (project) => {
        const relative = `${HOOKS[surface].dest}/.dhpk-installed.json`;
        const receiptPath = path.join(project, relative);
        const receipt = readJson(receiptPath);
        Object.assign(receipt, { profileId: 'full', selectedStableIds: ['codex-only', 'portable'] });
        writeJson(receiptPath, receipt);
        const before = snapshotTree(project);
        const expected = {
          reasonCode: 'LEGACY_PROFILE_UPDATE_UNSUPPORTED',
          receiptVersion: receipt.plugin_version,
          journalVersion: null,
          affectedPath: relative,
          command: /uninstall/,
        };
        const hook = assertBlocked(runHook(surface, project, PLAN, plugin), expected, `${surface} hook`);
        assert.strictEqual(hook.receipt_profile_id, 'full');
        assert.deepStrictEqual(hook.receipt_selected_stable_ids, ['codex-only', 'portable'], 'the plan still reports the stored selection');
        // dhpk-install reads the profile table of its own package, which keeps `full` retired.
        assertBlocked(planThroughDhpkInstall(surface, project), expected, `${surface} dhpk-install`);
        assert.strictEqual(snapshotTree(project), before);
      });
    }
  });
});

test('plan exit codes: 0 ready, 1 with a non-fatal collision report, 64 for argument errors', () => {
  withPlugin((plugin) => {
    withProject(installedProject('codex-sync', plugin), (project) => {
      const ready = runHook('codex-sync', project, PLAN, plugin);
      assert.strictEqual(ready.status, 0, output(ready));
      const readyReport = stdoutJson(ready, 'ready');
      assert.strictEqual(readyReport.verdict, 'READY');
      assert.strictEqual(readyReport.reasonCode, null);
      assert.deepStrictEqual(readyReport.remediation, []);

      fs.appendFileSync(path.join(project, '.codex', 'agents', 'explorer.toml'), '\n# local edit\n');
      write(path.join(plugin, 'codex', 'agents', 'explorer.toml'), 'name = "explorer"\ndescription = "v2"\n');
      const collided = runHook('codex-sync', project, PLAN, plugin);
      assert.strictEqual(collided.status, 1, output(collided));
      const report = stdoutJson(collided, 'collision');
      assert.strictEqual(report.verdict, 'BLOCKED');
      assert.strictEqual(report.reasonCode, 'UNOWNED_COLLISION');
      assert.ok(report.affectedPaths.includes('.codex/agents/explorer.toml'), JSON.stringify(report.affectedPaths));
      const adopt = report.remediation.find((entry) => entry.kind === 'adopt');
      const collision = report.collisions.find((item) => item.path === 'agents/explorer.toml');
      assert.ok(adopt && adopt.command.endsWith(collision.action), JSON.stringify(report.remediation));
    });
    for (const surface of ['codex-sync', 'cursor']) {
      const bogus = runHook(surface, ROOT, ['--plan', '--json', '--bogus'], plugin);
      assert.strictEqual(bogus.status, 64, output(bogus));
    }
  });
  const project = tempDir('argv');
  withProject(project, () => {
    assert.strictEqual(runDhpkInstall(['codex-sync', 'plan', '--project-root', project, '--bogus'], project).status, 64);
  });
});

// AGY package fixtures: one source package and a target the plan inspects.
const COMMIT = 'd'.repeat(40);
function agyPackage(root, version) {
  const source = path.join(root, `src-${version}`);
  const outDir = path.join(root, `pkg-${version}`);
  write(path.join(source, 'agents', 'sample.md'), ['---', 'name: sample', 'description: Sample', 'tools: ["view_file"]', 'model: inherit', '---', '', '# Agent', ''].join('\n'));
  write(path.join(source, 'rules', 'sample.md'), '# Rule\n');
  write(path.join(source, 'skills', 'dhpk-sample', 'SKILL.md'), '---\nname: dhpk-sample\ndescription: Sample\n---\n# Skill\n');
  materializeAgyPluginPackage({
    root: source,
    inventory: {
      schema: 'dhpk.distribution-inventory.v2',
      skills: [{ id: 'sample', path: 'skills/dhpk-sample', surfaces: ['agy-plugin'] }],
      modules: [],
      surface_membership: { 'agy-plugin': ['sample'] },
      agy_plugin: { agents: ['sample.md'], rules: ['rules/sample.md'] },
    },
    outDir,
    version,
    sourceVersion: version,
    sourceCommit: COMMIT,
  });
  return outDir;
}

test('AGY plan: blocked targets and receipts report the envelope with exit 2; ready exits 0; argument errors exit 64', () => {
  const root = tempDir('agy');
  withProject(root, () => {
    const pkg = agyPackage(root, '0.70.0');

    const absent = runAgy(['plan', '--source', pkg, '--target', path.join(root, 'absent'), '--json']);
    assert.strictEqual(absent.status, 0, output(absent));
    assert.strictEqual(stdoutJson(absent, 'absent').verdict, 'READY');

    const unowned = path.join(root, 'unowned');
    write(path.join(unowned, 'agents', 'sample.md'), '# A user file\n');
    assertBlocked(runAgy(['plan', '--source', pkg, '--target', unowned, '--json']), {
      reasonCode: 'UNOWNED_TARGET', receiptVersion: null, journalVersion: null, affectedPath: unowned,
    }, 'agy unowned target');

    const partial = path.join(root, 'partial');
    write(path.join(partial, 'provenance.json'), `${JSON.stringify({ schema: 'dhpk.agy-plugin.v1', surface: 'agy-plugin', sourceVersion: '0.66.6', state: 'partial' })}\n`);
    const before = fs.readFileSync(path.join(partial, 'provenance.json'), 'utf8');
    assertBlocked(runAgy(['plan', '--source', pkg, '--target', partial, '--json']), {
      reasonCode: 'INVALID_RECEIPT', receiptVersion: '0.66.6', journalVersion: null, affectedPath: 'provenance.json',
    }, 'agy 0.66.6 partial receipt');
    assert.strictEqual(fs.readFileSync(path.join(partial, 'provenance.json'), 'utf8'), before);

    const notAPackage = path.join(root, 'not-a-package');
    fs.mkdirSync(notAPackage);
    assertBlocked(runAgy(['plan', '--source', notAPackage, '--target', path.join(root, 'absent'), '--json']), {
      reasonCode: 'INVALID_SOURCE_PACKAGE', affectedPath: notAPackage,
    }, 'agy invalid source');

    for (const argv of [['bogus-action'], ['plan', '--bogus', '--json'], ['plan', '--source']]) {
      const result = runAgy(argv);
      assert.strictEqual(result.status, 64, `${argv.join(' ')}\n${output(result)}`);
    }
  });
});

run('install-plan-json-boundaries');
