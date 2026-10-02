'use strict';
// dhpk:read-only-planner (enforced by scripts/ci/validate-js-guardrails.js)

// Read-only one-time cutover preflight for the official Codex plugin.
// It observes historical schema-3 Codex installer receipts and the shared
// project projection receipt, proposes (never performs) removal of proven
// unchanged obsolete Codex entries, and binds every observation so a later
// executor can revalidate before mutating. Supplied consumer sources are
// observations, not an authoritative discovery adapter. Nothing here writes,
// recovers, installs, or activates; CURRENT is never activation approval.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { canonicalJson, sha256 } = require('./receipt-primitives');
const { cloneBoundedJson, immutableJson } = require('./receipt-json-primitives');
const { readProjectProjectionReceipt } = require('./project-agent-projection-publisher');
const { boundStableIds } = require('./project-agent-host-binding-policy');

const PLAN_SCHEMA = 'dhpk.marketplace-cutover-plan.v1';
const HISTORICAL_SCHEMA_VERSION = 3;
const CODEX_ROOT = '.codex';
const CODEX_SKILLS = '.codex/skills';
const HISTORICAL_RECEIPT = '.codex/.dhpk-installed.json';
const SHARED_TRANSACTION = '.dhpk-installed.transaction.json';
const JOURNAL_PREFIX = '.dhpk-transaction-';
const JOURNAL_NAME = /^\.dhpk-transaction-(\d{8}T\d{6}Z-\d+)\.json$/;
const TERMINAL_JOURNAL_PHASES = Object.freeze(['committed', 'rolled_back']);
const SAFE_NAME = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const CANDIDATE = /^(?:sha256:)?[a-f0-9]{64}$/;
const ENUMERATION_STATES = Object.freeze(['COMPLETE', 'NOT_RUN', 'BLOCKED']);
const SOURCE_KINDS = Object.freeze(['project', 'ancestor', 'user', 'plugin']);
const MAX_TREE_ENTRIES = 20000;
const MAX_RECEIPT_BYTES = 1024 * 1024;
const MAX_TREE_FILE_BYTES = 32 * 1024 * 1024;
// One byte budget shared by every tree hash in a single plan call.
const MAX_TOTAL_HASH_BYTES = 256 * 1024 * 1024;
const MAX_DIR_ENTRIES = 4096;
const MAX_JOURNAL_FILES = 256;
const READ_CHUNK_BYTES = 65536;
// Never follows a link and never blocks on a FIFO while opening.
const OPEN_FLAGS = fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK;
const LIMITS = Object.freeze({
  maxNodes: 500000,
  maxDepth: 32,
  maxStringBytes: 65536,
  maxTotalBytes: 32 * 1024 * 1024,
  maxKeys: 20000,
  maxArrayKeys: 100001,
  maxKeyBytes: 4096,
  maxArrayLength: 100000,
});
const DRIFT_SECTIONS = Object.freeze([
  ['state', 'STATE_DRIFT'],
  ['context', 'CONTEXT_DRIFT'],
  ['binding', 'BINDING_DRIFT'],
  ['receipts', 'RECEIPT_DRIFT'],
  ['observations', 'OBSERVATION_DRIFT'],
  ['actions', 'ACTION_DRIFT'],
  ['conflicts', 'CONFLICT_DRIFT'],
  ['retainedHostDependencies', 'RETAINED_DEPENDENCY_DRIFT'],
  ['recovery', 'RECOVERY_DRIFT'],
]);
const EMPTY = Object.freeze({
  conflicts: [], actions: [], observations: [], receipts: [], recovery: [], retained: [], claimed: [], unverified: [],
});

// Per-call accounting (planning is synchronous, so one slot is never shared).
let current = { hashed: 0, limits: new Set() };

function compare(left, right) {
  if (left < right) return -1;
  return left > right ? 1 : 0;
}

function byKeys(...keys) {
  return (left, right) => {
    for (const key of keys) {
      const order = compare(String(left[key] ?? ''), String(right[key] ?? ''));
      if (order !== 0) return order;
    }
    return 0;
  };
}

function merge(...parts) {
  return Object.fromEntries(Object.keys(EMPTY).map((key) => [
    key, parts.flatMap((part) => (part && part[key]) || []),
  ]));
}

function conflict(code, relative, stableId = null, detail = null) {
  return { code, path: relative, stableId, detail };
}

