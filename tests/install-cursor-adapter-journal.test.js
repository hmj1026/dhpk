'use strict';

// js-projection-journal stage 4: the JS adapter run as the Cursor installer
// records native Cursor and Shared Project Projection effects in the same
// Projection Journal, under the same project lock, as Codex. Crash and
// failure sweeps mirror tests/install-codex-adapter-journal.test.js (REQ-4,
// REQ-5, REQ-8); the remaining tests cover what is specific to Cursor
// moving off the Python installer: the lock shared with Codex, leftovers of
// the previous Python Cursor installer, and running without python3.

const { test, run, assert } = require('./_lib/tinytest');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { SimulatedCrash } = require('../scripts/lib/projection-journal');
const { fakePlugin, write, skillBody, REPO } = require('./_lib/shared-projection-plugin');
const { CODEX_STUB_BIN } = require('./_lib/install-codex-skills-fixtures');
const { loadLegacyFixture, restoreTree } = require('./_lib/legacy-journal-fixtures');
const {
  JOURNAL,
  LOCK,
  tempDir,
  cleanup,
  makeRunIn,
  snapshot,
  deadPid,
  markHolderDead,
  registerSweeps,
} = require('./_lib/adapter-journal-sweep');

const HOOK = path.join(REPO, 'scripts', 'hooks', 'install-cursor-harness.sh');
const runIn = makeRunIn('cursor');
const runCodex = makeRunIn('codex');
const USER_RULE = '---\nname: prefer-const\ndescription: user edit\nalwaysApply: false\n---\n# User rule\n';

function shell(project, args, plugin, env = {}) {
  return spawnSync('bash', [HOOK, ...args], {
    cwd: project,
    env: { ...process.env, PATH: `${CODEX_STUB_BIN}:${process.env.PATH || ''}`, CLAUDE_PLUGIN_ROOT: plugin, ...env },
    encoding: 'utf8',
    timeout: 60_000,
  });
}

function adoptToken(plugin, project, relative) {
  const plan = runIn(plugin, project, { plan: true, json: true, update: true });
  const report = JSON.parse(plan.stdout);
  const collision = report.collisions.find((item) => item.path === relative);
  assert.ok(collision, plan.stdout);
  return `${relative}@${collision.destination_fingerprint}@${collision.source_fingerprint}`;
}

function changeSources(plugin) {
  write(path.join(plugin, 'skills', 'dhpk-portable', 'SKILL.md'), skillBody('dhpk-portable', 'Portable v2'));
  write(path.join(plugin, 'cursor', 'skills', 'dhpk-portable', 'SKILL.md'), skillBody('dhpk-portable', 'Portable v2'));
  write(path.join(plugin, 'cursor', 'commands', 'review.md'), '---\nname: review\ndescription: review command v2\n---\n# Review v2\n');
}

const SCENARIOS = {
  install: {
    prepare: () => {},
    options: () => ({}),
  },
  update: {
    prepare: (plugin, project) => {
      assert.strictEqual(runIn(plugin, project).code, 0);
      changeSources(plugin);
    },
    options: () => ({ update: true }),
  },
  uninstall: {
    prepare: (plugin, project) => assert.strictEqual(runIn(plugin, project).code, 0),
    options: () => ({ uninstall: true }),
  },
  adoption: {
    prepare: (plugin, project) => {
      write(path.join(project, '.cursor', 'rules', 'prefer-const.mdc'), USER_RULE);
      assert.ok([0, 1].includes(runIn(plugin, project).code));
      assert.strictEqual(fs.readFileSync(path.join(project, '.cursor', 'rules', 'prefer-const.mdc'), 'utf8'), USER_RULE, 'the unowned rule must be preserved');
    },
    options: (plugin, project) => ({ update: true, adoptPaths: [adoptToken(plugin, project, 'rules/prefer-const.mdc')] }),
  },
};

// Journal steps are deterministic per scenario; see adapter-journal-sweep.js.
const EXPECTED_POINTS = {
  install: { crash: 44, failure: 23 },
  update: { crash: 50, failure: 26 },
  uninstall: { crash: 30, failure: 16 },
  adoption: { crash: 50, failure: 26 },
};

registerSweeps({ runIn, scenarios: SCENARIOS, expectedPoints: EXPECTED_POINTS, label: 'Cursor' });

