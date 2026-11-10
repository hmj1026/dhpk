'use strict';

// js-projection-journal stage 3 (tasks 3.4, 3.5, 3.6, 3.8): the JS Codex
// adapter records native and Shared Project Projection effects in one
// Projection Journal. A crash after any step, or in the middle of one, is
// recovered to the complete previous or the complete new state (REQ-5, REQ-8);
// a failure before the commit point restores the previous state (REQ-4); one
// project lock serializes runs. All runs are in-process.

const { test, run, assert } = require('./_lib/tinytest');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { installerEnv, runCaptured } = require('../scripts/lib/install-adapters/codex-cli');
const { SimulatedCrash } = require('../scripts/lib/projection-journal');
const { fakePlugin, write, skillBody, REPO } = require('./_lib/shared-projection-plugin');
const { CODEX_STUB_BIN, runInstaller: runShellInstaller } = require('./_lib/install-codex-skills-fixtures');
const { normalizer } = require('./_lib/installer-parity');

const JOURNAL = path.join('.agents', '.dhpk-projection-journal.json');
const LOCK = path.join('.agents', '.dhpk-install.lock');

function tempDir(prefix) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

function envFor(plugin, project, options = {}) {
  return installerEnv({
    host: 'codex',
    pluginRoot: plugin,
    installerRoot: REPO,
    projectRoot: project,
    mode: 'copy',
    modeExplicit: true,
    baseEnv: { ...process.env, PATH: `${CODEX_STUB_BIN}:${process.env.PATH || ''}` },
    ...options,
  });
}

function runIn(plugin, project, options = {}, hooks = {}) {
  return runCaptured(envFor(plugin, project, options), {
    afterStep: hooks.afterStep || null,
    rethrow: (error) => error instanceof SimulatedCrash,
  });
}

// Every path under the project, with link targets and normalized file text.
function snapshot(project, plugin) {
  const normalize = normalizer([[project, '<PROJECT>'], [plugin, '<PLUGIN>']]);
  const lines = [];
  const visit = (current, relative) => {
    const stat = fs.lstatSync(current);
    const name = normalize(relative);
    if (stat.isSymbolicLink()) lines.push(`link:${name}:${normalize(fs.readlinkSync(current))}`);
    else if (stat.isDirectory()) {
      lines.push(`dir:${name}:${(stat.mode & 0o777).toString(8)}`);
      for (const child of fs.readdirSync(current).sort()) visit(path.join(current, child), `${relative}/${child}`);
    } else lines.push(`file:${name}:${(stat.mode & 0o777).toString(8)}:${normalize(fs.readFileSync(current, 'utf8'))}`);
  };
  visit(project, '.');
  return lines;
}

function deadPid() {
  const child = spawnSync(process.execPath, ['-e', ''], { encoding: 'utf8' });
  return child.pid;
}

// A crash leaves the lock and the journal of a process that no longer runs.
function markHolderDead(project) {
  const pid = deadPid();
  for (const relative of [LOCK, JOURNAL]) {
    const file = path.join(project, relative);
    if (!fs.existsSync(file)) continue;
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    value.pid = pid;
    fs.writeFileSync(file, `${JSON.stringify(value)}\n`);
  }
}

function clone(template) {
  const project = tempDir('dhpk-adapter-project-');
  fs.cpSync(template.project, project, { recursive: true, verbatimSymlinks: true });
  return project;
}

function adoptToken(plugin, project, relative) {
  const plan = runIn(plugin, project, { plan: true, json: true, update: true });
  const report = JSON.parse(plan.stdout);
  const collision = report.collisions.find((item) => item.path === relative);
  assert.ok(collision, plan.stdout);
  return `${relative}@${collision.destination_fingerprint}@${collision.source_fingerprint}`;
}