function preserve(relative, stableId, reason) {
  return { kind: 'preserve', path: relative, stableId, reason };
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function safeRelative(relative) {
  return typeof relative === 'string' && relative !== '' && !relative.includes('\0')
    && !relative.includes('\\') && !path.posix.isAbsolute(relative)
    && relative.split('/').every((part) => part !== '' && part !== '.' && part !== '..');
}

function lstat(absolute) {
  try {
    return fs.lstatSync(absolute, { bigint: true });
  } catch (error) {
    if (error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) return null;
    throw error;
  }
}

function nodeType(stat) {
  if (!stat) return 'missing';
  if (stat.isSymbolicLink()) return 'symlink';
  if (stat.isFile()) return 'file';
  return stat.isDirectory() ? 'directory' : 'special';
}

function failure(reason) {
  return Object.assign(new Error(reason), { reason });
}

function tripLimit(reason) {
  current.limits.add(reason);
  return failure(reason);
}

function listDirectory(directory) {
  const names = fs.readdirSync(directory);
  if (names.length > MAX_DIR_ENTRIES) throw tripLimit('DIR_LIMIT');
  return names.sort(compare);
}

// Opens the observed path without following links, proves the descriptor is the
// same regular file the lstat saw (a swap after lstat is rejected), and hands
// bounded chunks to the consumer. Failures carry a path-free reason.
function readRegularFile(absolute, observed, limit, onChunk) {
  let fd;
  try {
    fd = fs.openSync(absolute, OPEN_FLAGS);
    const stat = fs.fstatSync(fd, { bigint: true });
    if (!stat.isFile() || stat.dev !== observed.dev || stat.ino !== observed.ino) throw failure('SWAPPED');
    if (stat.size > BigInt(limit)) throw failure('FILE_TOO_LARGE');
    const buffer = Buffer.allocUnsafe(READ_CHUNK_BYTES);
    let total = 0;
    for (;;) {
      const count = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (count === 0) return total;
      total += count;
      if (total > limit) throw failure('FILE_TOO_LARGE');
      onChunk(buffer.subarray(0, count));
    }
  } catch (error) {
    if (error && error.reason) throw error;
    throw failure(error && error.code === 'ELOOP' ? 'SWAPPED' : 'UNREADABLE');
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch (_) { /* descriptor already released */ }
    }
  }
}

// Reproduces the retired installer's COMPLETE hash_path view (bytecode cache
// included) without following any link and without opening special files.
function historicalTreeHash(absolute) {
  const physical = [];
  const walk = (location, relative) => {
    if (physical.length >= MAX_TREE_ENTRIES) throw tripLimit('TREE_LIMIT');
    const stat = fs.lstatSync(location, { bigint: true });
    const type = nodeType(stat);
    physical.push([relative, type, String(stat.dev), String(stat.ino), String(stat.mode), String(stat.size)]);
    if (type === 'symlink') throw Object.assign(new Error('nested link'), { reason: 'NESTED_LINK' });
    if (type === 'special') throw Object.assign(new Error('special file'), { reason: 'SPECIAL_FILE' });
    const digest = crypto.createHash('sha256');
    if (type === 'file') {
      digest.update('file\0');
      readRegularFile(location, stat, MAX_TREE_FILE_BYTES, (chunk) => {
        current.hashed += chunk.length;
        if (current.hashed > MAX_TOTAL_HASH_BYTES) throw tripLimit('HASH_BUDGET');
        digest.update(chunk);
      });
      return digest.digest('hex');
    }
    digest.update('dir\0');
    for (const name of listDirectory(location)) {
      digest.update(name);
      digest.update('\0');
      digest.update(walk(path.join(location, name), relative ? `${relative}/${name}` : name));
      digest.update('\0');
    }
    return digest.digest('hex');
  };
  try {
    const hash = walk(absolute, '');
    return { ok: true, hash, physicalFingerprint: sha256(canonicalJson(physical)) };
  } catch (error) {
    return { ok: false, reason: error.reason || 'UNREADABLE', physicalFingerprint: sha256(canonicalJson(physical)) };
  }
}

function observe(projectRoot, relative, { content = false, classification = null } = {}) {
  const absolute = path.join(projectRoot, relative);
  const stat = lstat(absolute);
  const type = nodeType(stat);
  const observation = { path: relative, type, classification };
  if (!stat) return { observation, absolute };
  Object.assign(observation, { dev: String(stat.dev), ino: String(stat.ino), mode: String(stat.mode), size: String(stat.size) });
  if (type === 'symlink') observation.linkTarget = fs.readlinkSync(absolute);
  let tree = null;
  if (content && (type === 'file' || type === 'directory')) {
    tree = historicalTreeHash(absolute);
    observation.contentFingerprint = tree.ok ? tree.hash : null;
    observation.physicalFingerprint = tree.physicalFingerprint;
    if (!tree.ok) observation.reason = tree.reason;
  }
  return { observation, absolute, tree };
}

function physicalDirectoryConflict(projectRoot, relative) {
  const stat = lstat(path.join(projectRoot, relative));
  if (!stat) return { exists: false, conflict: null, observation: { path: relative, type: 'missing', classification: null } };
  const type = nodeType(stat);
  const observation = { path: relative, type, classification: null, dev: String(stat.dev), ino: String(stat.ino), mode: String(stat.mode) };
  if (type !== 'directory') return { exists: true, conflict: conflict('UNSAFE_PATH', relative, null, `not a physical directory (${type})`), observation };
  return { exists: true, conflict: null, observation };
}

function rawFile(projectRoot, relative) {
  const absolute = path.join(projectRoot, relative);
  const stat = lstat(absolute);
  if (!stat) return { present: false, type: 'missing' };
  const type = nodeType(stat);
  if (type !== 'file') return { present: true, type };
  const chunks = [];
  try {
    readRegularFile(absolute, stat, MAX_RECEIPT_BYTES, (chunk) => chunks.push(Buffer.from(chunk)));
  } catch (error) {
    if (error.reason === 'FILE_TOO_LARGE') return { present: true, type, oversized: true, dev: String(stat.dev), ino: String(stat.ino) };
    return { present: true, type: error.reason === 'SWAPPED' ? 'swapped' : 'unreadable' };
  }
  const bytes = Buffer.concat(chunks);
  return { present: true, type, bytes, rawFingerprint: sha256(bytes), dev: String(stat.dev), ino: String(stat.ino) };
}

