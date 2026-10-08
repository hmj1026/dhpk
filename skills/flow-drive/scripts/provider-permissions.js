'use strict';

const PROVIDERS = Object.freeze(['anthropic', 'openai', 'google', 'xai', 'cursor']);
const PROVIDER_LABELS = Object.freeze({
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google',
  xai: 'xAI',
  cursor: 'Cursor',
});
const AGENT_FOR_PROVIDER = Object.freeze({
  anthropic: 'claude-code', openai: 'codex-cli', google: 'agy', cursor: 'cursor',
});
const PROVIDER_FOR_CLI = Object.freeze({
  claude: 'anthropic', codex: 'openai', agy: 'google',
});
const AGENT_FOR_CLI = Object.freeze({
  claude: 'claude-code', codex: 'codex-cli', agy: 'agy',
});
const MAX_QUESTION_ROUNDS = 8;

const isRecord = (value) => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const unique = (values) => [...new Set(values)];
const canonicalProvider = (value) => typeof value === 'string' && PROVIDERS.includes(value) ? value : null;

function exactWorkerTarget(invocation) {
  const option = invocation && invocation.options && invocation.options.workerTarget;
  if (!option || !PROVIDER_FOR_CLI[option.provider] || !option.model) return null;
  return Object.freeze({
    provider: PROVIDER_FOR_CLI[option.provider],
    target_agent: AGENT_FOR_CLI[option.provider],
    model_id: option.model,
    ...(option.effort ? { effort: option.effort } : {}),
    role: 'worker',
  });
}

function providerOptions(capabilities, currentProvider) {
  const profile = capabilities && capabilities.host_profile || {};
  const allowed = new Set(Array.isArray(profile.allowed_providers)
    ? profile.allowed_providers.map(canonicalProvider).filter(Boolean)
    : []);
  const routes = Array.isArray(capabilities && capabilities.catalog && capabilities.catalog.routes)
    ? capabilities.catalog.routes
    : [];
  const access = profile.access && typeof profile.access === 'object' ? profile.access : {};
  return PROVIDERS.filter((provider) => provider !== currentProvider && allowed.has(provider)
    && !['BLOCKED', 'DENIED'].includes(String(access[provider] && access[provider].status || '').toUpperCase())).map((provider) => {
    const matchingRoutes = routes.filter((route) => route && route.provider === provider);
    const targetAgents = unique(matchingRoutes.map((route) => route.target_agent)
      .filter((agent) => typeof agent === 'string'));
    return Object.freeze({
      provider,
      display_name: PROVIDER_LABELS[provider],
      target_agents: Object.freeze(targetAgents.length ? targetAgents : [AGENT_FOR_PROVIDER[provider]]),
      routes: Object.freeze(unique(matchingRoutes.map((route) => route.route).filter((route) => typeof route === 'string'))),
    });
  });
}

function addProviderGrant(grants, provider, source, answerIdValue) {
  const normalized = canonicalProvider(provider);
  if (!normalized) return;
  const answerId = source === 'user-answer' ? sanitizeAnswerId(answerIdValue) : null;
  if (source === 'user-answer' && !answerId) return;
  if (grants.some((grant) => grant.scope === 'provider' && grant.provider === normalized
      && grant.source === source && grant.answer_id === answerId)) return;
  grants.push(Object.freeze({
    scope: 'provider', provider: normalized, source,
    ...(answerId ? { answer_id: answerId } : {}),
  }));
}

function addExactTargetGrant(grants, target) {
  if (!target || !canonicalProvider(target.provider)
      || typeof target.target_agent !== 'string' || typeof target.model_id !== 'string') return;
  if (grants.some((grant) => grant.scope === 'target'
      && grant.provider === target.provider
      && grant.target_agent === target.target_agent
      && grant.model_id === target.model_id
      && grant.effort === target.effort)) return;
  grants.push(Object.freeze({
    scope: 'target',
    source: 'explicit-cli',
    provider: target.provider,
    target_agent: target.target_agent,
    model_id: target.model_id,
    ...(target.effort ? { effort: target.effort } : {}),
    role: 'worker',
  }));
}

