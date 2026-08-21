#!/usr/bin/env node
'use strict';

// This ledger is deliberately separate from context-budget.js. That validator
// owns skill discovery descriptions; this report accounts for agent-spawn
// inputs. Values under `static` are conservative estimates from source text or
// explicit fixtures. `runtimeObserved` is caller-supplied telemetry and is
// never folded into static totals.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { extract } = require('./_lib/frontmatter');

const SCHEMA = 'dhpk.subagent-context-budget.v1';
const ESTIMATOR = Object.freeze({
  id: 'dhpk-conservative-context-estimator',
  version: '1',
  words: 'unicode-whitespace-delimited',
  tokens: 'ceil-unicode-codepoints-divided-by-4',
  aggregation: 'measure-each-entry-then-sum',
});
const LOAD_PHASES = Object.freeze(['always', 'conditional', 'agent-spawn', 'hook-output']);
// `inline` is a no-dispatch scenario mode, not an inheritance tier.
const CONTEXT_TIERS = Object.freeze(['cold', 'bounded', 'full']);
const PACKET_PARTS = Object.freeze([
  ['goal_and_non_goals', 'goalAndNonGoals', 'goal', 'non_goals', 'nonGoals'],
  ['owned_files', 'ownedFiles', 'files', 'owned'],
  ['interfaces', 'invariants', 'constraints', 'settled_interfaces', 'settledInterfaces', 'settled'],
  ['verification', 'acceptance', 'verification_acceptance', 'verificationAcceptance'],
  ['identity', 'task_id', 'attempt_id', 'taskAttemptIdentity', 'evidence_pointers', 'evidencePointers'],
]);
const DEFAULT_ROOT = path.resolve(__dirname, '..', '..');

const REVIEWER_ROLES = Object.freeze([
  'code-reviewer',
  'database-reviewer',
  'security-reviewer',
  'frontend-reviewer',
  'doc-reviewer',
  'migration-reviewer',
  // This slot is capability-gated and has no default Codex kernel. The ledger
  // reports it as NOT_CONFIGURED instead of charging a substitute role.
  'polyfill-reviewer',
]);

const DEFAULT_SCENARIOS = Object.freeze([
  Object.freeze({ id: 'small-inline', contextTier: 'inline', roles: [] }),
  Object.freeze({ id: 'cold-worker', contextTier: 'cold', roles: ['worker'] }),
  Object.freeze({
    id: 'architect-tdd-worker',
    contextTier: 'bounded',
    reason: 'architect and TDD continuation retain unresolved route decisions',
    roles: ['architect', 'tdd-guide', 'worker'],
  }),
  Object.freeze({ id: 'reviewer-wave-2', contextTier: 'cold', roles: REVIEWER_ROLES.slice(0, 2) }),
  Object.freeze({ id: 'reviewer-wave-4', contextTier: 'cold', roles: REVIEWER_ROLES.slice(0, 4) }),
  Object.freeze({ id: 'reviewer-wave-7', contextTier: 'cold', roles: REVIEWER_ROLES.slice(0, 7) }),
]);

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') {
    const output = {};
    for (const key of Object.keys(value).sort()) output[key] = clone(value[key]);
    return output;
  }
  return value;
}