function receiptRecord(kind, relative, raw, schema = null) {
  return {
    kind,
    path: relative,
    present: raw.present,
    type: raw.type,
    rawFingerprint: raw.rawFingerprint || null,
    dev: raw.dev || null,
    ino: raw.ino || null,
    schema,
  };
}

function identityIndex(inventory) {
  const byName = new Map();
  const add = (name, record) => {
    if (!nonEmptyString(name) || !nonEmptyString(record.stableId)) return;
    byName.set(name, [...(byName.get(name) || []), record]);
  };
  const skills = Array.isArray(inventory.skills) ? inventory.skills : [];
  const ids = new Set(skills.filter((skill) => isPlainObject(skill) && nonEmptyString(skill.id)).map((skill) => skill.id));
  skills.filter(isPlainObject).forEach((skill) => add(skill.name, { stableId: skill.id, kind: 'current' }));
  (Array.isArray(inventory.renamed_skill_names) ? inventory.renamed_skill_names : []).filter(isPlainObject)
    .forEach((entry) => add(entry.oldName, { stableId: entry.id, kind: 'renamed', oldName: entry.oldName, newName: entry.newName }));
  (Array.isArray(inventory.retired_skills) ? inventory.retired_skills : []).filter(isPlainObject)
    .forEach((entry) => add(entry.name, {
      stableId: entry.id,
      kind: 'retired',
      reasonCode: entry.reasonCode || null,
      replacements: (Array.isArray(entry.replacements) ? entry.replacements : []).filter(isPlainObject)
        .map((replacement) => ({ kind: replacement.kind || null, id: replacement.id || null, mode: replacement.mode || null })),
    }));
  return { byName, ids };
}

function resolveIdentity(index, name, recordedId) {
  const records = index.byName.get(name) || [];
  const stableIds = [...new Set(records.map((record) => record.stableId))];
  if (stableIds.length === 0) return { code: 'IDENTITY_UNKNOWN' };
  if (stableIds.length > 1) return { code: 'IDENTITY_AMBIGUOUS' };
  if (recordedId !== undefined && recordedId !== null && recordedId !== stableIds[0]) return { code: 'IDENTITY_MISMATCH' };
  const record = records.find((entry) => entry.kind === 'retired')
    || records.find((entry) => entry.kind === 'renamed') || records[0];
  return { record };
}

function guidanceFor(record) {
  if (record.kind === 'retired') {
    return { kind: 'retired', stableId: record.stableId, reasonCode: record.reasonCode, replacements: record.replacements };
  }
  if (record.kind === 'renamed') {
    return { kind: 'renamed', stableId: record.stableId, oldName: record.oldName, newName: record.newName };
  }
  return { kind: 'successor', stableId: record.stableId, source: 'official-plugin' };
}

function removable(record, selected) {
  return record.kind === 'retired' || selected.includes(record.stableId);
}

function normalizeContext(context) {
  if (!isPlainObject(context)) return { context: null, conflict: conflict('CONTEXT_INVALID', null, null, 'context must be an object') };
  const incomplete = context.host !== 'codex' || !nonEmptyString(context.consumerVersion) || !nonEmptyString(context.sessionId)
    || !ENUMERATION_STATES.includes(context.enumerationState) || context.enumerationState !== 'COMPLETE';
  const sources = Array.isArray(context.sources) ? context.sources : null;
  const sourceIds = new Set();
  const validSource = (source) => isPlainObject(source) && nonEmptyString(source.sourceId) && !sourceIds.has(source.sourceId)
    && sourceIds.add(source.sourceId) && SOURCE_KINDS.includes(source.kind) && typeof source.root === 'string'
    && path.isAbsolute(source.root) && typeof source.enabled === 'boolean' && Array.isArray(source.entries)
    && source.entries.every((entry) => isPlainObject(entry) && nonEmptyString(entry.name) && typeof entry.path === 'string'
      && path.isAbsolute(entry.path) && (entry.stableId === null || entry.stableId === undefined || nonEmptyString(entry.stableId)));
  const sourcesValid = Boolean(sources) && sources.every(validSource);
  const normalized = {
    host: context.host ?? null,
    consumerVersion: context.consumerVersion ?? null,
    sessionId: context.sessionId ?? null,
    enumerationState: context.enumerationState ?? null,
    sources: sourcesValid ? sources.map((source) => ({
      sourceId: source.sourceId,
      kind: source.kind,
      root: source.root,
      enabled: source.enabled,
      entries: source.entries.map((entry) => ({ stableId: entry.stableId ?? null, name: entry.name, path: entry.path }))
        .sort(byKeys('path', 'name', 'stableId')),
    })).sort(byKeys('sourceId')) : null,
  };
  if (!sourcesValid) return { context: normalized, conflict: conflict('CONTEXT_INVALID', null, null, 'context sources are invalid') };
  if (incomplete) return { context: normalized, conflict: conflict('CONTEXT_INCOMPLETE', null, null, 'Codex consumer context must be fully enumerated') };
  return { context: normalized, conflict: null, complete: true };
}

function cloneJson(value) {
  try {
    return { ok: true, value: cloneBoundedJson(value, { limits: LIMITS }) };
  } catch (error) {
    return { ok: false, reason: error.reason || error.message };
  }
}

