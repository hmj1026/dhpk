'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { withIsolatedSkill } = require('./skill-directory-isolation');
const catalog = require('../../manifests/provider-model-catalog.json');
const profiles = require('../../manifests/host-profiles.json');

// Trusted fixture guards exercise dependency closure; they are not an OS
// sandbox. The child receives plain fixture data and imports only builtins and
// the relocated public runner. No canonical implementation is loaded there.
async function relocationDriver() {
  const fs = require('node:fs');
  const path = require('node:path');
  const crypto = require('node:crypto');
  const Module = require('node:module');
  const input = JSON.parse(fs.readFileSync(0, 'utf8'));
  const builtin = new Set(Module.builtinModules.flatMap((name) => [name, `node:${name}`]));
  const inside = (file, root) => file === root || file.startsWith(`${root}${path.sep}`);
  const canonical = input.canonicalRoot;
  const originalResolve = Module._resolveFilename;
  Module._resolveFilename = function guardedResolve(request, parent, ...rest) {
    if (!builtin.has(request) && path.isAbsolute(request) && !inside(path.resolve(request), input.skillDir)) {
      const error = new Error('fixture denies modules outside the relocated skill');
      error.code = 'MODULE_NOT_FOUND'; throw error;
    }
    const resolved = originalResolve.call(this, request, parent, ...rest);
    if (!builtin.has(request) && !inside(resolved, input.skillDir)) {
      const error = new Error('fixture denies module search fallback');
      error.code = 'MODULE_NOT_FOUND'; throw error;
    }
    return resolved;
  };
  const wrapFilesystem = (object, method) => {
    const original = object[method];
    if (typeof original !== 'function') return;
    object[method] = function guardedFilesystem(file, ...args) {
      if (typeof file !== 'number') {
        const resolved = path.resolve(String(file));
        if (!inside(resolved, input.fixtureRoot)) {
          const error = new Error('fixture denies canonical and sibling file visibility');
          error.code = 'EACCES'; throw error;
        }
      }
      return original.call(this, file, ...args);
    };
    if (original.native) object[method].native = object[method];
  };
  for (const method of ['readFileSync', 'writeFileSync', 'statSync', 'lstatSync', 'realpathSync', 'readdirSync',
    'existsSync', 'accessSync', 'mkdirSync', 'openSync', 'readlinkSync', 'unlinkSync', 'rmSync',
    'readFile', 'writeFile', 'stat', 'lstat', 'realpath', 'readdir', 'access', 'mkdir', 'open', 'readlink', 'unlink', 'rm']) {
    wrapFilesystem(fs, method);
    wrapFilesystem(fs.promises, method);
  }
  const guard = { module_denied: false, file_denied: false, sibling_denied: false,
    async_file_denied: false,
    module_search_clean: process.env.NODE_PATH === undefined && process.env.NODE_OPTIONS === undefined };
  try { require(path.join(canonical, 'skills/flow-drive/scripts/run.js')); } catch (error) { guard.module_denied = error.code === 'MODULE_NOT_FOUND'; }
  try { fs.statSync(path.join(canonical, 'skills/flow-drive/SKILL.md')); } catch (error) { guard.file_denied = error.code === 'EACCES'; }
  try { fs.statSync(path.join(canonical, 'skills/flow-guide/SKILL.md')); } catch (error) { guard.sibling_denied = error.code === 'EACCES'; }
  try { await fs.promises.stat(path.join(canonical, 'skills/flow-drive/SKILL.md')); } catch (error) { guard.async_file_denied = error.code === 'EACCES'; }
  const metadata = () => ({ guard,
    loaded_modules: Object.keys(require.cache).filter((file) => !builtin.has(file)),
    evidence_kind: 'fixture', provider_runtime: 'NOT_RUN' });
  let runFlowDrive;
  try { ({ runFlowDrive } = require(path.join(input.skillDir, 'scripts/run.js'))); }
  catch (error) { process.stdout.write(JSON.stringify({ ...metadata(), setup_error: { code: error.code, message: error.message } })); return; }

  const scenario = input.scenario;
  const external = scenario === 'cross-provider';
  const profile = input.profiles.find((profile) => profile.host === (external ? 'claude-code' : 'codex-cli'));
  const native = external
    ? { target_agent: 'claude-code', provider: 'anthropic', model_id: 'claude-opus-5-5', effort: 'medium' }
    : { target_agent: 'codex-cli', provider: 'openai', model_id: 'gpt-6-luna', effort: 'max' };
  const selected = scenario === 'stale-catalog' ? { ...native, model_id: 'relocated-current-model' }
    : external ? { target_agent: 'codex-cli', provider: 'openai', model_id: 'gpt-6-luna', effort: 'high' } : native;
  const graph = ['coordinated', 'reuse', 'review-independence'].includes(scenario);
  const assigned = graph ? ['src/receipt.js', 'scratch/notes.md'] : ['src/receipt.js'];
  const events = [];
  const capabilityRequests = [];
  const executions = [];
  let activeWriters = 0;
  let maxWriters = 0;
  let reuseCalls = 0;
  let parentVerifications = 0;
  let taskValue;
  const conclusion = { status: 'READY_FOR_DISPATCH', source_evidence: 'receipt source inspected',
    root_cause: 'line total omitted', repair: 'write the literal line sum', verification: 'compare total with 12' };
  const host = {
    async resolveTask(text) {
      const prompt = path.join(input.projectDir, 'input.txt');
      fs.writeFileSync(prompt, text);
      const stat = fs.statSync(prompt);
      taskValue = { goal: 'Repair the receipt and verify its line sum.', acceptance: ['The receipt total equals 12.'],
        constraints: { authority: 'workspace-write', assigned_files: assigned, delegation: graph ? 'coordinated' : 'none',
          ...(graph ? { decision_state: 'REASONER_REQUIRED' } : {}),
          prompt_evidence: { path: prompt, dev: stat.dev, ino: stat.ino, sha256: crypto.createHash('sha256').update(text).digest('hex') } } };
      return taskValue;
    },
    async getCapabilities(context) {
      capabilityRequests.push(JSON.parse(JSON.stringify(context)));
      const capabilities = { host_profile: { ...profile, access: { ...profile.access } }, catalog: input.catalog };
      if (context.allow_external_probe) for (const target of context.authorized_targets) {
        capabilities.host_profile.access[target.provider] = { status: 'AVAILABLE', evidence: 'stub selected target is executable' };
      }
      if (scenario === 'stale-catalog') capabilities.capability_evidence = {
        kind: 'host-executable-capability', state: 'OBSERVED_AVAILABLE', status: 'AVAILABLE', source: 'relocated stub executor',
        observed_at: '2026-10-08T00:00:00.000Z', session_id: context.session_id, binding_id: context.binding_id,
        host: 'codex-cli', target_agent: 'codex-cli', provider: 'openai', model_id: selected.model_id,
        role: 'worker', authority: 'workspace-write', effort: selected.effort, effort_binding: 'parameter', route: 'native', transport: 'native-runtime',
      };
      return capabilities;
    },
    async askProviderScope() { events.push('provider-answer'); return { status: 'ANSWERED', answer_id: 'relocated-consent', providers: ['openai', 'google'] }; },
    async coordinate(task) {
      if (!graph) return { mode: 'solo', target: selected };
      const reasoner = { id: 'reasoner', role: 'reasoner', goal: 'Diagnose the sum.', acceptance: ['a bounded diagnosis'],
        authority: 'read-only', assigned_files: [], dependencies: [], target: { ...native, model_id: 'gpt-6.1-sol', effort: 'high' } };
      if (scenario === 'reuse') {
        const stable = (value) => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object'
          ? Object.keys(value).sort().reduce((record, key) => ({ ...record, [key]: stable(value[key]) }), {}) : value;
        const reasonerTask = { ...task, goal: reasoner.goal, acceptance: reasoner.acceptance,
          constraints: { ...task.constraints, authority: reasoner.authority, assigned_files: [] } };
        const normalized = { id: reasoner.id, role: reasoner.role, goal: reasonerTask.goal, acceptance: reasonerTask.acceptance,
          workdir: input.projectDir, constraints: { ...reasonerTask.constraints, prompt_evidence: { sha256: task.constraints.prompt_evidence.sha256 }, assigned_files: [] } };
        reasoner.reuse = { prompt_sha256: task.constraints.prompt_evidence.sha256, baseline_identity: 'relocated-baseline',
          task_digest: crypto.createHash('sha256').update(JSON.stringify(stable(normalized))).digest('hex') };
      }
      const writers = assigned.map((file, index) => ({ id: `writer-${index}`, role: 'worker', goal: 'Apply the diagnosed repair.',
        acceptance: ['literal file value verified'], authority: 'workspace-write', assigned_files: [file],
        dependencies: ['reasoner'], reasoner_dependencies: ['reasoner'], decision_state: 'REASONER_REQUIRED', target: native }));
      const nodes = [reasoner, ...writers];
      if (scenario === 'review-independence') nodes.push({ id: 'reviewer', role: 'reviewer', goal: 'Review the repair independently.',
        acceptance: ['independent review verified'], authority: 'read-only', assigned_files: [],
        dependencies: ['writer-0', 'writer-1'], independent_of: ['writer-0', 'writer-1'], target: { ...native, model_id: 'gpt-6.1-sol', effort: 'high' } });
      return { mode: 'coordinated', nodes };
    },
    async inspectScope(_task, context) {
      events.push(`scope-${context.phase}:${context.node ? context.node.id : 'solo'}`);
      if (context.phase === 'post') activeWriters -= 1;
      return { identity: 'relocated-baseline', within_scope: true, wip_preserved: true };
    },
    async verifyReuse() { reuseCalls += 1; return { status: 'PASSED', evidence: 'prior diagnosis remains sufficient', conclusion,
      executor_identity: { agent_id: 'reused-reasoner', session_id: 'relocated-session' } }; },
    async execute(target, task, context) {
      const request = context.request;
      executions.push({ provider: target.provider, target_agent: target.target_agent, model_id: target.model_id,
        effort: target.effort, node: context.node && context.node.id, request });
      events.push(`execute:${context.node ? context.node.id : 'solo'}`);
      const identity = { agent_id: context.node && context.node.role === 'reviewer' ? 'writer-0' : context.node ? context.node.id : 'solo', session_id: 'relocated-session' };
      if (task.constraints.authority === 'workspace-write') {
        activeWriters += 1; maxWriters = Math.max(maxWriters, activeWriters);
        await new Promise((resolve) => setTimeout(resolve, 5));
        for (const file of task.constraints.assigned_files) {
          fs.mkdirSync(path.dirname(path.join(input.projectDir, file)), { recursive: true });
          fs.writeFileSync(path.join(input.projectDir, file), file.endsWith('.js') ? 'total=12' : 'diagnosis applied');
        }
      }
      return { status: 'SUCCEEDED', observed_target: { provider: target.provider, target_agent: target.target_agent,
        model_id: target.model_id, effort: target.effort }, executor_identity: identity,
        ...(context.node && context.node.role === 'reasoner' ? { conclusion } : {}) };
    },
    async verify(task, outcome, context) {
      if (context.graph) parentVerifications += 1;
      const files = task.constraints.authority === 'workspace-write' ? task.constraints.assigned_files : [];
      const valid = files.every((file) => fs.existsSync(path.join(input.projectDir, file))
        && fs.readFileSync(path.join(input.projectDir, file), 'utf8') === (file.endsWith('.js') ? 'total=12' : 'diagnosis applied'));
      return { status: outcome.status === 'SUCCEEDED' && valid ? 'PASSED' : 'FAILED', evidence: 'literal receipt sum and assigned notes verified' };
    },
  };
  const report = await runFlowDrive(['Repair the literal line sum.', ...(external ? ['--cross-provider'] : [])],
    { host, workdir: input.projectDir, recovery: { retryBudget: 0 } });
  const effects = Object.fromEntries(assigned.filter((file) => fs.existsSync(path.join(input.projectDir, file)))
    .map((file) => [file, fs.readFileSync(path.join(input.projectDir, file), 'utf8')]));
  process.stdout.write(JSON.stringify({ ...metadata(), report, effects, executions, capabilityRequests, events,
    maxWriters, activeWriters, reuseCalls, parentVerifications }));
}

function runRelocatedFlowDrive(scenario, { missingResource } = {}) {
  const canonicalRoot = path.resolve(__dirname, '..', '..');
  return withIsolatedSkill({ source: path.join(canonicalRoot, 'skills/flow-drive'),
    env: { NODE_PATH: canonicalRoot, NODE_OPTIONS: '--require=/canonical-fallback-must-not-load.js' } }, (context) => {
    if (missingResource) fs.unlinkSync(path.join(context.skillDir, missingResource));
    const result = spawnSync(process.execPath, ['-e', `(${relocationDriver.toString()})().catch(error => { console.error(error.message); process.exitCode = 1; });`], {
      cwd: context.projectDir, env: context.env, encoding: 'utf8', timeout: 10000, maxBuffer: 4 * 1024 * 1024,
      input: JSON.stringify({ scenario, canonicalRoot, skillDir: context.skillDir, projectDir: context.projectDir,
        fixtureRoot: path.dirname(context.skillDir), catalog, profiles: profiles.profiles }),
    });
    return { ...result, skillDir: context.skillDir, projectDir: context.projectDir,
      value: result.status === 0 ? JSON.parse(result.stdout) : null };
  });
}

module.exports = Object.freeze({ runRelocatedFlowDrive });
