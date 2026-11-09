'use strict';

// `dhpk-install --recover`: explicit recovery for the states that stay
// fail-closed (ADR-0033). It resolves an orphaned held shared-projection
// publication and names every installer journal whose rollback did not finish,
// with the installer command that replays it. It never guesses a commit.

const fs = require('node:fs');
const path = require('node:path');
const { recoverSharedProjection } = require('./native-shared-skill-install');

const INSTALLER_HOSTS = Object.freeze([
  { hostRoot: '.codex', script: path.join('scripts', 'hooks', 'install-codex-skills.sh') },
  { hostRoot: '.cursor', script: path.join('scripts', 'hooks', 'install-cursor-harness.sh') },
]);
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

function incompleteInstallerJournals(projectRoot, installerRoot) {
  const found = [];
  for (const { hostRoot, script } of INSTALLER_HOSTS) {
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
      } catch (readError) {
        phase = 'unreadable';
        error = readError.message;
      }
      if (phase === 'rollback_incomplete') {
        found.push({ host: hostRoot, run: match[1], phase, command: `bash ${path.join(installerRoot, script)} --recover` });
      } else if (phase === 'unreadable') {
        // The installer cannot replay a journal it cannot read; say so instead of suggesting it.
        found.push({ host: hostRoot, run: match[1], phase, journalPath, error, action: 'inspect or restore this journal by hand; the installer cannot replay it' });
      }
    }
  }
  return found;
}

function recoverProject({ projectRoot, installerRoot }) {
  const sharedProjection = recoverSharedProjection({ projectRoot });
  const installerJournals = incompleteInstallerJournals(projectRoot, installerRoot);
  return {
    ok: sharedProjection.ok && installerJournals.length === 0,
    projectRoot,
    sharedProjection,
    installerJournals,
  };
}

function formatRecoverReport(report) {
  const lines = [];
  const shared = report.sharedProjection;
  lines.push(shared.ok ? `shared projection: ${shared.state}` : `shared projection: BLOCKED (${shared.code}): ${shared.message}`);
  for (const journal of report.installerJournals) {
    if (journal.command) lines.push(`${journal.host} transaction ${journal.run} is ${journal.phase}; run: ${journal.command}`);
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
