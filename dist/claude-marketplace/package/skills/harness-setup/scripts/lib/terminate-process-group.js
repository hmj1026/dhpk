'use strict';

// Kills the process group of a detached spawnSync child. It uses process.kill
// only, so the packaged installer can ship it with the Host CLI probe without
// also shipping bounded-child-process.js (the Node test runner, which is the
// module that imports node:child_process for runNodeTest).

function terminateProcessGroup(pid, signal = 'SIGTERM') {
  if (process.platform === 'win32' || !Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(-pid, signal);
    return true;
  } catch (error) {
    if (error && error.code === 'ESRCH') return false;
    throw error;
  }
}

module.exports = { terminateProcessGroup };
