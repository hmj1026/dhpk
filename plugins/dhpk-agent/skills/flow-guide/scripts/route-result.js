'use strict';

const fs = require('node:fs');
const path = require('node:path');

const SCHEMA = 'dhpk.route-result.v3';
const HOSTS = Object.freeze(['claude', 'cursor', 'codex']);
const AVAILABILITY = Object.freeze(['available', 'unavailable', 'not-configured']);
const DISPOSITIONS = Object.freeze([
  'advice', 'ready', 'explicit-required', 'blocked', 'unavailable',
]);
const TARGET_KEYS = Object.freeze(['id', 'publicName', 'invocationClass', 'command']);
const TOP_LEVEL_KEYS = Object.freeze([
  'schema', 'action', 'host', 'cleanedQuery', 'options', 'target',
  'availability', 'diagnostics', 'disposition', 'requiredEvidence', 'nextAction',
]);
const DEFAULT_TABLE = path.join(__dirname, '..', 'references', 'route-table.json');

function freezeDeep(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  if (Array.isArray(value)) {
    for (const item of value) freezeDeep(item);
  } else {
    for (const child of Object.values(value)) freezeDeep(child);
  }
  return Object.freeze(value);
}

function loadRouteTable(tablePath = DEFAULT_TABLE) {
  try {
    return JSON.parse(fs.readFileSync(tablePath, 'utf8'));
  } catch {
    return { schema: 'dhpk.route-table.v2', rules: [] };
  }
}

function asTokens(argv) {
  if (Array.isArray(argv)) return argv.map(String);
  return String(argv || '').trim().split(/\s+/).filter(Boolean);
}

function parseFlags(argv) {
  const tokens = asTokens(argv);
  const query = [];
  const diagnostics = [];
  let go = false;

  for (const token of tokens) {
    if (token === '--go') {
      go = true;
      continue;
    }

    // Retired route and implementation controls are consumed as diagnostics,
    // so they cannot silently recreate a second routing contract.
    if (
      token === '--route-only'
      || token === '--execute-explicit'
      || token === '--openspec'
      || token === '--opsx'
      || token === '--mode'
      || token.startsWith('--mode=')
      || token === '--plan'
      || token.startsWith('--plan=')
      || token.startsWith('--worker=')
      || token.startsWith('--reasoner=')
      || token === '--architect'
      || token === '--no-architect'
    ) {
      diagnostics.push(`${token} is retired or unsupported for routing; use a flow-guide action or the explicit implementation entry.`);
      continue;
    }

    if (token === '--codex') {
      diagnostics.push('--codex is retired; choose an explicit supported Codex second opinion instead.');
      continue;
    }

    if (token.startsWith('--go=')) {
      diagnostics.push(`${token} is unsupported; use --go as a standalone option.`);
      continue;
    }

    query.push(token);
  }

  return {
    cleanedQuery: query.join(' ').trim(),
    options: { go },
    diagnostics,
  };
}

function readInvocationMetadata(id) {
  const root = path.join(__dirname, '..', '..', '..');
  const candidates = [
    path.join(root, 'skills', id, 'SKILL.md'),
    path.join(root, 'commands', `${id}.md`),
  ];
  for (const file of candidates) {
    try {
      const text = fs.readFileSync(file, 'utf8');
      const invocation = text.match(/^metadata:\s*\n\s+dhpk-invocation-class:\s*(\S+)/m);
      const name = text.match(/^name:\s*["']?([^"'\n]+?)["']?\s*$/m);
      const argumentHint = text.match(/^argument-hint:\s*["']?([^"'\n]+?)["']?\s*$/m);
      return {
        invocationClass: invocation ? invocation[1] : null,
        publicName: name ? name[1].trim() : id,
        argumentHint: argumentHint ? argumentHint[1].trim() : '<input>',
        kind: file.includes(`${path.sep}commands${path.sep}`) ? 'command' : 'skill',
      };
    } catch {
      // The generated package may not carry every route target. Such a target
      // remains visibly not-configured instead of receiving guessed authority.
    }
  }
  return {
    invocationClass: null,
    publicName: id,
    argumentHint: '<input>',
    kind: null,
  };
}

function observedTargetMetadata(raw, observed) {
  const metadata = observed && observed.targets && observed.targets[raw.id];
  return metadata && typeof metadata === 'object' ? metadata : {};
}

