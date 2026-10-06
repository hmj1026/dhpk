#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { prepareInvocationDispatch } = require('./dispatch');
const { launchWithInputs, readJsonObject, promptEvidence } = require(
  path.join(__dirname, '..', 'references', 'cli-dispatch', 'scripts', 'launch-cli-dispatch'),
);

function launchPacket(packet) {
  const evidence = promptEvidence(packet.prompt);
  const prepared = prepareInvocationDispatch(packet, evidence);
  if (prepared.resolution.status !== 'RESOLVED') {
    throw new Error(`dispatch ${prepared.resolution.status}: ${prepared.resolution.reason || 'target is not available'}`);
  }
  const target = prepared.resolution.target;
  if (packet.host_profile.host !== 'claude-code' || target.target_agent !== 'codex-cli'
    || target.route !== 'headless-cli' || target.transport !== 'local-cli') {
    throw new Error('this launcher requires a Claude Code headless Codex target; native dispatch belongs to the parent session');
  }
  const role = packet.role === 'worker' ? 'codex-worker' : 'codex-reasoner';
  return launchWithInputs({
    'dispatching-agent': 'claude-code',
    'execution-provider': 'codex',
    'requested-role': role,
    mode: packet.role === 'worker' ? 'workspace-write' : 'read-only',
    'task-id': packet.task_id,
    'attempt-id': packet.attempt_id,
    workdir: packet.workdir,
    prompt: packet.prompt,
  }, packet.scope, prepared.config, evidence);
}

function main(argv = process.argv.slice(2)) {
  if (argv.length === 1 && argv[0] === '--help') {
    process.stdout.write('Usage: launch-dispatch.js --packet <absolute dispatcher JSON path>\n');
    return 0;
  }
  if (argv.length !== 2 || argv[0] !== '--packet' || !path.isAbsolute(argv[1])) {
    process.stderr.write('flow-drive: BLOCKED: expected --packet <absolute dispatcher JSON path>\n');
    return 2;
  }
  try {
    return launchPacket(readJsonObject(argv[1], 'dispatcher packet'));
  } catch (error) {
    process.stderr.write(`flow-drive: BLOCKED: ${error.message}\n`);
    return 65;
  }
}

if (require.main === module) process.exitCode = main();

module.exports = Object.freeze({ main, launchPacket });