function projectRootConflict(projectRoot) {
  if (typeof projectRoot !== 'string' || !path.isAbsolute(projectRoot) || path.resolve(projectRoot) !== projectRoot) {
    return conflict('INPUT_INVALID', null, null, 'projectRoot must be a normalized absolute path');
  }
  const stat = lstat(projectRoot);
  if (!stat || nodeType(stat) !== 'directory' || fs.realpathSync(projectRoot) !== projectRoot) {
    return conflict('UNSAFE_PATH', '.', null, 'projectRoot must be a physical directory without symlinked ancestors');
  }
  return null;
}

function normalizeInput(input) {
  const candidateInput = isPlainObject(input) ? input : {};
  const inventoryClone = cloneJson(candidateInput.inventory);
  const contextClone = cloneJson(candidateInput.context);
  const inventory = inventoryClone.ok && isPlainObject(inventoryClone.value) ? inventoryClone.value : null;
  const config = inventory && isPlainObject(inventory.project_agent_projection) ? inventory.project_agent_projection : null;
  const index = inventory ? identityIndex(inventory) : null;
  const rawSelected = Array.isArray(candidateInput.selectedStableIds) ? candidateInput.selectedStableIds : null;
  const selected = rawSelected && rawSelected.every(nonEmptyString) ? [...new Set(rawSelected)].sort(compare) : null;
  const candidate = typeof candidateInput.candidateArtifactFingerprint === 'string'
    && CANDIDATE.test(candidateInput.candidateArtifactFingerprint) ? candidateInput.candidateArtifactFingerprint : null;
  const conflicts = [];
  const rootConflict = projectRootConflict(candidateInput.projectRoot);
  if (rootConflict) conflicts.push(rootConflict);
  if (!inventory || !config || !safeRelative(config.managed_root) || !safeRelative(config.receipt)) {
    conflicts.push(conflict('INPUT_INVALID', null, null, 'inventory with a safe project_agent_projection is required'));
  }
  if (!selected || selected.length === 0) conflicts.push(conflict('INPUT_INVALID', null, null, 'selectedStableIds must be non-empty strings'));
  else if (index) selected.filter((id) => !index.ids.has(id)).forEach((id) => conflicts.push(conflict('SELECTION_UNKNOWN', null, id, null)));
  if (!candidate) conflicts.push(conflict('INPUT_INVALID', null, null, 'candidateArtifactFingerprint must be a SHA-256 digest'));
  const contextResult = contextClone.ok ? normalizeContext(contextClone.value) : { context: null, conflict: conflict('CONTEXT_INVALID', null, null, contextClone.reason) };
  if (contextResult.conflict) conflicts.push(contextResult.conflict);
  return {
    projectRoot: rootConflict ? null : candidateInput.projectRoot,
    config,
    index,
    selected: selected || [],
    context: contextResult.context,
    contextComplete: Boolean(contextResult.complete),
    binding: {
      inventoryFingerprint: inventory ? sha256(canonicalJson(inventory)) : null,
      selectedStableIds: selected || [],
      candidateArtifactFingerprint: candidate,
    },
    ready: !rootConflict && Boolean(config && index && safeRelative(config.managed_root) && safeRelative(config.receipt)),
    conflicts,
  };
}

function classifyJournal(projectRoot, name) {
  const relative = `${CODEX_ROOT}/${name}`;
  const raw = rawFile(projectRoot, relative);
  const receipt = receiptRecord('codex-journal', relative, raw);
  const fail = (reason) => ({ receipts: [receipt], recovery: [{ path: relative, reason }] });
  if (raw.type !== 'file') return fail('JOURNAL_NOT_REGULAR');
  if (raw.oversized) return fail('JOURNAL_TOO_LARGE');
  const match = JOURNAL_NAME.exec(name);
  if (!match) return fail('JOURNAL_UNBOUND_NAME');
  let journal;
  try {
    journal = JSON.parse(raw.bytes.toString('utf8'));
  } catch (_) {
    return fail('JOURNAL_MALFORMED');
  }
  if (!isPlainObject(journal) || journal.relative !== name || journal.run !== match[1]) return fail('JOURNAL_UNBOUND');
  if (!TERMINAL_JOURNAL_PHASES.includes(journal.phase)) return fail('JOURNAL_NONTERMINAL');
  return { receipts: [receipt] };
}

