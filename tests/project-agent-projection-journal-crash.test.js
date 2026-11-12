'use strict';

// js-projection-journal stage 1 (#1240): the publisher records every effect as
// data before it runs (REQ-7), and a crash after any step leaves a state that
// recovery turns into exactly the previous or the new projection (REQ-8).
// Crashes are injected in-process through the `afterStep` hook: the sentinel
// bypasses every catch and finally cleanup, like a SIGKILL would.

const { test, run, assert } = require('./_lib/tinytest');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const publisher = require('../scripts/lib/project-agent-projection-publisher');
const { fingerprint } = require('../scripts/lib/distribution-projection-contract');
const { loadLegacyFixture, restoreTree } = require('./_lib/legacy-journal-fixtures');

const JOURNAL = '.agents/.dhpk-installed.transaction.json';
const SKILL = '---\nname: dhpk-sample\ndescription: Fixture\n---\n# Skill\n';
const SKILL_V2 = '---\nname: dhpk-sample\ndescription: Fixture\n---\n# Skill v2\n';

function inventory() {
  const host = (surface, shape, transform) => ({ surface, evidence_source: 'entry_surfaces', shape, transform: { id: transform, version: '1' } });
  return {
    schema: 'dhpk.distribution-inventory.v2',
    skills: [{ id: 'sample', name: 'dhpk-sample', path: 'skills/dhpk-sample', lifecycle: 'promoted', surfaces: ['claude-core', 'codex-sync', 'cursor-plugin', 'agy-plugin'] }],
    surface_membership: { 'claude-core': ['sample'], 'codex-sync': ['sample'], 'cursor-plugin': ['sample'], 'agy-plugin': ['sample'] },
    project_agent_projection: {
      schema: 'dhpk.project-agent-projection.v1',
      scope: 'project',
      owner: 'dhpk.project-agent-projection',
      managed_root: '.agents/skills',
      receipt: '.agents/.dhpk-installed.json',
      profiles: { 'portable-core': { version: 'portable-core-v1', compatibility_mode: 'portable-core', stable_ids: ['sample'], hosts: ['agy', 'claude', 'codex', 'cursor'] } },
      hosts: {
        claude: host('claude-core', 'project-skill-directory', 'claude-project-skill'),
        codex: host('codex-sync', 'project-skill-directory', 'codex-project-skill'),
        cursor: host('cursor-plugin', 'project-skill-directory', 'cursor-project-skill'),
        agy: host('agy-plugin', 'project-skill-direct-file', 'agy-project-direct-file'),
      },
      dependencies: {},
    },
  };
}