// The adoption sweep is only meaningful when the scenario really adopts.
test('testCursorAdoptionScenario_adoptsTheUnownedRuleIntoTheReceipt', () => {
  const plugin = fakePlugin();
  const project = tempDir('dhpk-cursor-adopt-');
  try {
    fs.mkdirSync(path.join(project, '.git'));
    SCENARIOS.adoption.prepare(plugin, project);
    const outcome = runIn(plugin, project, SCENARIOS.adoption.options(plugin, project));
    assert.strictEqual(outcome.code, 0, `${outcome.stdout}\n${outcome.stderr}`);
    const adopted = fs.readFileSync(path.join(project, '.cursor', 'rules', 'prefer-const.mdc'), 'utf8');
    assert.notStrictEqual(adopted, USER_RULE);
    assert.strictEqual(adopted, fs.readFileSync(path.join(plugin, 'cursor', 'rules', 'prefer-const.mdc'), 'utf8'));
    const receipt = JSON.parse(fs.readFileSync(path.join(project, '.cursor', '.dhpk-installed.json'), 'utf8'));
    assert.match(JSON.stringify(receipt), /rules\/prefer-const\.mdc/);
  } finally {
    cleanup(plugin, project);
  }
});

function crash(runner, plugin, project, stepNumber = 6) {
  try {
    runner(plugin, project, {}, { afterStep: (step) => { if (step === stepNumber) throw new SimulatedCrash(step); } });
  } catch (error) {
    if (!(error instanceof SimulatedCrash)) throw error;
  }
}

