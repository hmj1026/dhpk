'use strict';

const fs = require('node:fs');
const path = require('node:path');

const CLAUDE_PLUGIN_ROOT_TOKEN = '${' + 'CLAUDE_PLUGIN_ROOT}';
const CURSOR_PLUGIN_ROOT_TOKEN = '${' + 'CURSOR_PLUGIN_ROOT}';
const PORTABLE_ADAPTER_PREFIX = `${CURSOR_PLUGIN_ROOT_TOKEN}/../dhpk-agent/scripts/cli-dispatch/adapters/`;

const NATIVE_AGENT_SUPPORT_FILES = Object.freeze([
  'scripts/cli-dispatch/adapters/run-agy.sh',
  'scripts/cli-dispatch/adapters/run-codex.sh',
  'scripts/cli-dispatch/dispatch-runtime/build-cli-dispatch-context.js',
  'scripts/cli-dispatch/dispatch-runtime/cli-role-resolver.js',
  'scripts/cli-dispatch/dispatch-runtime/launch-cli-dispatch.js',
  'scripts/cli-dispatch/dispatch-runtime/physical-file.js',
  'scripts/cli-dispatch/dispatch-runtime/physical-file.py',
  'scripts/cli-dispatch/transport/prepare-cli-request.py',
  'scripts/cli-dispatch/transport/run-cli-transport.py',
  'scripts/cli-dispatch/verify-handoff.js',
  'scripts/fast-worker-selector.js',
  'scripts/lib/dispatch-capability-evidence.js',
  'scripts/lib/dispatch-contract.js',
  'scripts/lib/dispatch-engine.js',
  'scripts/lib/native-dispatch-policy.js',
  'manifests/provider-model-catalog.json',
]);

const CURSOR_SUPPORT_FILES = Object.freeze([
  'agent-traps/_common/prompt-defense.md',
  'agent-traps/_common/trap-sheet-loader.md',
  'agent-traps/_common/cli-prompt-composition.md',
  'agent-traps/_common/build-resolver-skeleton.md',
  'agent-traps/e2e-runner/playwright.md',
  'rules/execution-policy.mdc',
  'rules/tool-routing.mdc',
]);

const AGY_SUPPORT_FILES = Object.freeze([
  'agent-traps/_common/prompt-defense.md',
  'agent-traps/_common/trap-sheet-loader.md',
  'agent-traps/_common/cli-prompt-composition.md',
  'agent-traps/_common/build-resolver-skeleton.md',
  'agent-traps/e2e-runner/playwright.md',
  'rules/execution-policy.md',
  'rules/tool-routing.md',
  ...NATIVE_AGENT_SUPPORT_FILES,
]);

function rewriteAgyNativeAgentBody(body) {
  return String(body || '')
    .split(`${CLAUDE_PLUGIN_ROOT_TOKEN}/agent-traps/`).join('agent-traps/')
    .split(`${CLAUDE_PLUGIN_ROOT_TOKEN}/rules/`).join('rules/')
    .split(`${CLAUDE_PLUGIN_ROOT_TOKEN}/skills/`).join('skills/')
    .split(`${CLAUDE_PLUGIN_ROOT_TOKEN}/scripts/`).join('scripts/');
}