function write(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function fixture() {
  const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-crash-source-'));
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-crash-project-'));
  write(path.join(sourceRoot, 'skills/dhpk-sample/SKILL.md'), SKILL);
  // The project roots exist before the transaction; ensuring them is not part of it.
  fs.mkdirSync(path.join(projectRoot, '.agents'), { recursive: true });
  return { sourceRoot, projectRoot, options: { sourceRoot, projectRoot, inventory: inventory() } };
}

function cleanup({ sourceRoot, projectRoot }) {
  fs.rmSync(sourceRoot, { recursive: true, force: true });
  fs.rmSync(projectRoot, { recursive: true, force: true });
}

// Every path under the project with its type, content digest, mode, or link
// target. Transaction tokens are normalized so two runs compare equal.
function snapshot(projectRoot) {
  const result = {};
  const walk = (directory) => {
    for (const name of fs.readdirSync(directory).sort()) {
      const full = path.join(directory, name);
      const relative = path.relative(projectRoot, full).split(path.sep).join('/')
        .replace(/\.dhpk-projection-backup-[a-z0-9-]+/gi, '.dhpk-projection-backup-*');
      const stat = fs.lstatSync(full);
      if (stat.isSymbolicLink()) result[relative] = `link:${fs.readlinkSync(full)}`;
      else if (stat.isDirectory()) {
        result[relative] = 'dir';
        walk(full);
      } else result[relative] = `file:${(stat.mode & 0o777).toString(8)}:${crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex')}`;
    }
  };
  walk(projectRoot);
  return result;
}

function rewriteReceipt(receiptPath, mutate) {
  const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
  mutate(receipt);
  delete receipt.receiptFingerprint;
  receipt.receiptFingerprint = fingerprint(receipt);
  write(receiptPath, `${JSON.stringify(receipt)}\n`);
}

// Each scenario prepares a fixture and names the operation under test.
const SCENARIOS = {
  install: {
    prepare: () => fixture(),
    operate: (options) => publisher.materializeRelocatableAgentsSkillsProjection(options),
  },
  update: {
    prepare: () => {
      const context = fixture();
      publisher.materializeRelocatableAgentsSkillsProjection(context.options);
      write(path.join(context.sourceRoot, 'skills/dhpk-sample/SKILL.md'), SKILL_V2);
      return context;
    },
    operate: (options) => publisher.materializeRelocatableAgentsSkillsProjection({ ...options, update: true }),
  },
  uninstall: {
    prepare: () => {
      const context = fixture();
      publisher.materializeRelocatableAgentsSkillsProjection(context.options);
      return context;
    },
    operate: (options) => publisher.uninstallAgentsSkillsProjection(options),
  },
  rollback: {
    prepare: () => {
      const context = fixture();
      publisher.materializeRelocatableAgentsSkillsProjection(context.options);
      write(path.join(context.sourceRoot, 'skills/dhpk-sample/SKILL.md'), SKILL_V2);
      publisher.materializeRelocatableAgentsSkillsProjection({ ...context.options, update: true });
      return context;
    },
    operate: (options) => publisher.rollbackAgentsSkillsProjection(options),
  },
  adoption: {
    prepare: () => {
      const context = fixture();
      publisher.materializeRelocatableAgentsSkillsProjection(context.options);
      rewriteReceipt(path.join(context.projectRoot, '.agents/.dhpk-installed.json'), (receipt) => {
        delete receipt.fingerprint_algorithm;
        receipt.generatorVersion = '2.0.0';
      });
      write(path.join(context.projectRoot, '.agents/skills/dhpk-sample/SKILL.md'), 'edited before adoption\n');
      return context;
    },
    operate: (options) => publisher.materializeRelocatableAgentsSkillsProjection({ ...options, adopt: true }),
  },
};

// Preparing a scenario runs the publisher several times; each crash point
// starts from a copy of one prepared fixture instead.
function cloneContext(template) {
  const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-crash-source-'));
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-crash-project-'));
  fs.cpSync(template.sourceRoot, sourceRoot, { recursive: true, verbatimSymlinks: true });
  fs.cpSync(template.projectRoot, projectRoot, { recursive: true, verbatimSymlinks: true });
  return { sourceRoot, projectRoot, options: { ...template.options, sourceRoot, projectRoot } };
}

function expectedAfter(scenario) {
  const context = scenario.prepare();
  try {
    const outcome = scenario.operate(context.options);
    if (outcome && outcome.ok === false) throw new Error(`uninterrupted run failed: ${JSON.stringify(outcome)}`);
    return snapshot(context.projectRoot);
  } finally {
    cleanup(context);
  }
}

// `after`: the step's effect ran. `mid`: the record is flushed as planned but
// its effect has not run, the ambiguous case recovery must also handle.
for (const [name, scenario] of Object.entries(SCENARIOS)) for (const when of ['after', 'mid']) {
  test(`testCrash${when === 'after' ? 'After' : 'Before'}EachStep_${name}_recoveryLeavesPreviousOrNewState`, () => {
    const after = expectedAfter(scenario);
    const template = scenario.prepare();
    let crashes = 0;
    for (let target = 1; target < 500; target += 1) {
      const context = cloneContext(template);
      try {
        const before = snapshot(context.projectRoot);
        let crashed = false;
        const afterStep = (step) => {
          if (step === target) {
            crashed = true;
            throw new publisher.__testing.SimulatedCrash(step);
          }
        };
        try {
          scenario.operate({ ...context.options, afterStep: { [when]: afterStep } });
        } catch (error) {
          if (!(error instanceof publisher.__testing.SimulatedCrash)) throw error;
        }
        if (!crashed) {
          assert.ok(crashes > 0, `${name}: afterStep never ran`);
          cleanup(template);
          return;
        }
        crashes += 1;
        assert.ok(fs.existsSync(path.join(context.projectRoot, JOURNAL)), `${name}: crash after step ${target} left no journal`);
        publisher.recoverAgentsSkillsProjection({ projectRoot: context.projectRoot });
        const state = snapshot(context.projectRoot);
        const matches = assert.deepStrictEqual.bind(assert);
        try {
          matches(state, before);
        } catch (_) {
          assert.deepStrictEqual(state, after, `${name}: crash after step ${target} recovered to a mixed state`);
        }
      } finally {
        cleanup(context);
      }
    }
    cleanup(template);
    assert.fail(`${name}: operation did not finish within 500 steps`);
  });
}

for (const when of ['after', 'mid']) test(`testInterruptedRecovery_${when}_rerunReachesSameState`, () => {
  const scenario = SCENARIOS.update;
  const template = scenario.prepare();
  // Crash late enough that recovery has several effects to undo, then crash
  // recovery itself after each of its own steps and run it again.
  for (let recoveryTarget = 1; recoveryTarget < 200; recoveryTarget += 1) {
    const context = cloneContext(template);
    try {
      const before = snapshot(context.projectRoot);
      let publishSteps = 0;
      try {
        scenario.operate({ ...context.options, afterStep: () => { publishSteps += 1; if (publishSteps === 8) throw new publisher.__testing.SimulatedCrash(8); } });
      } catch (error) {
        if (!(error instanceof publisher.__testing.SimulatedCrash)) throw error;
      }
      let recoveryCrashed = false;
      try {
        publisher.recoverAgentsSkillsProjection({
          projectRoot: context.projectRoot,
          afterStep: { [when]: (step) => { if (step === recoveryTarget) { recoveryCrashed = true; throw new publisher.__testing.SimulatedCrash(step); } } },
        });
      } catch (error) {
        if (!(error instanceof publisher.__testing.SimulatedCrash)) throw error;
      }
      if (!recoveryCrashed) {
        assert.ok(recoveryTarget > 1, 'recovery afterStep never ran');
        assert.deepStrictEqual(snapshot(context.projectRoot), before);
        cleanup(template);
        return;
      }
      publisher.recoverAgentsSkillsProjection({ projectRoot: context.projectRoot });
      assert.deepStrictEqual(snapshot(context.projectRoot), before, `recovery interrupted after step ${recoveryTarget}`);
    } finally {
      cleanup(context);
    }
  }
  cleanup(template);
  assert.fail('recovery did not finish within 200 steps');
});

test('testTransientDirectories_recordedInJournalBeforeCreation', () => {
  const transient = /\.dhpk-projection-(?:artifact|backup|rollback-stage|rollback-candidate)-/;
  for (const scenario of [SCENARIOS.update, SCENARIOS.rollback]) {
    const context = scenario.prepare();
    const originalMkdir = fs.mkdirSync;
    const originalMkdtemp = fs.mkdtempSync;
    const unrecorded = [];
    const check = (target) => {
      const name = path.basename(String(target));
      if (!transient.test(name) || path.dirname(String(target)) !== path.join(context.projectRoot, '.agents')) return;
      const journalPath = path.join(context.projectRoot, JOURNAL);
      const journal = fs.existsSync(journalPath) ? JSON.parse(fs.readFileSync(journalPath, 'utf8')) : null;
      const recorded = journal && Array.isArray(journal.effects)
        && journal.effects.some((effect) => effect.kind === 'mkdir' && (effect.args.paths || []).includes(`.agents/${name}`));
      if (!recorded) unrecorded.push(name);
    };
    try {
      fs.mkdirSync = (target, ...rest) => { check(target); return originalMkdir(target, ...rest); };
      // A random name cannot be journaled before it exists; writes inside a
      // journaled transient tree (the artifact store's own stage) are covered by it.
      fs.mkdtempSync = (prefix, ...rest) => {
        if (path.dirname(String(prefix)) === path.join(context.projectRoot, '.agents')) unrecorded.push(`mkdtemp:${path.basename(String(prefix))}`);
        return originalMkdtemp(prefix, ...rest);
      };
      const outcome = scenario.operate(context.options);
      assert.notStrictEqual(outcome && outcome.ok, false, JSON.stringify(outcome));
    } finally {
      fs.mkdirSync = originalMkdir;
      fs.mkdtempSync = originalMkdtemp;
      cleanup(context);
    }
    assert.deepStrictEqual(unrecorded, []);
  }
});

// A flag-based journal as the previous release left it: the live SKILL.md is
// already in the backup, and the backup checkpoint was not reached.
function interruptedFlagJournal(projectRoot, schema) {
  const receipt = JSON.parse(fs.readFileSync(path.join(projectRoot, '.agents/.dhpk-installed.json'), 'utf8'));
  const backupName = '.dhpk-projection-backup-legacy-0001';
  const relative = 'dhpk-sample/SKILL.md';
  fs.mkdirSync(path.join(projectRoot, '.agents', backupName, 'managed', 'dhpk-sample'), { recursive: true });
  fs.renameSync(path.join(projectRoot, '.agents/skills', relative), path.join(projectRoot, '.agents', backupName, 'managed', relative));
  const journal = {
    schema,
    phase: 'publishing',
    managedName: 'skills',
    receiptName: '.dhpk-installed.json',
    backupName,
    rollbackStageName: '.none',
    stageName: '.none',
    oldPaths: receipt.managedPaths,
    newPaths: receipt.managedPaths,
    newFingerprints: receipt.generatedFingerprints,
    oldBindingPaths: {},
    newBindingPaths: {},
    newReceiptDigest: null,
    newRollback: false,
    oldRollbackPresent: false,
    oldRollbackMoved: false,
    newRollbackInstalled: false,
    liveBackedUp: false,
    ...(schema.endsWith('.v2') ? { claudeManagedName: 'claude-skills', oldClaudePaths: [], newClaudePaths: [], newClaudeFingerprints: {} } : {}),
  };
  write(path.join(projectRoot, JOURNAL), `${JSON.stringify(journal)}\n`);
}

for (const schema of ['dhpk.project-agent-projection-transaction.v1', 'dhpk.project-agent-projection-transaction.v2']) {
  // Stage 3 reads only v3; the stage-1 release (0.71.0) is the last one that
  // recovers flag-based journals, so the remediation names it.
  test(`testFlagJournalFormat_${schema.slice(-2)}_failsClosedNamingStageOneRelease`, () => {
    const context = SCENARIOS.uninstall.prepare();
    try {
      interruptedFlagJournal(context.projectRoot, schema);
      const before = snapshot(context.projectRoot);
      const remediation = (error) => error.projectionCode === 'UNSAFE_TRANSACTION'
        && error.message.includes(schema) && /dhpk 0\.71\.0/.test(error.message) && /--recover/.test(error.message);
      assert.throws(() => publisher.recoverAgentsSkillsProjection({ projectRoot: context.projectRoot }), remediation);
      assert.throws(() => publisher.materializeRelocatableAgentsSkillsProjection({ ...context.options, update: true }), remediation);
      const uninstalled = publisher.uninstallAgentsSkillsProjection(context.options);
      assert.strictEqual(uninstalled.code, 'UNSAFE_TRANSACTION');
      assert.deepStrictEqual(snapshot(context.projectRoot), before);
    } finally {
      cleanup(context);
    }
  });
}

test('testUnknownJournalFormat_failsClosedWithRemediation', () => {
  const context = SCENARIOS.uninstall.prepare();
  try {
    write(path.join(context.projectRoot, JOURNAL), `${JSON.stringify({ schema: 'dhpk.project-agent-projection-transaction.v0', phase: 'publishing' })}\n`);
    const before = snapshot(context.projectRoot);
    const remediation = (error) => error.projectionCode === 'UNSAFE_TRANSACTION'
      && /transaction\.v0/.test(error.message) && /--recover/.test(error.message) && /release that wrote it/.test(error.message);
    assert.throws(() => publisher.recoverAgentsSkillsProjection({ projectRoot: context.projectRoot }), remediation);
    assert.throws(() => publisher.materializeRelocatableAgentsSkillsProjection({ ...context.options, update: true }), remediation);
    const uninstalled = publisher.uninstallAgentsSkillsProjection(context.options);
    assert.strictEqual(uninstalled.code, 'UNSAFE_TRANSACTION');
    assert.deepStrictEqual(snapshot(context.projectRoot), before);
  } finally {
    cleanup(context);
  }
});

// The hold producer and its resolvers are removed (dhpk 0.75.0, #1321); a
// 0.72/0.73 installer's held v3 journal is a recording
// (tests/fixtures/legacy-journals) that this release refuses to resolve.
test('testHeldJournal_v3_recordingFailsClosedNamingLastRecoveringRelease', () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-held-journal-'));
  try {
    const recording = loadLegacyFixture('held-v3-install');
    restoreTree(recording.held, projectRoot, { '@@PROJECT@@': projectRoot, '@@SOURCE@@': path.join(projectRoot, '.no-source') });
    const journal = JSON.parse(fs.readFileSync(path.join(projectRoot, JOURNAL), 'utf8'));
    assert.strictEqual(journal.schema, publisher.PROJECT_TRANSACTION_SCHEMA);
    assert.strictEqual(journal.phase, 'held');
    assert.deepStrictEqual(journal.hold, { transactionId: 'run-1', host: 'codex' });
    const before = snapshot(projectRoot);
    const remediation = (error) => error.projectionCode === 'UNSAFE_TRANSACTION'
      && /dhpk 0\.74\.x/.test(error.message) && /--recover/.test(error.message);
    assert.throws(() => publisher.recoverAgentsSkillsProjection({ projectRoot }), remediation);
    const uninstalled = publisher.uninstallAgentsSkillsProjection({ projectRoot });
    assert.strictEqual(uninstalled.code, 'UNSAFE_TRANSACTION');
    assert.match(uninstalled.error.message, /dhpk 0\.74\.x/);
    assert.deepStrictEqual(snapshot(projectRoot), before);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

// Recovery replays a journal it may not have written; a project could ship one.
function craftedJournal(effects, phase = 'publishing') {
  return {
    schema: publisher.PROJECT_TRANSACTION_SCHEMA,
    phase,
    managedName: 'skills',
    claudeManagedName: 'claude-skills',
    receiptName: '.dhpk-installed.json',
    backupName: '.dhpk-projection-backup-x1',
    rollbackStageName: '.none',
    stageName: '.none',
    effects: effects.map((effect, index) => ({ id: index + 1, state: 'done', inverse: null, ...effect })),
  };
}

test('testCraftedJournal_outsideOwnedPaths_isRejectedWithoutChanges', () => {
  const context = SCENARIOS.uninstall.prepare();
  try {
    write(path.join(context.projectRoot, 'src/app.js'), 'user code\n');
    write(path.join(context.projectRoot, '.git/hooks/README'), 'hooks\n');
    const tree = { kind: 'remove', args: { paths: ['src'], mode: 'tree' } };
    const crafted = [
      craftedJournal([{ kind: 'mkdir', args: { paths: ['.agents/.dhpk-projection-backup-x1'] }, inverse: tree }]),
      craftedJournal([{ kind: 'mkdir', args: { paths: ['x'] }, inverse: { kind: 'remove', args: { paths: ['src/app.js'], mode: 'file', digest: 'a'.repeat(64) } } }]),
      craftedJournal([{ kind: 'mkdir', args: { paths: ['x'] }, inverse: { kind: 'write-file', args: { path: '.git/hooks/pre-commit', digest: 'a'.repeat(64), content: '#!/bin/sh\n' } } }]),
      craftedJournal([{ kind: 'mkdir', args: { paths: ['x'] }, inverse: { kind: 'rename', args: { from: 'src', to: '.git/moved' } } }]),
      craftedJournal([{ kind: 'rename', args: { from: 'src', to: '.agents/skills/src' }, state: 'planned' }], 'published'),
    ];
    for (const journal of crafted) {
      write(path.join(context.projectRoot, JOURNAL), `${JSON.stringify(journal)}\n`);
      const before = snapshot(context.projectRoot);
      assert.throws(() => publisher.recoverAgentsSkillsProjection({ projectRoot: context.projectRoot }), (error) => error.projectionCode === 'UNSAFE_TRANSACTION', JSON.stringify(journal.effects));
      assert.deepStrictEqual(snapshot(context.projectRoot), before);
    }
    // A rename that leaves the owned paths may move only a Host Binding symlink.
    write(path.join(context.projectRoot, JOURNAL), `${JSON.stringify(craftedJournal([
      { kind: 'mkdir', args: { paths: ['x'] }, inverse: { kind: 'rename', args: { from: 'src', to: '.agents/.dhpk-projection-backup-x1/bindings/src' } } },
    ]))}\n`);
    assert.throws(() => publisher.recoverAgentsSkillsProjection({ projectRoot: context.projectRoot }), (error) => error.projectionCode === 'RECOVERY_CONFLICT');
    assert.strictEqual(fs.readFileSync(path.join(context.projectRoot, 'src/app.js'), 'utf8'), 'user code\n');
  } finally {
    cleanup(context);
  }
});

run('project-agent-projection-journal-crash');