function readHistoricalReceipt(projectRoot) {
  const raw = rawFile(projectRoot, HISTORICAL_RECEIPT);
  if (!raw.present) return { result: { receipts: [receiptRecord('codex-historical', HISTORICAL_RECEIPT, raw)] }, receipt: null, absent: true };
  if (raw.type !== 'file') {
    return { result: { receipts: [receiptRecord('codex-historical', HISTORICAL_RECEIPT, raw)], conflicts: [conflict('UNSAFE_PATH', HISTORICAL_RECEIPT, null, raw.type)] }, receipt: null };
  }
  if (raw.oversized) {
    return { result: { receipts: [receiptRecord('codex-historical', HISTORICAL_RECEIPT, raw)], conflicts: [conflict('INPUT_LIMIT_EXCEEDED', HISTORICAL_RECEIPT, null, 'receipt exceeds the size cap')] }, receipt: null };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw.bytes.toString('utf8'));
  } catch (_) {
    parsed = undefined;
  }
  const bounded = parsed === undefined ? null : cloneJson(parsed);
  if (bounded && !bounded.ok) {
    return { result: { receipts: [receiptRecord('codex-historical', HISTORICAL_RECEIPT, raw)], conflicts: [conflict('INPUT_LIMIT_EXCEEDED', HISTORICAL_RECEIPT, null, bounded.reason)] }, receipt: null };
  }
  if (bounded) parsed = bounded.value;
  const schema = isPlainObject(parsed) && Number.isSafeInteger(parsed.schema_version) ? parsed.schema_version : null;
  const receipts = [receiptRecord('codex-historical', HISTORICAL_RECEIPT, raw, schema)];
  if (!isPlainObject(parsed)) return { result: { receipts, conflicts: [conflict('RECEIPT_MALFORMED', HISTORICAL_RECEIPT)] }, receipt: null };
  if (parsed.schema_version !== HISTORICAL_SCHEMA_VERSION) {
    return { result: { receipts, conflicts: [conflict('RECEIPT_UNSUPPORTED', HISTORICAL_RECEIPT, null, `schema_version ${schema}`)] }, receipt: null };
  }
  const managed = parsed.managed_entries;
  if (!isPlainObject(managed) || (managed.skills !== undefined && !isPlainObject(managed.skills))) {
    return { result: { receipts, conflicts: [conflict('RECEIPT_MALFORMED', HISTORICAL_RECEIPT, null, 'managed_entries')] }, receipt: null };
  }
  const recovery = parsed.transaction_final === false ? [{ path: HISTORICAL_RECEIPT, reason: 'RECEIPT_NOT_FINAL' }] : [];
  return { result: { receipts, recovery }, receipt: parsed };
}

function ownershipState(entry, relative, observed) {
  const { observation, tree } = observed;
  if (!['copy', 'symlink'].includes(entry.mode) || entry.ownership_marker !== `${entry.mode}:${relative}` || entry.orphaned) {
    return 'OWNERSHIP_UNPROVEN';
  }
  if (entry.mode === 'symlink') {
    if (observation.type !== 'symlink') return 'MODIFIED_MANAGED';
    if (typeof entry.destination_target !== 'string') return 'OWNERSHIP_UNPROVEN';
    return observation.linkTarget === entry.destination_target ? 'OWNED' : 'RETARGETED_MANAGED';
  }
  if (observation.type === 'symlink') return 'MODIFIED_MANAGED';
  if (!tree || !tree.ok) return 'OWNERSHIP_UNPROVEN';
  const recorded = entry.destination_fingerprint || entry.fingerprint;
  if (typeof recorded !== 'string' || !DIGEST.test(recorded)) return 'OWNERSHIP_UNPROVEN';
  return tree.hash === recorded ? 'OWNED' : 'MODIFIED_MANAGED';
}

function classifyHistoricalEntry(n, key, entry) {
  const relative = isPlainObject(entry) ? (entry.source || entry.destination) : null;
  if (!SAFE_NAME.test(key) || relative !== `skills/${key}`) {
    return { conflicts: [conflict('UNSAFE_PATH', null, null, 'historical receipt entry path is not a contained skills/<name>')] };
  }
  const destination = `${CODEX_SKILLS}/${key}`;
  const observed = observe(n.projectRoot, destination, { content: entry.mode !== 'symlink' });
  const exists = observed.observation.type !== 'missing';
  const blocked = (code, stableId = null) => ({
    observations: [observed.observation],
    conflicts: exists ? [conflict(code, destination, stableId)] : [],
    actions: exists ? [preserve(destination, stableId, code)] : [],
  });
  const identity = resolveIdentity(n.index, key, entry.id);
  if (identity.code) return blocked(identity.code);
  const stableId = identity.record.stableId;
  if (!exists) return { observations: [observed.observation] };
  const state = ownershipState(entry, relative, observed);
  if (state !== 'OWNED') return blocked(state, stableId);
  if (!removable(identity.record, n.selected)) return { observations: [{ ...observed.observation, classification: 'NOT_SELECTED_RETAINED' }] };
  const ownership = entry.mode === 'symlink'
    ? { receipt: HISTORICAL_RECEIPT, marker: entry.ownership_marker, linkTarget: entry.destination_target }
    : { receipt: HISTORICAL_RECEIPT, marker: entry.ownership_marker, fingerprint: observed.tree.hash };
  return {
    observations: [{ ...observed.observation, classification: 'OWNED_UNCHANGED' }],
    actions: [{ kind: entry.mode === 'symlink' ? 'remove-link' : 'remove-owned-entry', path: destination, stableId, ownership, guidance: guidanceFor(identity.record) }],
  };
}

function scanUnclaimed(n, claimed) {
  const directory = path.join(n.projectRoot, CODEX_SKILLS);
  const names = lstat(directory) ? listDirectory(directory) : [];
  return merge(...names.filter((name) => !claimed.has(name)).map((name) => {
    const relative = `${CODEX_SKILLS}/${name}`;
    const identity = resolveIdentity(n.index, name, null);
    const competing = identity.record && removable(identity.record, n.selected);
    const { observation } = observe(n.projectRoot, relative, { content: competing });
    if (!competing) return { observations: [{ ...observation, classification: 'FOREIGN_UNRELATED' }] };
    const stableId = identity.record.stableId;
    return {
      observations: [{ ...observation, classification: 'UNOWNED' }],
      conflicts: [conflict('UNOWNED_COLLISION', relative, stableId)],
      actions: [preserve(relative, stableId, 'UNOWNED_COLLISION')],
    };
  }));
}

