'use strict';

// The userConfig metadata boundary is deliberately separate from the Claude
// skills generator. It changes description text only; the legacy config
// contract remains the source of truth for keys and values.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { evaluateDiscoveryBudget, ESTIMATOR } = require('./discovery-budget');

const SCHEMA = 'dhpk.plugin-user-config-metadata.v1';
const CATEGORY = 'claude-user-config';
const SCOPE_KIND = 'claude-plugin.userConfig';
const ALLOWED_ENTRY_FIELDS = new Set([
  'key', 'type', 'multiple', 'title', 'default',
  'purpose', 'trigger', 'boundary', 'pointer', 'description',
]);
const LEGACY_ENTRY_FIELDS = new Set(['type', 'multiple', 'title', 'description', 'default']);
const CONSUMER_STATUSES = new Set(['PASS', 'FAIL', 'NOT_RUN', 'NOT_CONFIGURED', 'BLOCKED', 'UNAVAILABLE']);
const SOURCE_FIELDS = new Set(['schema', 'generatorVersion', 'pointerRoot', 'entries']);

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function digest(value) {
  const bytes = Buffer.isBuffer(value)
    ? value
    : Buffer.from(typeof value === 'string' ? value : JSON.stringify(value));
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function words(value) {
  return String(value || '').trim().split(/\s+/u).filter(Boolean).length;
}

function tokens(value) {
  return Math.ceil(Array.from(String(value || '')).length / 4);
}

function contractEntries(manifest) {
  const userConfig = manifest && manifest.userConfig;
  if (!userConfig || typeof userConfig !== 'object' || Array.isArray(userConfig)) return [];
  return Object.entries(userConfig).map(([key, entry]) => ({
    key,
    type: entry.type,
    multiple: entry.multiple === true,
    title: entry.title,
    default: clone(entry.default),
  }));
}

function result(ok, value, errors) {
  return ok ? { ok: true, value } : { ok: false, errors };
}

function safeRegularPath(root, file) {
  const resolvedRoot = path.resolve(root || path.dirname(file));
  const resolvedFile = path.resolve(file);
  const relative = path.relative(resolvedRoot, resolvedFile);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return false;
  let cursor = resolvedRoot;
  for (const part of relative.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    let stat;
    try { stat = fs.lstatSync(cursor); } catch (_) { continue; }
    if (stat.isSymbolicLink()) return false;
  }
  return true;
}

function boundedPointer(root, pointer, pointerRoot = 'docs') {
  if (typeof pointer !== 'string' || pointer.trim() === '' || path.isAbsolute(pointer)) return null;
  const normalized = pointer.replace(/\\/g, '/');
  if (normalized.split('/').includes('..')) return null;
  const canonicalRoot = String(pointerRoot || 'docs').replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '');
  if (!canonicalRoot || !(normalized === canonicalRoot || normalized.startsWith(`${canonicalRoot}/`))) return null;
  const absolute = path.resolve(root, normalized);
  const relative = path.relative(root, absolute);
  if (relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) return null;
  let cursor = root;
  for (const part of relative.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    let stat;
    try { stat = fs.lstatSync(cursor); } catch (_) { return null; }
    if (stat.isSymbolicLink()) return null;
  }
  return fs.existsSync(absolute) && fs.statSync(absolute).isFile() ? absolute : null;
}

