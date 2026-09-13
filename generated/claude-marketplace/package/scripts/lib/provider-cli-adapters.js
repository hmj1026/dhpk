'use strict';

const { createExecutionTarget } = require('./dispatch-contract');
const { createExecutionAdapter } = require('./provider-adapter');
const DEFAULT_CATALOG = require('../../manifests/provider-model-catalog.json');

const TRANSPORT_REQUESTS = Object.freeze({
  'codex-cli/local-cli': Object.freeze({ executable: 'codex', stdin_mode: 'prompt', output: 'transport-file' }),
  'agy/local-cli': Object.freeze({ executable: 'agy', stdin_mode: 'agy-confirmation', output: 'none' }),
  'claude-code/local-cli': Object.freeze({ executable: 'claude', stdin_mode: 'prompt', output: 'stdout' }),
  'cursor-native/native-runtime': Object.freeze({ executable: null, stdin_mode: 'native', output: 'native-result' }),
});

function requireTarget(target) {
  return createExecutionTarget(target);
}

function translatedModel(target, catalog) {
  const provider = catalog && Array.isArray(catalog.providers)
    ? catalog.providers.find((entry) => entry.provider === target.provider)
    : null;
  const model = provider && Array.isArray(provider.models)
    ? provider.models.find((entry) => entry.id === target.model)
    : null;
  return model && model.effort_mapping && model.effort_mapping[target.effort]
    ? model.effort_mapping[target.effort]
    : target.model;
}

function buildInvocation(target, request, { printTimeout = '300s', catalog = DEFAULT_CATALOG } = {}) {
  const normalizedTarget = requireTarget(target);
  const transport = TRANSPORT_REQUESTS[`${normalizedTarget.provider}/${normalizedTarget.transport}`];
  if (!transport) throw new Error(`unsupported Provider/Transport: ${normalizedTarget.provider}/${normalizedTarget.transport}`);
  if (normalizedTarget.provider === 'cursor-native') {
    return Object.freeze({ provider: normalizedTarget.provider, transport: normalizedTarget.transport, executable: null, argv: [], stdin_mode: transport.stdin_mode, output: transport.output });
  }
  const workdir = request.scope.workdir;
  if (normalizedTarget.provider === 'codex-cli') {
    const argv = ['exec', '--skip-git-repo-check', '--sandbox', request.authority,
      '-c', 'approval_policy=never', '--cd', workdir, '-m', normalizedTarget.model,
      '-c', `model_reasoning_effort=${normalizedTarget.effort}`,
      '--output-last-message', '{transport_output}', '-'];
    return Object.freeze({ provider: normalizedTarget.provider, transport: normalizedTarget.transport, executable: transport.executable, argv: Object.freeze(argv), stdin_mode: transport.stdin_mode, output: transport.output });
  }
  if (normalizedTarget.provider === 'agy') {
    const argv = ['--dangerously-skip-permissions', '--mode', 'accept-edits', '--add-dir', workdir,
      '--model', translatedModel(normalizedTarget, catalog), '--print-timeout', printTimeout, '-p', '{prompt}'];
    return Object.freeze({ provider: normalizedTarget.provider, transport: normalizedTarget.transport, executable: transport.executable, argv: Object.freeze(argv), stdin_mode: transport.stdin_mode, output: transport.output });
  }
  const argv = ['--model', normalizedTarget.model, '--effort', normalizedTarget.effort, '--prompt-file', '{prompt}'];
  return Object.freeze({ provider: normalizedTarget.provider, transport: normalizedTarget.transport, executable: transport.executable, argv: Object.freeze(argv), stdin_mode: transport.stdin_mode, output: transport.output });
}

function createCliAdapter({ provider, version, execute, catalog = DEFAULT_CATALOG } = {}) {
  return createExecutionAdapter({
    provider,
    version,
    execute: (target, request) => {
      const invocation = buildInvocation(target, request, { catalog });
      if (typeof execute !== 'function') return { status: 'BLOCKED', failure_class: 'ADAPTER_NOT_CONFIGURED', verification: 'BLOCKED' };
      return execute(target, request, invocation);
    },
  });
}

module.exports = Object.freeze({ TRANSPORT_REQUESTS, buildInvocation, createCliAdapter });