function invocationClassFor(raw, observed, metadata) {
  const classes = observed && observed.invocationClasses;
  if (classes && typeof classes === 'object') {
    const candidate = classes[raw.id] || classes[raw.publicName];
    if (candidate) return String(candidate);
  }
  const observedMetadata = observedTargetMetadata(raw, observed);
  return String(
    raw.invocationClass
      || raw.invocation_class
      || observedMetadata.invocationClass
      || observedMetadata.invocation_class
      || metadata.invocationClass
      || 'not-configured',
  );
}

function commandFor(raw, publicName, metadata, observed) {
  if (typeof raw.command === 'string' && raw.command.trim()) return raw.command.trim();
  const observedMetadata = observedTargetMetadata(raw, observed);
  if (typeof observedMetadata.command === 'string' && observedMetadata.command.trim()) {
    return observedMetadata.command.trim();
  }
  if (raw.id === 'flow-drive' || publicName === 'flow-drive') {
    return '$flow-drive <confirmed-spec-or-change-id>';
  }
  if (raw.id === 'flow-guide' || publicName === 'flow-guide') {
    return '$flow-guide <help|route|rules|next|close> <query>';
  }
  if (raw.kind === 'skill') return `$${publicName} <input>`;
  if (raw.kind === 'command') return `/dhpk:${publicName} <input>`;
  return `agent:${publicName} <input>`;
}

function targetFromRule(raw, observed) {
  if (!raw || typeof raw !== 'object' || !raw.id) return null;
  const metadata = readInvocationMetadata(raw.id);
  const publicName = String(
    raw.publicName
      || raw.public_name
      || observedTargetMetadata(raw, observed).publicName
      || observedTargetMetadata(raw, observed).public_name
      || metadata.publicName
      || raw.id,
  );
  return {
    id: String(raw.id),
    publicName,
    invocationClass: invocationClassFor({ ...raw, publicName }, observed, metadata),
    command: commandFor(raw, publicName, metadata, observed),
  };
}

function matchTarget(cleanedQuery, table, observed) {
  if (!cleanedQuery) return null;
  for (const rule of table && Array.isArray(table.rules) ? table.rules : []) {
    const pattern = rule && rule.pattern;
    const raw = rule && rule.target && typeof rule.target === 'object' ? rule.target : null;
    if (!pattern || !raw || !raw.id) continue;
    try {
      if (new RegExp(pattern, 'i').test(cleanedQuery)) return targetFromRule(raw, observed);
    } catch {
      // Invalid patterns are ignored by the deterministic shell matcher too.
    }
  }
  return null;
}

function listed(observed, key, target) {
  if (!observed || !Array.isArray(observed[key])) return null;
  return observed[key].includes(target.id) || observed[key].includes(target.publicName);
}

function computeAvailability(target, observed) {
  if (!target || !observed || typeof observed !== 'object') return 'not-configured';
  const explicit = observed.availability && observed.availability[target.id];
  if (explicit === 'available' || explicit === 'unavailable' || explicit === 'not-configured') {
    return explicit;
  }
  const checks = [];
  for (const key of ['published', 'discovered']) {
    const state = listed(observed, key, target);
    if (state !== null) checks.push(state);
  }
  if (checks.includes(false)) return 'unavailable';
  if (checks.length === 0) return 'not-configured';
  return 'available';
}

function availabilityEvidence(target, availability, observed) {
  if (!target) return ['No deterministic target matched the request.'];
  if (availability === 'available') return [`${target.publicName} is available on the selected host.`];
  if (availability === 'unavailable') return [`${target.publicName} is not available on the selected host.`];
  const host = observed && observed.host ? ` on ${observed.host}` : '';
  return [`Availability for ${target.publicName}${host} is not configured; verify the selected consumer before handoff.`];
}

function resolveDisposition({ parsed, target, availability }) {
  if (parsed.diagnostics.length > 0) return 'blocked';
  if (!parsed.options.go) return 'advice';
  if (!target) return 'blocked';
  if (target.invocationClass === 'explicit-only') return 'explicit-required';
  if (availability === 'unavailable') return 'unavailable';
  if (target.invocationClass !== 'implicit-eligible') return 'blocked';
  return 'ready';
}

function nextActionFor({ parsed, target, disposition }) {
  if (disposition === 'advice') {
    return target
      ? `Review the route to ${target.command}; add --go only for one bounded implicit handoff.`
      : 'Classify the request deliberately; no deterministic target was found.';
  }
  if (disposition === 'ready') return `Produce one bounded handoff to ${target.command}; flow-guide does not execute it.`;
  if (disposition === 'explicit-required') return `Ask for direct human invocation of ${target.command}; flow-guide does not dispatch explicit-only work.`;
  if (disposition === 'unavailable') return `Verify the consumer installation before invoking ${target.command}.`;
  if (parsed.diagnostics.length > 0) return 'Remove the retired or unsupported routing option, then select one supported flow-guide action.';
  return 'Resolve the route or required invocation evidence before proceeding.';
}

