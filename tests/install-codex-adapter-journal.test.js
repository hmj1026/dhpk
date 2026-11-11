'use strict';

// js-projection-journal stage 3 (tasks 3.4, 3.5, 3.6, 3.8): the JS Codex
// adapter records native and Shared Project Projection effects in one
// Projection Journal. A crash after any step, or in the middle of one, is
// recovered to the complete previous or the complete new state (REQ-5, REQ-8);
// a failure before the commit point restores the previous state (REQ-4); one
// project lock serializes runs. All runs are in-process.

const { test, run, assert } = require('./_lib/tinytest');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { SimulatedCrash } = require('../scripts/lib/projection-journal');
const { fakePlugin, write, skillBody, REPO } = require('./_lib/shared-projection-plugin');
const { CODEX_STUB_BIN, runInstaller: runShellInstaller } = require('./_lib/install-codex-skills-fixtures');

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

const runIn = makeRunIn('codex');

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

// Journal steps are deterministic per scenario; a sweep that visits fewer
// points than this has stopped covering a step (update this table with a step
// the adapter adds or removes on purpose).
const EXPECTED_POINTS = {
  install: { crash: 38, failure: 20 },
  update: { crash: 50, failure: 26 },
  uninstall: { crash: 28, failure: 15 },
  adoption: { crash: 50, failure: 26 },
};

registerSweeps({ runIn, scenarios: SCENARIOS, expectedPoints: EXPECTED_POINTS });

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

function crashAtStep(plugin, project, stepNumber = 6) {
  try {
    runIn(plugin, project, {}, { afterStep: (step) => { if (step === stepNumber) throw new SimulatedCrash(step); } });
  } catch (error) {
    if (!(error instanceof SimulatedCrash)) throw error;
  }
}

function recoverCli(project) {
  const result = spawnSync(process.execPath, [path.join(REPO, 'scripts', 'dhpk-install.js'), '--recover', '--project-root', project, '--json'], { encoding: 'utf8' });
  return { status: result.status, stderr: result.stderr, report: result.stdout ? JSON.parse(result.stdout) : null, raw: result.stdout + result.stderr };
}

// A dangling symlink is "present" for recovery: it must reach the installer
// (or block), never be reported ABSENT.
for (const [label, relative] of [['journal', JOURNAL], ['lock', LOCK]]) {
  test(`testDhpkInstallRecover_danglingSymlink${label}_isBlockedNotAbsent`, () => {
    const project = tempDir('dhpk-adapter-dangling-');
    try {
      fs.mkdirSync(path.join(project, '.agents'));
      fs.symlinkSync(path.join(project, 'nowhere'), path.join(project, relative));
      const outcome = recoverCli(project);
      assert.strictEqual(outcome.status, 2, outcome.raw);
      assert.strictEqual(outcome.report.projectionJournal.state, 'BLOCKED', outcome.raw);
      assert.ok(fs.lstatSync(path.join(project, relative)).isSymbolicLink(), 'the link must be left as found');
    } finally {
      cleanup(project);
    }
  });
}

test('testDhpkInstallRecover_unreadableHost_isBlockedHostUnknown', () => {
  const project = tempDir('dhpk-adapter-hostunknown-');
  try {
    write(path.join(project, JOURNAL), 'not json');
    const outcome = recoverCli(project);
    assert.strictEqual(outcome.status, 2, outcome.raw);
    assert.strictEqual(outcome.report.projectionJournal.state, 'BLOCKED');
    assert.strictEqual(outcome.report.projectionJournal.code, 'HOST_UNKNOWN', outcome.raw);
    assert.match(outcome.report.projectionJournal.message, /Host/);
    assert.strictEqual(fs.readFileSync(path.join(project, JOURNAL), 'utf8'), 'not json');
  } finally {
    cleanup(project);
  }
});

// A dead lock that is not the journal's own is never taken over silently;
// --recover removes it and then finishes the journal.
test('testInstallLock_deadLockOfAnotherPidBesideAJournal_blocksUntilRecover', () => {
  const plugin = fakePlugin();
  const project = tempDir('dhpk-adapter-otherpid-');
  try {
    fs.mkdirSync(path.join(project, '.git'));
    const before = snapshot(project, plugin);
    crashAtStep(plugin, project);
    markHolderDead(project);
    const journalPid = JSON.parse(fs.readFileSync(path.join(project, JOURNAL), 'utf8')).pid;
    let otherPid = deadPid();
    while (otherPid === journalPid) otherPid = deadPid();
    const lock = JSON.parse(fs.readFileSync(path.join(project, LOCK), 'utf8'));
    lock.pid = otherPid;
    fs.writeFileSync(path.join(project, LOCK), `${JSON.stringify(lock)}\n`);
    const crashed = snapshot(project, plugin);
    const blocked = runIn(plugin, project);
    assert.strictEqual(blocked.code, 2, `${blocked.stdout}\n${blocked.stderr}`);
    assert.match(blocked.stderr, /stale install lock .*rerun this installer with --recover/);
    assert.deepStrictEqual(snapshot(project, plugin), crashed);
    const recovered = runIn(plugin, project, { recover: true });
    assert.strictEqual(recovered.code, 0, `${recovered.stdout}\n${recovered.stderr}`);
    assert.deepStrictEqual(snapshot(project, plugin), before);
  } finally {
    cleanup(plugin, project);
  }
});

