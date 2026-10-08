'use strict';

// Serialized into the isolated consumer; only builtins and the copied public
// runner are available. Expectations live independently in expected.json.
async function devQaDriver(input, runFlowDrive) {
  const fs = require('node:fs');
  const path = require('node:path');
  const crypto = require('node:crypto');
  const childProcess = require('node:child_process');
  const data = input.fixtureData;
  const variant = input.variant || 'native';
  const external = variant === 'cross-provider';
  const profile = input.profiles.find((item) => item.host === (external ? 'claude-code' : 'codex-cli'));
  const native = external ? { provider: 'anthropic', target_agent: 'claude-code', model_id: 'claude-opus-5-5', effort: 'high' }
    : { provider: 'openai', target_agent: 'codex-cli', model_id: 'gpt-6.1-sol', effort: 'high' };
  const worker = external ? { provider: 'openai', target_agent: 'codex-cli', model_id: 'gpt-6-luna', effort: 'high' }
    : { ...native, model_id: 'gpt-6-luna', effort: 'max' };
  const calls = { git: 0, database: 0, DEV: 0, deploy: 0, provider: 0 };
  for (const method of ['exec', 'execSync', 'execFile', 'execFileSync', 'spawn', 'spawnSync', 'fork']) {
    childProcess[method] = () => { calls.provider++; throw new Error('fixture forbids external processes'); };
  }
  const write = (file, content) => { const full = path.join(input.projectDir, file); fs.mkdirSync(path.dirname(full), { recursive: true }); fs.writeFileSync(full, content); };
  for (const [file, content] of Object.entries(data.initial_files)) write(file, content);
  const read = (file) => fs.readFileSync(path.join(input.projectDir, file), 'utf8');
  const total = () => {
    const source = read('src/Receipt.php');
    if (/return \$subtotal - \$adjustment;/.test(source)) return data.observations.B.subtotal - data.observations.B.adjustment;
    const literal = source.match(/return (\d+);/); return literal ? Number(literal[1]) : null;
  };
  const events = [];
  const executions = [];
  const capabilities = [];
  const verifications = [];
  let active = 0; let peak = 0; let parentVerifications = 0;
  const ready = { status: 'READY_FOR_DISPATCH', source_evidence: 'fixture B source and read-only observations inspected',
    root_cause: 'constant baseline ignores subtotal minus adjustment', repair: 'PHP 5.6 arithmetic subtotal minus adjustment', verification: 'literal required total 900 and independent review' };
  const node = (id, role, dependencies, assigned = [], extra = {}) => ({ id, role, dependencies, assigned_files: assigned,
    goal: `${id}: bounded sanitized DEV QA step`, acceptance: [`${id} has concrete evidence`],
    authority: assigned.length ? 'workspace-write' : 'read-only', target: role === 'worker' && (!external || assigned.length) ? worker : native,
    ...extra });
  const host = {
    async resolveTask(text) {
      write('input.txt', text); const prompt = path.join(input.projectDir, 'input.txt'); const stat = fs.statSync(prompt);
      return { goal: data.task, acceptance: ['A cause established before any A write', 'B total repaired and independently reviewed', 'manual proposal and approval-gated merge plan'],
        constraints: { authority: 'workspace-write', assigned_files: data.assigned_files, delegation: 'coordinated',
          decision_state: 'CLEAR', php_version: '5.6', database: 'read-only', forbidden_actions: data.constraints.forbidden,
          prompt_evidence: { path: prompt, dev: stat.dev, ino: stat.ino, sha256: crypto.createHash('sha256').update(text).digest('hex') },
          ...(variant === 'strict-unavailable' ? { strict_target: { ...worker, model_id: 'strict-unavailable-model' } } : {}) } };
    },
    async getCapabilities(context) {
      capabilities.push(JSON.parse(JSON.stringify(context))); events.push(context.allow_external_probe ? 'refresh' : 'initial-capabilities');
      const value = { host_profile: { ...profile, access: { ...profile.access } }, catalog: input.catalog };
      if (context.allow_external_probe) for (const target of context.authorized_targets) value.host_profile.access[target.provider] = { status: 'AVAILABLE', evidence: 'answered selected fixture target' };
      if (variant === 'stale-capability') value.capability_evidence_records = ['reasoner', 'worker', 'reviewer'].flatMap((role) => ['read-only', 'workspace-write'].map((authority) => ({
        kind: 'host-executable-capability', state: 'OBSERVED_AVAILABLE', status: 'AVAILABLE', source: 'fixture stale executor', observed_at: '2026-10-08T00:00:00Z',
        session_id: 'stale-session', binding_id: 'stale-binding', host: profile.host, provider: 'openai', target_agent: 'codex-cli',
        model_id: role === 'worker' ? worker.model_id : native.model_id, role, authority, effort: role === 'worker' ? worker.effort : native.effort,
        effort_binding: 'parameter', route: 'native', transport: 'native-runtime' })));
      return value;
    },
    async askProviderScope() { events.push('answer'); return { status: 'ANSWERED', answer_id: 'qa-openai-only', providers: ['openai'] }; },
    async coordinate() {
      const nodes = [node('A-diagnosis', 'reasoner', []), node('B-diagnosis', 'reasoner', []),
        node('A-write', 'worker', ['A-diagnosis'], ['src/Display.php'], { decision_state: 'REASONER_REQUIRED', reasoner_dependencies: ['A-diagnosis'] }),
        node('B-red', 'worker', ['B-diagnosis']),
        node('B-repair', 'worker', ['B-red'], ['src/Receipt.php', 'tests/receipt-total.txt'], { decision_state: 'REASONER_REQUIRED', reasoner_dependencies: ['B-diagnosis'] }),
        node('B-tests', 'worker', ['B-repair']),
        node('B-review', 'reviewer', ['B-tests'], [], { independent_of: ['B-repair'] }),
        node('manual-proposal', 'worker', [], ['scratch/manual-proposal.md'], { decision_state: 'CLEAR' }),
        node('merge-plan', 'worker', ['manual-proposal'])];
      if (variant === 'strict-unavailable') for (const entry of nodes) if (entry.role === 'worker') entry.target = { ...worker, model_id: 'strict-unavailable-model' };
      return { mode: 'coordinated', nodes };
    },
    async inspectScope(_task, context) { if (context.phase === 'post') active--; return { identity: 'qa-baseline', within_scope: true, wip_preserved: true }; },
    async execute(target, task, context) {
      const id = context.node.id; events.push(`execute:${id}`);
      const identity = { agent_id: variant === 'missing-review' && id === 'B-review' ? 'B-repair' : id, session_id: 'qa-session' };
      executions.push({ id, target, request: context.request, executor_identity: identity });
      if (task.constraints.authority === 'workspace-write') { active++; peak = Math.max(peak, active); await new Promise((resolve) => setTimeout(resolve, 3)); }
      if (variant === 'timeout-writer' && id === 'B-repair') return { status: 'INTERRUPTED', failure_class: 'TIMEOUT_OR_INTERRUPTION', side_effects: 'unknown', executor_identity: identity };
      if (id === 'B-repair') {
        write('src/Receipt.php', variant === 'bad-repair' ? '<?php\nfunction receiptTotal($subtotal, $adjustment) { return 1000; }\n'
          : '<?php\nfunction receiptTotal($subtotal, $adjustment) { return $subtotal - $adjustment; }\n');
        write('tests/receipt-total.txt', '900\n');
      }
      if (id === 'manual-proposal') write('scratch/manual-proposal.md', 'Draft only: confirm diagnosis A before implementation; merge requires user approval.\n');
      return { status: 'SUCCEEDED', side_effects: task.constraints.authority === 'workspace-write' ? 'observed' : 'none',
        observed_target: { provider: target.provider, target_agent: target.target_agent, model_id: target.model_id, effort: target.effort }, executor_identity: identity,
        ...(id === 'A-diagnosis' ? { conclusion: { status: 'UNKNOWN', source_evidence: 'display status missing; sufficient cause unknown' } } : {}),
        ...(id === 'B-diagnosis' ? { conclusion: ready } : {}),
        ...(id === 'B-red' ? { actual_total: total(), test_status: total() === 900 ? 'GREEN' : 'RED' } : {}),
        ...(id === 'merge-plan' ? { approval: 'PENDING_APPROVAL' } : {}) };
    },
    async verify(task, outcome, context) {
      if (context.graph) { parentVerifications++; return { status: 'BLOCKED', evidence: 'A cause remains UNKNOWN' }; }
      const id = context.node.id;
      const valid = id === 'B-red' ? outcome.actual_total === 800 && outcome.test_status === 'RED'
        : ['B-repair', 'B-tests', 'B-review'].includes(id) ? total() === 900 && read('tests/receipt-total.txt') === '900\n' && !/\?\?|fn\s*\(/.test(read('src/Receipt.php'))
        : id === 'manual-proposal' ? read('scratch/manual-proposal.md').includes('merge requires user approval')
        : id === 'merge-plan' ? outcome.approval === 'PENDING_APPROVAL' : true;
      verifications.push({ id, status: valid ? 'PASSED' : 'FAILED', actual_total: total() });
      return { status: valid ? 'PASSED' : 'FAILED', evidence: `${id}: actual fixture bytes and literal acceptance verified` };
    },
  };
  const report = await runFlowDrive([data.task, ...(external ? ['--cross-provider'] : [])], { host, workdir: input.projectDir, recovery: { retryBudget: 0, executionTimeoutMs: 100, controlTimeoutMs: 20 } });
  return { report, events, executions, capabilityRequests: capabilities, verifications, peakWriters: peak,
    activeWriters: active, parentVerifications, total: total(), calls,
    files: Object.fromEntries([...new Set([...Object.keys(data.initial_files), ...data.assigned_files])]
      .filter((file) => fs.existsSync(path.join(input.projectDir, file))).map((file) => [file, read(file)])) };
}

module.exports = { devQaDriver };
