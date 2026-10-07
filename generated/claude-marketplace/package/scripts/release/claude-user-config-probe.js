'use strict';

// A structural manifest is not a Claude runtime observation. This probe is
// intentionally conservative: an unavailable or unconfigured exact-version
// CLI remains non-pass and carries a copyable resume command.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { digest, safeRegularPath } = require('../lib/plugin-user-config-metadata');

const STATUSES = new Set(['PASS', 'FAIL', 'NOT_RUN', 'NOT_CONFIGURED', 'BLOCKED', 'UNAVAILABLE']);

function safeCommand(command) {
  const value = typeof command === 'string' && command.trim() ? command.trim() : 'claude';
  return path.basename(value).match(/^[A-Za-z0-9._-]+$/) ? value : 'claude';
}

function redacted(value, depth = 0) {
  if (depth > 3) return '<depth-limited>';
  if (typeof value === 'string') {
    return value
      .replace(/[A-Za-z]:[\\/][^\s"']+/g, '<path>')
      .replace(/(^|[\s"'(])\/(?:[^/\s"'()]+\/)+[^/\s"'()]+/g, '$1<path>')
      .slice(0, 512);
  }
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, 32).map((item) => redacted(item, depth + 1));
  if (typeof value === 'object') return Object.keys(value).sort().slice(0, 32).reduce((out, key) => {
    if (/(token|secret|password|credential|authorization|api[_-]?key|private[_-]?key)/i.test(key)) out['<redacted-key>'] = '<redacted>';
    else if (/fingerprint/i.test(key)) out[key.slice(0, 96)] = safeFingerprint(value[key]);
    else out[key.slice(0, 96)] = redacted(value[key], depth + 1);
    return out;
  }, {});
  return String(value);
}

function parseJson(stdout) {
  try { return { value: JSON.parse(String(stdout || '')) }; } catch (_) { return { error: 'consumer returned invalid JSON' }; }
}

function validFingerprint(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
}

function safeFingerprint(value) {
  return validFingerprint(value) ? value : '<invalid-fingerprint>';
}

function hasExactVersion(output, expected) {
  const escaped = String(expected).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|\\D)${escaped}(?![0-9A-Za-z.-])`).test(String(output || ''));
}

function applicableRecords(inventory) {
  if (!Array.isArray(inventory) || inventory.some((record) => !record || typeof record !== 'object' || Array.isArray(record))) {
    return { status: 'UNAVAILABLE', reason: 'consumer inventory must be an array of plugin records' };
  }
  const records = [];
  for (const record of inventory.filter((item) => item.id === 'dhpk@dhpk')) {
    if (!['user', 'managed', 'project', 'local'].includes(record.scope) || typeof record.enabled !== 'boolean') {
      return { status: 'BLOCKED', reason: 'dhpk inventory has an ambiguous scope or enabled state' };
    }
    if (['project', 'local'].includes(record.scope)) {
      if (typeof record.projectPath !== 'string' || !path.isAbsolute(record.projectPath)) {
        return { status: 'BLOCKED', reason: 'project inventory requires an absolute project path' };
      }
      const relative = path.relative(record.projectPath, process.cwd());
      if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) continue;
    }
    if (!record.enabled) continue;
    if (record.errors !== undefined && (!Array.isArray(record.errors) || record.errors.length > 0)) {
      return { status: 'BLOCKED', reason: 'applicable dhpk installation has load errors' };
    }
    records.push(record);
  }
  return records.length ? { records } : { status: 'BLOCKED', reason: 'no applicable enabled dhpk plugin identity is installed' };
}

function installedManifest(record, manifests) {
  const folder = Object.prototype.hasOwnProperty.call(record, 'readFromFolder');
  const root = folder ? record.readFromFolder : record.installPath;
  if (typeof root !== 'string' || !path.isAbsolute(root) || root.split(path.sep).includes('..')) {
    return { status: 'BLOCKED', reason: 'effective installation path must be absolute' };
  }
  const manifestPath = path.join(root, '.claude-plugin/plugin.json');
  const normalizedRoot = path.resolve(root);
  let manifest = manifests.get(normalizedRoot);
  let content;
  if (!manifest) {
    try {
      if (!safeRegularPath(path.parse(root).root, manifestPath)
        || !fs.lstatSync(root).isDirectory() || !fs.lstatSync(manifestPath).isFile()) {
        return { status: 'BLOCKED', reason: 'installed manifest path must be physical and regular' };
      }
      content = fs.readFileSync(manifestPath, 'utf8');
    } catch (_) { return { status: 'BLOCKED', reason: 'installed manifest cannot be read' }; }
    try { manifest = JSON.parse(content); } catch (_) { return { status: 'FAIL', reason: 'installed manifest is invalid JSON' }; }
  }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest) || manifest.name !== 'dhpk') {
    return { status: 'BLOCKED', reason: 'installed manifest does not identify dhpk' };
  }
  manifests.set(normalizedRoot, manifest);
  const observedFingerprint = digest(manifest);
  const observedVersion = folder ? record.folderVersion : record.version;
  if (manifest.version !== undefined && observedVersion !== manifest.version) {
    return { status: 'FAIL', reason: 'inventory version does not match the installed manifest', observedFingerprint };
  }
  return { root: normalizedRoot, observedFingerprint };
}

function bindInventory(inventory, manifestFingerprint) {
  const selected = applicableRecords(inventory);
  if (!selected.records) return selected;
  const fingerprints = new Map();
  const manifests = new Map();
  for (const record of selected.records) {
    const observed = installedManifest(record, manifests);
    if (observed.status) return observed;
    fingerprints.set(observed.root, observed.observedFingerprint);
    if (observed.observedFingerprint !== manifestFingerprint) {
      return { status: 'FAIL', reason: 'installed manifest fingerprint is stale',
        expectedFingerprint: manifestFingerprint, observedFingerprint: observed.observedFingerprint };
    }
  }
  return { status: 'PASS', reason: 'Claude inventory matched every effective installed manifest; no live context reduction claim is made',
    manifestFingerprint, observedFingerprints: [...fingerprints.values()],
    details: redacted(selected.records.map(({ id, scope, enabled, version, folderVersion }) => ({ id, scope, enabled, version, folderVersion }))) };
}

function runClaudeUserConfigProbe({ executable = 'claude', manifestPath, manifestFingerprint, version, execute = false, runner = spawnSync } = {}) {
  const command = safeCommand(executable);
  const resumeCommand = `${command} plugin list --json`;
  const executing = execute || process.env.DHPK_CONSUMER_PROBE_EXECUTE === '1';
  if (!manifestPath || !fs.existsSync(manifestPath)) {
    return { status: 'NOT_CONFIGURED', reason: 'manifest is unavailable', resumeCommand };
  }
  if (!manifestFingerprint) {
    return { status: 'BLOCKED', reason: 'generated manifest fingerprint is required', resumeCommand };
  }
  if (!validFingerprint(manifestFingerprint)) return { status: 'BLOCKED', reason: 'manifest fingerprint must be a SHA-256 value', resumeCommand };
  let stat;
  try {
    if (!safeRegularPath(path.dirname(path.dirname(manifestPath)), manifestPath)) return { status: 'BLOCKED', reason: 'manifest path has a symlinked ancestor', resumeCommand };
    const linkStat = fs.lstatSync(manifestPath);
    if (linkStat.isSymbolicLink()) return { status: 'BLOCKED', reason: 'manifest path must not be a symlink', resumeCommand };
    stat = fs.statSync(manifestPath);
  } catch (_) { return { status: 'BLOCKED', reason: 'manifest cannot be read', resumeCommand }; }
  if (!stat.isFile()) return { status: 'BLOCKED', reason: 'manifest path is not a regular file', resumeCommand };
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch (_) { return { status: 'FAIL', reason: 'manifest is invalid JSON', resumeCommand }; }
  const versionResult = runner(command, ['--version'], { encoding: 'utf8', timeout: 5000 });
  if (versionResult.error || versionResult.status !== 0) {
    return { status: 'NOT_CONFIGURED', reason: 'configured Claude executable is unavailable', resumeCommand };
  }
  const observedVersion = String(versionResult.stdout || versionResult.stderr || '').trim();
  if (executing && (!version || String(version).trim() === '')) {
    return { status: 'BLOCKED', reason: 'exact Claude version is required for an executing consumer probe', observedVersion: redacted(observedVersion), resumeCommand };
  }
  if (version && !hasExactVersion(observedVersion, version)) {
    return { status: 'BLOCKED', reason: `Claude version mismatch; expected ${version}`, observedVersion: redacted(observedVersion), resumeCommand };
  }
  const observedManifestFingerprint = digest(manifest);
  if (observedManifestFingerprint !== manifestFingerprint) {
    return { status: 'FAIL', reason: 'manifest fingerprint does not match the generated candidate', expectedFingerprint: safeFingerprint(manifestFingerprint), observedManifestFingerprint: safeFingerprint(observedManifestFingerprint), resumeCommand };
  }
  if (!executing) {
    return { status: 'NOT_RUN', reason: 'Claude executable is present; installed-manifest observation was not requested', observedVersion: redacted(observedVersion), resumeCommand };
  }
  const detail = runner(command, ['plugin', 'list', '--json'], { encoding: 'utf8', timeout: 10000 });
  if (detail.error && (detail.error.code === 'ENOENT' || detail.error.code === 'EACCES')) return { status: 'NOT_CONFIGURED', reason: 'configured Claude executable is unavailable', resumeCommand };
  if (detail.error || detail.status !== 0) return { status: 'UNAVAILABLE', reason: `Claude plugin inventory exited ${detail.status}`, diagnostic: redacted(detail.stderr || ''), resumeCommand };
  const parsed = parseJson(detail.stdout);
  if (parsed.error) return { status: 'UNAVAILABLE', reason: parsed.error, resumeCommand };
  return {
    ...bindInventory(parsed.value, manifestFingerprint),
    stage: 'installed-manifest',
    observedVersion: redacted(observedVersion),
    resumeCommand,
  };
}

module.exports = { runClaudeUserConfigProbe, STATUSES };

function parseArgs(argv) {
  const args = { execute: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--manifest') args.manifestPath = argv[++i];
    else if (argv[i] === '--fingerprint') args.manifestFingerprint = argv[++i];
    else if (argv[i] === '--command') args.executable = argv[++i];
    else if (argv[i] === '--version') args.version = argv[++i];
    else if (argv[i] === '--execute') args.execute = true;
    else if (argv[i] === '--help') {
      console.log('usage: claude-user-config-probe.js --manifest <path> --fingerprint <sha256> [--command claude] [--version X.Y.Z] [--execute]');
      return null;
    } else throw new Error(`unknown argument '${argv[i]}'`);
  }
  if (!args.manifestPath || !args.manifestFingerprint) throw new Error('manifest and fingerprint are required');
  return args;
}

if (require.main === module) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (!args) process.exit(0);
    const result = runClaudeUserConfigProbe(args);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exit(result.status === 'PASS' ? 0 : 1);
  } catch (error) {
    console.error(`claude-user-config-probe: ${error.message}`);
    process.exit(2);
  }
}
