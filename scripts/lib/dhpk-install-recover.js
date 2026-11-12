'use strict';

// `dhpk-install --recover`: explicit recovery for the states that stay
// fail-closed (ADR-0033). It resolves an orphaned held shared-projection
// publication and names every Host journal a dhpk 0.72/0.73 installer left
// unfinished. This release no longer recovers those (issue #1321); the report
// points at the dhpk 0.74.x line that does. It never guesses a commit.

const fs = require('node:fs');
const path = require('node:path');
const { recoverSharedProjection } = require('./native-shared-skill-install');
const { LEGACY_JOURNAL_RECOVERY_RELEASE } = require('./projection-journal');

const INSTALLER_HOSTS = Object.freeze(['.codex', '.cursor']);
const HOST_JOURNAL_PHASES = Object.freeze(['committed', 'rolled_back', 'active', 'rollback_incomplete']);
const JOURNAL_NAME = /^\.dhpk-transaction-(\d{8}T\d{6}Z-\d+)\.json$/;

function parseRecoverArgs(argv) {
  const options = { projectRoot: process.cwd(), json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--recover') continue;
    if (arg === '--json') options.json = true;
    else if (arg === '--project-root') {
      const value = argv[++index];
      if (!value || value.startsWith('--')) throw new Error('--project-root requires a value');
      options.projectRoot = value;
    } else throw new Error(`unknown --recover option: ${arg}`);
  }
  options.projectRoot = path.resolve(options.projectRoot);
  return options;
}

function legacyHostJournals(projectRoot) {
  const found = [];
  for (const hostRoot of INSTALLER_HOSTS) {
    const directory = path.join(projectRoot, hostRoot);
    let names;
    try {
      names = fs.readdirSync(directory);
    } catch (error) {
      if (error && error.code === 'ENOENT') continue;
      throw error;
    }
    for (const name of names.sort()) {
      const match = JOURNAL_NAME.exec(name);
      if (!match) continue;
      const journalPath = path.join(directory, name);
      let phase;
      let error = null;
      try {
        phase = JSON.parse(fs.readFileSync(journalPath, 'utf8')).phase;
        // A phase this release cannot classify is not a finished journal: block, never all-clear.
        if (!HOST_JOURNAL_PHASES.includes(phase)) {
          error = `unsupported phase: ${JSON.stringify(phase === undefined ? null : phase)}`;
          phase = 'unreadable';
        }
      } catch (readError) {
        phase = 'unreadable';
        error = readError.message;
      }
      if (phase === 'active' || phase === 'rollback_incomplete') {
        found.push({ host: hostRoot, run: match[1], phase, code: 'LEGACY_HOST_JOURNAL', action: `recover it with dhpk ${LEGACY_JOURNAL_RECOVERY_RELEASE} --recover` });
      } else if (phase === 'unreadable') {
        // No release can replay a journal it cannot read; say so instead of suggesting it.
        found.push({ host: hostRoot, run: match[1], phase, journalPath, error, action: 'inspect or restore this journal by hand; the installer cannot replay it' });
      }
    }
  }
  return found;
}