const SCENARIOS = {
  install: {
    prepare: (plugin, project) => {},
    options: () => ({}),
  },
  update: {
    prepare: (plugin, project) => {
      assert.strictEqual(runIn(plugin, project).code, 0);
      write(path.join(plugin, 'skills', 'dhpk-codex-only', 'SKILL.md'), skillBody('dhpk-codex-only', 'Codex only v2'));
      write(path.join(plugin, 'codex', 'skills', 'dhpk-codex-only', 'SKILL.md'), skillBody('dhpk-codex-only', 'Codex only v2'));
      write(path.join(plugin, 'codex', 'agents', 'explorer.toml'), 'name = "explorer"\ndescription = "explore v2"\n');
    },
    options: () => ({ update: true }),
  },
  uninstall: {
    prepare: (plugin, project) => assert.strictEqual(runIn(plugin, project).code, 0),
    options: () => ({ uninstall: true }),
  },
  adoption: {
    prepare: (plugin, project) => {
      write(path.join(project, '.codex', 'agents', 'explorer.toml'), 'name = "explorer"\ndescription = "user edit"\n');
      assert.strictEqual(runIn(plugin, project).code, 0);
    },
    options: (plugin, project) => ({ update: true, adoptPaths: [adoptToken(plugin, project, 'agents/explorer.toml')] }),
  },
};

function prepareTemplate(scenario) {
  const plugin = fakePlugin();
  const project = tempDir('dhpk-adapter-template-');
  fs.mkdirSync(path.join(project, '.git'));
  scenario.prepare(plugin, project);
  return { plugin, project, options: scenario.options(plugin, project) };
}

function cleanup(...directories) {
  for (const directory of directories) fs.rmSync(directory, { recursive: true, force: true });
}

for (const [name, scenario] of Object.entries(SCENARIOS)) {
  test(`testAdapterCrashSweep_${name}_recoveryLeavesPreviousOrNewState`, () => {
    const template = prepareTemplate(scenario);
    try {
      // Snapshots compare clones with clones: a copy does not keep directory modes.
      const expected = clone(template);
      const before = snapshot(expected, template.plugin);
      const clean = runIn(template.plugin, expected, template.options);
      const after = snapshot(expected, template.plugin);
      cleanup(expected);
      assert.ok([0, 1].includes(clean.code), `${clean.stdout}\n${clean.stderr}`);
      let crashes = 0;
      for (const when of ['after', 'mid']) {
        for (let target = 1; target < 400; target += 1) {
          const project = clone(template);
          try {
            let crashed = false;
            try {
              runIn(template.plugin, project, template.options, {
                afterStep: { [when]: (step) => { if (step === target) { crashed = true; throw new SimulatedCrash(step); } } },
              });
            } catch (error) {
              if (!(error instanceof SimulatedCrash)) throw error;
            }
            if (!crashed) break;
            crashes += 1;
            assert.ok(fs.existsSync(path.join(project, JOURNAL)), `${name}: crash ${when} step ${target} left no journal`);
            markHolderDead(project);
            if (target % 3 === 0) {
              // REQ-5: the next ordinary run undoes or finishes the
              // interrupted transaction and completes its own run.
              const rerun = runIn(template.plugin, project, template.options);
              assert.strictEqual(rerun.code, clean.code, `${name}: rerun after crash ${when} step ${target}\n${rerun.stdout}\n${rerun.stderr}`);
              assert.deepStrictEqual(snapshot(project, template.plugin), after, `${name}: rerun after crash ${when} step ${target}`);
            } else {
              const recovered = runIn(template.plugin, project, { recover: true });
              assert.strictEqual(recovered.code, 0, `${name}: recover after crash ${when} step ${target}\n${recovered.stdout}\n${recovered.stderr}`);
              const state = snapshot(project, template.plugin);
              const matches = JSON.stringify(state) === JSON.stringify(before) || JSON.stringify(state) === JSON.stringify(after);
              assert.ok(matches, `${name}: crash ${when} step ${target} recovered to a mixed state`);
            }
          } finally {
            cleanup(project);
          }
        }
      }
      assert.ok(crashes >= 10, `${name}: only ${crashes} crash points`);
    } finally {
      cleanup(template.plugin, template.project);
    }
  });

  test(`testAdapterFailureAtEachStep_${name}_restoresPreviousState`, () => {
    const template = prepareTemplate(scenario);
    try {
      let failures = 0;
      for (let target = 1; target < 400; target += 4) {
        const project = clone(template);
        const before = snapshot(project, template.plugin);
        try {
          let injected = false;
          const outcome = runIn(template.plugin, project, template.options, {
            afterStep: (step) => { if (step === target) { injected = true; throw new Error(`injected failure at step ${step}`); } },
          });
          if (!injected) break;
          failures += 1;
          assert.notStrictEqual(outcome.code, 0, `${name}: failure at step ${target} still exited 0`);
          const journalFile = path.join(project, JOURNAL);
          if (fs.existsSync(journalFile) && JSON.parse(fs.readFileSync(journalFile, 'utf8')).phase === 'published') {
            // REQ-4: past the commit point nothing rolls back; recovery finishes it.
            const expected = clone(template);
            runIn(template.plugin, expected, template.options);
            const after = snapshot(expected, template.plugin);
            cleanup(expected);
            const recovered = runIn(template.plugin, project, { recover: true });
            assert.strictEqual(recovered.code, 0, recovered.stderr);
            assert.deepStrictEqual(snapshot(project, template.plugin), after, `${name}: failure after the commit point at step ${target}`);
          } else {
            assert.deepStrictEqual(snapshot(project, template.plugin), before, `${name}: failure at step ${target}\n${outcome.stderr}`);
          }
        } finally {
          cleanup(project);
        }
      }
      assert.ok(failures >= 3, `${name}: only ${failures} failure points`);
    } finally {
      cleanup(template.plugin, template.project);
    }
  });
}

