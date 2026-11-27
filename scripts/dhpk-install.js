#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { parseRequest, helpFor, execute } = require('./lib/dhpk-install-lifecycle');

const root = path.resolve(__dirname, '..');

function loadManifests() {
  return {
    inventory: JSON.parse(fs.readFileSync(path.join(root, 'manifests', 'distribution-inventory.json'), 'utf8')),
    profiles: JSON.parse(fs.readFileSync(path.join(root, 'manifests', 'install-profiles.json'), 'utf8')),
    moduleCatalog: JSON.parse(fs.readFileSync(path.join(root, 'manifests', 'module-catalog.json'), 'utf8')),
    plugin: JSON.parse(fs.readFileSync(path.join(root, '.claude-plugin', 'plugin.json'), 'utf8')),
  };
}

const argv = process.argv.slice(2);
if (argv.includes('--recover')) {
  const { parseRecoverArgs, recoverProject, formatRecoverReport } = require('./lib/dhpk-install-recover');
  let options;
  try {
    options = parseRecoverArgs(argv);
  } catch (error) {
    process.stderr.write(`dhpk-install: ${error.message}\n`);
    process.exitCode = 64;
    return;
  }
  if (options.help) {
    process.stdout.write(helpFor({ recover: true }));
    process.exitCode = 0;
    return;
  }
  try {
    const report = recoverProject({ projectRoot: options.projectRoot, installerRoot: root });
    process.stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : formatRecoverReport(report));
    process.exitCode = report.ok ? 0 : 2;
  } catch (error) {
    process.stderr.write(`dhpk-install: --recover failed: ${error.message}\n`);
    process.exitCode = 2;
  }
  return;
}

// Codex and Cursor project-local writes run the JS installer in-process, with
// the outcome the installer script would have (install-lifecycle).
const WRITE_HOSTS = Object.freeze({ 'codex-sync': 'codex', cursor: 'cursor' });

function hostWrite(request, host) {
  const { installerEnv, runCaptured, looksLikeProjectRoot } = require('./lib/install-adapters/codex-cli');
  const blocked = (code, message, remediation = []) => ({
    request,
    plan: null,
    lifecycle: { verdict: 'BLOCKED' },
    diagnostics: [{ code, message }],
    remediation,
  });
  if (!request.projectRoot) {
    return blocked('PROJECT_ROOT_REQUIRED', `${request.surface} ${request.action} writes into a project; pass --project-root <dir>`);
  }
  const projectRoot = path.resolve(request.projectRoot);
  if (request.mode === 'client-managed') return blocked('UNSUPPORTED_MODE', `${request.surface} supports --mode copy, symlink, or auto`);
  // The shell installer skips this heuristic for --uninstall; so does this path.
  if (request.action !== 'uninstall' && !request.yes && !looksLikeProjectRoot(projectRoot)) {
    return blocked('NOT_A_PROJECT_ROOT', `'${projectRoot}' does not look like a project root`, ['Re-run with --yes to bypass this check.']);
  }
  const env = installerEnv({
    host,
    pluginRoot: root,
    installerRoot: root,
    projectRoot,
    mode: request.mode === 'copy' ? 'copy' : 'symlink',
    modeExplicit: request.mode !== 'auto',
    update: request.action === 'update',
    uninstall: request.action === 'uninstall',
    plan: request.dryRun,
    json: false,
    skillIds: request.skillIds || [],
  });
  const outcome = runCaptured(env);
  const lines = (text) => text.split('\n').filter(Boolean);
  const installer = { exitCode: outcome.code, stdout: lines(outcome.stdout), stderr: lines(outcome.stderr) };
  if (outcome.code === 0) return { request, plan: null, lifecycle: { verdict: request.dryRun ? 'NOT_RUN' : 'INSTALL_PASS' }, diagnostics: [], remediation: [], installer };
  const actions = installer.stderr.filter((line) => /ACTION REQUIRED/.test(line));
  return {
    ...blocked(outcome.code === 1 ? 'RECONCILIATION_INCOMPLETE' : 'INSTALL_FAILED', installer.stderr.find((line) => /ERROR|BLOCKED|state=/.test(line)) || `${request.surface} ${request.action} exited ${outcome.code}`, actions),
    installer,
  };
}

