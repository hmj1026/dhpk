'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { normalizeConsumerEvidence } = require('./release-evidence');
const {
  DIRECT_SHAPE,
  NATIVE_LINK_SHAPE,
  CURSOR_PROJECT_PROBE_PRODUCER,
  CURSOR_PROJECT_PROBE_ADAPTER,
  CURSOR_PROJECT_PROBE_CLAIMS,
  CURSOR_PROJECT_PROBE_SURFACE,
  CODEX_PROJECT_PROBE_PRODUCER,
  CODEX_PROJECT_PROBE_ADAPTER,
  CODEX_PROJECT_PROBE_CLAIMS,
  CODEX_PROJECT_PROBE_SURFACE,
} = require('./project-agent-provider-adapters');

const HOST_PROBES = Object.freeze({
  cursor: Object.freeze({
    label: 'Cursor',
    envKey: 'DHPK_CURSOR_CONSUMER_EVIDENCE',
    producer: CURSOR_PROJECT_PROBE_PRODUCER,
    adapter: CURSOR_PROJECT_PROBE_ADAPTER,
    claims: CURSOR_PROJECT_PROBE_CLAIMS,
    surface: CURSOR_PROJECT_PROBE_SURFACE,
  }),
  codex: Object.freeze({
    label: 'Codex',
    envKey: 'DHPK_CODEX_CONSUMER_EVIDENCE',
    producer: CODEX_PROJECT_PROBE_PRODUCER,
    adapter: CODEX_PROJECT_PROBE_ADAPTER,
    claims: CODEX_PROJECT_PROBE_CLAIMS,
    surface: CODEX_PROJECT_PROBE_SURFACE,
  }),
});

function isObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function sameSortedList(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && new Set(left).size === left.length
    && left.slice().sort().every((value, index) => value === right.slice().sort()[index]);
}

function probeSpec(host) {
  const spec = HOST_PROBES[host];
  if (!spec) throw new Error(`unsupported discovery Host: ${host}`);
  return spec;
}

function adapterMatches(adapter, spec) {
  return isObject(adapter)
    && adapter.id === spec.adapter.id
    && adapter.version === spec.adapter.version;
}

function normalizeHostConsumerEvidence(host, raw) {
  const spec = probeSpec(host);
  if (!isObject(raw)) throw new Error(`${spec.label} discovery consumer probe record is missing`);
  if (raw.stage !== 'CONSUMER') {
    throw new Error(`${spec.label} discovery consumer probe record is not a PASS record`);
  }
  return normalizeConsumerEvidence(raw);
}

function isPassingHostConsumerProbe(host, evidence) {
  const spec = probeSpec(host);
  if (!isObject(evidence) || evidence.stage !== 'CONSUMER') return false;
  if (evidence.producer !== spec.producer) return false;
  if (!adapterMatches(evidence.adapter, spec)) return false;
  if (!Array.isArray(evidence.surfaceResults) || evidence.surfaceResults.length !== 1) return false;
  const row = evidence.surfaceResults[0];
  if (!isObject(row) || row.surface !== spec.surface || row.status !== 'PASS') return false;
  if (row.producer && row.producer !== spec.producer) return false;
  if (!adapterMatches(row.adapter || evidence.adapter, spec)) return false;
  return sameSortedList(row.checkedClaims, spec.claims);
}

