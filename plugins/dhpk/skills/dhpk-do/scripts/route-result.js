'use strict';

const fs = require('node:fs');
const path = require('node:path');

const SCHEMA = 'dhpk.route-result.v2';
const HOSTS = Object.freeze(['claude', 'cursor', 'codex']);
const DISPOSITIONS = Object.freeze([
  'route-only', 'explicit-required', 'ready', 'blocked', 'unavailable',
]);
const AVAIL_STATES = Object.freeze(['not-checked', 'available', 'unavailable']);
const REASON_CODES = Object.freeze([
  'NOT_PUBLISHED', 'NOT_DISCOVERED', 'POLICY_RESTRICTED',
  'HOST_UNSUPPORTED', 'DEPENDENCY_UNAVAILABLE',
]);
const TARGET_KINDS = Object.freeze(['skill', 'command', 'agent']);
const WORKER_BACKENDS = Object.freeze(['claude', 'codex', 'agy']);
const WORKER_VALUES = Object.freeze(['claude', 'codex', 'agy', 'auto']);
const TOP_LEVEL_KEYS = Object.freeze([
  'schema', 'host', 'cleanedQuery', 'options', 'target',
  'availability', 'backendSelection', 'diagnostics', 'disposition',
]);
const OPTION_KEYS = Object.freeze([
  'routeOnly', 'codexPeer', 'architect', 'openSpec',
  'executeExplicit', 'plan', 'worker', 'reasoner',
]);
const DEFAULT_TABLE = path.join(__dirname, '..', 'references', 'route-table.json');
const RECEIPT_SCHEMA = 'dhpk.cli.receipt.v1';
const BLOCKING_RECEIPTS = Object.freeze(['FAILED', 'BLOCKED', 'TIMEOUT', 'PARTIAL']);

function freezeDeep(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  if (Array.isArray(value)) {
    for (const item of value) freezeDeep(item);
  } else {
    for (const child of Object.values(value)) freezeDeep(child);
  }
  return Object.freeze(value);
}

function loadRouteTable() {
  try {
    return JSON.parse(fs.readFileSync(DEFAULT_TABLE, 'utf8'));
  } catch {
    return { schema: 'dhpk.route-table.v2', rules: [] };
  }
}

function matchTarget(cleanedQuery, table) {
  if (!cleanedQuery) return null;
  for (const rule of table.rules || []) {
    const pat = rule.pattern;
    const raw = rule.target && typeof rule.target === 'object' ? rule.target : null;
    if (!pat || !raw || !raw.id) continue;
    try {
      if (new RegExp(pat, 'i').test(cleanedQuery)) {
        const target = { kind: raw.kind, id: raw.id };
        if (raw.portable_skill_id != null) target.portable_skill_id = raw.portable_skill_id;
        return target;
      }
    } catch {
      continue;
    }
  }
  return null;
}

function parsePlanValue(raw) {
  const parts = String(raw).split(':');
  return {
    plan: {
      enabled: true,
      model: parts[0] || null,
      effort: parts[1] || null,
    },
    extra: parts.length > 2,
  };
}

function parseReasonerValue(raw) {
  const parts = String(raw).split(':');
  const backend = parts[0] || '';
  const valid = backend.length > 0;
  return {
    reasoner: {
      enabled: valid,
      backend,
      model: parts[1] || null,
      effort: parts[2] || null,
      valid,
    },
    extra: parts.length > 3,
  };
}

function parseWorkerValue(raw) {
  const requested = String(raw);
  const valid = WORKER_VALUES.includes(requested);
  return {
    requested,
    value: valid ? requested : null,
    valid,
  };
}

function parseFlags(argv) {
  const tokens = Array.isArray(argv)
    ? argv.map(String)
    : String(argv || '').trim().split(/\s+/).filter(Boolean);
  const options = {
    routeOnly: false,
    codexPeer: false,
    architect: false,
    openSpec: false,
    executeExplicit: false,
    plan: null,
    worker: null,
    reasoner: null,
  };
  let extraPlan = false;
  let extraReasoner = false;
  let deprecatedCodex = false;
  const query = [];

  for (const token of tokens) {
    if (token === '--route-only') {
      options.routeOnly = true;
    } else if (token === '--codex') {
      // Retain the option field for the v2 shape, but never activate the
      // retired MCP peer path. The caller turns this marker into a blocking
      // diagnostic and must choose an explicit replacement instead.
      deprecatedCodex = true;
    } else if (token === '--architect') {
      options.architect = true;
    } else if (token === '--no-architect') {
      options.architect = false;
    } else if (token === '--openspec' || token === '--opsx') {
      options.openSpec = true;
    } else if (token === '--execute-explicit') {
      options.executeExplicit = true;
    } else if (token === '--plan') {
      options.plan = { enabled: true, model: null, effort: null };
      extraPlan = false;
    } else if (token.startsWith('--plan=')) {
      const parsed = parsePlanValue(token.slice('--plan='.length));
      options.plan = parsed.plan;
      extraPlan = parsed.extra;
    } else if (token.startsWith('--worker=')) {
      options.worker = parseWorkerValue(token.slice('--worker='.length));
    } else if (token.startsWith('--reasoner=')) {
      const parsed = parseReasonerValue(token.slice('--reasoner='.length));
      options.reasoner = parsed.reasoner;
      extraReasoner = parsed.extra;
    } else {
      query.push(token);
    }
  }

  return {
    options,
    cleanedQuery: query.join(' ').trim(),
    extraPlan,
    extraReasoner,
    deprecatedCodex,
  };
}

