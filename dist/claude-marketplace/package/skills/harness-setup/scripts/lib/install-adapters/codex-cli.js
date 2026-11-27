'use strict';

// Process and in-process entry for the JS Codex/Cursor installer
// (js-projection-journal stage 3). scripts/hooks/install-codex-skills.sh
// parses its options, exports DHPK_* variables, and execs this file;
// dhpk-install runs the same installer in-process through runInstaller().

const fs = require('node:fs');
const path = require('node:path');
const { createInstaller, HOSTS } = require('./codex');
const { InstallerExit } = require('./python-compat');
const {
  DELEGATED_ENV,
  appendInstallHistory,
  readPackageSourceVersion,
  readHostReceiptSummary,
} = require('../install-history');

// The DHPK_* environment the shell entry builds from its options. `pluginRoot`
// and `installerRoot` name the artifact (data: manifests, codex/, cursor/,
// skills/); the installer's own modules never come from either.
function installerEnv({
  host = 'codex',
  pluginRoot,
  installerRoot = pluginRoot,
  projectRoot,
  mode = 'symlink',
  modeExplicit = false,
  update = false,
  migrate = false,
  uninstall = false,
  plan = false,
  recover = false,
  json = false,
  adoptPaths = [],
  skillIds = [],
  historyDelegated = false,
  baseEnv = process.env,
}) {
  const shape = HOSTS[host];
  if (!shape) throw new Error(`unsupported installer host: ${host}`);
  const env = {
    ...baseEnv,
    DHPK_HARNESS_KIND: host,
    DHPK_SRC_REL: shape.srcRel,
    DHPK_DEST_REL: shape.destRel,
    DHPK_SOURCE_KINDS: shape.sourceKinds,
    DHPK_INSTALLER_NAME: shape.installerName,
    DHPK_PLUGIN_ROOT: pluginRoot,
    DHPK_INSTALLER_ROOT: installerRoot,
    DHPK_PROJECT_ROOT: projectRoot,
    DHPK_MODE: mode,
    DHPK_MODE_EXPLICIT: modeExplicit ? '1' : '0',
    DHPK_UPDATE: update ? '1' : '0',
    DHPK_MIGRATE: migrate ? '1' : '0',
    DHPK_UNINSTALL: uninstall ? '1' : '0',
    DHPK_PLAN: plan ? '1' : '0',
    DHPK_RECOVER: recover ? '1' : '0',
    DHPK_JSON_OUTPUT: json ? '1' : '0',
    DHPK_ADOPT_PATHS: adoptPaths.map((value) => `${value}\n`).join(''),
    DHPK_SKILL_IDS: skillIds.map((value) => `${value}\n`).join(''),
  };
  if (historyDelegated) env[DELEGATED_ENV] = '1';
  return env;
}

function resolveInstallerAction(env) {
  if (env.DHPK_PLAN === '1') return 'plan';
  if (env.DHPK_RECOVER === '1') return 'recover';
  if (env.DHPK_UNINSTALL === '1') return 'uninstall';
  if (env.DHPK_MIGRATE === '1') return 'migrate';
  if (env.DHPK_UPDATE === '1') return 'update';
  return 'install';
}

function parseJsonReport(text) {
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (_) {
    return null;
  }
}

function inferReasonCodes(code, action, report, stderrText) {
  const codes = [];
  if (report) {
    if (typeof report.reasonCode === 'string' && report.reasonCode) codes.push(report.reasonCode);
    if (Array.isArray(report.blockers)) {
      for (const blocker of report.blockers) {
        if (blocker && typeof blocker.reasonCode === 'string' && blocker.reasonCode) codes.push(blocker.reasonCode);
      }
    }
  }
  if (codes.length === 0 && code !== 0) {
    if (/CODEX_NATIVE_PLUGIN_ENABLED|native .* plugin dhpk@dhpk is enabled/i.test(stderrText)) codes.push('CODEX_NATIVE_PLUGIN_ENABLED');
    else if (/state=stale_receipt/i.test(stderrText)) codes.push('STALE_RECEIPT');
    else if (/could not release the install lock/i.test(stderrText)) codes.push('LOCK_RELEASE_FAILED');
    else if (/unexpected failure:/i.test(stderrText)) codes.push('UNEXPECTED_FAILURE');
    else if (code === 1) codes.push(action === 'plan' ? 'CHANGES_PENDING' : 'RECONCILIATION_INCOMPLETE');
    else codes.push('INSTALL_FAILED');
  }
  return codes;
}