function listJournals(n) {
  const names = listDirectory(path.join(n.projectRoot, CODEX_ROOT)).filter((name) => name.startsWith(JOURNAL_PREFIX));
  if (names.length > MAX_JOURNAL_FILES) throw tripLimit('JOURNAL_LIMIT');
  return merge(...names.map((name) => classifyJournal(n.projectRoot, name)));
}

function inspectReceiptEntries(n, projectionClaims, skills) {
  const { result, receipt, absent } = readHistoricalReceipt(n.projectRoot);
  if (skills.conflict || (!absent && !receipt)) return result;
  if (absent) return merge(result, skills.exists ? guarded(() => scanUnclaimed(n, projectionClaims), 'historical-scan') : null);
  const entries = isPlainObject(receipt.managed_entries.skills) ? receipt.managed_entries.skills : {};
  const orphaned = isPlainObject(receipt.orphaned_entries) && isPlainObject(receipt.orphaned_entries.skills) ? receipt.orphaned_entries.skills : {};
  const keys = Object.keys(entries).sort(compare);
  const doubleClaims = keys.filter((key) => projectionClaims.has(key));
  const classified = keys.filter((key) => !projectionClaims.has(key)).map((key) => classifyHistoricalEntry(n, key, entries[key]));
  const orphanResults = Object.keys(orphaned).sort(compare).filter((key) => !Object.hasOwn(entries, key)).map((key) => (
    classifyHistoricalEntry(n, key, { ...(isPlainObject(orphaned[key]) ? orphaned[key] : {}), orphaned: true })));
  const doubles = doubleClaims.map((key) => ({
    conflicts: [conflict('OWNERSHIP_UNPROVEN', `${CODEX_SKILLS}/${key}`, null, 'claimed by two receipts')],
    actions: [preserve(`${CODEX_SKILLS}/${key}`, null, 'OWNERSHIP_UNPROVEN')],
  }));
  const claimed = new Set([...keys, ...Object.keys(orphaned), ...projectionClaims]);
  return merge(result, ...classified, ...orphanResults, ...doubles,
    skills.exists ? guarded(() => scanUnclaimed(n, claimed), 'historical-scan') : null);
}

// Each step is guarded separately so a late failure never erases the recovery
// findings (or preserve actions) already gathered by an earlier step.
function inspectHistorical(n, projectionClaims) {
  const codex = physicalDirectoryConflict(n.projectRoot, CODEX_ROOT);
  if (!codex.exists || codex.conflict) {
    return merge({ observations: [codex.observation], conflicts: codex.conflict ? [codex.conflict] : [] },
      { receipts: [receiptRecord('codex-historical', HISTORICAL_RECEIPT, { present: false, type: 'missing' })] });
  }
  const skills = physicalDirectoryConflict(n.projectRoot, CODEX_SKILLS);
  return merge({ observations: [codex.observation, skills.observation], conflicts: skills.conflict ? [skills.conflict] : [] },
    guarded(() => listJournals(n), 'historical-journals'),
    guarded(() => inspectReceiptEntries(n, projectionClaims, skills), 'historical-receipt'));
}

function sameJson(bytes, value) {
  try {
    return canonicalJson(JSON.parse(bytes.toString('utf8'))) === canonicalJson(value);
  } catch (_) {
    return false;
  }
}

function projectionRoots(n) {
  const managedRoot = path.join(n.projectRoot, n.config.managed_root);
  return {
    sourceRoot: null,
    projectRoot: n.projectRoot,
    agentsRoot: path.dirname(managedRoot),
    managedRoot,
    receiptPath: path.join(n.projectRoot, n.config.receipt),
    config: n.config,
  };
}

function codexBindingResults(n, receipt, entriesByName) {
  const binding = receipt.hostBindings.codex;
  if (!binding) return EMPTY;
  const ids = boundStableIds(binding).filter((id) => n.selected.includes(id));
  if (binding.bindingShape === 'direct') {
    return { conflicts: ids.map((id) => conflict('RETAINED_HOST_RELOCATION_REQUIRED', n.config.managed_root, id, 'Codex direct binding scans shared content')) };
  }
  return merge(...((receipt.bindingPaths || {}).codex || []).map((entry) => {
    const name = path.posix.basename(entry.path);
    const record = entriesByName.get(name);
    const stableId = record ? record.stableId : null;
    const { observation } = observe(n.projectRoot, entry.path);
    const claim = { claimed: entry.path.startsWith(`${CODEX_SKILLS}/`) ? [name] : [] };
    if (observation.type === 'missing') return { ...claim, observations: [observation] };
    const code = observation.type !== 'symlink' ? 'MODIFIED_MANAGED' : (observation.linkTarget === entry.target ? null : 'RETARGETED_MANAGED');
    if (code) return { ...claim, observations: [observation], conflicts: [conflict(code, entry.path, stableId)], actions: [preserve(entry.path, stableId, code)] };
    const identity = stableId ? { stableId, kind: 'current' } : null;
    if (!identity || !removable(identity, n.selected)) return { ...claim, observations: [{ ...observation, classification: 'NOT_SELECTED_RETAINED' }] };
    return {
      ...claim,
      observations: [{ ...observation, classification: 'OWNED_UNCHANGED' }],
      actions: [{ kind: 'remove-codex-binding', path: entry.path, stableId, ownership: { receipt: n.config.receipt, linkTarget: entry.target }, guidance: guidanceFor(identity) }],
    };
  }));
}

