'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const HOST_PROFILES = require('../../skills/flow-drive/references/execution-bundle/manifests/host-profiles.json');
const CATALOG = require('../../skills/flow-drive/references/execution-bundle/manifests/provider-model-catalog.json');
const EVIDENCE_ROOTS = new Set();
process.once('exit', () => {
  for (const root of EVIDENCE_ROOTS) fs.rmSync(root, { recursive: true, force: true });
});

const CODEX_PROFILE = HOST_PROFILES.profiles.find((profile) => profile.host === 'codex-cli');
const CLAUDE_PROFILE = HOST_PROFILES.profiles.find((profile) => profile.host === 'claude-code');
const DEFAULT_TASK = Object.freeze({
  goal: 'Update the receipt total display.',
  acceptance: Object.freeze(['The displayed total matches the receipt lines.']),
  constraints: Object.freeze({
    provider: 'openai',
    authority: 'workspace-write',
    assigned_files: Object.freeze(['src/receipt.js']),
    delegation: 'none',
  }),
});
const DEFAULT_TARGET = Object.freeze({
  target_agent: 'codex-cli',
  provider: 'openai',
  model_id: 'gpt-6-luna',
  effort: 'max',
});

function createRunnerFixture({
  task = DEFAULT_TASK,
  capabilities = { host_profile: CODEX_PROFILE, catalog: CATALOG },
  decision = { target: DEFAULT_TARGET, mode: 'solo' },
  outcome = {
    status: 'SUCCEEDED',
    observed_target: { target_agent: 'codex-cli', provider: 'openai', model_id: 'gpt-6-luna' },
  },
  acceptance = { status: 'PASSED', evidence: 'receipt total matches the literal acceptance example' },
} = {}) {
  const calls = [];
  const evidenceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-drive-runner-fixture-'));
  EVIDENCE_ROOTS.add(evidenceRoot);
  const host = {
    async resolveTask(input, context) {
      calls.push({ method: 'resolveTask', input, context });
      const promptPath = path.join(evidenceRoot, `input-${calls.length}.txt`);
      const content = Buffer.from(String(input));
      fs.writeFileSync(promptPath, content, { mode: 0o600 });
      const stat = fs.statSync(promptPath);
      return {
        ...task,
        constraints: {
          ...task.constraints,
          prompt_evidence: {
            path: promptPath,
            dev: stat.dev,
            ino: stat.ino,
            sha256: crypto.createHash('sha256').update(content).digest('hex'),
          },
        },
      };
    },
    async getCapabilities() {
      calls.push({ method: 'getCapabilities' });
      return capabilities;
    },
    async coordinate(resolvedTask, context) {
      calls.push({ method: 'coordinate', task: resolvedTask, context });
      return decision;
    },
    async execute(target, resolvedTask, context) {
      calls.push({ method: 'execute', target, task: resolvedTask, context });
      return outcome;
    },
    async verify(resolvedTask, executionOutcome, context) {
      calls.push({ method: 'verify', task: resolvedTask, outcome: executionOutcome, context });
      return acceptance;
    },
    async inspectScope() {
      return { within_scope: true, wip_preserved: true, identity: 'fixture-baseline' };
    },
  };

  return {
    host,
    calls,
    workdir: evidenceRoot,
    cleanup() {
      EVIDENCE_ROOTS.delete(evidenceRoot);
      fs.rmSync(evidenceRoot, { recursive: true, force: true });
    },
  };
}

module.exports = Object.freeze({
  CODEX_PROFILE,
  CLAUDE_PROFILE,
  CATALOG,
  DEFAULT_TASK,
  DEFAULT_TARGET,
  createRunnerFixture,
});
