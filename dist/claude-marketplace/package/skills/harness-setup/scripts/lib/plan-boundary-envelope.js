'use strict';

// The `--plan --json` envelope shared by the Codex and Cursor installer, the
// AGY installer and dhpk-install (#1584). A plan that stops at a fail-closed
// policy or version boundary (ADR-0031, ADR-0036) still answers on stdout:
// verdict BLOCKED, a stable reasonCode, the detected receipt or journal
// version, the affected paths and structured remediation. Remediation only
// names existing ways out (a transition release, --uninstall, --recover); it
// never offers to read a legacy fingerprint recipe.

// Records without fingerprint_algorithm, or written by a superseded
// generator, are read only by this release line (content-fingerprint.js).
const FINGERPRINT_TRANSITION_VERSION = '0.69.x';
const PLAN_VERDICTS = Object.freeze(['READY', 'CHANGES_PENDING', 'BLOCKED']);
const REMEDIATION_FIELDS = Object.freeze(['kind', 'summary', 'command', 'transitionVersion', 'releasesEntries']);

function remediation(kind, summary, { command = null, transitionVersion = null, releasesEntries = false } = {}) {
  return { kind, summary, command, transitionVersion, releasesEntries };
}

function uniqueSorted(values) {
  return [...new Set((values || []).filter((value) => typeof value === 'string' && value))].sort();
}

function uniqueRemediation(entries) {
  const seen = new Set();
  const result = [];
  for (const entry of entries || []) {
    const key = JSON.stringify(REMEDIATION_FIELDS.map((field) => entry[field]));
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(entry);
  }
  return result;
}

function envelope(verdict, { reasonCode = null, receiptVersion = null, journalVersion = null, affectedPaths = [], remediation: entries = [] } = {}) {
  if (!PLAN_VERDICTS.includes(verdict)) throw new Error(`unsupported plan verdict: ${verdict}`);
  return {
    verdict,
    reasonCode,
    receiptVersion,
    journalVersion,
    affectedPaths: uniqueSorted(affectedPaths),
    remediation: uniqueRemediation(entries),
  };
}

// One fail-closed finding; `message` is the text the installer already prints.
function blocker({ reasonCode, message, receiptVersion = null, journalVersion = null, affectedPaths = [], remediation: entries = [] }) {
  return { reasonCode, message, receiptVersion, journalVersion, affectedPaths: uniqueSorted(affectedPaths), remediation: uniqueRemediation(entries) };
}

// The first finding names the reason; versions come from the first finding
// that detected one; paths and remediation are the union.
function blockedEnvelope(blockers) {
  if (!Array.isArray(blockers) || blockers.length === 0) throw new Error('a blocked envelope needs at least one blocker');
  const first = (field) => {
    const found = blockers.find((item) => item[field] !== null && item[field] !== undefined);
    return found ? found[field] : null;
  };
  return {
    ...envelope('BLOCKED', {
      reasonCode: blockers[0].reasonCode,
      receiptVersion: first('receiptVersion'),
      journalVersion: first('journalVersion'),
      affectedPaths: blockers.flatMap((item) => item.affectedPaths),
      remediation: blockers.flatMap((item) => item.remediation),
    }),
    blockers,
  };
}

// A receipt or journal this release cannot read (ADR-0031): upgrade through
// the transition release line, or --uninstall, which releases what it cannot
// prove into Released Entries without deleting a file.
function versionBoundaryRemediation({ updateCommand, uninstallCommand, installCommand = null }) {
  return [
    remediation('transition-upgrade',
      `Run one install or update with dhpk ${FINGERPRINT_TRANSITION_VERSION}; it rewrites the record with tree-merkle-v1, which this release reads.`,
      { command: updateCommand, transitionVersion: FINGERPRINT_TRANSITION_VERSION }),
    remediation('uninstall-and-reinstall',
      `Or run --uninstall with this release: receipt entries are released into Released Entries and no file is deleted; then install again${installCommand ? ` (${installCommand})` : ''}.`,
      { command: uninstallCommand, releasesEntries: true }),
  ];
}

// A journal only an older release line recovers (ADR-0036).
function transitionRecoverRemediation({ transitionVersion, recoverCommand }) {
  return [remediation('transition-recover',
    `Run --recover with dhpk ${transitionVersion}, the last release line that recovers this journal, then retry with this release.`,
    { command: recoverCommand, transitionVersion })];
}

function recoverRemediation({ recoverCommand }) {
  return [remediation('recover',
    'Run --recover with this release to finish or roll back the interrupted transaction, then re-run the plan.',
    { command: recoverCommand })];
}

function retiredProfileRemediation({ uninstallCommand, installCommand }) {
  return [
    remediation('uninstall-and-reinstall',
      'Run --uninstall: unchanged receipt-owned entries are removed and local edits stay in place; then install again without --profile.',
      { command: uninstallCommand }),
    remediation('reinstall', 'Install the common collection after the uninstall.', { command: installCommand }),
  ];
}

function manualRemediation(summary) {
  return [remediation('manual-inspection', summary)];
}

// A POSIX-shell word for a path in a remediation command.
function shellWord(value) {
  const text = String(value);
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(text) ? text : `'${text.replace(/'/g, "'\\''")}'`;
}

module.exports = {
  FINGERPRINT_TRANSITION_VERSION,
  PLAN_VERDICTS,
  remediation,
  envelope,
  blocker,
  blockedEnvelope,
  versionBoundaryRemediation,
  transitionRecoverRemediation,
  recoverRemediation,
  retiredProfileRemediation,
  manualRemediation,
  shellWord,
};
