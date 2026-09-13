'use strict';

// Exact configured-consumer probe for an opt-in Claude profile package. A
// missing CLI or unsupported receipt is an honest non-pass result; package
// structure alone is never upgraded to consumer PASS.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createTraversalBudget, readDirectoryEntries, readFileBounded } = require('../lib/bounded-filesystem');

const STATUSES = Object.freeze(['PASS', 'FAIL', 'NOT_RUN', 'NOT_CONFIGURED', 'SKIP_INCOMPATIBLE', 'BLOCKED', 'UNAVAILABLE']);
const PROFILE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SECRET_KEY = /(token|secret|password|passwd|credential|authorization|api[_-]?key|private[_-]?key)/i;

function safeCommand(command) {
  const base = path.basename(typeof command === 'string' && command.trim() ? command : 'claude');
  return /^[A-Za-z0-9._-]+$/.test(base) ? base : 'claude';
}

function boundedValue(value, depth = 0, key = '') {
  if (depth > 3) return '<depth-limited>';
  if (typeof value === 'string') {
    if (/(?:path|root|home|cwd|directory|file)/i.test(key)) return '<path>';
    const normalized = value
      .replace(/[A-Za-z]:[\\/][^\s"']+/g, '<path>')
      .replace(/(^|[\s"'(])\/(?:[^/\s"'()]+\/)+[^/\s"'()]+/g, '$1<path>')
      .replace(/(^|[\s"'(])\/[^/\s"'()]+/g, '$1<path>');
    return normalized.length > 512 ? `${normalized.slice(0, 509)}...` : normalized;
  }
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, 64).map((item) => boundedValue(item, depth + 1, key));
  if (typeof value === 'object') {
    return Object.keys(value).sort().slice(0, 64).reduce((out, key) => {
      const safeKey = SECRET_KEY.test(key) ? '<redacted-key>' : key.slice(0, 128);
      out[safeKey] = SECRET_KEY.test(key) ? '<redacted>' : boundedValue(value[key], depth + 1, key);
      return out;
    }, {});
  }
  return String(value);
}

function digestTree(root) {
  const files = [];
  const budget = createTraversalBudget();
  const walk = (directory, relative = '', depth = 0) => {
    const realDirectory = budget.enterDirectory(directory, depth);
    try {
      for (const entry of readDirectoryEntries(directory, { budget, sort: true, localeSort: true })) {
        if (entry.name === '.artifact-store' || entry.name.startsWith('.projection-')) continue;
        const absolute = path.join(directory, entry.name);
        const rel = path.posix.join(relative, entry.name);
        if (entry.isSymbolicLink()) return { error: `symlink is not allowed in profile package: ${rel}` };
        if (entry.isDirectory()) {
          const result = walk(absolute, rel, depth + 1);
          if (result && result.error) return result;
        } else if (entry.isFile()) {
          const stat = fs.lstatSync(absolute);
          const content = budget.readFile(absolute, stat, rel);
          files.push({ path: rel, digest: crypto.createHash('sha256').update(content).digest('hex') });
        } else return { error: `unsupported profile package entry: ${rel}` };
      }
    } finally {
      budget.leaveDirectory(realDirectory);
    }
    return null;
  };
  let error;
  try { error = walk(root); } catch (caught) { return { error: caught.message }; }
  if (error) return error;
  return { fingerprint: crypto.createHash('sha256').update(JSON.stringify(files)).digest('hex'), files };
}

function digestArtifact(root, receipt) {
  if (!receipt || !Array.isArray(receipt.outputs) || receipt.outputs.length === 0) return { error: 'profile receipt output ledger is missing' };
  const outputs = [];
  for (const output of receipt.outputs) {
    if (!output || typeof output.stableId !== 'string' || typeof output.destination !== 'string'
      || output.destination.includes('\\') || path.posix.normalize(output.destination) !== output.destination
      || path.posix.isAbsolute(output.destination) || output.destination.startsWith('../')) {
      return { error: 'profile receipt output ledger is invalid' };
    }
    const file = path.resolve(root, output.destination);
    const relative = path.relative(root, file);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return { error: 'profile receipt output escapes package root' };
    let stat;
    try { stat = fs.lstatSync(file); } catch (_) { return { error: `profile receipt output is missing: ${output.destination}` }; }
    if (!stat.isFile() || stat.isSymbolicLink()) return { error: `profile receipt output is not a regular file: ${output.destination}` };
    let content;
    try { content = readFileBounded(file); } catch (_) { return { error: `profile receipt output cannot be read: ${output.destination}` }; }
    outputs.push({ stableId: output.stableId, destination: output.destination, fingerprint: crypto.createHash('sha256').update(content).digest('hex'), mode: stat.mode & 0o7777 });
  }
  return { fingerprint: crypto.createHash('sha256').update(JSON.stringify({ outputs, links: [] })).digest('hex'), outputs };
}

function parseJson(stdout) {
  try { return { value: JSON.parse(String(stdout || '')) }; } catch (_) { return { error: 'consumer returned invalid JSON' }; }
}

function safeManifest(manifest) {
  return boundedValue({ name: manifest && manifest.name, version: manifest && manifest.version, skills: manifest && manifest.skills });
}

function runClaudeProfileProbe({
  profileId,
  packageRoot,
  expectedPlanFingerprint = null,
  expectedArtifactFingerprint = null,
  command = 'claude',
  runner = spawnSync,
} = {}) {
  const commandName = safeCommand(command);
  const validProfile = typeof profileId === 'string' && PROFILE_ID_PATTERN.test(profileId);
  const pluginId = validProfile ? `dhpk@dhpk-profile-${profileId}` : null;
  const commands = validProfile ? [
    { argv: [commandName, 'plugin', 'list', '--json'], purpose: 'resolve installed profile plugin' },
    { argv: [commandName, 'plugin', 'details', pluginId, '--json'], purpose: 'observe profile components and projected cost' },
  ] : [];
  const unavailable = (status, reason, extra = {}) => ({
    status,
    platform: 'claude-profile',
    profileId: validProfile ? profileId : null,
    packageRoot: packageRoot ? '<profile-package>' : null,
    commands,
    reason,
    resumeCommand: validProfile ? `claude plugin details ${pluginId} --json` : 'claude plugin details <profile-plugin> --json',
    ...extra,
  });
  if (!validProfile) return unavailable('BLOCKED', 'profile id must use a finite safe alias');
  if (!packageRoot || !fs.existsSync(packageRoot)) return unavailable('BLOCKED', 'profile package is missing');
  let packageStat;
  try { packageStat = fs.lstatSync(packageRoot); } catch (_) { return unavailable('BLOCKED', 'profile package is unavailable'); }
  if (!packageStat.isDirectory() || packageStat.isSymbolicLink()) return unavailable('BLOCKED', 'profile package root must be a real directory');
  const receiptPath = path.join(packageRoot, 'bundle-receipt.json');
  const manifestPath = path.join(packageRoot, 'plugin.json');
  if (!fs.existsSync(receiptPath) || !fs.existsSync(manifestPath)) return unavailable('BLOCKED', 'profile package receipt or manifest is missing');
  let receipt;
  let manifest;
  try {
    receipt = JSON.parse(readFileBounded(receiptPath).toString('utf8'));
    manifest = JSON.parse(readFileBounded(manifestPath).toString('utf8'));
  } catch (_) {
    return unavailable('FAIL', 'profile package receipt or manifest is invalid');
  }
  if (receipt.schema !== 'dhpk.claude-capability-bundle.v1' || !receipt.profile
    || receipt.profile.id !== profileId || receipt.consumerPluginId !== pluginId
    || !Array.isArray(receipt.selectedStableIds)) {
    return unavailable('FAIL', 'profile receipt identity is invalid');
  }
  const tree = digestTree(packageRoot);
  if (tree.error) return unavailable('FAIL', tree.error);
  const artifact = digestArtifact(packageRoot, receipt);
  if (artifact.error) return unavailable('FAIL', artifact.error, { treeFingerprint: tree.fingerprint });
  const plannedPaths = new Set(artifact.outputs.map((output) => output.destination));
  const observedPaths = new Set(tree.files.map((file) => file.path));
  if (plannedPaths.size !== observedPaths.size || [...plannedPaths].some((file) => !observedPaths.has(file))) {
    return unavailable('FAIL', 'profile package contains files outside the receipt output ledger', {
      treeFingerprint: tree.fingerprint,
      artifactFingerprint: artifact.fingerprint,
    });
  }
  if (expectedPlanFingerprint && receipt.planFingerprint !== expectedPlanFingerprint) {
    return unavailable('FAIL', 'profile package plan fingerprint is stale', { planFingerprint: receipt.planFingerprint, artifactFingerprint: artifact.fingerprint });
  }
  let listed;
  try {
    const list = runner(command, ['plugin', 'list', '--json'], { encoding: 'utf8' });
    if (list.error && (list.error.code === 'ENOENT' || list.error.code === 'EACCES')) return unavailable('NOT_CONFIGURED', 'Claude executable is unavailable');
    if (list.status !== 0) return unavailable('UNAVAILABLE', `Claude plugin list exited ${list.status}`);
    const parsed = parseJson(list.stdout);
    if (parsed.error) return unavailable('UNAVAILABLE', parsed.error);
    listed = parsed.value;
  } catch (_) {
    return unavailable('NOT_CONFIGURED', 'Claude executable is unavailable');
  }
  const rows = Array.isArray(listed) ? listed : Array.isArray(listed && listed.plugins) ? listed.plugins : [];
  const installed = rows.find((row) => row && [row.id, row.name, row.plugin, row.pluginId].includes(pluginId));
  if (!installed) return unavailable('UNAVAILABLE', `profile plugin '${pluginId}' is not installed`, { manifest: safeManifest(manifest), artifactFingerprint: artifact.fingerprint });
  const installedPath = installed.installPath || installed.path;
  if (typeof installedPath !== 'string' || path.resolve(installedPath) !== path.resolve(packageRoot)) {
    return unavailable('FAIL', 'consumer did not resolve the expected profile package path', { manifest: safeManifest(manifest), artifactFingerprint: artifact.fingerprint });
  }
  const detailResult = runner(command, ['plugin', 'details', pluginId, '--json'], { encoding: 'utf8' });
  if (detailResult.error && (detailResult.error.code === 'ENOENT' || detailResult.error.code === 'EACCES')) return unavailable('NOT_CONFIGURED', 'Claude executable is unavailable');
  if (detailResult.status !== 0) return unavailable('UNAVAILABLE', `Claude plugin details exited ${detailResult.status}`, { manifest: safeManifest(manifest), artifactFingerprint: artifact.fingerprint });
  const parsedDetails = parseJson(detailResult.stdout);
  if (parsedDetails.error) return unavailable('UNAVAILABLE', parsedDetails.error, { manifest: safeManifest(manifest), artifactFingerprint: artifact.fingerprint });
  const details = parsedDetails.value;
  const detailPath = details && (details.installPath || details.path);
  if (detailPath && path.resolve(detailPath) !== path.resolve(packageRoot)) return unavailable('FAIL', 'consumer details resolved a different profile package path', { manifest: safeManifest(manifest), artifactFingerprint: artifact.fingerprint });
  if (!expectedPlanFingerprint || !expectedArtifactFingerprint) return unavailable('BLOCKED', 'consumer PASS requires expected plan and artifact fingerprints');
  if (receipt.planFingerprint !== expectedPlanFingerprint) return unavailable('FAIL', 'profile package plan fingerprint is stale', { artifactFingerprint: artifact.fingerprint });
  if (expectedArtifactFingerprint !== artifact.fingerprint) return unavailable('FAIL', 'consumer package fingerprint is stale', { artifactFingerprint: artifact.fingerprint });
  return {
    status: 'PASS',
    platform: 'claude-profile',
    profileId,
    manifest: safeManifest(manifest),
    packageRoot: '<profile-package>',
    planFingerprint: receipt.planFingerprint,
    artifactFingerprint: artifact.fingerprint,
    treeFingerprint: tree.fingerprint,
    details: { fingerprint: crypto.createHash('sha256').update(String(detailResult.stdout || '')).digest('hex'), summary: boundedValue(details) },
    commands,
    checkedClaims: ['installed profile identity', 'resolved package path', 'inventory-bound package fingerprint', 'consumer component details'],
    reason: 'Claude resolved the selected profile package and returned component details; this is not model prompt-token proof',
  };
}

module.exports = {
  STATUSES,
  digestTree,
  digestArtifact,
  runClaudeProfileProbe,
  probeClaudeProfile: runClaudeProfileProbe,
};