// js-projection-journal stage 3: one Projection Journal and one install lock
// per project. Recovery runs the installer of the Host the journal (or the
// lock) names with --recover, which removes a stale lock, finishes or undoes
// the journal by its commit point, and recovers that Host's older journals.
function recoverProjectionJournal(projectRoot, installerRoot) {
  const agents = path.join(projectRoot, '.agents');
  const journalPath = path.join(agents, '.dhpk-projection-journal.json');
  const lockPath = path.join(agents, '.dhpk-install.lock');
  const readHost = (file) => {
    try {
      const value = JSON.parse(fs.readFileSync(file, 'utf8'));
      return value && typeof value.host === 'string' ? value.host : null;
    } catch (_) {
      return null;
    }
  };
  // lstat, not existsSync: a dangling symlink exists and must reach the installer.
  const journalPresent = pathExists(journalPath);
  const lockPresent = pathExists(lockPath);
  if (!journalPresent && !lockPresent) return { ok: true, state: 'ABSENT' };
  const host = (journalPresent && readHost(journalPath)) || (lockPresent && readHost(lockPath)) || null;
  if (!host) {
    return { ok: false, state: 'BLOCKED', code: 'HOST_UNKNOWN', message: 'neither .agents/.dhpk-projection-journal.json nor .agents/.dhpk-install.lock names a readable Host; inspect or remove them by hand, then rerun the Codex installer' };
  }
  try {
    const { HOSTS, installerEnv, runCaptured } = require('./install-adapters/codex-cli');
    if (!HOSTS[host]) return { ok: false, state: 'BLOCKED', code: 'UNKNOWN_HOST', message: `the Projection Journal names an unknown Host: ${host}` };
    const outcome = runCaptured(installerEnv({ host, pluginRoot: installerRoot, installerRoot, projectRoot, recover: true }));
    const output = `${outcome.stdout}${outcome.stderr}`.trim();
    if (outcome.code === 0) return { ok: true, state: 'RECOVERED', host };
    return { ok: false, state: 'BLOCKED', code: 'RECOVERY_FAILED', host, message: output };
  } catch (error) {
    return { ok: false, state: 'BLOCKED', code: 'RECOVERY_FAILED', host, message: `the ${host} installer could not run: ${error && error.message ? error.message : error}` };
  }
}

function pathExists(file) {
  try {
    fs.lstatSync(file);
    return true;
  } catch (error) {
    if (error && error.code === 'ENOENT') return false;
    throw error;
  }
}

function recoverProject({ projectRoot, installerRoot }) {
  // Host journals first: when one blocks, neither mutating recovery may run
  // (it would change the tree this release then tells the user to hand to 0.74.x).
  const installerJournals = legacyHostJournals(projectRoot);
  if (installerJournals.length > 0) {
    const skipped = { ok: false, state: 'SKIPPED', code: 'LEGACY_HOST_JOURNAL', message: 'not run: a Host journal this release cannot recover blocks every mutating recovery' };
    return { ok: false, projectRoot, projectionJournal: { ...skipped }, sharedProjection: { ...skipped }, installerJournals };
  }
  const projectionJournal = recoverProjectionJournal(projectRoot, installerRoot);
  const sharedProjection = recoverSharedProjection({ projectRoot });
  return {
    ok: projectionJournal.ok && sharedProjection.ok && installerJournals.length === 0,
    projectRoot,
    projectionJournal,
    sharedProjection,
    installerJournals,
  };
}

function formatRecoverReport(report) {
  const lines = [];
  const journal = report.projectionJournal;
  if (journal && journal.state === 'SKIPPED') {
    lines.push(`projection journal: SKIPPED (${journal.message})`);
  } else if (journal && journal.state !== 'ABSENT') {
    lines.push(journal.ok ? `projection journal: ${journal.state} (${journal.host})` : `projection journal: BLOCKED (${journal.code}): ${journal.message}`);
  }
  const shared = report.sharedProjection;
  lines.push(shared.state === 'SKIPPED' ? `shared projection: SKIPPED (${shared.message})` : shared.ok ? `shared projection: ${shared.state}` : `shared projection: BLOCKED (${shared.code}): ${shared.message}`);
  for (const journal of report.installerJournals) {
    if (journal.code === 'LEGACY_HOST_JOURNAL') lines.push(`${journal.host} transaction ${journal.run} is ${journal.phase}; ${journal.action}`);
    else lines.push(`${journal.host} transaction ${journal.run} is ${journal.phase} (${journal.journalPath}: ${journal.error}); ${journal.action}`);
  }
  if (report.ok) lines.push('no incomplete rollback or orphaned shared projection remains; an interrupted installer run is reconciled by its next normal run');
  return `${lines.join('\n')}\n`;
}

module.exports = {
  parseRecoverArgs,
  recoverProject,
  formatRecoverReport,
};
