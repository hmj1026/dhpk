'use strict';

const path = require('node:path');

function validConclusion(result) {
  let cursor = result;
  let conclusion = null;
  for (let depth = 0; cursor && depth < 4; depth += 1) {
    if (cursor.conclusion) { conclusion = cursor.conclusion; break; }
    cursor = cursor.outcome;
  }
  return Boolean(result && (result.status === 'SUCCEEDED' || result.outcome && result.outcome.status === 'SUCCEEDED') && conclusion
    && conclusion.status === 'READY_FOR_DISPATCH'
    && ['source_evidence', 'root_cause', 'repair', 'verification'].every((key) => typeof conclusion[key] === 'string' && conclusion[key].trim() !== ''));
}

function sameIdentity(left, right) {
  return left && right && typeof left.agent_id === 'string' && typeof left.session_id === 'string'
    && left.agent_id === right.agent_id;
}

async function runTaskGraph({ graph, resolvedTask, capabilities, decision, host, invocation, workdir, sessionId, bindingId,
  currentProvider, taskIdentity, nodeTaskDigest, selectedTarget, dispatchRequest, prepareDispatch, withWriterLease, executeSchedule, verifyPromptEvidence, observedTargetIssue }) {
  const outcomes = new Map();
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const currentDigest = resolvedTask.constraints.prompt_evidence.sha256;
  const strict = resolvedTask.constraints.strict_target;
  const exact = invocation && invocation.options && invocation.options.workerTarget;
  const explicit = exact && ({ provider: ({ claude: 'anthropic', codex: 'openai', agy: 'google' })[exact.provider], target_agent: ({ claude: 'claude-code', codex: 'codex-cli', agy: 'agy' })[exact.provider], model_id: exact.model, effort: exact.effort });

  const executeNode = async (node, { lease = true } = {}) => {
    const target = selectedTarget({ target: node.target });
    if (!target) return { id: node.id, status: 'BLOCKED', reason: `node ${node.id} has no valid target` };
    if (target.provider !== currentProvider && !resolvedTask.constraints.provider) return { id: node.id, status: 'BLOCKED', reason: 'node Provider is outside the current Host Provider' };
    if (resolvedTask.constraints.provider && target.provider !== resolvedTask.constraints.provider) return { id: node.id, status: 'BLOCKED', reason: 'node Provider conflicts with the task constraint' };
    if (strict && (target.provider !== strict.provider || target.target.target_agent !== strict.target_agent || target.target.model_id !== strict.model_id || strict.effort && (node.effort || target.effort) !== strict.effort)) return { id: node.id, status: 'BLOCKED', reason: 'node target does not match strict task target' };
    if (explicit && (target.provider !== explicit.provider || target.target.target_agent !== explicit.target_agent || target.target.model_id !== explicit.model_id || explicit.effort && (node.effort || target.effort) !== explicit.effort)) return { id: node.id, status: 'BLOCKED', reason: 'node target does not match explicit worker target' };
    if (!exact && invocation.options.worker !== 'auto') { const backend = ({ 'claude-code': 'claude', 'codex-cli': 'codex', agy: 'agy' })[target.target.target_agent]; if (backend !== invocation.options.worker) return { id: node.id, status: 'BLOCKED', reason: 'node target does not match the legacy worker selector' }; }
    const nodeTask = { ...resolvedTask, goal: node.goal, acceptance: [...node.acceptance], constraints: { ...resolvedTask.constraints, authority: node.authority, assigned_files: node.assigned_files } };
    const currentTaskDigest = nodeTaskDigest(node, nodeTask, workdir);
    let prepared;
    try {
      prepared = prepareDispatch({
        ...dispatchRequest(nodeTask, path.resolve(workdir), capabilities, target, node.effort || target.effort,
          [currentProvider], capabilities.capability_evidence, { session_id: sessionId, binding_id: bindingId }, Boolean(strict || explicit), node.role),
        change: { confirmed: true, change_id: taskIdentity(resolvedTask).taskId },
      });
    } catch (error) { return { id: node.id, status: 'BLOCKED', reason: error.message }; }
    if (prepared.resolution.status !== 'RESOLVED') return { id: node.id, status: 'BLOCKED', reason: prepared.resolution.reason || 'node dispatch blocked' };
    const nodeContext = { invocation, capabilities, decision, resolution: prepared.resolution, workdir, node };
    let scopeBefore = null;
    let executionStarted = false;
    let outcome = null;
    let verification = null;
    let observedIssue = null;
    let reviewerIssue = null;
    let scopeIssue = null;
    let nodeResult = null;
    try {
      if (node.authority === 'workspace-write' && typeof host.inspectScope !== 'function') return { id: node.id, status: 'BLOCKED', reason: 'writer scope inspection is required' };
      if (node.authority === 'workspace-write' || (node.reuse && typeof host.inspectScope === 'function')) scopeBefore = await host.inspectScope(nodeTask, { phase: 'pre', node, workdir });
      if (node.reuse) {
        const reusable = typeof host.verifyReuse === 'function' && node.reuse.prompt_sha256 === currentDigest
          && node.reuse.task_digest === currentTaskDigest
          && scopeBefore && typeof scopeBefore.identity === 'string' && node.reuse.baseline_identity === scopeBefore.identity;
        if (reusable) {
          const reuse = await host.verifyReuse(node.reuse, { node, task: nodeTask, current_prompt_sha256: currentDigest, current_task_digest: currentTaskDigest, current_scope_baseline: scopeBefore.identity, workdir });
          if (reuse && reuse.status === 'PASSED' && typeof reuse.evidence === 'string' && reuse.evidence.trim() !== '') {
            if (node.role === 'reviewer' && node.independent_of) {
              const sources = node.independent_of.map((dependency) => outcomes.get(dependency)?.outcome?.executor_identity);
              if (!reuse.executor_identity || typeof reuse.executor_identity.agent_id !== 'string' || typeof reuse.executor_identity.session_id !== 'string'
                || sources.some((source) => !source || typeof source.agent_id !== 'string' || typeof source.session_id !== 'string' || sameIdentity(reuse.executor_identity, source))) return { id: node.id, status: 'BLOCKED', reason: 'reviewer independence was not observed' };
            }
            return { id: node.id, status: 'SUCCEEDED', outcome: { status: 'SUCCEEDED', conclusion: reuse.conclusion, executor_identity: reuse.executor_identity }, verification: reuse };
          }
        }
      }
      const execute = () => {
        const evidence = nodeTask.constraints.prompt_evidence;
        if (!evidence || typeof verifyPromptEvidence !== 'function' || !verifyPromptEvidence(evidence)) return { status: 'BLOCKED', reason: 'prompt evidence changed before execution' };
        executionStarted = true;
        return host.execute(prepared.resolution.target, nodeTask, nodeContext);
      };
      outcome = await (lease && node.authority === 'workspace-write' ? withWriterLease(execute) : execute());
      if (!outcome || typeof outcome !== 'object' || !['SUCCEEDED', 'FAILED', 'BLOCKED', 'TIMEOUT'].includes(outcome.status)) {
        nodeResult = { id: node.id, status: 'BLOCKED', reason: 'invalid node execution outcome' };
      } else {
        verification = await host.verify(nodeTask, outcome, nodeContext);
        observedIssue = observedTargetIssue && observedTargetIssue(outcome.observed_target, prepared.resolution.target, explicit || strict);
        if (node.role === 'reviewer' && node.independent_of) {
          const observed = outcome.executor_identity;
          const sources = node.independent_of.map((dependency) => outcomes.get(dependency)?.outcome?.executor_identity);
          if (!observed || typeof observed.agent_id !== 'string' || typeof observed.session_id !== 'string'
            || sources.some((source) => !source || typeof source.agent_id !== 'string' || typeof source.session_id !== 'string' || sameIdentity(observed, source))) {
            reviewerIssue = 'reviewer independence was not observed';
          }
        }
        const passed = verification && verification.status === 'PASSED' && outcome.status === 'SUCCEEDED'
          && typeof verification.evidence === 'string' && verification.evidence.trim() !== '';
        nodeResult = { id: node.id, status: passed ? 'SUCCEEDED' : 'FAILED', outcome, verification };
      }
    } catch (error) {
      nodeResult = { id: node.id, status: 'FAILED', reason: error.message };
    } finally {
      if (executionStarted && node.authority === 'workspace-write') {
        try {
          const scopeAfter = await host.inspectScope(nodeTask, { phase: 'post', node, workdir, baseline: scopeBefore, outcome });
          if (!scopeAfter || scopeAfter.within_scope !== true || scopeAfter.wip_preserved !== true) {
            scopeIssue = 'writer scope inspection did not prove assigned changes and WIP preservation';
          }
        } catch (_) {
          scopeIssue = 'writer scope inspection failed after execution';
        }
      }
    }
    if (scopeIssue) return { id: node.id, status: 'BLOCKED', reason: scopeIssue, ...(outcome ? { outcome } : {}), ...(verification ? { verification } : {}) };
    if (observedIssue) return { id: node.id, status: 'BLOCKED', reason: observedIssue, outcome, verification };
    if (reviewerIssue) return { id: node.id, status: 'BLOCKED', reason: reviewerIssue, outcome, verification };
    return nodeResult || { id: node.id, status: 'FAILED', reason: 'node execution did not produce a result' };
  };

  const requests = graph.nodes.map((node) => {
    const target = selectedTarget({ target: node.target });
    const nodeTask = { ...resolvedTask, goal: node.goal, acceptance: [...node.acceptance], constraints: { ...resolvedTask.constraints, authority: node.authority, assigned_files: node.assigned_files } };
    const packet = dispatchRequest(nodeTask, path.resolve(workdir), capabilities,
      target || { target: { target_agent: 'cursor', provider: currentProvider, model_id: capabilities.host_profile.native_model }, effort: null },
      node.effort || target && target.effort, [currentProvider], capabilities.capability_evidence,
      { session_id: sessionId, binding_id: bindingId }, Boolean(strict || explicit), node.role);
    return { ...packet.request, task_id: node.id, parallelism: { dependencies: [...node.dependencies], max_concurrency: graph.nodes.length } };
  });
  const scheduled = await executeSchedule(requests, {
    catalog: capabilities.catalog, fallback: false, singleWriter: true, retainOutcomes: true,
    beforeDispatch: async (request, resolution, completed) => {
      const node = nodeById.get(request.task_id);
      if (node.authority === 'workspace-write' && node.decision_state !== 'CLEAR') {
        const dependencies = Array.isArray(node.reasoner_dependencies) ? node.reasoner_dependencies : [];
        if (node.decision_state !== 'REASONER_REQUIRED' || dependencies.length === 0 || !dependencies.every((id) => {
          const result = completed.get(id);
          // scheduler retains the complete prior dispatch result for semantic gates
          return result && result.status === 'SUCCEEDED' && validConclusion(result.outcome);
        })) return false;
      }
      return resolution.status === 'RESOLVED';
    },
    dispatch: async (request) => {
      const result = await executeNode(nodeById.get(request.task_id), { lease: false });
      outcomes.set(request.task_id, result);
      return result;
    },
  });
  const results = scheduled.results.map((result) => ({ id: result.task_id, status: result.status, reason: result.reason, outcome: result.outcome }));
  const failed = results.filter((result) => result.status !== 'SUCCEEDED');
  let parentVerification = null;
  if (failed.length === 0) {
    try { parentVerification = await host.verify(resolvedTask, { status: 'SUCCEEDED', nodes: results }, { invocation, capabilities, decision, workdir, graph: true }); } catch (_) { parentVerification = null; }
  }
  const parentPassed = parentVerification && parentVerification.status === 'PASSED' && typeof parentVerification.evidence === 'string' && parentVerification.evidence.trim() !== '';
  if (!parentPassed && failed.length === 0) failed.push({ id: 'parent', reason: 'parent acceptance verification did not pass' });
  return { failed, results, parentVerification };
}

module.exports = Object.freeze({ runTaskGraph });