function createRouteResult(input = {}) {
  const host = input.host == null || input.host === '' ? 'claude' : String(input.host);
  const parsed = parseFlags(input.argv);
  const table = input.routeTable || loadRouteTable(input.routeTablePath || DEFAULT_TABLE);
  const target = matchTarget(parsed.cleanedQuery, table, input.observed);
  const availability = computeAvailability(target, input.observed);
  const disposition = resolveDisposition({ parsed, target, availability });
  const diagnostics = parsed.diagnostics.slice();
  if (!target && parsed.cleanedQuery) diagnostics.push('No deterministic route matched; deliberate classification is required.');
  if (target && target.invocationClass === 'not-configured') {
    diagnostics.push(`Invocation class for ${target.publicName} is not configured in the selected consumer.`);
  }
  if (target && target.invocationClass === 'explicit-only' && parsed.options.go) {
    diagnostics.push(`Target ${target.publicName} is explicit-only; direct human invocation is required.`);
  }
  const requiredEvidence = availabilityEvidence(target, availability, input.observed);
  const result = {
    schema: SCHEMA,
    action: 'route',
    host,
    cleanedQuery: parsed.cleanedQuery,
    options: parsed.options,
    target,
    availability,
    diagnostics,
    disposition,
    requiredEvidence,
    nextAction: nextActionFor({ parsed, target, disposition }),
  };
  return freezeDeep(result);
}

function parseInvocationContext(argv, { host } = {}) {
  return createRouteResult({ host, argv });
}

function throwInvalid(message) {
  throw new Error(message);
}

function validateRouteResult(result) {
  if (!result || typeof result !== 'object') throwInvalid('invalid route result');
  if (result.schema !== SCHEMA) throwInvalid(`invalid schema: ${result.schema}`);
  const keys = Object.keys(result);
  if (keys.length !== TOP_LEVEL_KEYS.length || keys.some((key) => !TOP_LEVEL_KEYS.includes(key))) {
    throwInvalid('unknown additional property in route result');
  }
  for (const key of TOP_LEVEL_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(result, key)) throwInvalid(`missing required property: ${key}`);
  }
  if (result.action !== 'route') throwInvalid(`invalid action: ${result.action}`);
  if (!HOSTS.includes(result.host)) throwInvalid(`invalid host: ${result.host}`);
  if (typeof result.cleanedQuery !== 'string') throwInvalid('invalid cleanedQuery');

  if (!result.options || typeof result.options !== 'object') throwInvalid('invalid options');
  const optionKeys = Object.keys(result.options);
  if (optionKeys.length !== 1 || optionKeys[0] !== 'go' || typeof result.options.go !== 'boolean') {
    throwInvalid('options must be exactly { go: boolean }');
  }

  if (result.target !== null) {
    if (typeof result.target !== 'object') throwInvalid('invalid target');
    const targetKeys = Object.keys(result.target);
    if (targetKeys.length !== TARGET_KEYS.length || targetKeys.some((key) => !TARGET_KEYS.includes(key))) {
      throwInvalid('target has unknown or missing fields');
    }
    for (const key of TARGET_KEYS) {
      if (typeof result.target[key] !== 'string' || result.target[key].trim() === '') {
        throwInvalid(`invalid target.${key}`);
      }
    }
    if (!['implicit-eligible', 'explicit-only', 'not-configured'].includes(result.target.invocationClass)) {
      throwInvalid(`invalid target.invocationClass: ${result.target.invocationClass}`);
    }
  }

  if (!AVAILABILITY.includes(result.availability)) throwInvalid(`invalid availability: ${result.availability}`);
  if (!DISPOSITIONS.includes(result.disposition)) throwInvalid(`invalid disposition: ${result.disposition}`);
  for (const key of ['diagnostics', 'requiredEvidence']) {
    if (!Array.isArray(result[key]) || result[key].some((item) => typeof item !== 'string')) {
      throwInvalid(`invalid ${key}`);
    }
  }
  if (typeof result.nextAction !== 'string' || result.nextAction.trim() === '') throwInvalid('invalid nextAction');
  return true;
}

module.exports = {
  parseInvocationContext,
  createRouteResult,
  validateRouteResult,
};
