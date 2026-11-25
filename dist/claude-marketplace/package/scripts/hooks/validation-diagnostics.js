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
const MAIN_SESSION = 'main';
const STATE_LOCK_TIMEOUT_MS = 10000;
const STATE_LOCK_POLL_MS = 10;
const OWNERLESS_LOCK_GRACE_MS = 2000;
const SLEEP_BUFFER = new Int32Array(new SharedArrayBuffer(4));

function sleepMs(milliseconds) {
  Atomics.wait(SLEEP_BUFFER, 0, 0, milliseconds);
}

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
    || MAIN_SESSION;
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
  const [tool, subcommand] = executable === 'npx' || executable === 'pnpx' ? argv.slice(1) : [executable, ...argv.slice(1)];
  if (!DIRECT_TOOLS.has(tool)) return null;
  if (tool === 'cargo') {
    return ['test', 'check', 'clippy'].includes(subcommand) ? `direct:cargo:${subcommand}` : null;
  }
  if ((tool === 'go' || tool === 'swift') && subcommand !== 'test') return null;
  return `direct:${tool}`;
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

function lockOwner(file) {
  try {
    const owner = JSON.parse(fs.readFileSync(path.join(file, 'owner.json'), 'utf8'));
    return owner && Number.isSafeInteger(owner.pid) && owner.pid > 0 ? owner : null;
  } catch (_) {
    return null;
  }
}

function retireLock(lock, expected) {
  const owner = lockOwner(lock);
  if (expected && (!owner || owner.pid !== expected.pid || owner.token !== expected.token)) return false;
  const aside = `${lock}.retired-${process.pid}-${Date.now()}`;
  try {
    fs.renameSync(lock, aside);
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
  fs.rmSync(aside, { recursive: true, force: true });
  return true;
}

function processIsAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; }
}

// A hook killed while holding the lock never releases it. Reclaim only a lock
// whose recorded owner is gone, or one that never recorded an owner.
function reclaimOrphanedLock(lock) {
  const owner = lockOwner(lock);
  if (owner) {
    if (!processIsAlive(owner.pid)) retireLock(lock, owner);
    return;
  }
  let stat;
  try { stat = fs.lstatSync(lock); } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  if (Date.now() - stat.mtimeMs > OWNERLESS_LOCK_GRACE_MS) retireLock(lock, null);
}

function withStateLock(file, fn, options = {}) {
  const lock = `${file}.lock`;
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const deadline = Date.now() + (options.lockTimeoutMs ?? STATE_LOCK_TIMEOUT_MS);
  let owner;
  while (!owner) {
    try {
      fs.mkdirSync(lock, { recursive: false, mode: 0o700 });
      owner = { pid: process.pid, token: crypto.randomBytes(12).toString('hex'), createdAt: Date.now() };
      fs.writeFileSync(path.join(lock, 'owner.tmp'), `${JSON.stringify(owner)}\n`, { mode: 0o600 });
      fs.renameSync(path.join(lock, 'owner.tmp'), path.join(lock, 'owner.json'));
    } catch (error) {
      if (owner) {
        try { fs.rmSync(lock, { recursive: true, force: true }); } catch (_) { /* best effort */ }
        throw error;
      }
      if (error.code !== 'EEXIST') throw error;
      reclaimOrphanedLock(lock);
      if (Date.now() >= deadline) throw new Error(`timed out waiting for validation state lock: ${lock}`);
      sleepMs(STATE_LOCK_POLL_MS);
    }
  }
  try {
    return fn();
  } finally {
    retireLock(lock, owner);
  }
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
      withStateLock(file, () => {
        const current = readState(file);
        if (current && current.session === session && current.project === project && current.subagent === subagent) {
          removeState(file);
        }
      }, options);
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
const CHECK_CONFIG_MAX_BYTES = 262144;
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

// Project files are untrusted: bind the size, type, and path checks to the
// descriptor that is read, so a swap after validation cannot supply evidence.
function readCheckConfig(config) {
  const { O_RDONLY, O_NOFOLLOW, O_NONBLOCK } = fs.constants;
  if (!Number.isInteger(O_NOFOLLOW) || !Number.isInteger(O_NONBLOCK)) return null;
  const descriptor = fs.openSync(config, O_RDONLY | O_NOFOLLOW | O_NONBLOCK);
  try {
    const opened = fs.fstatSync(descriptor);
    if (!opened.isFile() || opened.size > CHECK_CONFIG_MAX_BYTES) return null;
    if (fs.realpathSync(config) !== config) return null;
    const current = fs.lstatSync(config);
    if (current.dev !== opened.dev || current.ino !== opened.ino) return null;
    const buffer = Buffer.alloc(CHECK_CONFIG_MAX_BYTES + 1);
    let length = 0;
    for (let count = -1; count !== 0 && length < buffer.length; length += count) {
      count = fs.readSync(descriptor, buffer, length, buffer.length - length, null);
    }
    return length > CHECK_CONFIG_MAX_BYTES ? null : buffer.toString('utf8', 0, length);
  } finally {
    fs.closeSync(descriptor);
  }
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
  const contents = readCheckConfig(path.join(project, file));
  if (contents === null || !contents.includes(observation)) return null;
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
    permissionDecisionReason: '[validation-diagnostics] ' + reason + ' Do not edit through Bash while paused.',
  } };
}

