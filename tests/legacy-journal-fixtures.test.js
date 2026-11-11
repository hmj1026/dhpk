'use strict';

// The recordings under tests/fixtures/legacy-journals must stay resolvable by
// the Publisher's resolver side, which is kept for the REQ-9 window after the
// hold producer is removed (js-projection-journal stage 5).

const { test, run, assert } = require('./_lib/tinytest');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const publisher = require('../scripts/lib/project-agent-projection-publisher');
const { loadLegacyFixture, restoreTree } = require('./_lib/legacy-journal-fixtures');

const JOURNAL = '.agents/.dhpk-installed.transaction.json';

function projectFrom(recording, state) {
  const project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-legacy-journal-')));
  restoreTree(recording[state], project, { '@@PROJECT@@': project, '@@SOURCE@@': path.join(project, '.no-source') });
  return project;
}

// Every path of a tree, with link text or file bytes, ignoring the Publisher's own transient entries.
function files(root) {
  const lines = [];
  const visit = (current, relative) => {
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) lines.push(`link:${relative}:${fs.readlinkSync(current)}`);
    else if (stat.isDirectory()) for (const name of fs.readdirSync(current).sort()) visit(path.join(current, name), `${relative}/${name}`);
    else lines.push(`file:${relative}:${fs.readFileSync(current, 'utf8')}`);
  };
  visit(root, '.');
  return lines.filter((line) => !/\.dhpk-(?:projection-(?:backup|rollback|artifact)|installed\.transaction)/.test(line));
}

function transientEntries(project) {
  return fs.readdirSync(path.join(project, '.agents')).filter((name) => /^\.dhpk-(?:projection-(?:backup|rollback-stage|artifact)|installed\.transaction)/.test(name));
}

test('testHeldV3Recording_install_isHeldByItsTransactionAndCommitsOnlyThere', () => {
  const recording = loadLegacyFixture('held-v3-install');
  const project = projectFrom(recording, 'held');
  try {
    assert.deepStrictEqual(publisher.heldProjection({ projectRoot: project }), { transactionId: 'run-1', host: 'codex', phase: 'publishing', holdReady: true });
    assert.strictEqual(publisher.commitHeldProjection({ projectRoot: project, transactionId: 'run-2' }).code, 'TRANSACTION_MISMATCH');
    const committed = publisher.commitHeldProjection({ projectRoot: project, transactionId: 'run-1' });
    assert.strictEqual(committed.state, 'COMMITTED', JSON.stringify(committed));
    assert.deepStrictEqual(transientEntries(project), []);
    assert.match(fs.readFileSync(path.join(project, '.agents/skills/dhpk-sample/SKILL.md'), 'utf8'), /Skill v2/);
    assert.strictEqual(publisher.commitHeldProjection({ projectRoot: project, transactionId: 'run-1' }).state, 'ABSENT');
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
  }
});

for (const name of ['held-v3-install', 'held-v3-install-killed', 'held-v3-uninstall']) {
  test(`testHeldV3Recording_${name}_abortRestoresThePreviousProjectionByteForByte`, () => {
    const recording = loadLegacyFixture(name);
    const project = projectFrom(recording, 'held');
    const previous = projectFrom(recording, 'before');
    try {
      assert.ok(fs.existsSync(path.join(project, JOURNAL)), 'the recording must hold a Publisher journal');
      const aborted = publisher.abortHeldProjection({ projectRoot: project, transactionId: 'run-1' });
      assert.strictEqual(aborted.state, 'ABORTED', JSON.stringify(aborted));
      assert.deepStrictEqual(files(project), files(previous));
      assert.deepStrictEqual(transientEntries(project), []);
    } finally {
      fs.rmSync(project, { recursive: true, force: true });
      fs.rmSync(previous, { recursive: true, force: true });
    }
  });
}

test('testHeldV3Recording_killedMidPublish_cannotCommitButAborts', () => {
  const project = projectFrom(loadLegacyFixture('held-v3-install-killed'), 'held');
  try {
    assert.strictEqual(publisher.commitHeldProjection({ projectRoot: project, transactionId: 'run-1' }).code, 'TRANSACTION_INCOMPLETE');
    assert.ok(fs.existsSync(path.join(project, JOURNAL)), 'a refused commit must leave the journal');
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
  }
});

test('testHeldV3Recording_uninstall_commitFinishesTheRemoval', () => {
  const project = projectFrom(loadLegacyFixture('held-v3-uninstall'), 'held');
  try {
    assert.strictEqual(publisher.commitHeldProjection({ projectRoot: project, transactionId: 'run-1' }).state, 'COMMITTED');
    assert.strictEqual(fs.existsSync(path.join(project, '.agents/.dhpk-installed.json')), false);
    assert.strictEqual(fs.existsSync(path.join(project, JOURNAL)), false);
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
  }
});

run('legacy-journal-fixtures');
