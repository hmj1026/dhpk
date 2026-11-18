'use strict';

// hookbatch - run many hook invocations from one table in a single batch
// process (#1506, spec #1491 story 29).
//
// The bypass and credential suites are tables: hundreds of rows, each judged by
// a real bash hook. Spawning a Node child plus a shell wrapper per invocation,
// and building a throwaway git repo per row, dominated their run time. Here
// every invocation of a file is registered while the file loads, one driver
// process (bash + xargs) runs them all, and each row's test then reads its own
// result back. Case names, case counts and assertions stay per row, so a
// failure still names the row and the hook that failed.
//
// The hooks themselves still run unmodified under `bash <hook>` with the same
// environment contract as hookharness.runHook; only the process fan-out
// changes.
//
//   const batch = createHookBatch();
//   const call = batch.add({ hook, command, cwd, env });   // at load time
//   test('row', async () => { const res = await batch.result(call); ... });

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { ROOT, hookPath } = require('./hookharness');

const BATCH_TIMEOUT_MS = 20 * 60 * 1000;

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function defaultJobs() {
  const fromEnv = Number.parseInt(process.env.DHPK_HOOK_BATCH_JOBS || '', 10);
  if (Number.isInteger(fromEnv) && fromEnv > 0) return fromEnv;
  return Math.max(1, Math.min(os.cpus().length, 4));
}

// One case script: the runHook environment contract, then the hook fed the
// payload on stdin. Exit status, stdout and stderr land in files named by index.
function caseScript(dir, index, call) {
  const { hook, payload, cwd = ROOT, env = {}, deleteEnv = [], pluginRoot = ROOT, projectDir, profile = 'standard', timeout = 10000 } = call;
  const hookFile = path.isAbsolute(hook) ? hook : hookPath(hook);
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const file = (ext) => shellQuote(path.join(dir, `${index}.${ext}`));
  fs.writeFileSync(path.join(dir, `${index}.in`), body);
  // Same environment contract as hookharness.runHook, applied in the same order.
  const lines = ['unset CLAUDE_PROJECT_DIR'];
  for (const name of deleteEnv) lines.push(`unset ${name}`);
  if (pluginRoot === null) lines.push('unset CLAUDE_PLUGIN_ROOT');
  else lines.push(`export CLAUDE_PLUGIN_ROOT=${shellQuote(pluginRoot)}`);
  if (projectDir !== undefined && projectDir !== null) lines.push(`export CLAUDE_PROJECT_DIR=${shellQuote(projectDir)}`);
  if (profile !== null) lines.push(`export CLAUDE_PLUGIN_OPTION_HOOK_PROFILE=${shellQuote(profile)}`);
  for (const [name, value] of Object.entries(env)) lines.push(`export ${name}=${shellQuote(value)}`);
  lines.push(`cd ${shellQuote(cwd)} || exit 97`);
  const seconds = Math.max(1, Math.ceil(timeout / 1000));
  lines.push(`${'$'}{DHPK_BATCH_TIMEOUT:+$DHPK_BATCH_TIMEOUT ${seconds}} bash ${shellQuote(hookFile)} < ${file('in')} > ${file('out')} 2> ${file('err')}`);
  lines.push(`echo $? > ${file('rc')}`);
  fs.writeFileSync(path.join(dir, `${index}.sh`), `${lines.join('\n')}\n`);
}

function readResult(dir, index) {
  const read = (ext) => {
    try {
      return fs.readFileSync(path.join(dir, `${index}.${ext}`), 'utf8');
    } catch {
      return '';
    }
  };
  const rc = Number.parseInt(read('rc').trim(), 10);
  return { status: Number.isInteger(rc) ? rc : null, stdout: read('out'), stderr: read('err') };
}

function executeBatch(calls, jobs) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-hookbatch-')));
  try {
    calls.forEach((call, index) => caseScript(dir, index, call));
    const driver = [
      'dir=$1; jobs=$2',
      'if command -v timeout >/dev/null 2>&1; then export DHPK_BATCH_TIMEOUT=timeout; fi',
      'i=0; while [ "$i" -lt "$3" ]; do printf "%s\\0" "$dir/$i.sh"; i=$((i + 1)); done |',
      '  xargs -0 -n 1 -P "$jobs" bash',
    ].join('\n');
    const res = spawnSync('bash', ['-c', driver, 'hookbatch', dir, String(jobs), String(calls.length)], {
      encoding: 'utf8',
      timeout: BATCH_TIMEOUT_MS,
      env: { ...process.env },
    });
    if (res.error) throw res.error;
    return calls.map((_, index) => readResult(dir, index));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function createHookBatch({ jobs = defaultJobs() } = {}) {
  const calls = [];
  let results = null;
  return {
    add(call) {
      if (results) throw new Error('hookbatch: add() after the batch has run; register every call at load time');
      calls.push(call);
      return calls.length - 1;
    },
    get size() {
      return calls.length;
    },
    async result(handle) {
      if (!results) results = executeBatch(calls, jobs);
      return results[handle];
    },
  };
}

module.exports = { createHookBatch, defaultJobs };
