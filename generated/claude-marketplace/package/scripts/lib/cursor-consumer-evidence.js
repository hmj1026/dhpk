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
} = require('./project-agent-provider-adapters');

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

function adapterMatches(adapter) {
  return isObject(adapter)
    && adapter.id === CURSOR_PROJECT_PROBE_ADAPTER.id
    && adapter.version === CURSOR_PROJECT_PROBE_ADAPTER.version;
}

function normalizeCursorConsumerEvidence(raw) {
  if (!isObject(raw)) throw new Error('Cursor discovery consumer probe record is missing');
  if (raw.stage !== 'CONSUMER') {
    throw new Error('Cursor discovery consumer probe record is not a PASS record');
  }
  return normalizeConsumerEvidence(raw);
}

function isPassingCursorConsumerProbe(evidence) {
  if (!isObject(evidence) || evidence.stage !== 'CONSUMER') return false;
  if (evidence.producer !== CURSOR_PROJECT_PROBE_PRODUCER) return false;
  if (!adapterMatches(evidence.adapter)) return false;
  if (!Array.isArray(evidence.surfaceResults) || evidence.surfaceResults.length !== 1) return false;
  const row = evidence.surfaceResults[0];
  if (!isObject(row) || row.surface !== CURSOR_PROJECT_PROBE_SURFACE || row.status !== 'PASS') return false;
  if (row.producer && row.producer !== CURSOR_PROJECT_PROBE_PRODUCER) return false;
  if (!adapterMatches(row.adapter || evidence.adapter)) return false;
  return sameSortedList(row.checkedClaims, CURSOR_PROJECT_PROBE_CLAIMS);
}

function classifyCursorConsumerEvidence(raw) {
  if (raw == null) {
    return {
      bindingShape: NATIVE_LINK_SHAPE,
      reason: 'Cursor discovery consumer probe record is missing',
    };
  }
  let evidence;
  try {
    evidence = normalizeCursorConsumerEvidence(raw);
  } catch (error) {
    const message = String(error && error.message ? error.message : error);
    if (/stale/i.test(message)) {
      return {
        bindingShape: NATIVE_LINK_SHAPE,
        reason: 'Cursor discovery consumer probe record is stale',
      };
    }
    if (/not a PASS record/i.test(message)) {
      return {
        bindingShape: NATIVE_LINK_SHAPE,
        reason: 'Cursor discovery consumer probe is not a PASS record',
      };
    }
    return {
      bindingShape: NATIVE_LINK_SHAPE,
      reason: 'Cursor discovery consumer probe record is unreadable',
    };
  }
  if (isPassingCursorConsumerProbe(evidence)) {
    return {
      bindingShape: DIRECT_SHAPE,
      reason: 'Cursor discovery consumer probe PASS',
    };
  }
  const status = evidence.surfaceResults && evidence.surfaceResults[0] && evidence.surfaceResults[0].status;
  if (status === 'FAIL') {
    return {
      bindingShape: NATIVE_LINK_SHAPE,
      reason: 'Cursor discovery consumer probe failed',
    };
  }
  return {
    bindingShape: NATIVE_LINK_SHAPE,
    reason: 'Cursor discovery consumer probe is not a PASS record',
  };
}

function loadCursorConsumerEvidence({
  consumerEvidence = null,
  consumerEvidencePath = null,
  env = process.env,
} = {}) {
  if (consumerEvidence != null) return consumerEvidence;
  const file = consumerEvidencePath || (env && env.DHPK_CURSOR_CONSUMER_EVIDENCE) || '';
  if (!file || typeof file !== 'string') return null;
  const resolved = path.resolve(file);
  let stat;
  try {
    stat = fs.lstatSync(resolved);
  } catch (error) {
    throw new Error(`Cursor discovery consumer probe record is unreadable: ${error.message}`);
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error('Cursor discovery consumer probe record must be a regular file');
  }
  try {
    return JSON.parse(fs.readFileSync(resolved, 'utf8'));
  } catch (error) {
    throw new Error(`Cursor discovery consumer probe record is unreadable: ${error.message}`);
  }
}

function classifyCursorHostBinding(options = {}) {
  try {
    return classifyCursorConsumerEvidence(loadCursorConsumerEvidence(options));
  } catch (error) {
    return {
      bindingShape: NATIVE_LINK_SHAPE,
      reason: String(error && error.message ? error.message : error),
    };
  }
}

module.exports = {
  DIRECT_SHAPE,
  NATIVE_LINK_SHAPE,
  CURSOR_PROJECT_PROBE_PRODUCER,
  CURSOR_PROJECT_PROBE_ADAPTER,
  CURSOR_PROJECT_PROBE_CLAIMS,
  CURSOR_PROJECT_PROBE_SURFACE,
  isPassingCursorConsumerProbe,
  classifyCursorConsumerEvidence,
  classifyCursorHostBinding,
  loadCursorConsumerEvidence,
};
