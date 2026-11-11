'use strict';

// Crash and failure sweeps of the JS installer adapter, shared by the Codex
// and Cursor journal suites (js-projection-journal stages 3 and 4). A sweep
// replays one scenario, injecting a simulated crash (or a thrown failure)
// after or in the middle of every Projection Journal step, and checks that
// recovery lands on the complete previous or the complete new state. All runs
// are in-process.

const { test, assert } = require('./tinytest');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { installerEnv, runCaptured } = require('../../scripts/lib/install-adapters/codex-cli');
const { SimulatedCrash } = require('../../scripts/lib/projection-journal');
const { fakePlugin, REPO } = require('./shared-projection-plugin');
const { CODEX_STUB_BIN } = require('./install-codex-skills-fixtures');
const { normalizer } = require('./run-normalizer');

const JOURNAL = path.join('.agents', '.dhpk-projection-journal.json');
const LOCK = path.join('.agents', '.dhpk-install.lock');

function tempDir(prefix) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

function cleanup(...directories) {
  for (const directory of directories) fs.rmSync(directory, { recursive: true, force: true });
}

// A runner of one in-process installer invocation for `host`.
function makeRunIn(host) {
  const envFor = (plugin, project, options = {}) => installerEnv({
    host,
    pluginRoot: plugin,
    installerRoot: REPO,
    projectRoot: project,
    mode: 'copy',
    modeExplicit: true,
    baseEnv: { ...process.env, PATH: `${CODEX_STUB_BIN}:${process.env.PATH || ''}` },
    ...options,
  });
  return (plugin, project, options = {}, hooks = {}) => runCaptured(envFor(plugin, project, options), {
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

function prepareTemplate(scenario) {
  const plugin = fakePlugin();
  const project = tempDir('dhpk-adapter-template-');
  fs.mkdirSync(path.join(project, '.git'));
  scenario.prepare(plugin, project);
  return { plugin, project, options: scenario.options(plugin, project) };
}

// Registers a crash sweep and a failure sweep per scenario. `runIn` is the
// host's runner; `expectedPoints` pins how many points each sweep visits (a
// sweep that visits fewer has stopped covering a step: update the table with
// a step the adapter adds or removes on purpose). `label` prefixes test names
// for hosts other than Codex.
function registerSweeps({ runIn, scenarios, expectedPoints, label = '' }) {
  for (const [name, scenario] of Object.entries(scenarios)) {
    test(`test${label}AdapterCrashSweep_${name}_recoveryLeavesPreviousOrNewState`, () => {
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
              // Lock and journal are gone once recovery or the rerun is done.
              assert.strictEqual(fs.existsSync(path.join(project, LOCK)), false, `${name}: crash ${when} step ${target} left the lock`);
              assert.strictEqual(fs.existsSync(path.join(project, JOURNAL)), false, `${name}: crash ${when} step ${target} left the journal`);
            } finally {
              cleanup(project);
            }
          }
        }
        assert.strictEqual(crashes, expectedPoints[name].crash, `${name}: the sweep visited ${crashes} crash points`);
      } finally {
        cleanup(template.plugin, template.project);
      }
    });

    test(`test${label}AdapterFailureAtEachStep_${name}_restoresPreviousState`, () => {
      const template = prepareTemplate(scenario);
      try {
        let failures = 0;
        for (let target = 1; target < 400; target += 1) {
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
            // Lock and journal are gone in both branches.
            assert.strictEqual(fs.existsSync(path.join(project, LOCK)), false, `${name}: failure at step ${target} left the lock`);
            assert.strictEqual(fs.existsSync(path.join(project, JOURNAL)), false, `${name}: failure at step ${target} left the journal`);
          } finally {
            cleanup(project);
          }
        }
        assert.strictEqual(failures, expectedPoints[name].failure, `${name}: the sweep visited ${failures} failure points`);
      } finally {
        cleanup(template.plugin, template.project);
      }
    });
  }
}

module.exports = {
  JOURNAL,
  LOCK,
  tempDir,
  cleanup,
  makeRunIn,
  snapshot,
  deadPid,
  markHolderDead,
  clone,
  prepareTemplate,
  registerSweeps,
};
