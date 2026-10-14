'use strict';

const PROVIDERS = Object.freeze({ claude: 'anthropic', codex: 'openai', agy: 'google' });
const AGENTS = Object.freeze({ claude: 'claude-code', codex: 'codex-cli', agy: 'agy' });

function requestedRoleIntents(invocation, profile) {
  const roles = {};
  const defaults = profile.role_defaults || {};
  if (invocation.options.plan.enabled) {
    const target = defaults.planner;
    if (!target || !target.provider || !target.target_agent || !target.model_id || !target.effort) {
      throw new Error('planner UNAVAILABLE: the current Host has no declared planner target/default');
    }
    roles.planner = { target: Object.fromEntries(Object.entries(target).filter(([key]) => key !== 'route')),
      scope: invocation.options.plan.mode };
  }
  const reasoner = invocation.options.reasoner;
  if (reasoner) {
    const provider = PROVIDERS[reasoner.backend];
    const pairs = [defaults.reasoner, ...(profile.role_fallbacks && profile.role_fallbacks.reasoner || [])].filter(Boolean);
    const pair = pairs.find((target) => target.provider === provider);
    const model = reasoner.model || pair && pair.model_id;
    const effort = reasoner.effort || pair && pair.effort;
    if (!model || !effort) throw new Error('reasoner UNAVAILABLE: the current Host has no default for the selected Provider');
    roles.reasoner = { target: { ...(pair ? Object.fromEntries(Object.entries(pair).filter(([key]) => key !== 'route')) : {}),
      provider, target_agent: AGENTS[reasoner.backend], model_id: model, effort } };
  }
  return Object.freeze(Object.fromEntries(Object.entries(roles).map(([role, value]) =>
    [role, Object.freeze({ ...value, target: Object.freeze(value.target) })])));
}

function requestedRoleIssue(decision, roles) {
  if (!Object.keys(roles).length) return null;
  if (!decision || decision.mode !== 'coordinated' || !Array.isArray(decision.nodes)) {
    return 'Host coordination did not provide the requested planner/reasoner roles';
  }
  for (const [role, intent] of Object.entries(roles)) {
    const node = decision.nodes.find((candidate) => candidate.role === role
      && candidate.authority === 'read-only' && candidate.target
      && ['provider', 'target_agent', 'model_id', 'effort'].every((key) => candidate.target[key] === intent.target[key]));
    if (!node) return `Host coordination did not preserve the requested ${role} target`;
    const dependsOn = (writer, dependency, seen = new Set()) => {
      if (seen.has(writer.id)) return false;
      seen.add(writer.id);
      return (writer.dependencies || []).some((id) => id === dependency
        || decision.nodes.some((parent) => parent.id === id && dependsOn(parent, dependency, seen)));
    };
    for (const writer of decision.nodes.filter((candidate) => candidate.authority === 'workspace-write')) {
      if (!dependsOn(writer, node.id)) return `writer ${writer.id} does not depend on the requested ${role}`;
      if (role === 'reasoner' && (!(writer.reasoner_dependencies || []).includes(node.id)
        || writer.decision_state !== 'REASONER_REQUIRED')) {
        return `writer ${writer.id} omitted the requested reasoner READY_FOR_DISPATCH gate`;
      }
    }
  }
  return null;
}

module.exports = Object.freeze({ requestedRoleIntents, requestedRoleIssue });
