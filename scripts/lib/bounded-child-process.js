'use strict';

const { spawnSync } = require('node:child_process');

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

function runNodeTest(file, { env = process.env, timeoutMs = 60000 } = {}) {
  const detached = process.platform !== 'win32';
  const result = spawnSync(process.execPath, [file], {
    stdio: 'inherit',
    env,
    timeout: timeoutMs,
    killSignal: 'SIGKILL',
    detached,
  });

  // spawnSync's timeout only targets the direct child.  A timed-out test can
  // have spawned grandchildren (or a child that ignores SIGTERM), so clean up
  // its process group only on the timeout/error path.  Killing a group after a
  // successful child exit can race with a deliberately short-lived descendant
  // that is still flushing output; the outer verified cgroup owns that normal
  // completion boundary. ESRCH simply means the group already exited.
  const timedOut = Boolean(result.error) || result.status === null;
  if (detached && result.pid && timedOut) {
    terminateProcessGroup(result.pid, 'SIGTERM');
    terminateProcessGroup(result.pid, 'SIGKILL');
  }
  return result;
}

module.exports = { runNodeTest, terminateProcessGroup };