test('testInstallLock_heldByAnotherHost_failsBeforeChangingFiles', () => {
  const plugin = fakePlugin();
  const project = tempDir('dhpk-adapter-lock-');
  try {
    fs.mkdirSync(path.join(project, '.git'));
    write(path.join(project, LOCK), `${JSON.stringify({ pid: process.pid, host: 'cursor', start: '2026-11-10T00:00:00.000Z' })}\n`);
    const before = snapshot(project, plugin);
    const outcome = runIn(plugin, project);
    assert.strictEqual(outcome.code, 2, outcome.stdout);
    assert.match(outcome.stderr, /already reconciling this project: \.agents\/\.dhpk-install\.lock \(held by the cursor installer, pid \d+/);
    assert.deepStrictEqual(snapshot(project, plugin), before);
  } finally {
    cleanup(plugin, project);
  }
});

test('testInstallLock_staleWithoutJournal_isRemovedOnlyByRecover', () => {
  const plugin = fakePlugin();
  const project = tempDir('dhpk-adapter-stale-');
  try {
    fs.mkdirSync(path.join(project, '.git'));
    write(path.join(project, LOCK), `${JSON.stringify({ pid: deadPid(), host: 'codex', start: '2026-11-10T00:00:00.000Z' })}\n`);
    const blocked = runIn(plugin, project);
    assert.strictEqual(blocked.code, 2);
    assert.match(blocked.stderr, /stale install lock .*rerun this installer with --recover/);
    assert.ok(fs.existsSync(path.join(project, LOCK)));
    assert.strictEqual(fs.existsSync(path.join(project, '.codex')), false);
    const recovered = runIn(plugin, project, { recover: true });
    assert.strictEqual(recovered.code, 0, recovered.stderr);
    assert.match(recovered.stdout, /removing stale install lock/);
    assert.strictEqual(fs.existsSync(path.join(project, LOCK)), false);
    assert.strictEqual(runIn(plugin, project).code, 0);
  } finally {
    cleanup(plugin, project);
  }
});

test('testDhpkInstallRecover_finishesACrashedJournal', () => {
  const plugin = fakePlugin();
  const project = tempDir('dhpk-adapter-recover-');
  try {
    fs.mkdirSync(path.join(project, '.git'));
    const before = snapshot(project, plugin);
    try {
      runIn(plugin, project, {}, { afterStep: (step) => { if (step === 6) throw new SimulatedCrash(step); } });
    } catch (error) {
      if (!(error instanceof SimulatedCrash)) throw error;
    }
    markHolderDead(project);
    const recovered = spawnSync(process.execPath, [path.join(REPO, 'scripts', 'dhpk-install.js'), '--recover', '--project-root', project, '--json'], { encoding: 'utf8' });
    assert.strictEqual(recovered.status, 0, recovered.stdout + recovered.stderr);
    const report = JSON.parse(recovered.stdout);
    assert.strictEqual(report.projectionJournal.state, 'RECOVERED', recovered.stdout);
    assert.deepStrictEqual(snapshot(project, plugin), before);
  } finally {
    cleanup(plugin, project);
  }
});

// Task 3.6: a Host journal the previous release's Python installer left in
// flight, with its publication held, is undone by its own commit point.
test('testPreviousReleaseHeldTransaction_isRolledBackByTheJsInstaller', () => {
  const plugin = fakePlugin();
  const project = tempDir('dhpk-adapter-legacy-');
  try {
    fs.mkdirSync(path.join(project, '.git'));
    const first = runShellInstaller(project, ['--copy', '--force'], plugin, { DHPK_INSTALLER_ENGINE: 'python' });
    assert.strictEqual(first.status, 0, first.stderr);
    const before = snapshot(project, plugin).filter((line) => !/\.dhpk-transaction-|\.dhpk-install\.lock/.test(line));
    write(path.join(plugin, 'skills', 'dhpk-codex-only', 'SKILL.md'), skillBody('dhpk-codex-only', 'Codex only v2'));
    const killed = runShellInstaller(project, ['--copy', '--update', '--force'], plugin, { DHPK_INSTALLER_ENGINE: 'python', DHPK_TEST_KILL_AT: 'after-shared-projection' });
    assert.notStrictEqual(killed.status, 0);
    assert.ok(fs.existsSync(path.join(project, '.agents', '.dhpk-installed.transaction.json')), 'the Python run must leave a held publication');
    write(path.join(plugin, 'skills', 'dhpk-codex-only', 'SKILL.md'), skillBody('dhpk-codex-only', 'Codex only'));
    const recovered = runIn(plugin, project, { recover: true });
    assert.strictEqual(recovered.code, 0, `${recovered.stdout}\n${recovered.stderr}`);
    assert.strictEqual(fs.existsSync(path.join(project, '.agents', '.dhpk-installed.transaction.json')), false);
    const state = snapshot(project, plugin).filter((line) => !/\.dhpk-transaction-|\.dhpk-install\.lock|\.dhpk-backups/.test(line));
    assert.deepStrictEqual(state, before.filter((line) => !/\.dhpk-backups/.test(line)));
  } finally {
    cleanup(plugin, project);
  }
});

// The shell entry point routes Codex to the JS installer, so no python3 is
// needed on PATH (only the tools the shell itself calls, plus node).
test('testShellEntryPoint_codexInstallsWithoutPython3OnPath', () => {
  const plugin = fakePlugin();
  const project = tempDir('dhpk-adapter-nopython-');
  const bin = tempDir('dhpk-adapter-nopython-bin-');
  try {
    fs.mkdirSync(path.join(project, '.git'));
    for (const tool of ['bash', 'dirname', 'sed', 'node']) {
      const found = spawnSync('/bin/sh', ['-c', `command -v ${tool}`], { encoding: 'utf8' }).stdout.trim();
      assert.ok(found, `${tool} must exist on the test host`);
      fs.symlinkSync(tool === 'node' ? process.execPath : found, path.join(bin, tool));
    }
    const outcome = runShellInstaller(project, ['--copy', '--force'], plugin, { PATH: `${CODEX_STUB_BIN}:${bin}` });
    assert.strictEqual(outcome.status, 0, `${outcome.stdout}\n${outcome.stderr}`);
    assert.doesNotMatch(outcome.stderr, /python3/);
    assert.ok(fs.existsSync(path.join(project, '.codex', '.dhpk-installed.json')));
  } finally {
    cleanup(plugin, project);
    fs.rmSync(bin, { recursive: true, force: true });
  }
});

// Task 3.6: a flag-based (v1/v2) publisher journal is older than the stage-1
// release; the JS installer blocks without changing files and names 0.71.0.
for (const schema of ['dhpk.project-agent-projection-transaction.v1', 'dhpk.project-agent-projection-transaction.v2']) {
  test(`testFlagPublisherJournal_${schema.slice(-2)}_failsClosedNamingStageOneRelease`, () => {
    const plugin = fakePlugin();
    const project = tempDir('dhpk-adapter-flag-');
    try {
      fs.mkdirSync(path.join(project, '.git'));
      assert.strictEqual(runIn(plugin, project).code, 0);
      write(path.join(project, '.agents', '.dhpk-installed.transaction.json'), `${JSON.stringify({ schema, phase: 'publishing' })}\n`);
      const before = snapshot(project, plugin);
      for (const options of [{ update: true }, { recover: true }]) {
        const outcome = runIn(plugin, project, options);
        assert.notStrictEqual(outcome.code, 0, outcome.stdout);
        assert.match(`${outcome.stdout}\n${outcome.stderr}`, /dhpk 0\.71\.0/);
        assert.deepStrictEqual(snapshot(project, plugin), before);
      }
    } finally {
      cleanup(plugin, project);
    }
  });
}

run('install-codex-adapter-journal');
