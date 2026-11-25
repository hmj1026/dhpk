#!/usr/bin/env node
'use strict';

// Validation failure state is deliberately kept outside the project. The hook
// only owns one identity file (session + project + subagent), so cleanup cannot
// erase another running subagent's diagnostic history.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const SCRIPT_MANAGERS = new Set(['npm', 'pnpm', 'yarn', 'bun']);
const DIRECT_TOOLS = new Set([
  'eslint', 'tsc', 'prettier', 'vitest', 'jest', 'pytest', 'phpunit',
  'mypy', 'ruff', 'flake8', 'cargo', 'go', 'swift',
]);

function clean(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function projectOf(input) {
  const declared = clean(input.project_dir || input.projectDir || process.env.CLAUDE_PROJECT_DIR);
  const candidate = declared || clean(input.cwd) || process.cwd();
  try {
    const root = require('node:child_process').spawnSync('git', ['-C', candidate, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' });
    if (root.status === 0 && root.stdout.trim()) return fs.realpathSync(root.stdout.trim());
  } catch (_) { /* fall through to a declared, real path */ }
  try { return fs.realpathSync(candidate); } catch (_) { return null; }
}

function subagentOf(input) {
  // Claude's agent_id is the stable lifecycle identity. Do not collapse
  // missing IDs into a guessed agent name: main-session state must not be
  // cleaned by an unrelated SubagentStop event.
  return clean(input.agent_id || input.agentId || input.subagent_id || input.subagentId)
    || 'main';
}

function sessionOf(input) {
  return clean(input.session_id || input.sessionId) || null;
}

function commandOf(input) {
  const toolInput = input.tool_input || input.toolInput || {};
  return clean(toolInput.command || input.command);
}

function deriveValidationTarget(input) {
  const command = commandOf(input);
  if (!command || /[;&|<>$`()\n\r]/.test(command) || /["']/.test(command)) return null;
  const argv = command.trim().split(/\s+/);
  const executable = path.basename(argv[0]);
  if (SCRIPT_MANAGERS.has(executable)) {
    let script = argv[1];
    if (script === 'run') script = argv[2];
    if (!script || !/^(?:test|lint|typecheck|check)(?::[a-z0-9][a-z0-9._-]*)?$/i.test(script)) return null;
    return `${executable}:${script.toLowerCase()}`;
  }
  if (executable === 'npx' || executable === 'pnpx') {
    if (!DIRECT_TOOLS.has(argv[1])) return null;
    return `direct:${argv[1].toLowerCase()}`;
  }
  if (!DIRECT_TOOLS.has(executable)) return null;
  if (executable === 'cargo' && !['test', 'check', 'clippy'].includes(argv[1])) return null;
  if (executable === 'go' && argv[1] !== 'test') return null;
  if (executable === 'swift' && argv[1] !== 'test') return null;
  return `direct:${executable}`;
}

function identity(input, target) {
  return { session: sessionOf(input), project: projectOf(input), subagent: subagentOf(input), target };
}

function stateDirectory(options = {}) {
  return options.stateDir
    || process.env.DHPK_VALIDATION_STATE_DIR
    || path.join(os.homedir(), '.claude', 'dhpk', 'validation-diagnostics');
}

function statePath(id, options) {
  const scope = { session: id.session, project: id.project, subagent: id.subagent };
  const digest = crypto.createHash('sha256').update(JSON.stringify(scope)).digest('hex');
  return path.join(stateDirectory(options), `${digest}.json`);
}

function readState(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return null; }
}

function writeState(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, file);
}

function removeState(file) {
  try { fs.unlinkSync(file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
}

function cleanupSubagent(input, options) {
  const directory = stateDirectory(options);
  let names;
  try { names = fs.readdirSync(directory); } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  const session = sessionOf(input);
  const project = projectOf(input);
  const subagent = subagentOf(input);
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const file = path.join(directory, name);
    const record = readState(file);
    if (record && record.session === session && record.project === project && record.subagent === subagent) {
      removeState(file);
    }
  }
}

function validationOutcome(input, event) {
  const response = input.tool_response || input.toolResponse || {};
  if (event === 'PostToolUseFailure') {
    return /^Exit code [1-9]\d*(?=\r?\n|$)/.test(clean(input.error)) ? 'fail' : null;
  }
  if (response.exit_code !== undefined || response.exitCode !== undefined) {
    const code = response.exit_code ?? response.exitCode;
    return Number.isInteger(code) ? (code === 0 ? 'pass' : 'fail') : null;
  }
  return 'pass';
}

function processEvent(input, options = {}) {
  const event = clean(input.hook_event_name || input.hookEventName);
  if (event === 'SubagentStop') {
    if (!clean(input.agent_id) || !sessionOf(input)) return { message: null, record: { ignored: true } };
    cleanupSubagent(input, options);
    return { message: null, record: { cleaned: true } };
  }

  const target = deriveValidationTarget(input);
  const id = identity(input, target);
  if (!target || !id.session || !id.project || input.tool_name !== 'Bash'
      || input.is_interrupt === true || input.isInterrupt === true
      || (event !== 'PostToolUse' && event !== 'PostToolUseFailure')) {
    return { message: null, record: { ignored: true } };
  }

  const outcome = validationOutcome(input, event);
  if (outcome === null) return { message: null, record: { ignored: true } };
  const file = statePath(id, options);
  if (outcome === 'pass') {
    removeState(file);
    return { message: null, record: { ...id, failures: 0 } };
  }

  const previous = readState(file);
  const failures = previous && previous.target === target ? Number(previous.failures || 0) + 1 : 1;
  const record = { ...id, failures, notified: failures >= 2 };
  writeState(file, record);
  const message = failures === 2 ? {
    systemMessage: `[validation-diagnostics] ${target} failed twice in this session/project/subagent. Before editing, list the assumptions and run read-only checks that can distinguish them. This is advisory; resume after evidence or escalate if no direction is available.`,
  } : null;
  return { message, record };
}

function main() {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => { input += chunk; });
  process.stdin.on('end', () => {
    try {
      const result = processEvent(JSON.parse(input || '{}'));
      if (result.message) process.stdout.write(`${JSON.stringify(result.message)}\n`);
    } catch (_) {
      // Hooks are advisory and must not turn malformed host payloads into a
      // blocking failure. No payload content is echoed.
      process.exitCode = 0;
    }
  });
}

module.exports = {
  deriveValidationTarget,
  processEvent,
  identity,
};

if (require.main === module) main();