function cursorCases() {
  return [
    {
      agent: 'agents/planner.md',
      required: [
        `${CURSOR_PLUGIN_ROOT_TOKEN}/agent-traps/_common/prompt-defense.md`,
        `${CURSOR_PLUGIN_ROOT_TOKEN}/rules/execution-policy.mdc`,
      ],
      files: ['agent-traps/_common/prompt-defense.md', 'rules/execution-policy.mdc'],
      forbidden: ['.cursor/dhpk/'],
    },
    {
      agent: 'agents/code-reviewer.md',
      required: [
        `${CURSOR_PLUGIN_ROOT_TOKEN}/agent-traps/_common/prompt-defense.md`,
        `${CURSOR_PLUGIN_ROOT_TOKEN}/agent-traps/_common/trap-sheet-loader.md`,
        `${CURSOR_PLUGIN_ROOT_TOKEN}/rules/execution-policy.mdc`,
      ],
      files: [
        'agent-traps/_common/prompt-defense.md',
        'agent-traps/_common/trap-sheet-loader.md',
        'rules/execution-policy.mdc',
      ],
      forbidden: ['.cursor/dhpk/'],
    },
    {
      agent: 'agents/e2e-runner.md',
      required: [
        `${CURSOR_PLUGIN_ROOT_TOKEN}/agent-traps/e2e-runner/playwright.md`,
        `${CURSOR_PLUGIN_ROOT_TOKEN}/rules/tool-routing.mdc`,
      ],
      files: ['agent-traps/e2e-runner/playwright.md', 'rules/tool-routing.mdc'],
      forbidden: ['.cursor/dhpk/', '.cursor/rules/'],
    },
    {
      agent: 'agents/codex-worker.md',
      required: [
        `${CURSOR_PLUGIN_ROOT_TOKEN}/agent-traps/_common/cli-prompt-composition.md`,
        `${CURSOR_PLUGIN_ROOT_TOKEN}/agent-traps/_common/build-resolver-skeleton.md`,
        `${PORTABLE_ADAPTER_PREFIX}run-codex.sh`,
      ],
      files: [
        'agent-traps/_common/cli-prompt-composition.md',
        'agent-traps/_common/build-resolver-skeleton.md',
      ],
      forbidden: [
        '.cursor/dhpk/',
        `${CURSOR_PLUGIN_ROOT_TOKEN}/scripts/cli-dispatch/adapters/run-codex.sh`,
      ],
    },
    {
      agent: 'agents/agy-worker.md',
      required: [`${PORTABLE_ADAPTER_PREFIX}run-agy.sh`],
      files: [],
      forbidden: [`${CURSOR_PLUGIN_ROOT_TOKEN}/scripts/cli-dispatch/adapters/run-agy.sh`],
    },
  ];
}

function agyCases() {
  return [
    {
      agent: 'agents/planner.md',
      required: ['agent-traps/_common/prompt-defense.md', 'rules/execution-policy.md'],
      files: ['agent-traps/_common/prompt-defense.md', 'rules/execution-policy.md'],
      forbidden: [CLAUDE_PLUGIN_ROOT_TOKEN, '.cursor/dhpk/'],
    },
    {
      agent: 'agents/code-reviewer.md',
      required: ['agent-traps/_common/prompt-defense.md', 'agent-traps/_common/trap-sheet-loader.md'],
      files: ['agent-traps/_common/prompt-defense.md', 'agent-traps/_common/trap-sheet-loader.md'],
      forbidden: [`${CLAUDE_PLUGIN_ROOT_TOKEN}/agent-traps`, '.cursor/dhpk/'],
    },
    {
      agent: 'agents/e2e-runner.md',
      required: ['agent-traps/e2e-runner/playwright.md', 'rules/tool-routing.md'],
      files: ['agent-traps/e2e-runner/playwright.md', 'rules/tool-routing.md'],
      forbidden: [`${CLAUDE_PLUGIN_ROOT_TOKEN}/agent-traps`, '.cursor/rules/'],
    },
    {
      agent: 'agents/codex-worker.md',
      required: [
        'agent-traps/_common/cli-prompt-composition.md',
        'agent-traps/_common/build-resolver-skeleton.md',
        'scripts/cli-dispatch/adapters/run-codex.sh',
      ],
      files: [
        'agent-traps/_common/cli-prompt-composition.md',
        'agent-traps/_common/build-resolver-skeleton.md',
        ...NATIVE_AGENT_SUPPORT_FILES,
      ],
      forbidden: [`${CLAUDE_PLUGIN_ROOT_TOKEN}/skills`],
    },
    {
      agent: 'agents/codex-reasoner.md',
      required: [
        'agent-traps/_common/cli-prompt-composition.md',
        'scripts/cli-dispatch/adapters/run-codex.sh',
      ],
      files: [
        'agent-traps/_common/cli-prompt-composition.md',
        ...NATIVE_AGENT_SUPPORT_FILES,
      ],
      forbidden: [`${CLAUDE_PLUGIN_ROOT_TOKEN}/skills`],
    },
    {
      agent: 'agents/agy-worker.md',
      required: [
        'agent-traps/_common/cli-prompt-composition.md',
        'agent-traps/_common/build-resolver-skeleton.md',
        'scripts/cli-dispatch/adapters/run-agy.sh',
      ],
      files: [
        'agent-traps/_common/cli-prompt-composition.md',
        'agent-traps/_common/build-resolver-skeleton.md',
        ...NATIVE_AGENT_SUPPORT_FILES,
      ],
      forbidden: [`${CLAUDE_PLUGIN_ROOT_TOKEN}/skills`],
    },
    {
      agent: 'agents/fast-worker.md',
      required: [
        'agent-traps/_common/build-resolver-skeleton.md',
        'scripts/fast-worker-selector.js',
      ],
      files: [
        'agent-traps/_common/build-resolver-skeleton.md',
        ...NATIVE_AGENT_SUPPORT_FILES,
      ],
      forbidden: [`${CLAUDE_PLUGIN_ROOT_TOKEN}/skills`],
    },
  ];
}