// A Codex or Cursor plan against a project runs the installer's read-only
// `--update --plan --json` and keeps its envelope and exit status (#1584):
// 0 ready, 1 non-fatal reconciliation or collision, 2 blocked.
function hostPlan(request, host) {
  const { installerEnv, runCaptured, looksLikeProjectRoot } = require('./lib/install-adapters/codex-cli');
  const { envelope, manualRemediation } = require('./lib/plan-boundary-envelope');
  const blocked = (reasonCode, message, summary, installer = null) => ({
    request,
    plan: null,
    lifecycle: { verdict: 'BLOCKED' },
    ...envelope('BLOCKED', { reasonCode, remediation: manualRemediation(summary) }),
    diagnostics: [{ code: reasonCode, message }],
    ...(installer ? { installer } : {}),
    exitCode: 2,
  });
  const projectRoot = path.resolve(request.projectRoot);
  if (request.mode === 'client-managed') return blocked('UNSUPPORTED_MODE', `${request.surface} supports --mode copy, symlink, or auto`, 'Re-run with --mode copy, symlink, or auto.');
  if (!request.yes && !looksLikeProjectRoot(projectRoot)) {
    return blocked('NOT_A_PROJECT_ROOT', `'${projectRoot}' does not look like a project root`, 'Re-run with --yes to bypass this check.');
  }
  const outcome = runCaptured(installerEnv({
    host,
    pluginRoot: root,
    installerRoot: root,
    projectRoot,
    mode: request.mode === 'copy' ? 'copy' : 'symlink',
    modeExplicit: request.mode !== 'auto',
    update: true,
    plan: true,
    json: true,
    skillIds: request.skillIds || [],
  }));
  const installer = { exitCode: outcome.code, stderr: outcome.stderr.split('\n').filter(Boolean) };
  let report;
  try {
    report = JSON.parse(outcome.stdout);
  } catch (error) {
    report = null;
  }
  if (!report || typeof report !== 'object' || typeof report.verdict !== 'string') {
    return blocked('INSTALLER_OUTPUT_INVALID', `${request.surface} plan exited ${outcome.code} without a plan report`, 'Run the installer plan directly and inspect its output.', installer);
  }
  const { verdict, reasonCode, receiptVersion, journalVersion, affectedPaths, remediation } = report;
  return {
    request,
    plan: report,
    lifecycle: { verdict: outcome.code === 2 ? 'BLOCKED' : 'NOT_RUN' },
    verdict,
    reasonCode,
    receiptVersion,
    journalVersion,
    affectedPaths,
    remediation,
    diagnostics: reasonCode ? [{ code: reasonCode, message: (report.blockers && report.blockers[0] && report.blockers[0].message) || reasonCode }] : [],
    installer,
    exitCode: [0, 1, 2].includes(outcome.code) ? outcome.code : 2,
  };
}

try {
  const request = parseRequest(argv);
  if (request.help) {
    process.stdout.write(helpFor(request));
    process.exitCode = 0;
    return;
  }
  const writeHost = WRITE_HOSTS[request.surface];
  if (writeHost && request.scope === 'project' && request.action === 'plan' && request.projectRoot) {
    const { exitCode, ...result } = hostPlan(request, writeHost);
    if (request.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    else {
      for (const line of (result.installer && result.installer.stderr) || []) process.stderr.write(`${line}\n`);
      process.stdout.write(`${result.verdict}: ${request.surface} plan${result.reasonCode ? ` (${result.reasonCode})` : ''}\n`);
      for (const entry of result.remediation) process.stdout.write(`  ${entry.summary}${entry.command ? `: ${entry.command}` : ''}\n`);
    }
    process.exitCode = exitCode;
    return;
  }
  if (writeHost && request.scope === 'project' && ['install', 'update', 'uninstall'].includes(request.action)) {
    const result = hostWrite(request, writeHost);
    if (request.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    else {
      if (result.installer) {
        for (const line of result.installer.stdout) process.stdout.write(`${line}\n`);
        for (const line of result.installer.stderr) process.stderr.write(`${line}\n`);
      }
      process.stdout.write(`${result.lifecycle.verdict}: ${request.surface} ${request.action}\n`);
      for (const diagnostic of result.diagnostics) if (!result.installer) process.stderr.write(`dhpk-install: ${diagnostic.code}: ${diagnostic.message}\n`);
    }
    process.exitCode = result.lifecycle.verdict === 'BLOCKED' ? 2 : 0;
    return;
  }
  const { inventory, profiles, moduleCatalog, plugin } = loadManifests();
  if (request.action === 'status') {
    const { formatStatusReport } = require('./lib/dhpk-install-status');
    const { exitCode, ...result } = execute(request, inventory, {
      root,
      profiles,
      moduleCatalog,
      sourceVersion: plugin.version,
    });
    if (request.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    else process.stdout.write(formatStatusReport(result));
    process.exitCode = Number.isInteger(exitCode) ? exitCode : 0;
    return;
  }
  const result = execute(request, inventory, { root, profiles, moduleCatalog, sourceVersion: plugin.version });
  if (request.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else process.stdout.write(`${result.lifecycle.verdict}: ${request.surface} ${request.action}\n`);
  process.exitCode = result.lifecycle.verdict === 'BLOCKED' ? 2 : 0;
} catch (error) {
  process.stderr.write(`dhpk-install: ${error.message}\n`);
  process.exitCode = 64;
}
