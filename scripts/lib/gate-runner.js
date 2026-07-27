'use strict';

// Runs a fixed list of shell steps and composes a release-evidence-shaped
// stage object. Every step always runs (no fail-fast) so the stage records
// full evidence rather than stopping at the first failure.

const { spawnSync } = require('child_process');
const { VERDICTS } = require('./release-evidence');

function runSteps(steps, { environment, cwd } = {}) {
  const commands = [];
  const failureReasons = [];

  for (const step of steps) {
    const res = spawnSync(step.cmd, step.args || [], { cwd, encoding: 'utf8' });
    const exitCode = res.status === null ? 127 : res.status;
    commands.push({ cmd: `${step.cmd} ${(step.args || []).join(' ')}`.trim(), exitCode });
    if (exitCode !== 0) {
      const detail = (res.stderr || res.stdout || '').trim().split('\n').slice(-3).join(' | ');
      failureReasons.push(`${step.name}: exited ${exitCode}${detail ? ` (${detail})` : ''}`);
    }
  }

  return {
    verdict: failureReasons.length === 0 ? VERDICTS.PASS : VERDICTS.FAIL,
    commands,
    environment: environment || 'local',
    artifacts: [],
    failureReasons,
  };
}

module.exports = { runSteps };