function stableStringify(value) {
  if (value === undefined) return '';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function textValue(value) {
  if (value === undefined || value === null) return '';
  return typeof value === 'string' ? value : stableStringify(value);
}

function measureText(value) {
  const text = textValue(value).trim();
  return {
    chars: Array.from(text).length,
    words: text ? text.split(/\s+/u).length : 0,
    tokens: text ? Math.ceil(Array.from(text).length / 4) : 0,
  };
}

function digest(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function unquote(value) {
  const text = String(value == null ? '' : value).trim();
  if (text.length >= 2 && ((text.startsWith("'") && text.endsWith("'")) || (text.startsWith('"') && text.endsWith('"')))) {
    return text.slice(1, -1).replace(/\\(['"])/g, '$1');
  }
  return text;
}

function safePath(root, relativePath) {
  if (typeof relativePath !== 'string' || relativePath.trim() === '' || path.isAbsolute(relativePath)) return null;
  const rootPath = path.resolve(root);
  const candidate = path.resolve(rootPath, relativePath);
  if (candidate !== rootPath && !candidate.startsWith(`${rootPath}${path.sep}`)) return null;
  return candidate;
}

function readFile(root, relativePath) {
  const file = safePath(root, relativePath);
  if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) return null;
  return { file, text: fs.readFileSync(file, 'utf8') };
}

function roleName(role) {
  if (typeof role === 'string') return role;
  if (!role || typeof role !== 'object') return null;
  return role.role || role.name || role.id || null;
}

function roleSelection(selectedRoles, fallback) {
  if (selectedRoles == null) return fallback;
  if (Array.isArray(selectedRoles)) return selectedRoles.map(roleName).filter(Boolean);
  if (typeof selectedRoles === 'object') return Object.keys(selectedRoles);
  return [];
}

function listRoleFiles(root) {
  const files = [];
  const roots = [path.join(root, 'agents')];
  const modules = path.join(root, 'modules');
  if (fs.existsSync(modules) && fs.statSync(modules).isDirectory()) {
    for (const moduleName of fs.readdirSync(modules).sort()) roots.push(path.join(modules, moduleName, 'agents'));
  }
  for (const directory of roots) {
    if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) continue;
    for (const name of fs.readdirSync(directory).filter((entry) => entry.endsWith('.md')).sort()) {
      if (name === 'INDEX.md' || name === 'README.md') continue;
      const file = path.join(directory, name);
      if (fs.statSync(file).isFile()) files.push(file);
    }
  }
  return files;
}

function descriptionFromSource(source) {
  const frontmatter = extract(String(source || ''));
  return unquote(frontmatter.values && frontmatter.values.description);
}

function tomlField(source, field) {
  const text = String(source || '');
  const multiline = text.match(new RegExp(`^${field}\\s*=\\s*"""([\\s\\S]*?)"""`, 'm'));
  if (multiline) return multiline[1].replace(/^\r?\n/, '').replace(/\r?\n$/, '');
  const basic = text.match(new RegExp(`^${field}\\s*=\\s*("(?:\\\\.|[^"\\r\\n])*")`, 'm'));
  if (!basic) return '';
  try {
    return JSON.parse(basic[1]);
  } catch (_) {
    return unquote(basic[1]);
  }
}

function makeMeasurement({
  id,
  kind,
  value,
  surface = null,
  runtime = null,
  loadPhase = null,
  source = null,
  provenance = null,
  basis = 'static-estimate',
  duplicateGroup = null,
} = {}) {
  const text = textValue(value).trim();
  const measured = measureText(text);
  const fingerprint = digest(text);
  return {
    id: id || null,
    kind: kind || null,
    basis,
    surface,
    runtime,
    loadPhase,
    source,
    provenance: provenance ? clone(provenance) : null,
    chars: measured.chars,
    words: measured.words,
    tokens: measured.tokens,
    duplicateFingerprint: fingerprint,
    duplicateGroup: duplicateGroup || `duplicate-${fingerprint.slice(0, 12)}`,
  };
}

function sumMeasurements(measurements) {
  const entries = Array.isArray(measurements) ? measurements : [];
  return entries.reduce((total, item) => ({
    entries: total.entries + 1,
    chars: total.chars + Number(item.chars || 0),
    words: total.words + Number(item.words || 0),
    tokens: total.tokens + Number(item.tokens || 0),
  }), { entries: 0, chars: 0, words: 0, tokens: 0 });
}

function addMeasurementTotals(...values) {
  return values.reduce((total, value) => ({
    chars: total.chars + Number(value && value.chars || 0),
    words: total.words + Number(value && value.words || 0),
    tokens: total.tokens + Number(value && value.tokens || 0),
  }), { chars: 0, words: 0, tokens: 0 });
}

function zeroMeasurement(id, kind, metadata = {}) {
  return makeMeasurement({ id, kind, value: '', ...metadata });
}

function normalizeRoleRecord(role, root, sourceKind) {
  const name = roleName(role);
  const input = role && typeof role === 'object' ? role : {};
  const relative = input.path || (sourceKind === 'description' ? `agents/${name}.md` : `codex/agents/${name}.toml`);
  const loaded = input.text !== undefined
    ? { file: relative, text: textValue(input.text) }
    : readFile(root, relative);
  return { name, relative, loaded, input };
}

function measureRoleDescriptions({ root = DEFAULT_ROOT, roles = null, readDescription = null } = {}) {
  const rootPath = path.resolve(root);
  const selections = roles == null
    ? listRoleFiles(rootPath).map((file) => ({ name: path.basename(file, '.md'), path: path.relative(rootPath, file) }))
    : roles;
  const entries = [];
  const diagnostics = [];
  for (const role of selections) {
    const mapped = roles && !Array.isArray(roles) && typeof roles === 'object' && !roles.path
      ? { name: roleName(role), description: roles[roleName(role)] }
      : role;
    const normalized = normalizeRoleRecord(mapped, rootPath, 'description');
    if (!normalized.name) {
      diagnostics.push({ code: 'INVALID_ROLE', message: 'role description selection has no role name' });
      continue;
    }
    let description = normalized.input.description;
    if (description === undefined && typeof readDescription === 'function') {
      description = readDescription(normalized.name, normalized.input, normalized.loaded && normalized.loaded.text);
    }
    if (description === undefined && normalized.loaded) description = descriptionFromSource(normalized.loaded.text);
    if (description === undefined) description = '';
    if (!String(description).trim()) {
      diagnostics.push({
        code: 'MISSING_ROLE_DESCRIPTION',
        message: `role '${normalized.name}' has no usable description`,
        role: normalized.name,
        source: normalized.relative,
      });
      continue;
    }
    entries.push(makeMeasurement({
      id: normalized.name,
      kind: 'role-description',
      value: description,
      surface: 'claude',
      runtime: 'claude-code',
      loadPhase: 'always',
      source: normalized.relative,
      provenance: { kind: 'canonical', role: normalized.name },
    }));
  }
  return { basis: 'static-estimate', entries, totals: sumMeasurements(entries), diagnostics };
}

function developerInstructionValue(source) {
  return tomlField(source, 'developer_instructions');
}

function measureDeveloperInstructions({ root = DEFAULT_ROOT, selectedRoles = null, roles = null, readDeveloperInstructions = null } = {}) {
  const rootPath = path.resolve(root);
  const roleInput = roles || selectedRoles;
  const codexRoot = path.join(rootPath, 'codex', 'agents');
  const fallback = fs.existsSync(codexRoot)
    ? fs.readdirSync(codexRoot).filter((name) => name.endsWith('.toml')).sort().map((name) => name.slice(0, -5))
    : [];
  const selected = roleSelection(roleInput, fallback);
  const entries = [];
  const diagnostics = [];
  for (const role of selected) {
    const mapped = roles && !Array.isArray(roles) && typeof roles === 'object' && !roles.path
      ? { name: roleName(role), developerInstructions: roles[roleName(role)] }
      : role;
    const normalized = normalizeRoleRecord(mapped, rootPath, 'developer');
    if (!normalized.name) {
      diagnostics.push({ code: 'INVALID_ROLE', message: 'developer instruction selection has no role name' });
      continue;
    }
    let instructions = normalized.input.developerInstructions;
    if (instructions === undefined) instructions = normalized.input.instructions;
    if (instructions === undefined && typeof readDeveloperInstructions === 'function') {
      instructions = readDeveloperInstructions(normalized.name, normalized.input, normalized.loaded && normalized.loaded.text);
    }
    if (instructions === undefined && normalized.loaded) instructions = developerInstructionValue(normalized.loaded.text);
    if (instructions === undefined) instructions = '';
    if (!String(instructions).trim()) {
      diagnostics.push({
        code: 'MISSING_DEVELOPER_INSTRUCTIONS',
        message: `role '${normalized.name}' has no usable developer instructions`,
        role: normalized.name,
        source: normalized.relative,
      });
      continue;
    }
    entries.push(makeMeasurement({
      id: normalized.name,
      kind: 'developer-instructions',
      value: instructions,
      surface: 'codex',
      runtime: 'codex-cli',
      loadPhase: 'agent-spawn',
      source: normalized.relative,
      provenance: { kind: 'projection', role: normalized.name, canonical: `agents/${normalized.name}.md` },
    }));
  }
  return {
    basis: 'static-estimate',
    selectedRoles: selected.slice(),
    entries,
    totals: sumMeasurements(entries),
    diagnostics,
  };
}

function payloadText(value, kind) {
  if (value == null) return '';
  if (kind === 'warmstart') {
    if (typeof value === 'object') {
      const output = value.hookSpecificOutput;
      if (output && output.additionalContext !== undefined) return textValue(output.additionalContext);
      if (value.additionalContext !== undefined) return textValue(value.additionalContext);
    }
    if (typeof value === 'string') {
      try {
        return payloadText(JSON.parse(value), kind);
      } catch (_) {
        // A fixture may be the raw additionalContext string rather than JSON.
      }
    }
  }
  if (typeof value === 'object' && value.text !== undefined) return textValue(value.text);
  return textValue(value);
}

function measureDispatchPacket(packet, options = {}) {
  return makeMeasurement({
    id: options.id || 'dispatch-packet',
    kind: 'dispatch-packet',
    value: payloadText(packet, 'packet'),
    surface: 'orchestration',
    runtime: 'agent-dispatch',
    loadPhase: 'agent-spawn',
    source: options.source || 'dispatch-input',
    provenance: { kind: 'dispatch-packet', ...options.provenance },
  });
}

function measureWarmstartOutput(output, options = {}) {
  return makeMeasurement({
    id: options.id || 'warmstart-output',
    kind: 'warmstart-output',
    value: payloadText(output, 'warmstart'),
    surface: 'claude',
    runtime: 'claude-code',
    loadPhase: 'hook-output',
    source: options.source || 'pre-agent-warmstart',
    provenance: { kind: 'hook-output', ...options.provenance },
  });
}

function validateDispatchPacket(packet, { required = false } = {}) {
  const value = packet && typeof packet === 'object' ? packet : null;
  if (!textValue(packet).trim()) {
    return required
      ? { ok: false, code: 'DISPATCH_PACKET_REQUIRED', message: 'agent dispatch requires a non-empty decision-complete packet' }
      : { ok: true, parts: [] };
  }
  // Raw serialized packets are accepted as an opaque static fixture. Structured
  // packets expose five independently checkable contract parts.
  if (!value || Array.isArray(value)) return { ok: true, parts: [], structured: false };
  const present = (key) => {
    const field = value[key];
    if (field === undefined || field === null) return false;
    if (Array.isArray(field)) return field.length > 0;
    if (typeof field === 'object') return Object.keys(field).length > 0;
    return textValue(field).trim() !== '';
  };
  const goalPart = (present('goal_and_non_goals') || present('goalAndNonGoals')
    || (present('goal') && (present('non_goals') || present('nonGoals'))));
  const missing = [];
  if (!goalPart) missing.push(PACKET_PARTS[0]);
  for (const aliases of PACKET_PARTS.slice(1)) {
    if (!aliases.some((key) => present(key))) missing.push(aliases);
  }
  return missing.length
    ? { ok: false, code: 'DISPATCH_PACKET_INCOMPLETE', message: `dispatch packet is missing required part(s): ${missing.map((part) => part[0]).join(', ')}`, missing }
    : { ok: true, parts: PACKET_PARTS.map((aliases) => aliases.find((key) => value[key] !== undefined) || aliases[0]), structured: true };
}

function normalizeRuntimeObserved(input) {
  const records = Array.isArray(input)
    ? input
    : input && Array.isArray(input.records) ? input.records : input ? [input] : [];
  const normalized = records.map((record, index) => {
    const item = record && typeof record === 'object' ? clone(record) : { value: record };
    const inputTokens = Number(item.inputTokens !== undefined ? item.inputTokens : item.input_tokens);
    const outputTokens = Number(item.outputTokens !== undefined ? item.outputTokens : item.output_tokens);
    const totalTokens = Number(item.totalTokens !== undefined
      ? item.totalTokens
      : item.total_tokens !== undefined ? item.total_tokens : item.tokens);
    return {
      ...item,
      id: item.id || `observation-${index + 1}`,
      inputTokens: Number.isFinite(inputTokens) ? inputTokens : null,
      outputTokens: Number.isFinite(outputTokens) ? outputTokens : null,
      totalTokens: Number.isFinite(totalTokens) ? totalTokens : null,
    };
  });
  const sum = (field) => normalized.reduce((total, item) => total + (Number.isFinite(item[field]) ? item[field] : 0), 0);
  return {
    basis: 'runtime-observed',
    status: normalized.length ? 'OBSERVED' : 'NOT_RUN',
    records: normalized,
    totals: {
      observations: normalized.length,
      inputTokens: sum('inputTokens'),
      outputTokens: sum('outputTokens'),
      totalTokens: sum('totalTokens'),
    },
  };
}

function scenarioDispatches(scenario) {
  if (Array.isArray(scenario.dispatches)) return scenario.dispatches;
  const roles = Array.isArray(scenario.roles) ? scenario.roles : [];
  return roles.map((role) => ({
    role,
    contextTier: scenario.contextTier,
    reason: scenario.reason,
    ...(role === 'polyfill-reviewer' ? { availability: 'capability-gated' } : {}),
  }));
}

function inspectScenario(scenario, developerByRole, inheritedDefault, packetDefault, warmstartDefault, fallbackId = 'scenario') {
  const spec = scenario && typeof scenario === 'object' ? scenario : {};
  const id = spec.id || spec.name || fallbackId;
  const dispatches = scenarioDispatches(spec);
  const missingRoles = [];
  const inherited = [];
  const kernels = [];
  const packets = [];
  const hooks = [];
  const unavailableRoles = [];
  let parentHistoryIncluded = false;
  const packetValidations = [];
  const tierErrors = [];

  for (const [index, dispatch] of dispatches.entries()) {
    const item = dispatch && typeof dispatch === 'object' ? dispatch : { role: dispatch };
    const role = roleName(item.role || item.name);
    const contextTier = item.contextTier || spec.contextTier || 'cold';
    if (!CONTEXT_TIERS.includes(contextTier)) tierErrors.push({ code: 'INVALID_CONTEXT_TIER', role, value: contextTier, scenario: id });
    if (contextTier === 'full' && !String(item.reason || spec.reason || '').trim()) {
      tierErrors.push({
        code: 'FULL_CONTEXT_REASON_REQUIRED',
        message: `scenario '${id}' requires a reason for full context inheritance`,
        scenario: id,
        role,
      });
    }
    const developer = role && developerByRole.get(role);
    const availability = item.availability || null;
    if (role && !developer) {
      if (availability === 'capability-gated') {
        unavailableRoles.push({ code: 'ROLE_NOT_CONFIGURED', role, status: 'NOT_CONFIGURED' });
      } else {
        missingRoles.push({ code: 'MISSING_SELECTED_DEVELOPER_INSTRUCTIONS', role });
      }
    }
    kernels.push(developer ? developer : zeroMeasurement(`${id}-kernel-${index + 1}`, 'developer-instructions', {
      provenance: { kind: 'unavailable-role', role, availability },
    }));

    const requestedInherited = item.inheritedContext !== undefined
      ? item.inheritedContext
      : spec.inheritedContext !== undefined ? spec.inheritedContext : inheritedDefault;
    const includeHistory = contextTier !== 'cold' && contextTier !== 'inline';
    if (includeHistory) parentHistoryIncluded = true;
    inherited.push(makeMeasurement({
      id: `${id}-inherited-${index + 1}`,
      kind: 'inherited-context',
      value: includeHistory ? requestedInherited : '',
      surface: 'orchestration',
      runtime: 'agent-dispatch',
      loadPhase: 'conditional',
      source: 'parent-history',
      provenance: { kind: 'inherited-context', contextTier },
    }));

    const packet = item.dispatchPacket !== undefined
      ? item.dispatchPacket
      : spec.dispatchPacket !== undefined ? spec.dispatchPacket : packetDefault;
    packetValidations.push(validateDispatchPacket(packet, { required: contextTier !== 'inline' }));
    packets.push(measureDispatchPacket(packet, { id: `${id}-packet-${index + 1}`, provenance: { contextTier } }));
    const hook = item.warmstartOutput !== undefined
      ? item.warmstartOutput
      : spec.warmstartOutput !== undefined ? spec.warmstartOutput : warmstartDefault;
    hooks.push(measureWarmstartOutput(hook, { id: `${id}-hook-${index + 1}`, provenance: { contextTier } }));
  }

  const inheritedTotals = sumMeasurements(inherited);
  const kernelTotals = sumMeasurements(kernels);
  const packetTotals = sumMeasurements(packets);
  const hookTotals = sumMeasurements(hooks);
  const marginal = addMeasurementTotals(inheritedTotals, kernelTotals, packetTotals, hookTotals);
  const firstTier = dispatches.length
    ? (dispatches[0].contextTier || spec.contextTier || 'cold')
    : (spec.contextTier || 'inline');
  const configurationErrors = [];
  if (firstTier !== 'inline' && !CONTEXT_TIERS.includes(firstTier)) {
    configurationErrors.push({
      code: 'INVALID_CONTEXT_TIER',
      message: `scenario '${id}' has unsupported context tier '${firstTier}'`,
      scenario: id,
      value: firstTier,
    });
  }
  if (firstTier === 'full' && !dispatches.length && !String(spec.reason || '').trim()) {
    configurationErrors.push({
      code: 'FULL_CONTEXT_REASON_REQUIRED',
      message: `scenario '${id}' requires a reason for full context inheritance`,
      scenario: id,
    });
  }
  configurationErrors.push(...tierErrors, ...packetValidations.filter((validation) => !validation.ok).map((validation) => ({
    code: validation.code,
    message: `scenario '${id}': ${validation.message}`,
    scenario: id,
    missing: validation.missing,
  })));
  return {
    id,
    contextTier: firstTier,
    dispatchCount: dispatches.length,
    parentHistoryIncluded,
    inherited_context: inheritedTotals,
    role_kernel: kernelTotals,
    packet: packetTotals,
    hook_context: hookTotals,
    marginal_cost: marginal,
    inherited_context_tokens: inheritedTotals.tokens,
    role_kernel_tokens: kernelTotals.tokens,
    packet_tokens: packetTotals.tokens,
    hook_context_tokens: hookTotals.tokens,
    marginal_cost_tokens: marginal.tokens,
    marginalCost: marginal.tokens,
    totals: marginal,
    packetValidation: packetValidations,
    missingRoles,
    unavailableRoles,
    configurationErrors,
  };
}

function defaultPacket(dispatchPacket) {
  return dispatchPacket !== undefined
    ? dispatchPacket
    : 'goal non-goals owned files interfaces invariants constraints verification acceptance task attempt identity evidence pointers';
}

function inspectSubagentContext({
  root = DEFAULT_ROOT,
  roles = null,
  selectedRoles = null,
  readDescription = null,
  readDeveloperInstructions = null,
  developerInstructions = null,
  dispatchPacket = undefined,
  warmstartOutput = '',
  scenarios = null,
  contextTier = null,
  reason = null,
  runtimeObserved = null,
  inheritedContext = '',
} = {}) {
  const rootPath = path.resolve(root);
  const roleDescriptions = measureRoleDescriptions({ root: rootPath, roles, readDescription });
  const developer = developerInstructions
    ? measureDeveloperInstructions({ root: rootPath, selectedRoles, roles: developerInstructions, readDeveloperInstructions })
    : measureDeveloperInstructions({ root: rootPath, selectedRoles, readDeveloperInstructions });
  const packet = measureDispatchPacket(defaultPacket(dispatchPacket));
  const packetValidation = validateDispatchPacket(defaultPacket(dispatchPacket), { required: dispatchPacket !== undefined });
  const warmstart = measureWarmstartOutput(warmstartOutput);
  const specs = scenarios || (contextTier
    ? [{ id: 'requested-scenario', contextTier, reason, roles: selectedRoles || [] }]
    : DEFAULT_SCENARIOS);
  const developerByRole = new Map(developer.entries.map((entry) => [entry.id, entry]));
  const scenarioReports = specs.map((scenario, index) => inspectScenario(
    scenario,
    developerByRole,
    inheritedContext,
    defaultPacket(dispatchPacket),
    warmstartOutput,
    `scenario-${index + 1}`,
  ));
  const configurationErrors = [
    ...roleDescriptions.diagnostics,
    ...developer.diagnostics,
    ...(packetValidation.ok ? [] : [{
      code: packetValidation.code,
      message: packetValidation.message,
      missing: packetValidation.missing,
    }]),
    ...scenarioReports.flatMap((scenario) => [
      ...scenario.configurationErrors,
      ...scenario.missingRoles,
    ]),
  ];
  const scenarioTotals = scenarioReports.reduce((output, scenario) => {
    output[scenario.id] = clone(scenario.marginal_cost);
    return output;
  }, {});
  const roleSpawnIncrement = addMeasurementTotals(developer.totals, packet);
  const staticTotals = addMeasurementTotals(roleDescriptions.totals, developer.totals, packet, warmstart);
  const staticReport = {
    basis: 'static-estimate',
    roleDescriptions,
    roleDescriptionCatalog: roleDescriptions,
    developerInstructions: developer,
    selectedDeveloperKernels: developer,
    dispatchPacket: packet,
    packetValidation,
    warmstartOutput: warmstart,
    scenarios: scenarioReports,
    scenarioTotals,
    baseline: {
      always_loaded: clone(roleDescriptions.totals),
      conditional_increment: clone(developer.totals),
      role_spawn_increment: clone(roleSpawnIncrement),
      hook_output_budget: clone(warmstart),
    },
    totals: {
      ...staticTotals,
      roleDescriptions: clone(roleDescriptions.totals),
      developerInstructions: clone(developer.totals),
      dispatchPacket: clone(packet),
      warmstartOutput: clone(warmstart),
      scenarioTotals,
    },
  };
  const observedReport = normalizeRuntimeObserved(runtimeObserved);
  return {
    schema: SCHEMA,
    estimator: ESTIMATOR,
    static: staticReport,
    staticEstimate: staticReport,
    runtimeObserved: observedReport,
    runtime_observed: observedReport,
    configurationErrors,
    ok: configurationErrors.length === 0,
  };
}

function renderBudgetReport(report) {
  const lines = [
    `role descriptions: ${report.static.roleDescriptions.totals.entries} entries, ${report.static.roleDescriptions.totals.tokens} estimated tokens`,
    `selected developer instructions: ${report.static.developerInstructions.totals.entries} entries, ${report.static.developerInstructions.totals.tokens} estimated tokens`,
    `dispatch packet: ${report.static.dispatchPacket.tokens} estimated tokens`,
    `warmstart output: ${report.static.warmstartOutput.tokens} estimated tokens`,
  ];
  for (const scenario of report.static.scenarios) {
    lines.push(`scenario ${scenario.id}: ${scenario.marginal_cost.tokens} estimated tokens (marginal_cost = inherited_context + role_kernel + packet + hook_context)`);
  }
  lines.push(`runtime observed: ${report.runtimeObserved.status}`);
  for (const error of report.configurationErrors || []) lines.push(`FAIL configuration: ${error.code}: ${error.message}`);
  return `${lines.join('\n')}\n`;
}

function main(argv = process.argv.slice(2)) {
  const report = inspectSubagentContext({ root: DEFAULT_ROOT });
  process.stdout.write(renderBudgetReport(report));
  if (argv.includes('--json')) process.stdout.write(`${JSON.stringify(report)}\n`);
  return report.ok ? 0 : 1;
}

if (require.main === module) process.exit(main());

module.exports = {
  SCHEMA,
  ESTIMATOR,
  LOAD_PHASES,
  CONTEXT_TIERS,
  PACKET_PARTS,
  DEFAULT_SCENARIOS,
  measureText,
  counts: measureText,
  measureRoleDescriptions,
  measureDeveloperInstructions,
  measureDispatchPacket,
  measureWarmstartOutput,
  validateDispatchPacket,
  normalizeRuntimeObserved,
  inspectSubagentContext,
  inspectSubagentContextBudget: inspectSubagentContext,
  buildContextLedger: inspectSubagentContext,
  renderBudgetReport,
};
