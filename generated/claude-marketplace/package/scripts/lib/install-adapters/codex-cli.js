'use strict';

// Process and in-process entry for the JS Codex/Cursor installer
// (js-projection-journal stage 3). scripts/hooks/install-codex-skills.sh
// parses its options, exports DHPK_* variables, and execs this file;
// dhpk-install runs the same installer in-process through runInstaller().

const fs = require('node:fs');
const path = require('node:path');
const { createInstaller } = require('./codex');
const { InstallerExit } = require('./python-compat');

const HOSTS = Object.freeze({
  codex: { srcRel: 'codex', destRel: '.codex', sourceKinds: 'skills,agents', installerName: 'install-codex-skills' },
  cursor: { srcRel: 'cursor', destRel: '.cursor', sourceKinds: 'skills,agents,rules,commands', installerName: 'install-cursor-harness' },
});

// The DHPK_* environment the shell entry builds from its options.
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
  baseEnv = process.env,
}) {
  const shape = HOSTS[host];
  if (!shape) throw new Error(`unsupported installer host: ${host}`);
  return {
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
}

// Runs one installer invocation. `io.stdout` / `io.stderr` receive text;
// `afterStep` is the in-process crash hook of the Projection Journal (tests).
function runInstaller(env = process.env, io = {}) {
  const output = {
    stdout: io.stdout || ((text) => fs.writeSync(1, text)),
    stderr: io.stderr || ((text) => fs.writeSync(2, text)),
    afterStep: io.afterStep || null,
  };
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
      output.stderr(`[${env.DHPK_INSTALLER_NAME || 'install-codex-skills'}] ERROR: unexpected failure: ${error && error.stack ? error.stack : error}\n`);
      code = 1;
    }
  } finally {
    if (!crashed) {
      try {
        installer.close();
      } catch (error) {
        // Never silent, and never a different outcome: a failing run keeps its
        // code; a run that would have succeeded now fails with 2.
        output.stderr(`[${env.DHPK_INSTALLER_NAME || 'install-codex-skills'}] ERROR: could not release the install lock: ${error && error.message ? error.message : error}\n`);
        if (code === 0) code = 2;
      }
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