// Runs one installer invocation. `io.stdout` / `io.stderr` receive text;
// `afterStep` is the in-process crash hook of the Projection Journal (tests).
function runInstaller(env = process.env, io = {}) {
  const rawStdout = io.stdout || ((text) => fs.writeSync(1, text));
  const rawStderr = io.stderr || ((text) => fs.writeSync(2, text));
  const stdoutChunks = [];
  const stderrChunks = [];
  const output = {
    stdout: (text) => {
      if (stdoutChunks.length < 512) stdoutChunks.push(text);
      rawStdout(text);
    },
    stderr: (text) => {
      if (stderrChunks.length < 512) stderrChunks.push(text);
      rawStderr(text);
    },
    afterStep: io.afterStep || null,
  };
  const DEFAULT_INSTALLER_NAME = 'install-codex-skills';
  const host = env.DHPK_HARNESS_KIND === 'cursor' ? 'cursor' : 'codex';
  const surface = host === 'cursor' ? 'cursor' : 'codex-sync';
  const destRel = env.DHPK_DEST_REL || (host === 'cursor' ? '.cursor' : '.codex');
  const action = resolveInstallerAction(env);
  const projectRoot = env.DHPK_PROJECT_ROOT || null;
  const pluginRoot = env.DHPK_PLUGIN_ROOT || env.DHPK_INSTALLER_ROOT || path.resolve(__dirname, '..', '..', '..');
  const sourceVersion = readPackageSourceVersion(pluginRoot);
  const beforeSummary = projectRoot ? readHostReceiptSummary(projectRoot, destRel) : { version: null, state: 'absent' };
  const installer = createInstaller(env, output);
  let crashed = false;
  let code = 0;
  try {
    installer.main();
  } catch (error) {
    if (error instanceof InstallerExit) code = error.code;
    else if (io.rethrow && io.rethrow(error)) {
      // A simulated crash leaves the lock behind, as a killed process would.
      crashed = true;
      throw error;
    } else {
      output.stderr(`[${env.DHPK_INSTALLER_NAME || DEFAULT_INSTALLER_NAME}] ERROR: unexpected failure: ${error && error.stack ? error.stack : error}\n`);
      code = 1;
    }
  } finally {
    if (!crashed) {
      try {
        installer.close();
      } catch (error) {
        // Never silent, and never a different outcome: a failing run keeps its
        // code; a run that would have succeeded now fails with 2.
        output.stderr(`[${env.DHPK_INSTALLER_NAME || DEFAULT_INSTALLER_NAME}] ERROR: could not release the install lock: ${error && error.message ? error.message : error}\n`);
        if (code === 0) code = 2;
      }
      const report = parseJsonReport(stdoutChunks.join(''));
      const stderrText = stderrChunks.join('');
      const afterSummary = action === 'plan'
        ? { ...beforeSummary }
        : (projectRoot ? readHostReceiptSummary(projectRoot, destRel) : { ...beforeSummary });
      if (beforeSummary.version === null && report && typeof report.receiptVersion === 'string') {
        beforeSummary.version = report.receiptVersion;
        if (action === 'plan') afterSummary.version = report.receiptVersion;
      }
      const verdict = action === 'plan'
        ? (report && typeof report.verdict === 'string' ? report.verdict : (code === 0 ? 'READY' : code === 1 ? 'CHANGES_PENDING' : 'BLOCKED'))
        : (code === 0 ? 'INSTALL_PASS' : code === 1 ? 'PARTIAL' : 'BLOCKED');
      appendInstallHistory({
        surface,
        action,
        scope: 'project',
        sourceVersion,
        projectRoot,
        exitCode: code,
        verdict,
        reasonCodes: inferReasonCodes(code, action, report, stderrText),
        beforeVersion: beforeSummary,
        afterVersion: afterSummary,
      }, { env, stderr: rawStderr });
    }
  }
  return code;
}

// Captures the output of one in-process run.
function runCaptured(env, { afterStep = null, rethrow = null } = {}) {
  const stdout = [];
  const stderr = [];
  const code = runInstaller(env, { stdout: (text) => stdout.push(text), stderr: (text) => stderr.push(text), afterStep, rethrow });
  return { code, stdout: stdout.join(''), stderr: stderr.join('') };
}

// The project-root heuristic the shell entry applies unless --force.
function looksLikeProjectRoot(projectRoot) {
  return ['.git', '.claude', '.codex', '.cursor', 'package.json', 'composer.json'].some((name) => fs.existsSync(path.join(projectRoot, name)));
}

if (require.main === module) process.exitCode = runInstaller();

module.exports = { HOSTS, installerEnv, runInstaller, runCaptured, looksLikeProjectRoot };
