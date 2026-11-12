'use strict';

// REQ-9 window closed (dhpk 0.75.0, #1321): the recordings of held v3
// journals under tests/fixtures/legacy-journals are no longer resolved. Every
// Publisher entry point must fail closed on them without changing a file and
// must name dhpk 0.74.x, the last release line that recovers them.

const { test, run, assert } = require('./_lib/tinytest');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const publisher = require('../scripts/lib/project-agent-projection-publisher');
const projectionJournal = require('../scripts/lib/projection-journal');
const { recoverSharedProjection } = require('../scripts/lib/native-shared-skill-install');
const { recoverProject, formatRecoverReport } = require('../scripts/lib/dhpk-install-recover');
const { loadLegacyFixture, restoreTree } = require('./_lib/legacy-journal-fixtures');

const JOURNAL = '.agents/.dhpk-installed.transaction.json';

function projectFrom(recording) {
  const project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-legacy-journal-')));
  restoreTree(recording.held, project, { '@@PROJECT@@': project, '@@SOURCE@@': path.join(project, '.no-source') });
  return project;
}

// Every path of the tree with link text, mode and content digest.
function snapshot(root) {
  const result = {};
  const walk = (directory) => {
    for (const name of fs.readdirSync(directory).sort()) {
      const full = path.join(directory, name);
      const relative = path.relative(root, full).split(path.sep).join('/');
      const stat = fs.lstatSync(full);
      if (stat.isSymbolicLink()) result[relative] = `link:${fs.readlinkSync(full)}`;
      else if (stat.isDirectory()) {
        result[relative] = 'dir';
        walk(full);
      } else result[relative] = `file:${(stat.mode & 0o777).toString(8)}:${crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex')}`;
    }
  };
  walk(root);
  return result;
}

function assertNamesLastRecoveringRelease(message) {
  assert.match(message, /dhpk 0\.74\.x/);
  assert.match(message, /--recover/);
}

const failsClosed = (error) => {
  assert.strictEqual(error.projectionCode, 'UNSAFE_TRANSACTION');
  assertNamesLastRecoveringRelease(error.message);
  return true;
};

test('testLegacyRecoveryRelease_isTheZeroSevenFourLine', () => {
  assert.strictEqual(projectionJournal.LEGACY_JOURNAL_RECOVERY_RELEASE, '0.74.x');
  assert.ok(!projectionJournal.EFFECT_PHASES.includes('held'), 'the held phase is no longer a valid journal phase');
});

test('testHeldResolvers_areNoLongerExported', () => {
  for (const name of ['heldProjection', 'commitHeldProjection', 'abortHeldProjection']) {
    assert.strictEqual(publisher[name], undefined, name);
  }
});

for (const name of ['held-v3-install', 'held-v3-install-killed']) {
  test(`testHeldV3Recording_${name}_failsClosedOnEveryEntryWithoutChangingFiles`, () => {
    const project = projectFrom(loadLegacyFixture(name));
    try {
      assert.ok(fs.existsSync(path.join(project, JOURNAL)), 'the recording must hold a Publisher journal');
      const before = snapshot(project);
      assert.throws(() => publisher.recoverAgentsSkillsProjection({ projectRoot: project }), failsClosed);
      for (const outcome of [publisher.uninstallAgentsSkillsProjection({ projectRoot: project }), publisher.rollbackAgentsSkillsProjection({ projectRoot: project })]) {
        assert.strictEqual(outcome.ok, false, JSON.stringify(outcome));
        assert.strictEqual(outcome.code, 'UNSAFE_TRANSACTION', JSON.stringify(outcome));
        assertNamesLastRecoveringRelease(outcome.error ? outcome.error.message : outcome.message);
      }
      assert.deepStrictEqual(snapshot(project), before);
    } finally {
      fs.rmSync(project, { recursive: true, force: true });
    }
  });

  test(`testHeldV3Recording_${name}_sharedProjectionRecoveryIsBlockedNamingTheLastRecoveringRelease`, () => {
    const project = projectFrom(loadLegacyFixture(name));
    try {
      const before = snapshot(project);
      const result = recoverSharedProjection({ projectRoot: project });
      assert.strictEqual(result.ok, false, JSON.stringify(result));
      assert.strictEqual(result.state, 'BLOCKED');
      assert.strictEqual(result.code, 'UNSAFE_TRANSACTION');
      assertNamesLastRecoveringRelease(result.message);
      assert.deepStrictEqual(snapshot(project), before);
    } finally {
      fs.rmSync(project, { recursive: true, force: true });
    }
  });
}

// The Python Host recordings: the installers' own fail-closed behavior is
// pinned in tests/install-{codex,cursor}-adapter-journal.test.js; this pins the
// `dhpk-install --recover` report, which no longer offers a replay command.
for (const [name, hostRoot] of [['python-codex-host-journal', '.codex'], ['python-cursor-host-journal', '.cursor']]) {
  test(`testPythonHostRecording_${name}_isReportedAsLegacyHostJournalWithoutChangingFiles`, () => {
    const recording = loadLegacyFixture(name);
    const project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-legacy-host-')));
    try {
      restoreTree(recording.interrupted, project, { '@@PROJECT@@': project, '@@PLUGIN@@': path.join(project, '.no-plugin') });
      const before = snapshot(project);
      const report = recoverProject({ projectRoot: project, installerRoot: path.join(project, '.no-installer') });
      assert.strictEqual(report.ok, false);
      const active = report.installerJournals.filter((entry) => entry.phase === 'active');
      assert.ok(active.length >= 1, JSON.stringify(report.installerJournals));
      for (const entry of active) {
        assert.strictEqual(entry.host, hostRoot);
        assert.strictEqual(entry.code, 'LEGACY_HOST_JOURNAL');
        assert.ok(!('command' in entry));
        assertNamesLastRecoveringRelease(entry.action);
        assert.ok(formatRecoverReport(report).includes(`${hostRoot} transaction ${entry.run} is active; recover it with dhpk 0.74.x --recover`));
      }
      assert.deepStrictEqual(snapshot(project), before);
    } finally {
      fs.rmSync(project, { recursive: true, force: true });
    }
  });
}

run('legacy-journal-fixtures');