function sanitizeAnswerId(value) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const trimmed = value.trim();
  if (/\s/.test(trimmed)) return null;
  const sanitized = trimmed.replace(/[^A-Za-z0-9_.:-]/g, '_').slice(0, 64);
  return /[A-Za-z0-9]/.test(sanitized) ? sanitized : null;
}

function trustedProviders(evidence, currentProvider) {
  const records = Array.isArray(evidence) ? evidence : [evidence];
  const providers = [];
  for (const record of records) {
    if (!isRecord(record) || record.source !== 'user-answer') continue;
    const answerId = sanitizeAnswerId(record.answer_id);
    if (!answerId) continue;
    const values = Array.isArray(record.providers) ? record.providers : [record.provider];
    for (const value of values) {
      const provider = canonicalProvider(value);
      if (provider && provider !== currentProvider) providers.push({ provider, answer_id: answerId });
    }
  }
  return providers;
}

function createAuthorizationLedgerBuilder(currentProvider, authorizationEvidence, cliTarget) {
  const grants = [];
  addProviderGrant(grants, currentProvider, 'current-provider');
  trustedProviders(authorizationEvidence, currentProvider)
    .forEach(({ provider, answer_id: answerId }) => addProviderGrant(grants, provider, 'user-answer', answerId));
  addExactTargetGrant(grants, cliTarget);

  function addAnsweredProviders(values, allowedProviders, answerId) {
    const sanitizedAnswerId = sanitizeAnswerId(answerId);
    if (!sanitizedAnswerId) return;
    const allowed = new Set(allowedProviders);
    values.forEach((provider) => {
      if (provider !== currentProvider && allowed.has(provider)) {
        addProviderGrant(grants, provider, 'user-answer', sanitizedAnswerId);
      }
    });
  }

  function snapshot() {
    const immutableGrants = Object.freeze([...grants]);
    const providers = Object.freeze(unique(immutableGrants
      .filter((grant) => grant.scope === 'provider')
      .map((grant) => grant.provider)));
    const targets = Object.freeze(immutableGrants.filter((grant) => grant.scope === 'target'));
    return Object.freeze({
      schema: 'dhpk.flow-drive.authorization-ledger.v1',
      current_provider: currentProvider,
      providers,
      targets,
      grants: immutableGrants,
    });
  }

  return Object.freeze({ addAnsweredProviders, snapshot });
}

function explicitlySelectedProviders(answer, allowedProviders) {
  if (!isRecord(answer) || String(answer.status || '').toUpperCase() !== 'ANSWERED') {
    return { providers: [], continue: false };
  }
  const answerId = sanitizeAnswerId(answer.answer_id);
  if (!answerId) return { providers: [], continue: false };
  const allowed = new Set(allowedProviders);
  const raw = Array.isArray(answer.providers) ? answer.providers : (answer.provider ? [answer.provider] : []);
  const providers = raw.map(canonicalProvider).filter((provider) => provider && allowed.has(provider));
  if (typeof answer.text === 'string') providers.push(...parseProviderListText(answer.text, allowedProviders));
  return { providers: unique(providers), answer_id: answerId, continue: answer.continue === true };
}

function parseProviderListText(input, allowedProviders) {
  const providersByLabel = new Map();
  for (const provider of allowedProviders) {
    providersByLabel.set(provider.toLowerCase(), provider);
    providersByLabel.set(PROVIDER_LABELS[provider].toLowerCase(), provider);
  }
  let text = input.trim().toLowerCase();
  if (!text) return [];
  text = text.replace(/^(?:please\s+)?(?:i\s+)?(?:authorize|authorise|approve|allow|permit|grant)\s+/, '');
  text = text.replace(/^yes\s*[:,]?\s*/, '');
  text = text.replace(/^only\s+/, '');
  text = text.replace(/[.!?]+$/, '').replace(/\s+only$/, '').trim();
  const parts = text.split(/\s*(?:,|\band\b|&|\+)\s*/);
  if (parts.length === 0 || parts.some((part) => !part || !providersByLabel.has(part.trim()))) return [];
  return unique(parts.map((part) => providersByLabel.get(part.trim())).filter(Boolean));
}