function notCheckedAvailability() {
  return { state: 'not-checked', reasonCode: null, evidence: [] };
}

function evidence(type, surface, subject, state, detail) {
  return { type, surface, subject, state, detail };
}

function computeAvailability(target, observed, host) {
  if (!observed) return notCheckedAvailability();
  const publishedGiven = Array.isArray(observed.published);
  const discoveredGiven = Array.isArray(observed.discovered);
  if (!publishedGiven && !discoveredGiven) return notCheckedAvailability();
  if (!target) return notCheckedAvailability();

  const id = target.id;
  const inPublished = publishedGiven && observed.published.includes(id);
  const inDiscovered = discoveredGiven && observed.discovered.includes(id);

  if (publishedGiven && !inPublished) {
    return {
      state: 'unavailable',
      reasonCode: 'NOT_PUBLISHED',
      evidence: [evidence(
        'publication', host, id, 'missing',
        `Target ${id} is not published on host ${host}`,
      )],
    };
  }
  if (discoveredGiven && !inDiscovered) {
    return {
      state: 'unavailable',
      reasonCode: 'NOT_DISCOVERED',
      evidence: [evidence(
        'discovery', host, id, 'missing',
        `Target ${id} was not discovered on host ${host}`,
      )],
    };
  }

  const items = [];
  if (publishedGiven) {
    items.push(evidence(
      'publication', host, id, 'present',
      `Target ${id} is published on host ${host}`,
    ));
  }
  if (discoveredGiven) {
    items.push(evidence(
      'discovery', host, id, 'present',
      `Target ${id} is discovered on host ${host}`,
    ));
  }
  if (items.length === 0) {
    items.push(evidence(
      'discovery', host, id, 'present',
      `Target ${id} is available on host ${host}`,
    ));
  }
  return { state: 'available', reasonCode: null, evidence: items };
}

function computeBackendSelection(options, observed) {
  const worker = options.worker;
  if (!worker || !WORKER_BACKENDS.includes(worker.requested)) return null;
  const executables = observed && observed.executables;
  if (!executables) return null;
  const missing = executables[worker.requested] === false;
  const claudePresent = executables.claude === true;
  if (missing && claudePresent && worker.requested !== 'claude') {
    return {
      requested: worker.requested,
      selected: 'claude',
      fallbackUsed: true,
      reasonCode: 'MISSING_EXECUTABLE',
    };
  }
  return null;
}

function explicitOnlySequence(observed) {
  const seq = observed && observed.openSpecSequence;
  if (!Array.isArray(seq)) return [];
  return seq.filter((entry) => entry && entry.invocationClass === 'explicit-only');
}

function resolveDisposition(input) {
  const {
    options, target, observed, cliReceipt, obligationsComplete,
    writeCapable, parentContinuation, warmReview, availability,
    deprecatedCodex,
  } = input;

  if (writeCapable && parentContinuation === false) return 'blocked';

  if (options.routeOnly) return 'route-only';

  if (deprecatedCodex) return 'blocked';

  if (cliReceipt && cliReceipt.schema === RECEIPT_SCHEMA) {
    if (BLOCKING_RECEIPTS.includes(cliReceipt.status)) return 'blocked';
    if (cliReceipt.status === 'SUCCEEDED' && obligationsComplete === true) return 'ready';
  }

  if (warmReview && typeof warmReview === 'object') {
    const verdict = warmReview.verdict;
    if (verdict === 'FIX-THEN-SHIP' && Number(warmReview.fixBatchesApplied) >= 1) {
      return 'blocked';
    }
    if (verdict === 'RECONSULT' && Number(warmReview.reconsultsApplied) >= 1) {
      return 'blocked';
    }
  }

  if (explicitOnlySequence(observed).length > 0) return 'explicit-required';

  const invocationClass = target && observed && observed.invocationClasses
    && observed.invocationClasses[target.id];
  if (
    invocationClass === 'explicit-only'
    && !options.executeExplicit
    && !options.routeOnly
  ) {
    return 'explicit-required';
  }

  if (availability && availability.state === 'unavailable') return 'unavailable';

  return 'ready';
}