function classifyHostConsumerEvidence(host, raw) {
  const spec = probeSpec(host);
  if (raw == null) {
    return {
      bindingShape: NATIVE_LINK_SHAPE,
      reason: `${spec.label} discovery consumer probe record is missing`,
    };
  }
  let evidence;
  try {
    evidence = normalizeHostConsumerEvidence(host, raw);
  } catch (error) {
    const message = String(error && error.message ? error.message : error);
    if (/stale/i.test(message)) {
      return {
        bindingShape: NATIVE_LINK_SHAPE,
        reason: `${spec.label} discovery consumer probe record is stale`,
      };
    }
    if (/not a PASS record/i.test(message)) {
      return {
        bindingShape: NATIVE_LINK_SHAPE,
        reason: `${spec.label} discovery consumer probe is not a PASS record`,
      };
    }
    return {
      bindingShape: NATIVE_LINK_SHAPE,
      reason: `${spec.label} discovery consumer probe record is unreadable`,
    };
  }
  if (isPassingHostConsumerProbe(host, evidence)) {
    return {
      bindingShape: DIRECT_SHAPE,
      reason: `${spec.label} discovery consumer probe PASS`,
    };
  }
  const status = evidence.surfaceResults && evidence.surfaceResults[0] && evidence.surfaceResults[0].status;
  if (status === 'FAIL') {
    return {
      bindingShape: NATIVE_LINK_SHAPE,
      reason: `${spec.label} discovery consumer probe failed`,
    };
  }
  return {
    bindingShape: NATIVE_LINK_SHAPE,
    reason: `${spec.label} discovery consumer probe is not a PASS record`,
  };
}

function loadHostConsumerEvidence(host, {
  consumerEvidence = null,
  consumerEvidencePath = null,
  env = process.env,
} = {}) {
  const spec = probeSpec(host);
  if (consumerEvidence != null) return consumerEvidence;
  const file = consumerEvidencePath || (env && env[spec.envKey]) || '';
  if (!file || typeof file !== 'string') return null;
  const resolved = path.resolve(file);
  let stat;
  try {
    stat = fs.lstatSync(resolved);
  } catch (error) {
    throw new Error(`${spec.label} discovery consumer probe record is unreadable: ${error.message}`);
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`${spec.label} discovery consumer probe record must be a regular file`);
  }
  try {
    return JSON.parse(fs.readFileSync(resolved, 'utf8'));
  } catch (error) {
    throw new Error(`${spec.label} discovery consumer probe record is unreadable: ${error.message}`);
  }
}

function classifyHostBinding(host, options = {}) {
  try {
    return classifyHostConsumerEvidence(host, loadHostConsumerEvidence(host, options));
  } catch (error) {
    return {
      bindingShape: NATIVE_LINK_SHAPE,
      reason: String(error && error.message ? error.message : error),
    };
  }
}

function normalizeCursorConsumerEvidence(raw) {
  return normalizeHostConsumerEvidence('cursor', raw);
}

function isPassingCursorConsumerProbe(evidence) {
  return isPassingHostConsumerProbe('cursor', evidence);
}

function classifyCursorConsumerEvidence(raw) {
  return classifyHostConsumerEvidence('cursor', raw);
}

function loadCursorConsumerEvidence(options = {}) {
  return loadHostConsumerEvidence('cursor', options);
}

function classifyCursorHostBinding(options = {}) {
  return classifyHostBinding('cursor', options);
}

function classifyCodexConsumerEvidence(raw) {
  return classifyHostConsumerEvidence('codex', raw);
}

function loadCodexConsumerEvidence(options = {}) {
  return loadHostConsumerEvidence('codex', options);
}

function classifyCodexHostBinding(options = {}) {
  return classifyHostBinding('codex', options);
}

module.exports = {
  DIRECT_SHAPE,
  NATIVE_LINK_SHAPE,
  CURSOR_PROJECT_PROBE_PRODUCER,
  CURSOR_PROJECT_PROBE_ADAPTER,
  CURSOR_PROJECT_PROBE_CLAIMS,
  CURSOR_PROJECT_PROBE_SURFACE,
  CODEX_PROJECT_PROBE_PRODUCER,
  CODEX_PROJECT_PROBE_ADAPTER,
  CODEX_PROJECT_PROBE_CLAIMS,
  CODEX_PROJECT_PROBE_SURFACE,
  isPassingCursorConsumerProbe,
  classifyCursorConsumerEvidence,
  classifyCursorHostBinding,
  loadCursorConsumerEvidence,
  classifyCodexConsumerEvidence,
  classifyCodexHostBinding,
  loadCodexConsumerEvidence,
  classifyHostBinding,
};
