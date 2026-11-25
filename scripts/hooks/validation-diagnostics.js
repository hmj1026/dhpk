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

const CHECK_CONFIG = /^(?:package\.json|(?:jest|vitest|eslint)\.config\.[cm]?[jt]s|tsconfig(?:\.[a-z0-9_-]+)?\.json|pyproject\.toml|pytest\.ini|phpunit\.xml(?:\.dist)?|Cargo\.toml|Package\.swift)$/i;
const RECOVERY_FIELDS = ['target', 'premise', 'file', 'observation', 'proposed_change', 'rerun_plan'];

function projectMode(project, options) {
  if (options.mode) return options.mode;
  for (const name of ['.claude/settings.local.json', '.claude/settings.json']) {
    try {
      const config = JSON.parse(fs.readFileSync(path.join(project, name), 'utf8'));
      const values = config.pluginConfigs?.['dhpk@dhpk']?.options;
      if (values && Object.hasOwn(values, 'validation_failure_mode')) {
        return values.validation_failure_mode === 'block' ? 'block' : 'advisory';
      }
    } catch (_) { /* no project override in this file */ }
  }
  return process.env.CLAUDE_PLUGIN_OPTION_VALIDATION_FAILURE_MODE === 'block' ? 'block' : 'advisory';
}

function digest(contents) {
  return crypto.createHash('sha256').update(contents).digest('hex');
}

function verifyRecovery(raw, project) {
  if (typeof raw !== 'string' || raw.length > 8192 || !project) return null;
  const request = JSON.parse(raw);
  if (!request || RECOVERY_FIELDS.some((key) => !clean(request[key]))) return null;
  const { target, file, observation, rerun_plan: rerun } = request;
  if (deriveValidationTarget({ command: rerun }) !== target
      || !/^[\w./-]+$/.test(file)
      || file.split('/').some((part) => !part || part.startsWith('.'))
      || !CHECK_CONFIG.test(path.basename(file))) return null;
  const config = path.join(project, file);
  const stat = fs.lstatSync(config);
  if (!stat.isFile() || stat.size > 262144 || fs.realpathSync(config) !== config) return null;
  const contents = fs.readFileSync(config, 'utf8');
  if (!contents.includes(observation)) return null;
  return { target, evidenceDigest: digest(raw + '\0' + digest(contents)) };
}

function recoveryEvidence(input, project) {
  const command = /^node (?:'([^'\r\n]+)'|([\w./-]+)) recover '([^'\r\n]+)'$/.exec(commandOf(input));
  if (!command) return null;
  const script = path.resolve(input.cwd || project, command[1] || command[2]);
  if (fs.realpathSync(script) !== __filename) return null;
  const response = input.tool_response;
  const output = typeof response === 'string' ? response : response?.stdout;
  const expected = verifyRecovery(command[3], project);
  return expected && typeof output === 'string' && output.trim() === JSON.stringify(expected) ? expected : null;
}

function blockMessage(latch) {
  const reason = latch.stopped
    ? 'The same validation has repeatedly failed. Escalate before editing.'
    : 'Run the scoped configuration recovery check and record the next change before editing.';
  return { hookSpecificOutput: {
    hookEventName: 'PreToolUse', permissionDecision: 'deny',
    permissionDecisionReason: '[validation-diagnostics] ' + reason,
  } };
}

function processEvent(input, options = {}) {
  const event = clean(input.hook_event_name);
  if (event === 'SubagentStop') {
    if (!clean(input.agent_id) || !sessionOf(input)) return { message: null, record: { ignored: true } };
    cleanupSubagent(input, options);
    return { message: null, record: { cleaned: true } };
  }
  const edit = event === 'PreToolUse' && /^(?:Edit|Write|MultiEdit)$/.test(clean(input.tool_name));
  const bash = input.tool_name === 'Bash' && (event === 'PostToolUse' || event === 'PostToolUseFailure');
  if ((!edit && !bash) || input.is_interrupt === true) return { message: null, record: { ignored: true } };

  const id = identity(input, bash ? deriveValidationTarget(input) : null);
  if (!id.session || !id.project) return { message: null, record: { ignored: true } };
  const file = statePath(id, options);
  const prior = readState(file);
  const latch = prior?.latch;
  const block = projectMode(id.project, options) === 'block';
  if (edit) {
    if (latch && block) return { message: blockMessage(latch), record: prior };
    return { message: null, record: { ...id, allowed: true } };
  }

  const outcome = validationOutcome(input, event);
  if (!outcome) return { message: null, record: { ignored: true } };
  if (!id.target) {
    const evidence = outcome === 'pass' && latch && !latch.stopped ? recoveryEvidence(input, id.project) : null;
    if (evidence?.target !== latch?.target || !evidence) return { message: null, record: { ignored: true } };
    const record = { ...id, failures: 0, recoveryEvidence: evidence };
    writeState(file, record);
    return { message: null, record };
  }
  if (outcome === 'pass') {
    const record = { ...id, failures: 0, latch };
    if (latch) writeState(file, record);
    else removeState(file);
    return { message: null, record };
  }

  const sameTarget = prior?.target === id.target;
  const failures = sameTarget ? prior.failures + 1 : 1;
  const signature = digest(String(input.error ?? input.tool_response?.exit_code ?? ''));
  const repeats = sameTarget && prior.signature === signature ? prior.repeats + 1 : 1;
  let activeLatch = latch || (block && failures >= 2 ? { target: id.target, stopped: false } : undefined);
  if (activeLatch?.target === id.target && repeats >= 3) activeLatch = { ...activeLatch, stopped: true };
  const record = { ...id, failures, signature, repeats, latch: activeLatch };
  writeState(file, record);
  const direction = block
    ? 'Edits pause until correlated recovery. For a configuration check, call node \'' + __filename
      + '\' recover with a single-quoted JSON argument containing target, premise, file, observation, proposed_change, and rerun_plan.'
    : 'This is advisory. Escalate if no direction is available.';
  const message = failures === 2 ? {
    systemMessage: '[validation-diagnostics] ' + id.target + ' failed twice. Check the premise with a targeted read-only operation and record the observation, proposed change, and rerun plan. ' + direction,
  } : null;
  return { message, record };
}

function main() {
  if (process.argv[2] === 'recover') {
    try {
      const result = verifyRecovery(process.argv[3], projectOf({ cwd: process.cwd() }));
      if (!result) throw new Error('invalid evidence');
      process.stdout.write(JSON.stringify(result) + '\n');
    } catch (_) {
      process.stderr.write('[validation-diagnostics] Recovery requires an observed value in a project validation config and a matching rerun command.\n');
      process.exitCode = 1;
    }
    return;
  }
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => { input += chunk; });
  process.stdin.on('end', () => {
    try {
      const result = processEvent(JSON.parse(input || '{}'));
      if (result.message) process.stdout.write(JSON.stringify(result.message) + '\n');
    } catch (_) {
      // Keep the host adapter quiet on invalid payloads. A failed recovery
      // leaves the previous latch untouched.
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
