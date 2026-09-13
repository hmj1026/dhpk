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

function runClaudeUserConfigProbe({ executable = 'claude', manifestPath, manifestFingerprint, version, execute = false, runner = spawnSync } = {}) {
  const command = safeCommand(executable);
  const resumeCommand = `${command} plugin details dhpk@dhpk --json`;
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
  if (execute && (!version || String(version).trim() === '')) {
    return { status: 'BLOCKED', reason: 'exact Claude version is required for an executing consumer probe', observedVersion: redacted(observedVersion), resumeCommand };
  }
  if (version && !hasExactVersion(observedVersion, version)) {
    return { status: 'BLOCKED', reason: `Claude version mismatch; expected ${version}`, observedVersion: redacted(observedVersion), resumeCommand };
  }
  const observedManifestFingerprint = digest(manifest);
  if (observedManifestFingerprint !== manifestFingerprint) {
    return { status: 'FAIL', reason: 'manifest fingerprint does not match the generated candidate', expectedFingerprint: safeFingerprint(manifestFingerprint), observedManifestFingerprint: safeFingerprint(observedManifestFingerprint), resumeCommand };
  }
  if (!execute && process.env.DHPK_CONSUMER_PROBE_EXECUTE !== '1') {
    return { status: 'NOT_RUN', reason: 'Claude executable is present; exact plugin details observation was not requested', observedVersion: redacted(observedVersion), resumeCommand };
  }
  const detail = runner(command, ['plugin', 'details', 'dhpk@dhpk', '--json'], { encoding: 'utf8', timeout: 10000 });
  if (detail.error && (detail.error.code === 'ENOENT' || detail.error.code === 'EACCES')) return { status: 'NOT_CONFIGURED', reason: 'configured Claude executable is unavailable', resumeCommand };
  if (detail.status !== 0) return { status: 'UNAVAILABLE', reason: `Claude plugin details exited ${detail.status}`, diagnostic: redacted(detail.stderr || ''), resumeCommand };
  const parsed = parseJson(detail.stdout);
  if (parsed.error) return { status: 'UNAVAILABLE', reason: parsed.error, resumeCommand };
  const details = parsed.value;
  const identity = details && (details.id || details.name || details.plugin || details.pluginId);
  const identities = Array.isArray(identity) ? identity : [identity];
  if (!identities.some((value) => value === 'dhpk' || value === 'dhpk@dhpk')) {
    return { status: 'BLOCKED', reason: 'consumer details are not the dhpk plugin identity', details: redacted(details), resumeCommand };
  }
  const declaredFingerprints = [details && details.manifestFingerprint, details && details.userConfigFingerprint].filter((value) => value !== undefined);
  if (declaredFingerprints.length === 0 || declaredFingerprints.some((value) => !validFingerprint(value))) {
    return { status: 'BLOCKED', reason: 'consumer details did not expose a valid manifest fingerprint for binding', details: redacted(details), resumeCommand };
  }
  const observedFingerprint = declaredFingerprints[0];
  if (new Set(declaredFingerprints).size !== 1) {
    return { status: 'FAIL', reason: 'consumer details exposed conflicting manifest fingerprints', fingerprints: declaredFingerprints.map(safeFingerprint), resumeCommand };
  }
  if (observedFingerprint !== manifestFingerprint) {
    return { status: 'FAIL', reason: 'consumer manifest fingerprint is stale', expectedFingerprint: safeFingerprint(manifestFingerprint), observedFingerprint: safeFingerprint(observedFingerprint), resumeCommand };
  }
  return {
    status: 'PASS',
    reason: 'Claude plugin details matched the generated manifest fingerprint; no live context reduction claim is made',
    observedVersion: redacted(observedVersion),
    manifestFingerprint,
    details: redacted(details),
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