async function askForProviderScope(host, capabilities, currentProvider, ledgerBuilder) {
  if (typeof host.askProviderScope !== 'function') return;
  const options = providerOptions(capabilities, currentProvider);
  const allowedProviders = options.map((option) => option.provider);
  if (allowedProviders.length === 0) return;
  const initial = ledgerBuilder.snapshot();
  const hasReusableProviderGrant = initial.providers.some((provider) => provider !== currentProvider);
  if (hasReusableProviderGrant) return;

  for (let round = 1; round <= MAX_QUESTION_ROUNDS; round += 1) {
    let answer;
    try {
      answer = await host.askProviderScope(Object.freeze({
        schema: 'dhpk.flow-drive.provider-scope-question.v1',
        current_provider: currentProvider,
        provider_options: Object.freeze(options),
        already_authorized: Object.freeze(ledgerBuilder.snapshot().providers.filter((provider) => provider !== currentProvider)),
        answer_evidence_required: 'answer_id',
        round,
        allow_external_probe: false,
      }));
    } catch (_) {
      return;
    }
    const selected = explicitlySelectedProviders(answer, allowedProviders);
    ledgerBuilder.addAnsweredProviders(selected.providers, allowedProviders, selected.answer_id);
    if (!selected.continue) return;
  }
}

function capabilityRefreshScope(ledger, constraints, selectedTargets = []) {
  const candidates = selectedTargets.filter((target) => target
    && target.provider !== ledger.current_provider
    && target.provider === canonicalProvider(target.provider)
    && (target.role === 'worker' || target.role === 'reasoner' || target.role === 'reviewer' || target.role === 'planner')
    && typeof target.target_agent === 'string'
    && typeof target.model_id === 'string'
    && target.model_id.trim() !== ''
    && (!constraints.provider || target.provider === constraints.provider)
    && (!constraints.strict_target || (target.provider === constraints.strict_target.provider
      && target.target_agent === constraints.strict_target.target_agent
      && target.model_id === constraints.strict_target.model_id
      && (constraints.strict_target.effort === undefined || target.effort === constraints.strict_target.effort)))
    && (ledger.providers.includes(target.provider) || targetGrantMatches(ledger, target, target.role)));
  const distinctTargets = [];
  for (const target of candidates) {
    const scoped = {
      provider: target.provider,
      target_agent: target.target_agent,
      model_id: target.model_id,
      ...(target.effort ? { effort: target.effort } : {}),
      role: target.role,
      authority: target.authority,
      ...(target.route ? { route: target.route } : {}),
      ...(target.transport ? { transport: target.transport } : {}),
    };
    if (!distinctTargets.some((other) => JSON.stringify(other) === JSON.stringify(scoped))) distinctTargets.push(scoped);
  }
  return Object.freeze({
    authorized_providers: Object.freeze([]),
    authorized_targets: Object.freeze(distinctTargets.map((target) => Object.freeze(target))),
  });
}

function targetGrantMatches(ledger, target, role) {
  return ledger.targets.some((grant) => grant.role === role
    && grant.provider === target.provider
    && grant.target_agent === target.target_agent
    && grant.model_id === target.model_id
    && (!grant.effort || grant.effort === target.effort));
}

module.exports = Object.freeze({
  PROVIDERS,
  PROVIDER_LABELS,
  exactWorkerTarget,
  providerOptions,
  createAuthorizationLedgerBuilder,
  askForProviderScope,
  capabilityRefreshScope,
  targetGrantMatches,
});