function processEvent(input, options = {}) {
  const event = clean(input.hook_event_name);
  if (event === 'SubagentStop') {
    if (subagentOf(input) === MAIN_SESSION || !sessionOf(input)) return { message: null, record: { ignored: true } };
    cleanupSubagent(input, options);
    return { message: null, record: { cleaned: true } };
  }
  const edit = event === 'PreToolUse' && /^(?:Edit|Write|MultiEdit)$/.test(clean(input.tool_name));
  const bash = input.tool_name === 'Bash' && (event === 'PostToolUse' || event === 'PostToolUseFailure');
  if ((!edit && !bash) || input.is_interrupt === true) return { message: null, record: { ignored: true } };

  const id = identity(input, bash ? deriveValidationTarget(input) : null);
  if (!id.session || !id.project) return { message: null, record: { ignored: true } };
  const file = statePath(id, options);
  const block = projectMode(id.project, options) === 'block';
  if (edit) {
    const prior = readState(file);
    const latch = prior?.latch;
    if (latch && block) return { message: blockMessage(latch), record: prior };
    return { message: null, record: { ...id, allowed: true } };
  }

  const outcome = validationOutcome(input, event);
  if (!outcome) return { message: null, record: { ignored: true } };
  if (!id.target && outcome === 'pass' && !readState(file)?.latch) {
    return { message: null, record: { ignored: true } };
  }
  return withStateLock(file, () => {
    const prior = readState(file);
    const latch = prior?.latch;
    if (!id.target) {
      const evidence = outcome === 'pass' && latch && !latch.stopped ? recoveryEvidence(input, id.project) : null;
      if (evidence?.target !== latch?.target || !evidence) return { message: null, record: { ignored: true } };
      const record = { ...id, failures: 0, recoveryEvidence: evidence };
      writeState(file, record);
      return { message: null, record };
    }
    if (outcome === 'pass') {
      const remaining = latch?.target === id.target ? undefined : latch;
      const record = { ...id, failures: 0, latch: remaining };
      if (remaining) writeState(file, record);
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
    const diagnostic = '[validation-diagnostics] ' + id.target
      + ' failed twice. Check the premise with a targeted read-only operation and record the observation, proposed change, and rerun plan. ' + direction;
    const message = failures === 2 ? {
      systemMessage: diagnostic,
      hookSpecificOutput: { hookEventName: event, additionalContext: diagnostic },
    } : null;
    return { message, record };
  }, options);
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
  verifyRecovery,
  identity,
};

if (require.main === module) main();