// REQ-3: one project lock serializes Codex and Cursor.
test('testCursorInstallLock_heldByALiveCodexInstaller_failsBeforeChangingFiles', () => {
  const plugin = fakePlugin();
  const project = tempDir('dhpk-cursor-lock-');
  try {
    fs.mkdirSync(path.join(project, '.git'));
    write(path.join(project, LOCK), `${JSON.stringify({ pid: process.pid, host: 'codex', start: '2026-11-10T00:00:00.000Z' })}\n`);
    const before = snapshot(project, plugin);
    const outcome = runIn(plugin, project);
    assert.strictEqual(outcome.code, 2, outcome.stdout);
    assert.match(outcome.stderr, /already reconciling this project: \.agents\/\.dhpk-install\.lock \(held by the codex installer, pid \d+/);
    assert.deepStrictEqual(snapshot(project, plugin), before);
    assert.strictEqual(fs.existsSync(path.join(project, '.cursor')), false);
  } finally {
    cleanup(plugin, project);
  }
});

// A Codex run that crashed mid-transaction blocks Cursor while its process
// lives. Once that process is gone the lock and the journal belong to the same
// dead pid, so Cursor takes the lock over, rolls the interrupted Codex
// transaction back (the pre-run state), and then completes its own install:
// the outcome equals a Cursor install on a project Codex never touched.
test('testCursorInstallLock_crashedCodexRun_blocksWhileAliveThenCursorTakesOverAndCompletes', () => {
  const plugin = fakePlugin();
  const project = tempDir('dhpk-cursor-overlap-');
  const reference = tempDir('dhpk-cursor-overlap-ref-');
  try {
    fs.mkdirSync(path.join(project, '.git'));
    fs.mkdirSync(path.join(reference, '.git'));
    crash(runCodex, plugin, project);
    assert.ok(fs.existsSync(path.join(project, JOURNAL)), 'the crashed Codex run must leave its journal');
    const crashed = snapshot(project, plugin);

    const blocked = runIn(plugin, project);
    assert.strictEqual(blocked.code, 2, `${blocked.stdout}\n${blocked.stderr}`);
    assert.match(blocked.stderr, /already reconciling this project: \.agents\/\.dhpk-install\.lock \(held by the codex installer, pid \d+/);
    assert.deepStrictEqual(snapshot(project, plugin), crashed);

    markHolderDead(project);
    const takeover = runIn(plugin, project);
    assert.strictEqual(takeover.code, 0, `${takeover.stdout}\n${takeover.stderr}`);
    assert.match(takeover.stdout, /taking over the install lock of interrupted transaction \.agents\/\.dhpk-install\.lock \(held by the codex installer, pid \d+/);
    assert.match(takeover.stdout, /recovered interrupted codex transaction \S+: rolled back; re-run install-codex-skills to apply it/);
    assert.strictEqual(fs.existsSync(path.join(project, LOCK)), false);
    assert.strictEqual(fs.existsSync(path.join(project, JOURNAL)), false);
    assert.strictEqual(fs.existsSync(path.join(project, '.codex')), false, 'the rolled-back Codex install must leave nothing');
    assert.strictEqual(runIn(plugin, reference).code, 0);
    assert.deepStrictEqual(snapshot(project, plugin), snapshot(reference, plugin));
  } finally {
    cleanup(plugin, project, reference);
  }
});

// Crashes `runner` at the first step after which the journal has reached its
// commit point (phase `published`), and returns the earliest such step.
function crashAfterCommitPoint(runner, plugin, project) {
  for (let step = 1; step < 400; step += 1) {
    const dir = tempDir('dhpk-cursor-commit-probe-');
    try {
      fs.mkdirSync(path.join(dir, '.git'));
      crash(runner, plugin, dir, step);
      const journalFile = path.join(dir, JOURNAL);
      if (!fs.existsSync(journalFile)) continue;
      if (JSON.parse(fs.readFileSync(journalFile, 'utf8')).phase !== 'published') continue;
      crash(runner, plugin, project, step);
      return step;
    } finally {
      cleanup(dir);
    }
  }
  throw new Error('no step reaches the commit point');
}

// Whichever Host takes over says what became of the other Host's transaction.
test('testCrossHostTakeover_codexCrashedAfterTheCommitPoint_cursorFinishesItAndSaysSo', () => {
  const plugin = fakePlugin();
  const project = tempDir('dhpk-cursor-finish-');
  try {
    fs.mkdirSync(path.join(project, '.git'));
    crashAfterCommitPoint(runCodex, plugin, project);
    markHolderDead(project);
    const takeover = runIn(plugin, project);
    assert.strictEqual(takeover.code, 0, `${takeover.stdout}\n${takeover.stderr}`);
    assert.match(takeover.stdout, /recovered interrupted codex transaction \S+: finished; its changes are in place/);
    assert.ok(fs.existsSync(path.join(project, '.codex', '.dhpk-installed.json')), 'the finished Codex install stays');
    assert.ok(fs.existsSync(path.join(project, '.cursor', '.dhpk-installed.json')), 'and the Cursor install is added');
  } finally {
    cleanup(plugin, project);
  }
});

test('testCrossHostTakeover_cursorCrashedBeforeTheCommitPoint_codexRollsItBackAndSaysSo', () => {
  const plugin = fakePlugin();
  const project = tempDir('dhpk-cursor-reverse-');
  try {
    fs.mkdirSync(path.join(project, '.git'));
    crash(runIn, plugin, project);
    markHolderDead(project);
    const takeover = runCodex(plugin, project);
    assert.strictEqual(takeover.code, 0, `${takeover.stdout}\n${takeover.stderr}`);
    assert.match(takeover.stdout, /recovered interrupted cursor transaction \S+: rolled back; re-run install-cursor-harness to apply it/);
    assert.strictEqual(fs.existsSync(path.join(project, '.cursor')), false);
  } finally {
    cleanup(plugin, project);
  }
});

test('testSameHostTakeover_cursorAfterCursor_staysQuiet', () => {
  const plugin = fakePlugin();
  const project = tempDir('dhpk-cursor-same-');
  try {
    fs.mkdirSync(path.join(project, '.git'));
    crash(runIn, plugin, project);
    markHolderDead(project);
    const takeover = runIn(plugin, project);
    assert.strictEqual(takeover.code, 0, `${takeover.stdout}\n${takeover.stderr}`);
    assert.doesNotMatch(takeover.stdout, /recovered interrupted/);
  } finally {
    cleanup(plugin, project);
  }
});

// The previous release's Python Cursor installer, killed after it published
// the Shared Project Projection, leaves a held publication and a Host journal
// (a recording: tests/fixtures/legacy-journals/README.md).
// The JS Cursor installer rolls it back to the state before that run.
function legacyHeldTransaction({ extraLeftover = null } = {}) {
  const plugin = fakePlugin();
  const project = tempDir('dhpk-cursor-legacy-');
  const recording = loadLegacyFixture('python-cursor-host-journal');
  fs.mkdirSync(path.join(project, '.git'));
  restoreTree(recording.interrupted, project, { '@@PROJECT@@': project, '@@PLUGIN@@': plugin });
  const expected = tempDir('dhpk-cursor-legacy-before-');
  restoreTree(recording.before, expected, { '@@PROJECT@@': expected, '@@PLUGIN@@': plugin });
  const volatile = /\.dhpk-transaction-|\.dhpk-install\.lock|\.dhpk-backups/;
  const before = snapshot(expected, plugin).filter((line) => !volatile.test(line));
  fs.rmSync(expected, { recursive: true, force: true });
  assert.ok(fs.existsSync(path.join(project, '.agents', '.dhpk-installed.transaction.json')), 'the recording must hold a publication');
  if (extraLeftover) extraLeftover(project);
  return { plugin, project, before };
}

test('testPreviousPythonCursorHeldTransaction_isRecoveredByTheJsCursorInstaller', () => {
  const { plugin, project, before } = legacyHeldTransaction();
  try {
    // The Cursor Host journal of the killed run is still in flight.
    assert.ok(fs.readdirSync(path.join(project, '.cursor')).some((name) => /^\.dhpk-transaction-.*\.json$/.test(name)));
    write(path.join(plugin, 'skills', 'dhpk-portable', 'SKILL.md'), skillBody('dhpk-portable', 'Portable'));
    write(path.join(plugin, 'cursor', 'skills', 'dhpk-portable', 'SKILL.md'), skillBody('dhpk-portable', 'Portable'));
    write(path.join(plugin, 'cursor', 'commands', 'review.md'), '---\nname: review\ndescription: review command\n---\n# Review\n');
    const recovered = runIn(plugin, project, { recover: true });
    assert.strictEqual(recovered.code, 0, `${recovered.stdout}\n${recovered.stderr}`);
    assert.strictEqual(fs.existsSync(path.join(project, '.agents', '.dhpk-installed.transaction.json')), false);
    const state = snapshot(project, plugin).filter((line) => !/\.dhpk-transaction-|\.dhpk-install\.lock|\.dhpk-backups/.test(line));
    assert.deepStrictEqual(state, before);
  } finally {
    cleanup(plugin, project);
  }
});

test('testPreviousPythonCursorHeldTransaction_withALeftoverCursorLockFile_isRecoveredToo', () => {
  const { plugin, project, before } = legacyHeldTransaction({
    extraLeftover: (dir) => write(path.join(dir, '.cursor', '.dhpk-install.lock'), ''),
  });
  try {
    assert.ok(fs.existsSync(path.join(project, '.cursor', '.dhpk-install.lock')));
    write(path.join(plugin, 'skills', 'dhpk-portable', 'SKILL.md'), skillBody('dhpk-portable', 'Portable'));
    write(path.join(plugin, 'cursor', 'skills', 'dhpk-portable', 'SKILL.md'), skillBody('dhpk-portable', 'Portable'));
    write(path.join(plugin, 'cursor', 'commands', 'review.md'), '---\nname: review\ndescription: review command\n---\n# Review\n');
    const recovered = runIn(plugin, project, { recover: true });
    assert.strictEqual(recovered.code, 0, `${recovered.stdout}\n${recovered.stderr}`);
    assert.strictEqual(fs.existsSync(path.join(project, '.agents', '.dhpk-installed.transaction.json')), false);
    const state = snapshot(project, plugin).filter((line) => !/\.dhpk-transaction-|\.dhpk-install\.lock|\.dhpk-backups/.test(line));
    assert.deepStrictEqual(state, before);
    // The next ordinary run is not blocked by what the old installer left.
    const next = runIn(plugin, project, { update: true });
    assert.strictEqual(next.code, 0, `${next.stdout}\n${next.stderr}`);
  } finally {
    cleanup(plugin, project);
  }
});

// The shell entry point routes Cursor to the JS installer, so no python3 is
// needed on PATH (only the tools the shell itself calls, plus node).
test('testShellEntryPoint_cursorInstallsAndPlansWithoutPython3OnPath', () => {
  const plugin = fakePlugin();
  const project = tempDir('dhpk-cursor-nopython-');
  const bin = tempDir('dhpk-cursor-nopython-bin-');
  try {
    fs.mkdirSync(path.join(project, '.git'));
    for (const tool of ['bash', 'dirname', 'sed', 'node']) {
      const found = spawnSync('/bin/sh', ['-c', `command -v ${tool}`], { encoding: 'utf8' }).stdout.trim();
      assert.ok(found, `${tool} must exist on the test host`);
      fs.symlinkSync(tool === 'node' ? process.execPath : found, path.join(bin, tool));
    }
    const noPython = { PATH: `${CODEX_STUB_BIN}:${bin}` };
    const planned = shell(project, ['--plan', '--json', '--force'], plugin, noPython);
    // A plan that finds work to do exits 1; what matters is the report.
    assert.strictEqual(planned.status, 1, `${planned.stdout}\n${planned.stderr}`);
    assert.deepStrictEqual(JSON.parse(planned.stdout).warnings, []);
    assert.doesNotMatch(planned.stderr, /python3/);
    const installed = shell(project, ['--copy', '--force'], plugin, noPython);
    assert.strictEqual(installed.status, 0, `${installed.stdout}\n${installed.stderr}`);
    assert.doesNotMatch(installed.stderr, /python3/);
    assert.ok(fs.existsSync(path.join(project, '.cursor', '.dhpk-installed.json')));
  } finally {
    cleanup(plugin, project, bin);
  }
});

run('install-cursor-adapter-journal');