// With the lock created atomically with its content, an empty or unreadable
// lock is never ours mid-creation: it is held until --recover removes it.
test('testInstallLock_unreadableLock_isHeldUntilRecover', () => {
  const plugin = fakePlugin();
  const project = tempDir('dhpk-adapter-unreadable-');
  try {
    fs.mkdirSync(path.join(project, '.git'));
    write(path.join(project, LOCK), '');
    const before = snapshot(project, plugin);
    const blocked = runIn(plugin, project);
    assert.strictEqual(blocked.code, 2, `${blocked.stdout}\n${blocked.stderr}`);
    assert.match(blocked.stderr, /unreadable install lock .*; rerun with --recover/);
    assert.deepStrictEqual(snapshot(project, plugin), before);
    const recovered = runIn(plugin, project, { recover: true });
    assert.strictEqual(recovered.code, 0, `${recovered.stdout}\n${recovered.stderr}`);
    assert.strictEqual(fs.existsSync(path.join(project, LOCK)), false);
  } finally {
    cleanup(plugin, project);
  }
});

// Runs `body` with fs[name] wrapped so `before(args)` runs ahead of each call.
function withFsHook(name, before, body) {
  const original = fs[name];
  fs[name] = function hooked(...args) {
    before(...args);
    return original.apply(this, args);
  };
  try {
    return body();
  } finally {
    fs[name] = original;
  }
}

// A lock swapped in between the staleness check and its removal belongs to a
// live installer and must survive.
for (const mode of ['journal-takeover', 'recover']) {
  test(`testInstallLock_freshLockSwappedInDuringStaleRemoval_${mode}_isNotDestroyed`, () => {
    const plugin = fakePlugin();
    const project = tempDir('dhpk-adapter-swap-');
    try {
      fs.mkdirSync(path.join(project, '.git'));
      if (mode === 'journal-takeover') {
        crashAtStep(plugin, project);
        markHolderDead(project);
      } else {
        write(path.join(project, LOCK), `${JSON.stringify({ pid: deadPid(), host: 'codex', start: '2026-11-10T00:00:00.000Z' })}\n`);
      }
      const lockFile = path.join(project, LOCK);
      const fresh = `${JSON.stringify({ pid: process.pid, host: 'cursor', start: '2026-11-10T01:00:00.000Z' })}\n`;
      const outcome = withFsHook('renameSync', (from) => { if (from === lockFile) fs.writeFileSync(from, fresh); }, () => runIn(plugin, project, mode === 'recover' ? { recover: true } : {}));
      assert.strictEqual(outcome.code, 2, `${outcome.stdout}\n${outcome.stderr}`);
      assert.match(outcome.stderr, /already reconciling this project/);
      assert.strictEqual(fs.readFileSync(lockFile, 'utf8'), fresh);
      assert.deepStrictEqual(fs.readdirSync(path.join(project, '.agents')).filter((name) => name.startsWith('.dhpk-install.lock')), ['.dhpk-install.lock']);
    } finally {
      cleanup(plugin, project);
    }
  });
}

// The lock appears at its path already complete: it is linked from a finished
// temp file, which is gone afterwards.
test('testInstallLock_isCreatedCompleteByLinkingATempFile', () => {
  const plugin = fakePlugin();
  const project = tempDir('dhpk-adapter-atomic-');
  try {
    fs.mkdirSync(path.join(project, '.git'));
    fs.mkdirSync(path.join(project, '.agents'));
    const lockFile = path.join(project, LOCK);
    const seen = [];
    const outcome = withFsHook('linkSync', (from, to) => {
      if (to !== lockFile) return;
      const owner = JSON.parse(fs.readFileSync(from, 'utf8'));
      seen.push({ pid: owner.pid, host: owner.host, destinationExists: fs.existsSync(to) });
    }, () => runIn(plugin, project));
    assert.strictEqual(outcome.code, 0, `${outcome.stdout}\n${outcome.stderr}`);
    assert.deepStrictEqual(seen, [{ pid: process.pid, host: 'codex', destinationExists: false }]);
    assert.deepStrictEqual(fs.readdirSync(path.join(project, '.agents')).filter((name) => name.includes('lock')), []);
  } finally {
    cleanup(plugin, project);
  }
});

// A lock that cannot be released must not pass silently, nor change the outcome.
test('testRunInstaller_lockReleaseFailure_isReportedAndKeepsTheOutcome', () => {
  const plugin = fakePlugin();
  const project = tempDir('dhpk-adapter-release-');
  try {
    fs.mkdirSync(path.join(project, '.git'));
    const lockFile = path.join(project, LOCK);
    const outcome = withFsHook('rmSync', (target) => { if (target === lockFile) throw Object.assign(new Error('EACCES: simulated'), { code: 'EACCES' }); }, () => runIn(plugin, project));
    assert.match(outcome.stderr, /\[install-codex-skills\] ERROR: could not release the install lock: .*simulated/);
    assert.strictEqual(outcome.code, 2, 'a successful run whose lock stays behind must not exit 0');
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