function retainedResults(n, receipt, entriesById) {
  return merge(...Object.keys(receipt.hostBindings).filter((host) => host !== 'codex').sort(compare).map((host) => {
    const bound = boundStableIds(receipt.hostBindings[host]);
    const stableIds = (bound.length === 0 && host === 'claude' ? [...entriesById.keys()] : bound).sort(compare);
    const sharedPaths = stableIds.filter((id) => entriesById.has(id))
      .map((id) => `${n.config.managed_root}/${entriesById.get(id).name}`).sort(compare);
    const bindingPaths = ((receipt.bindingPaths || {})[host] || []).map((entry) => entry.path).sort(compare);
    return {
      retained: [{ host, stableIds, sharedPaths, bindingPaths, receiptPath: n.config.receipt }],
      observations: [
        ...sharedPaths.map((relative) => observe(n.projectRoot, relative, { content: true, classification: 'RETAINED_SHARED' }).observation),
        ...bindingPaths.map((relative) => observe(n.projectRoot, relative, { classification: 'RETAINED_BINDING' }).observation),
      ],
    };
  }));
}

function inspectProjection(n) {
  const managedRelative = n.config.managed_root;
  const agentsRelative = path.posix.dirname(managedRelative);
  const directories = [agentsRelative, managedRelative].filter((relative) => relative !== '.').map((relative) => physicalDirectoryConflict(n.projectRoot, relative));
  const unsafe = directories.filter((entry) => entry.conflict);
  const base = { observations: directories.map((entry) => entry.observation), conflicts: unsafe.map((entry) => entry.conflict) };
  if (unsafe.length > 0) return base;
  const transactionRelative = agentsRelative === '.' ? SHARED_TRANSACTION : `${agentsRelative}/${SHARED_TRANSACTION}`;
  const transaction = rawFile(n.projectRoot, transactionRelative);
  const transactionResult = {
    receipts: [receiptRecord('project-transaction', transactionRelative, transaction)],
    recovery: transaction.present ? [{ path: transactionRelative, reason: 'SHARED_TRANSACTION_PRESENT' }] : [],
  };
  const raw = rawFile(n.projectRoot, n.config.receipt);
  const receiptBase = merge(base, transactionResult, { receipts: [receiptRecord('project-projection', n.config.receipt, raw)] });
  if (!raw.present) return receiptBase;
  if (raw.oversized || raw.type === 'swapped' || raw.type === 'unreadable') {
    return merge(receiptBase, { conflicts: [conflict('RECEIPT_INVALID', n.config.receipt, null, raw.oversized ? 'INPUT_LIMIT_EXCEEDED' : raw.type)] });
  }
  let receipt;
  try {
    receipt = readProjectProjectionReceipt(projectionRoots(n));
  } catch (error) {
    return merge(receiptBase, { conflicts: [conflict('RECEIPT_INVALID', n.config.receipt, null, error.projectionCode || 'INVALID_RECEIPT')] });
  }
  if (raw.type !== 'file' || !sameJson(raw.bytes, receipt)) {
    return merge(receiptBase, { conflicts: [conflict('RECEIPT_INVALID', n.config.receipt, null, 'RECEIPT_CHANGED_DURING_READ')] });
  }
  const entriesById = new Map(receipt.entries.map((entry) => [entry.stableId, entry]));
  const entriesByName = new Map(receipt.entries.map((entry) => [entry.name, entry]));
  return merge(receiptBase, codexBindingResults(n, receipt, entriesByName), retainedResults(n, receipt, entriesById));
}

function inside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function inspectSources(n, actions) {
  if (!n.contextComplete) return EMPTY;
  const removals = new Set(actions.filter((action) => action.kind !== 'preserve').map((action) => action.path));
  const managedRoot = path.join(n.projectRoot, n.config.managed_root);
  const pluginCounts = new Map();
  const results = n.context.sources.filter((source) => source.enabled).flatMap((source) => source.entries.map((entry) => {
    const identity = nonEmptyString(entry.stableId) ? { stableId: entry.stableId } : resolveIdentity(n.index, entry.name, null).record;
    if (!identity || !n.selected.includes(identity.stableId)) return null;
    if (source.kind === 'plugin') {
      pluginCounts.set(identity.stableId, [...(pluginCounts.get(identity.stableId) || []), entry.path]);
      return null;
    }
    const relative = inside(n.projectRoot, entry.path) ? path.relative(n.projectRoot, entry.path).split(path.sep).join('/') : null;
    if (relative !== null && removals.has(relative)) return null;
    const code = inside(managedRoot, entry.path) ? 'RETAINED_HOST_RELOCATION_REQUIRED' : 'DISCOVERY_COMPETITION';
    return { conflicts: [conflict(code, relative ?? entry.path, identity.stableId, source.sourceId)] };
  }));
  const duplicates = [...pluginCounts.entries()].filter(([, paths]) => paths.length > 1)
    .map(([stableId, paths]) => ({ conflicts: [conflict('DISCOVERY_COMPETITION', paths.sort(compare)[0], stableId, 'duplicate plugin entries')] }));
  return merge(...results, ...duplicates);
}

function dedupe(list, keyOf) {
  const seen = new Map();
  list.forEach((entry) => {
    const key = keyOf(entry);
    const previous = seen.get(key);
    if (!previous || (entry.contentFingerprint !== undefined && previous.contentFingerprint === undefined)
      || (entry.classification && !previous.classification)) seen.set(key, entry);
  });
  return [...seen.values()];
}

