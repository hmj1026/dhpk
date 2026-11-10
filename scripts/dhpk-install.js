#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { parseRequest, execute } = require('./lib/dhpk-install-lifecycle');

const root = path.resolve(__dirname, '..');
const inventory = JSON.parse(fs.readFileSync(path.join(root, 'manifests', 'distribution-inventory.json'), 'utf8'));
const profiles = JSON.parse(fs.readFileSync(path.join(root, 'manifests', 'install-profiles.json'), 'utf8'));
const moduleCatalog = JSON.parse(fs.readFileSync(path.join(root, 'manifests', 'module-catalog.json'), 'utf8'));
const plugin = JSON.parse(fs.readFileSync(path.join(root, '.claude-plugin', 'plugin.json'), 'utf8'));

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

// js-projection-journal stage 3: Codex project-local writes run the JS
// installer in-process, with the outcome the installer script would have.
function codexWrite(request) {
  const { installerEnv, runCaptured, looksLikeProjectRoot } = require('./lib/install-adapters/codex-cli');
  const blocked = (code, message, remediation = []) => ({
    request,
    plan: null,
    lifecycle: { verdict: 'BLOCKED' },
    diagnostics: [{ code, message }],
    remediation,
  });
  if (!request.projectRoot) {
    return blocked('PROJECT_ROOT_REQUIRED', `codex-sync ${request.action} writes into a project; pass --project-root <dir>`);
  }
  const projectRoot = path.resolve(request.projectRoot);
  if (request.mode === 'client-managed') return blocked('UNSUPPORTED_MODE', 'codex-sync supports --mode copy, symlink, or auto');
  if (!request.yes && !looksLikeProjectRoot(projectRoot)) {
    return blocked('NOT_A_PROJECT_ROOT', `'${projectRoot}' does not look like a project root`, ['Re-run with --yes to bypass this check.']);
  }
  const env = installerEnv({
    host: 'codex',
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
    ...blocked(outcome.code === 1 ? 'RECONCILIATION_INCOMPLETE' : 'INSTALL_FAILED', installer.stderr.find((line) => /ERROR|BLOCKED|state=/.test(line)) || `codex-sync ${request.action} exited ${outcome.code}`, actions),
    installer,
  };
}

try {
  const request = parseRequest(argv);
  if (request.surface === 'codex-sync' && ['install', 'update', 'uninstall'].includes(request.action)) {
    const result = codexWrite(request);
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
  const result = execute(request, inventory, { profiles, moduleCatalog, sourceVersion: plugin.version });
  if (request.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else process.stdout.write(`${result.lifecycle.verdict}: ${request.surface} ${request.action}\n`);
  process.exitCode = result.lifecycle.verdict === 'BLOCKED' ? 2 : 0;
} catch (error) {
  process.stderr.write(`dhpk-install: ${error.message}\n`);
  process.exitCode = 64;
}
