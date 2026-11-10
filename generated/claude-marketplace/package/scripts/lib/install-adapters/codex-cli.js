'use strict';

// Process entry for the JS Codex/Cursor installer. scripts/hooks/
// install-codex-skills.sh parses options and exports DHPK_* variables, then
// execs this file (js-projection-journal stage 3).

const fs = require('node:fs');
const { createInstaller } = require('./codex');
const { InstallerExit } = require('./python-compat');

function run(env = process.env) {
  const io = {
    stdout: (text) => fs.writeSync(1, text),
    stderr: (text) => fs.writeSync(2, text),
  };
  const installer = createInstaller(env, io);
  try {
    installer.main();
    return 0;
  } catch (error) {
    if (error instanceof InstallerExit) return error.code;
    io.stderr(`[${env.DHPK_INSTALLER_NAME || 'install-codex-skills'}] ERROR: unexpected failure: ${error && error.stack ? error.stack : error}\n`);
    return 1;
  } finally {
    installer.close();
  }
}

if (require.main === module) process.exitCode = run();

module.exports = { run };