function recoveryState(findings, unverified) {
  if (findings.length > 0) return 'RECOVERY_REQUIRED';
  return unverified.length > 0 ? 'RECOVERY_UNKNOWN' : 'CLEAR';
}

function finalize(n, collected) {
  const recoveryFindings = dedupe(collected.recovery, (entry) => `${entry.path}\0${entry.reason}`).sort(byKeys('path', 'reason'));
  const recoveryConflicts = recoveryFindings.map((finding) => conflict('RECOVERY_REQUIRED', finding.path, null, finding.reason));
  const unverified = dedupe(collected.unverified, canonicalJson).sort(byKeys('phase', 'reason'));
  const limitConflicts = [...current.limits].map((reason) => conflict('INPUT_LIMIT_EXCEEDED', null, null, reason));
  const conflicts = dedupe([...n.conflicts, ...collected.conflicts, ...recoveryConflicts, ...limitConflicts], canonicalJson)
    .sort(byKeys('code', 'path', 'stableId', 'detail'));
  const actions = dedupe(collected.actions.filter((action) => conflicts.length === 0 || action.kind === 'preserve'), canonicalJson)
    .sort(byKeys('path', 'kind'));
  const body = {
    schema: PLAN_SCHEMA,
    state: conflicts.length === 0 ? 'READY_FOR_MIGRATION' : 'BLOCKED',
    context: n.context,
    binding: n.binding,
    receipts: dedupe(collected.receipts, (entry) => entry.path).sort(byKeys('path')),
    observations: dedupe(collected.observations, (entry) => entry.path).sort(byKeys('path')),
    actions,
    conflicts,
    retainedHostDependencies: collected.retained.slice().sort(byKeys('host')),
    recovery: { state: recoveryState(recoveryFindings, unverified), findings: recoveryFindings, unverified },
    mutation: false,
    activation: 'NOT_RUN',
    runtime: 'NOT_RUN',
  };
  return immutableJson({ ...body, planFingerprint: sha256(canonicalJson(body)) }, { limits: LIMITS });
}

function errorCode(error) {
  const code = error && (typeof error.code === 'string' ? error.code : error.reason);
  return typeof code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(code) ? code : 'READ_FAILED';
}

// Hostile or racing on-disk state must block the plan, not crash the planner;
// only the error code (never the path-bearing message) is surfaced, and the
// recovery verdict becomes unknown rather than CLEAR for the failed step.
function guarded(inspect, phase) {
  try {
    return merge(inspect());
  } catch (error) {
    const code = errorCode(error);
    return merge({ conflicts: [conflict('UNREADABLE', null, null, code)], unverified: [{ phase, reason: code }] });
  }
}

function failedPlan(error) {
  const code = errorCode(error);
  const binding = { inventoryFingerprint: null, selectedStableIds: [], candidateArtifactFingerprint: null };
  const n = { context: null, binding, conflicts: [conflict('PLAN_FAILED', null, null, code)] };
  return finalize(n, merge({ unverified: [{ phase: 'plan', reason: code }] }));
}

function planMarketplaceCutover(input) {
  current = { hashed: 0, limits: new Set() };
  try {
    const n = normalizeInput(input);
    if (!n.ready) return finalize(n, merge());
    const projection = guarded(() => inspectProjection(n), 'projection');
    const historical = guarded(() => inspectHistorical(n, new Set(projection.claimed)), 'historical');
    const sources = guarded(() => inspectSources(n, [...projection.actions, ...historical.actions]), 'sources');
    return finalize(n, merge(projection, historical, sources));
  } catch (error) {
    return failedPlan(error);
  }
}

function revalidation(state, reasons) {
  return immutableJson({ ok: state === 'CURRENT', state, reasons, mutation: false, activation: 'NOT_RUN', runtime: 'NOT_RUN' });
}

function revalidateMarketplaceCutoverPlan(plan, input) {
  try {
    return revalidatePlan(plan, input);
  } catch (error) {
    return revalidation('BLOCKED', [`REVALIDATION_FAILED:${errorCode(error)}`]);
  }
}

function revalidatePlan(plan, input) {
  const stored = cloneJson(plan);
  if (!stored.ok || !isPlainObject(stored.value) || stored.value.schema !== PLAN_SCHEMA || typeof stored.value.planFingerprint !== 'string') {
    return revalidation('BLOCKED', ['PLAN_INVALID']);
  }
  const { planFingerprint, ...body } = stored.value;
  if (sha256(canonicalJson(body)) !== planFingerprint) return revalidation('BLOCKED', ['PLAN_FINGERPRINT_MISMATCH']);
  if (body.mutation !== false || body.activation !== 'NOT_RUN' || body.runtime !== 'NOT_RUN') return revalidation('BLOCKED', ['PLAN_INVALID']);
  if (body.state !== 'READY_FOR_MIGRATION') return revalidation('BLOCKED', ['PLAN_BLOCKED']);
  const fresh = planMarketplaceCutover(input);
  if (fresh.planFingerprint === planFingerprint) return revalidation('CURRENT', []);
  const reasons = DRIFT_SECTIONS.filter(([key]) => canonicalJson(fresh[key]) !== canonicalJson(body[key])).map(([, reason]) => reason);
  return revalidation('STALE_PLAN', reasons.length > 0 ? reasons : ['PLAN_DRIFT']);
}

module.exports = {
  planMarketplaceCutover,
  revalidateMarketplaceCutoverPlan,
};
