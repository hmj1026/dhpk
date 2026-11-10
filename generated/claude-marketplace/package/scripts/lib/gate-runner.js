'use strict';

// Runs a fixed list of shell steps and composes a release-evidence-shaped
// stage object. Every step always runs (no fail-fast) so the stage records
// full evidence rather than stopping at the first failure. A failed step's
// complete output is kept as a `step-output` artifact; the failure reason
// carries only its tail plus the artifact path.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { VERDICTS } = require('./release-evidence');

function writeStepOutput(logDir, index, step, res) {
  const directory = logDir || fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-gate-'));
  fs.mkdirSync(directory, { recursive: true });
  const safeName = String(step.name).replace(/[^A-Za-z0-9._-]/g, '_');
  const file = path.join(directory, `${String(index).padStart(2, '0')}-${safeName}.log`);
  const body = [
    `$ ${step.cmd} ${(step.args || []).join(' ')}`.trim(),
    '--- stdout ---',
    res.stdout || '',
    '--- stderr ---',
    res.stderr || '',
  ].join('\n');
  fs.writeFileSync(file, body, { mode: 0o600 });
  return file;
}

function runSteps(steps, { environment, cwd, env, logDir } = {}) {
  const commands = [];
  const failureReasons = [];
  const artifacts = [];
  let failureLogDir = logDir;

  steps.forEach((step, index) => {
    const stepEnv = step.env
      ? { ...(env || process.env), ...step.env }
      : env;
    const res = spawnSync(step.cmd, step.args || [], {
      cwd,
      env: stepEnv,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    const exitCode = res.status === null ? 127 : res.status;
    commands.push({ cmd: `${step.cmd} ${(step.args || []).join(' ')}`.trim(), exitCode });
    if (exitCode === 0) return;

    const detail = (res.stderr || res.stdout || '').trim().split('\n').slice(-3).join(' | ');
    let reason = `${step.name}: exited ${exitCode}${detail ? ` (${detail})` : ''}`;
    // Spawn failures and maxBuffer overflows (ENOBUFS) surface only on res.error.
    if (res.error) reason += ` [spawn error: ${res.error.message}]`;
    if (res.stdout || res.stderr) {
      try {
        const file = writeStepOutput(failureLogDir, index, step, res);
        failureLogDir = path.dirname(file);
        artifacts.push({ kind: 'step-output', step: step.name, path: file });
        reason += ` [full output: ${file}]`;
      } catch (error) {
        // The verdict stays FAIL either way; say why the full output is missing.
        reason += ` [full output unavailable: ${error.message}]`;
      }
    }
    failureReasons.push(reason);
  });

  return {
    verdict: failureReasons.length === 0 ? VERDICTS.PASS : VERDICTS.FAIL,
    commands,
    environment: environment || 'local',
    artifacts,
    failureReasons,
  };
}

module.exports = { runSteps };