function validateUserConfigMetadata({ root, legacyManifest, source }) {
  const errors = [];
  const legacy = contractEntries(legacyManifest);
  if (source && typeof source === 'object') {
    for (const field of Object.keys(source)) if (!SOURCE_FIELDS.has(field)) errors.push(`metadata source has unsupported field ${field}`);
  }
  for (const [key, entry] of Object.entries((legacyManifest && legacyManifest.userConfig) || {})) {
    for (const field of Object.keys(entry || {})) if (!LEGACY_ENTRY_FIELDS.has(field)) errors.push(`${key} has unsupported legacy manifest field ${field}`);
  }
  if (!source || source.schema !== SCHEMA) errors.push(`metadata source schema must be ${SCHEMA}`);
  if (!source || typeof source.generatorVersion !== 'string' || source.generatorVersion.trim() === '') errors.push('metadata source generatorVersion is required');
  if (source && source.pointerRoot !== undefined && source.pointerRoot !== 'docs') errors.push('metadata source pointerRoot must be the canonical docs root');
  if (!source || !Array.isArray(source.entries)) errors.push('metadata source entries must be an array');
  if (errors.length) return result(false, undefined, errors);

  const seen = new Set();
  const byKey = new Map(legacy.map((entry) => [entry.key, entry]));
  const entries = [];
  for (const entry of source.entries) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      errors.push('metadata entry must be an object');
      continue;
    }
    for (const key of Object.keys(entry)) {
      if (!ALLOWED_ENTRY_FIELDS.has(key)) errors.push(`${entry.key || '(unknown)'} has unsupported field ${key}`);
    }
    if (typeof entry.key !== 'string') {
      errors.push('metadata entry key is required');
      continue;
    }
    if (seen.has(entry.key)) errors.push(`duplicate metadata key ${entry.key}`);
    seen.add(entry.key);
    const expected = byKey.get(entry.key);
    if (!expected) {
      errors.push(`unowned metadata key ${entry.key}`);
      continue;
    }
    for (const field of ['type', 'multiple', 'title', 'default']) {
      if (JSON.stringify(entry[field]) !== JSON.stringify(expected[field])) errors.push(`${entry.key} contract field ${field} differs`);
    }
    for (const field of ['purpose', 'trigger', 'boundary', 'pointer', 'description']) {
      if (typeof entry[field] !== 'string' || !entry[field].trim()) errors.push(`${entry.key} ${field} is required`);
    }
    if (entry.pointer && !boundedPointer(root, entry.pointer, source.pointerRoot || 'docs')) errors.push(`${entry.key} pointer is missing, outside canonical root, or escapes repository: ${entry.pointer}`);
    if (entry.description && legacyManifest.userConfig[entry.key] && entry.description === legacyManifest.userConfig[entry.key].description) {
      errors.push(`${entry.key} duplicates long-form legacy description`);
    }
    if (entry.description && entry.description.length > 400) errors.push(`${entry.key} description is long-form prose`);
    entries.push(clone(entry));
  }
  if (seen.size !== legacy.length) {
    for (const expected of legacy) if (!seen.has(expected.key)) errors.push(`missing characterized metadata key ${expected.key}`);
  }
  if (errors.length) return result(false, undefined, errors);
  return result(true, {
    schema: SCHEMA,
    category: CATEGORY,
    scope: { kind: SCOPE_KIND },
    generatorVersion: String(source.generatorVersion),
    entries,
  });
}

function loadAuthoritativeMetadata({ root, legacyManifest, sourcePath } = {}) {
  const file = sourcePath || path.join(root, 'manifests', 'claude-user-config-metadata.json');
  const source = JSON.parse(fs.readFileSync(file, 'utf8'));
  const contract = new Map(contractEntries(legacyManifest).map((entry) => [entry.key, entry]));
  const entries = (source.entries || []).map((entry) => {
    const expected = contract.get(entry.key) || {};
    const description = entry.description || `${entry.purpose} Use ${entry.trigger}; ${entry.boundary}. See ${entry.pointer}.`;
    return { ...expected, ...entry, description };
  });
  return { ...source, entries };
}