function mentionsNativeSupport(text) {
  return text.includes('prompt-defense')
    || text.includes('trap-sheet-loader')
    || text.includes('execution-policy')
    || text.includes('playwright.md')
    || text.includes('tool-routing')
    || text.includes('cli-prompt-composition')
    || text.includes('build-resolver-skeleton')
    || text.includes('run-codex.sh')
    || text.includes('run-agy.sh')
    || text.includes('fast-worker-selector.js')
    || text.includes('.cursor/dhpk/')
    || text.includes(CLAUDE_PLUGIN_ROOT_TOKEN);
}

function skillOwnedFileApplies(packageRoot, relative) {
  const parts = relative.split('/');
  if (parts[0] !== 'skills' || !parts[1]) return true;
  try {
    return fs.statSync(path.join(packageRoot, 'skills', parts[1])).isDirectory();
  } catch (error) {
    if (error && error.code === 'ENOENT') return false;
    throw error;
  }
}

function closureErrors(packageRoot, cases) {
  const errors = [];
  const reportedFiles = new Set();
  for (const item of cases) {
    const agentPath = path.join(packageRoot, ...item.agent.split('/'));
    if (!fs.existsSync(agentPath)) continue;
    const text = fs.readFileSync(agentPath, 'utf8');
    // Fixture agents that never ask for these resources stay out of the closure.
    // A published agent that names one of them must resolve every representative locator.
    if (!mentionsNativeSupport(text)) continue;
    if ((item.forbidden || []).some((needle) => text.includes(needle))) {
      errors.push(`native agent support locator is not package-local: ${item.agent}`);
    }
    for (const needle of item.required || []) {
      if (!text.includes(needle)) errors.push(`native agent support locator is missing from ${item.agent}: ${needle}`);
    }
    for (const relative of item.files || []) {
      // Skill files ship with that skill. A partial package may still copy the
      // worker agent; it must not be forced to vendor an unselected skill.
      if (!skillOwnedFileApplies(packageRoot, relative)) continue;
      if (reportedFiles.has(relative)) continue;
      reportedFiles.add(relative);
      const target = path.join(packageRoot, ...relative.split('/'));
      if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
        errors.push(`native agent support file is missing: ${relative}`);
      }
    }
  }
  return errors;
}

function cursorNativeAgentClosureErrors(packageRoot) {
  return closureErrors(packageRoot, cursorCases());
}

function agyNativeAgentClosureErrors(packageRoot) {
  return closureErrors(packageRoot, agyCases());
}

module.exports = {
  CURSOR_SUPPORT_FILES,
  AGY_SUPPORT_FILES,
  NATIVE_AGENT_SUPPORT_FILES,
  rewriteAgyNativeAgentBody,
  cursorNativeAgentClosureErrors,
  agyNativeAgentClosureErrors,
};
