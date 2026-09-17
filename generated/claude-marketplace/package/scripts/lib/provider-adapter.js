'use strict';

const {
  createDispatchReceipt,
  createDispatchRequest,
  createExecutionTarget,
  PROVIDERS,
  SCHEMAS,
  TERMINAL_STATUSES,
  VERIFICATION_STATES,
} = require('./dispatch-contract');

const ADAPTER_PROVIDERS = Object.freeze(['claude-code', 'codex-cli', 'agy', 'cursor-native']);
const CANONICAL_ADAPTER_PROVIDERS = Object.freeze(['anthropic', 'openai', 'google', 'xai', 'cursor']);
const CAPABILITY_STATUSES = Object.freeze(['AVAILABLE', 'UNAVAILABLE', 'BLOCKED', 'NOT_RUN']);
const ADAPTER_PROVIDER_ALIASES = Object.freeze({ 'claude-code': 'anthropic', 'codex-cli': 'openai', agy: 'google', 'cursor-native': 'xai' });
const CANONICAL_PROVIDER_ADAPTERS = Object.freeze({ anthropic: 'anthropic', openai: 'openai', google: 'google', xai: 'xai', cursor: 'cursor' });
const safeString = (value, fallback) => typeof value === 'string' && value.trim() ? value : fallback;

function validateAdapterProvider(provider) {
  const canonical = ADAPTER_PROVIDER_ALIASES[provider] || provider;
  if ((!ADAPTER_PROVIDERS.includes(provider) && !CANONICAL_ADAPTER_PROVIDERS.includes(provider)) || !PROVIDERS.includes(canonical)) throw new TypeError(`unsupported adapter Provider: ${provider}`);
}

function validateTarget(provider, target) {
  const normalized = createExecutionTarget(target);
  const canonical = ADAPTER_PROVIDER_ALIASES[provider] || provider;
  const normalizedProvider = ADAPTER_PROVIDER_ALIASES[normalized.provider] || normalized.provider;
  if (normalizedProvider !== canonical) throw new TypeError(`adapter ${provider} received target for ${normalized.provider}`);
  return normalized;
}

function createCapabilityProbe({ provider, version = 'provider-probe.v1', probe } = {}) {
  validateAdapterProvider(provider);
  return Object.freeze({
    provider,
    version,
    probe(target, request) {
      const normalizedTarget = validateTarget(provider, target);
      createDispatchRequest(request);
      if (probe === undefined) {
        return Object.freeze({
          status: 'NOT_RUN', provider, model: normalizedTarget.model, transport: normalizedTarget.transport,
          evidence: 'bounded capability probe was not run', source: version,
        });
      }
      const result = probe(normalizedTarget, request);
      if (!result || !CAPABILITY_STATUSES.includes(result.status)) throw new TypeError('capability probe must return an explicit capability status');
      return Object.freeze({
        status: result.status, provider, model: normalizedTarget.model, transport: normalizedTarget.transport,
        evidence: safeString(result.evidence, 'capability probe returned no bounded evidence'), source: version,
      });
    },
  });
}

function receiptFor({ request, target, status, failureClass, verification, sideEffects, adapterVersion, receiptId }) {
  return createDispatchReceipt({
    receipt_id: receiptId || `receipt-${request.attempt_id}`,
    request,
    target,
    status,
    failure_class: failureClass,
    side_effects: sideEffects,
    verification: verification || 'NOT_RUN',
    adapter_version: adapterVersion,
    resolution_source: 'provider-adapter',
  });
}

function createExecutionAdapter({ provider, version = 'provider-adapter.v1', execute } = {}) {
  validateAdapterProvider(provider);
  return Object.freeze({
    provider,
    version,
    execute(target, request) {
      let normalizedRequest;
      try {
        normalizedRequest = createDispatchRequest(request);
      } catch (error) {
        return Object.freeze({ status: 'BLOCKED', receipt: null, failure_class: 'ATTESTATION_INVALID', reason: error.message });
      }
      let normalizedTarget;
      try {
        normalizedTarget = validateTarget(provider, target);
      } catch (error) {
        const receipt = receiptFor({
          request: normalizedRequest, target: null, status: 'BLOCKED', failureClass: 'ADAPTER_TARGET_MISMATCH',
          verification: 'BLOCKED', adapterVersion: version,
        });
        return Object.freeze({ status: receipt.status, receipt, failure_class: 'ADAPTER_TARGET_MISMATCH' });
      }
      if (typeof execute !== 'function') {
        const receipt = receiptFor({
          request: normalizedRequest, target: normalizedTarget, status: 'BLOCKED', failureClass: 'ADAPTER_NOT_CONFIGURED',
          verification: 'BLOCKED', adapterVersion: version,
        });
        return Object.freeze({ status: receipt.status, receipt, failure_class: 'ADAPTER_NOT_CONFIGURED' });
      }
      try {
        const outcome = execute(normalizedTarget, normalizedRequest);
        const status = outcome && outcome.status;
        if (!TERMINAL_STATUSES.includes(status)) throw new TypeError('execution adapter must return one terminal status');
        const verification = outcome.verification === undefined ? 'NOT_RUN' : outcome.verification;
        if (!VERIFICATION_STATES.includes(verification)) throw new TypeError('execution adapter returned invalid verification state');
        const receipt = receiptFor({
          request: normalizedRequest, target: normalizedTarget, status,
          failureClass: outcome.failure_class, verification, sideEffects: outcome.side_effects,
          adapterVersion: version, receiptId: outcome.receipt_id,
        });
        return Object.freeze({ status: receipt.status, receipt, failure_class: receipt.failure_class });
      } catch (error) {
        const receipt = receiptFor({
          request: normalizedRequest, target: normalizedTarget, status: 'FAILED', failureClass: 'PROVIDER_EXECUTION_FAILURE',
          verification: 'NOT_RUN', adapterVersion: version,
        });
        return Object.freeze({ status: receipt.status, receipt, failure_class: receipt.failure_class });
      }
    },
  });
}

function createAdapterRegistry({ executors = {}, probes = {} } = {}) {
  const adapters = Object.fromEntries(ADAPTER_PROVIDERS.map((provider) => [provider, createExecutionAdapter({ provider, execute: executors[provider] })]));
  const capabilityProbes = Object.fromEntries(ADAPTER_PROVIDERS.map((provider) => [provider, createCapabilityProbe({ provider, probe: probes[provider] })]));
  for (const provider of CANONICAL_ADAPTER_PROVIDERS) {
    const legacy = Object.entries(ADAPTER_PROVIDER_ALIASES).find(([, canonical]) => canonical === provider)?.[0];
    adapters[provider] = createExecutionAdapter({ provider, execute: executors[provider] || legacy && executors[legacy] });
    capabilityProbes[provider] = createCapabilityProbe({ provider, probe: probes[provider] || legacy && probes[legacy] });
  }
  const get = (provider) => {
    const legacy = CANONICAL_PROVIDER_ADAPTERS[provider] || provider;
    return adapters[legacy] || null;
  };
  const probe = (provider) => {
    const legacy = CANONICAL_PROVIDER_ADAPTERS[provider] || provider;
    return capabilityProbes[legacy] || null;
  };
  return Object.freeze({
    providers: [...ADAPTER_PROVIDERS],
    canonical_providers: [...CANONICAL_ADAPTER_PROVIDERS],
    get,
    probe,
  });
}

module.exports = Object.freeze({ ADAPTER_PROVIDERS, createAdapterRegistry, createCapabilityProbe, createExecutionAdapter });