function generateUserConfigMetadata({ root, legacyManifest, source }) {
  const validation = validateUserConfigMetadata({ root, legacyManifest, source });
  if (!validation.ok) return validation;
  const manifest = clone(legacyManifest);
  const metadata = validation.value;
  const byKey = new Map(metadata.entries.map((entry) => [entry.key, entry]));
  for (const [key, entry] of Object.entries(manifest.userConfig)) {
    const compact = byKey.get(key);
    entry.description = compact.description;
  }
  const manifestFingerprint = digest(manifest);
  return result(true, {
    manifest,
    candidateManifest: manifest,
    manifestFingerprint,
    sourceFingerprint: digest(metadata),
    generatorVersion: metadata.generatorVersion,
    category: CATEGORY,
    scope: { kind: SCOPE_KIND },
  });
}

function measureManifest(manifest) {
  const bytes = Buffer.byteLength(`${JSON.stringify(manifest, null, 2)}\n`);
  const descriptions = Object.values(manifest.userConfig || {}).map((entry) => entry.description || '');
  return {
    bytes,
    words: descriptions.reduce((sum, value) => sum + words(value), 0),
    tokens: descriptions.reduce((sum, value) => sum + tokens(value), 0),
  };
}

function measureUserConfigMetadata({ beforeManifest, afterManifest, metadataSource, identity, consumer, limits = null }) {
  const before = measureManifest(beforeManifest);
  const after = measureManifest(afterManifest);
  const structural = {
    verdict: after.bytes < before.bytes && after.tokens < before.tokens ? 'PASS' : 'FAIL',
    stage: 'structural',
    category: CATEGORY,
  };
  const requestedStatus = consumer && consumer.status ? consumer.status : 'NOT_CONFIGURED';
  const status = CONSUMER_STATUSES.has(requestedStatus) ? requestedStatus : 'NOT_CONFIGURED';
  const budgetItems = Object.entries(afterManifest.userConfig || {}).map(([key, entry]) => ({
    stableId: `claude-user-config:${key}`,
    discoveryVisible: true,
    lifecycle: 'compatibility',
    publicationSurface: 'claude',
    category: CATEGORY,
    words: words(entry.description),
    tokens: tokens(entry.description),
    limits,
  }));
  const budget = evaluateDiscoveryBudget({
    items: budgetItems,
    category: CATEGORY,
    scope: { kind: SCOPE_KIND },
    estimator: ESTIMATOR,
    identity,
  });
  return result(true, {
    schema: 'dhpk.plugin-user-config-metadata-evidence.v1',
    category: CATEGORY,
    scope: { kind: SCOPE_KIND, artifactFingerprint: identity && identity.artifactFingerprint },
    sourceFingerprint: digest(metadataSource || {}),
    before,
    after,
    structural,
    budget,
    consumer: {
      verdict: status === 'PASS' ? 'NOT_CONFIGURED' : status,
      status,
      resumeCommand: consumer && consumer.resumeCommand,
    },
    claims: ['structural metadata reduction only; no live Claude context reduction claim'],
  });
}

function rollbackUserConfigMetadata({ root, manifestPath, legacyManifest, legacyFingerprint }) {
  try {
    const manifestRoot = root || path.dirname(path.dirname(manifestPath));
    if (!safeRegularPath(manifestRoot, manifestPath)) return result(false, undefined, ['rollback manifest path is symlinked or escapes its root']);
    const current = fs.readFileSync(manifestPath);
    if (legacyFingerprint && digest(current) === legacyFingerprint) return result(true, { restored: false, manifestFingerprint: legacyFingerprint });
    const legacyBytes = `${JSON.stringify(legacyManifest, null, 2)}\n`;
    fs.writeFileSync(manifestPath, legacyBytes);
    return result(true, { restored: true, manifestFingerprint: digest(legacyBytes) });
  } catch (error) {
    return result(false, undefined, [error.message]);
  }
}

module.exports = {
  SCHEMA,
  CATEGORY,
  SCOPE_KIND,
  validateUserConfigMetadata,
  generateUserConfigMetadata,
  measureUserConfigMetadata,
  rollbackUserConfigMetadata,
  contractEntries,
  digest,
  loadAuthoritativeMetadata,
  safeRegularPath,
};