function createRouteResult(input = {}) {
  const host = input.host == null || input.host === '' ? 'claude' : String(input.host);
  const parsed = parseFlags(input.argv);
  const table = loadRouteTable();
  const target = parsed.deprecatedCodex ? null : matchTarget(parsed.cleanedQuery, table);
  const availability = computeAvailability(target, input.observed, host);
  const backendSelection = parsed.deprecatedCodex
    ? null
    : computeBackendSelection(parsed.options, input.observed);
  const diagnostics = [];

  if (parsed.deprecatedCodex) {
    diagnostics.push({
      code: 'DEPRECATED_CODEX_FLAG',
      severity: 'error',
      message: '--codex is retired; use the default Codex-free route, --worker=codex, --reasoner=codex, or an explicit codex exec second opinion',
    });
  }

  if (parsed.extraPlan || parsed.extraReasoner) {
    diagnostics.push({
      code: 'EXTRA_SEGMENTS',
      severity: 'warning',
      message: parsed.extraPlan && parsed.extraReasoner
        ? 'Extra segments after --plan and --reasoner effort were ignored'
        : parsed.extraPlan
          ? 'Extra segments after --plan effort were ignored'
          : 'Extra segments after --reasoner effort were ignored',
    });
  }
  const explicitSeq = explicitOnlySequence(input.observed);
  if (explicitSeq.length > 0) {
    const ids = explicitSeq.map((entry) => entry.id).filter(Boolean).join(', ');
    diagnostics.push({
      code: 'EXPLICIT_ONLY_SEQUENCE',
      severity: 'error',
      message: `OpenSpec compound sequence contains explicit-only entries: ${ids}`,
    });
  }

  const disposition = resolveDisposition({
    options: parsed.options,
    target,
    observed: input.observed,
    cliReceipt: input.cliReceipt,
    obligationsComplete: input.obligationsComplete,
    writeCapable: input.writeCapable,
    parentContinuation: input.parentContinuation,
    warmReview: input.warmReview,
    availability,
    deprecatedCodex: parsed.deprecatedCodex,
  });

  const result = {
    schema: SCHEMA,
    host,
    cleanedQuery: parsed.cleanedQuery,
    options: parsed.options,
    target,
    availability,
    backendSelection,
    diagnostics,
    disposition,
  };

  if (input.cliReceipt) result.cliReceipt = input.cliReceipt;
  if (input.cliReceipt && input.cliReceipt.schema === RECEIPT_SCHEMA
    && input.cliReceipt.status === 'SUCCEEDED' && input.obligationsComplete === true) {
    result.finalVerdict = 'PASS';
  }
  if (Array.isArray(input.observed && input.observed.openSpecSequence)) {
    result.openSpecSequence = input.observed.openSpecSequence;
  }

  return freezeDeep(result);
}

function parseInvocationContext(argv, { host } = {}) {
  return createRouteResult({ host, argv });
}

function throwInvalid(message) {
  throw new Error(message);
}

function validateEnum(value, allowed, label) {
  if (!allowed.includes(value)) throwInvalid(`invalid ${label} enum: ${value}`);
}

function validateRouteResult(result) {
  if (!result || typeof result !== 'object') throwInvalid('invalid route result');
  if (result.schema !== SCHEMA) throwInvalid(`invalid schema: ${result.schema}`);

  for (const key of Object.keys(result)) {
    if (!TOP_LEVEL_KEYS.includes(key)) {
      throwInvalid(`unknown additional property: ${key}`);
    }
  }

  validateEnum(result.host, HOSTS, 'host');
  validateEnum(result.disposition, DISPOSITIONS, 'disposition');
  if (typeof result.cleanedQuery !== 'string') throwInvalid('invalid cleanedQuery');

  const options = result.options;
  if (!options || typeof options !== 'object') throwInvalid('invalid options');
  for (const key of Object.keys(options)) {
    if (!OPTION_KEYS.includes(key)) throwInvalid(`unknown additional property: options.${key}`);
  }

  const availability = result.availability;
  if (!availability || typeof availability !== 'object') throwInvalid('invalid availability');
  validateEnum(availability.state, AVAIL_STATES, 'availability.state');
  if (availability.reasonCode != null) {
    validateEnum(availability.reasonCode, REASON_CODES, 'reasonCode');
  }
  if (!Array.isArray(availability.evidence)) throwInvalid('invalid availability evidence');
  if (availability.state === 'available' && availability.evidence.length === 0) {
    throwInvalid('available availability requires non-empty evidence');
  }

  if (result.target != null) {
    if (typeof result.target !== 'object') throwInvalid('invalid target');
    validateEnum(result.target.kind, TARGET_KINDS, 'target.kind');
  }

  if (result.backendSelection != null) {
    if (typeof result.backendSelection !== 'object') throwInvalid('invalid backendSelection');
    validateEnum(result.backendSelection.requested, [...WORKER_VALUES], 'backendSelection.requested');
    validateEnum(result.backendSelection.selected, WORKER_BACKENDS, 'backendSelection.selected');
  }

  if (!Array.isArray(result.diagnostics)) throwInvalid('invalid diagnostics');
  for (const item of result.diagnostics) {
    if (!item || typeof item !== 'object') throwInvalid('invalid diagnostic');
    validateEnum(item.severity, ['info', 'warning', 'error'], 'diagnostic.severity');
  }
}

module.exports = {
  parseInvocationContext,
  createRouteResult,
  validateRouteResult,
};
