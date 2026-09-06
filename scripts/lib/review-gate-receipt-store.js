'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {
  COMMIT,
  TREE,
  SAFE_ID,
  canonicalJson,
  compareIdentity,
  sha256,
  redactEvidence,
  ensurePhysicalDirectory,
  assertPhysicalContainment,
  writeImmutable,
  replayJsonSequence,
  acquireLeaseJournal,
  releaseLeaseJournal,
  assertLeaseJournalOwnership,
} = require('./receipt-primitives');

const STORE_EVENT_SCHEMA = 'dhpk.review-gate.store-event.v1';
const EVIDENCE_RECEIPT_SCHEMA = 'dhpk.review-gate.evidence-receipt.v1';
const SEQUENCE_SCHEMA = 'dhpk.review-gate.store-sequence.v1';
const LEASE_SCHEMA = 'dhpk.review-gate.store-lease.v1';
const RECEIPT_KINDS = Object.freeze([
  'decision',
  'review',
  'verification',
  'authority',
  'migration-observation',
]);
const INTEGRITY_MAC = /^hmac-sha256:[a-f0-9]{64}$/;
const FORBIDDEN_KEY = /(?:prompt|message|chainofthought|thought|reasoning|transcript|fullsource|sourcecode|fulllog|rawlog|stdout|stderr)/;
const INTEGRITY_KEYS = new WeakMap();
const STALE_IDENTITY_FIELDS = new Set([
  'sourceCommit',
  'sourceTree',
  'patchHash',
  'scopeManifestHash',
  'governingInputsHash',
  'policyVersion',
  'contractVersion',
  'materialRisksHash',
]);

class ReceiptStoreError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ReceiptStoreError';
    this.code = code;
  }
}

const fail = (code, message) => {
  throw new ReceiptStoreError(code, message);
};

const isForbiddenKey = (key) => FORBIDDEN_KEY.test(String(key).replace(/[^A-Za-z0-9]/g, '').toLowerCase())
  || /^(?:messages?|transcripts?)$/i.test(String(key));

const deepFreeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
};

const cloneJsonData = (value, state = { count: 0 }, key = '', depth = 0) => {
  state.count += 1;
  if (state.count > 4000 || depth > 12) fail('MALFORMED_EVIDENCE', 'evidence exceeds the bounded data budget');
  if (isForbiddenKey(key)) fail('SENSITIVE_EVIDENCE', 'evidence contains a forbidden content field');
  if (typeof value === 'string') {
    if (Buffer.byteLength(value, 'utf8') > 4096) fail('MALFORMED_EVIDENCE', 'evidence string exceeds the bounded data budget');
    return value;
  }
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) {
    if (value.length > 200) fail('MALFORMED_EVIDENCE', 'evidence array exceeds the bounded data budget');
    return value.map((entry) => cloneJsonData(entry, state, key, depth + 1));
  }
  if (!value || typeof value !== 'object') fail('MALFORMED_EVIDENCE', 'evidence must contain JSON-compatible data');
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail('MALFORMED_EVIDENCE', 'evidence must contain plain JSON records');
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Object.keys(descriptors).filter((entryKey) => descriptors[entryKey].enumerable);
  if (keys.length > 200) fail('MALFORMED_EVIDENCE', 'evidence record exceeds the bounded data budget');
  const result = {};
  for (const entryKey of keys) {
    const descriptor = descriptors[entryKey];
    if (!Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
      fail('MALFORMED_EVIDENCE', 'evidence accessors are not allowed');
    }
    result[entryKey] = cloneJsonData(descriptor.value, state, entryKey, depth + 1);
  }
  return result;
};

const immutableEvidence = (value) => deepFreeze(redactEvidence(cloneJsonData(value)));

const assertSafeId = (value, name) => {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) fail('MALFORMED_EVIDENCE', `${name} is invalid`);
};

const assertVersion = (value, name) => {
  if (typeof value !== 'string' || value.length === 0 || value.length > 128) {
    fail('MALFORMED_EVIDENCE', `${name} is invalid`);
  }
};

const assertTimestamp = (value) => {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    fail('MALFORMED_EVIDENCE', 'recordedAt is invalid');
  }
};

const validateCommonRecord = (record, idField) => {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    fail('MALFORMED_EVIDENCE', 'evidence record is required');
  }
  for (const field of [idField, 'workId', 'waveId', 'producer', 'adapter', 'sessionId']) {
    assertSafeId(record[field], field);
  }
  if (!COMMIT.test(record.sourceCommit || '') || !TREE.test(record.sourceTree || '')) {
    fail('MALFORMED_EVIDENCE', 'source commit and tree must be exact Git identities');
  }
  assertVersion(record.policyVersion, 'policyVersion');
  assertVersion(record.contractVersion, 'contractVersion');
  assertTimestamp(record.recordedAt);
  if (!record.payload || typeof record.payload !== 'object' || Array.isArray(record.payload)) {
    fail('MALFORMED_EVIDENCE', 'payload must be a record');
  }
};

const digestFor = (value) => `sha256:${sha256(canonicalJson(value))}`;
const digestBody = (digest) => String(digest || '').replace(/^sha256:/, '');
const integrityMacFor = (key, value) => `hmac-sha256:${crypto
  .createHmac('sha256', key)
  .update(canonicalJson(value))
  .digest('hex')}`;

const integrityMacMatches = (key, value, actual) => {
  if (!INTEGRITY_MAC.test(actual || '')) return false;
  const expected = integrityMacFor(key, value);
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
};

const defaultLeaseOwnerAlive = (processId) => {
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    if (error && error.code === 'ESRCH') return false;
    if (error && error.code === 'EPERM') return true;
    throw error;
  }
};

const decodeLease = (bytes) => {
  let value;
  try {
    value = JSON.parse(bytes);
  } catch (_) {
    fail('LEASE_CONFLICT', 'the active lease record is malformed');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || value.schema !== LEASE_SCHEMA
    || !Number.isSafeInteger(value.generation) || value.generation <= 0
    || !Number.isSafeInteger(value.processId) || value.processId <= 0
    || typeof value.workId !== 'string' || !SAFE_ID.test(value.workId)
    || typeof value.ownerId !== 'string' || !SAFE_ID.test(value.ownerId)
    || typeof value.token !== 'string' || !/^[a-f0-9]{32}$/.test(value.token)
    || !Number.isFinite(Date.parse(value.acquiredAt))
    || !Number.isFinite(Date.parse(value.expiresAt))
    || Date.parse(value.expiresAt) <= Date.parse(value.acquiredAt)) {
    fail('LEASE_CONFLICT', 'the active lease record is malformed');
  }
  return deepFreeze(cloneJsonData(value));
};

class ReceiptStore {
  constructor({
    root = path.resolve('.dhpk/review-gate/v1'),
    trustPolicy = { producers: [] },
    integrityKey,
    now = () => Date.now(),
    leaseMs = 30000,
    isLeaseOwnerAlive = defaultLeaseOwnerAlive,
  } = {}) {
    if (typeof root !== 'string' || !root) fail('STORE_CONFIG', 'store root is required');
    const keyBytes = Buffer.isBuffer(integrityKey)
      ? Buffer.from(integrityKey)
      : Buffer.from(typeof integrityKey === 'string' ? integrityKey : '');
    if (keyBytes.length < 32) fail('STORE_CONFIG', 'integrityKey must contain at least 32 bytes');
    if (typeof now !== 'function') fail('STORE_CONFIG', 'store clock must be a function');
    if (typeof isLeaseOwnerAlive !== 'function') fail('STORE_CONFIG', 'lease owner liveness check must be a function');
    if (!Number.isSafeInteger(leaseMs) || leaseMs <= 0) fail('STORE_CONFIG', 'leaseMs must be positive');
    const policy = immutableEvidence(trustPolicy);
    if (!Array.isArray(policy.producers)) fail('STORE_CONFIG', 'trust policy producers must be an array');
    this.root = ensurePhysicalDirectory(path.resolve(root));
    this.trustPolicy = policy;
    INTEGRITY_KEYS.set(this, keyBytes);
    this.now = now;
    this.leaseMs = leaseMs;
    this.isLeaseOwnerAlive = isLeaseOwnerAlive;
  }

  acquireLease(workId, { ownerId, ttlMs = this.leaseMs } = {}) {
    assertSafeId(workId, 'workId');
    assertSafeId(ownerId, 'ownerId');
    if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) fail('STORE_CONFIG', 'lease ttlMs must be positive');
    const leaseDirectory = this._leasePath(workId);
    const lease = acquireLeaseJournal({
      directory: leaseDirectory,
      create: (generation) => {
        const nowMs = this._nowMs();
        return {
          schema: LEASE_SCHEMA,
          generation,
          processId: process.pid,
          workId,
          ownerId,
          token: crypto.randomBytes(16).toString('hex'),
          acquiredAt: new Date(nowMs).toISOString(),
          expiresAt: new Date(nowMs + ttlMs).toISOString(),
        };
      },
      encode: (candidate) => `${canonicalJson(candidate)}\n`,
      decode: decodeLease,
      generationFor: (candidate) => candidate.generation,
      tokenFor: (candidate) => candidate.token,
      isStale: (current) => {
        if (current.workId !== workId) {
          fail('LEASE_CONFLICT', 'the active lease identity does not match this work');
        }
        return Date.parse(current.expiresAt) <= this._nowMs()
          && !this.isLeaseOwnerAlive(current.processId);
      },
      attempts: 3,
      matches: (left, right) => left.generation === right.generation
        && left.workId === right.workId
        && left.ownerId === right.ownerId
        && left.token === right.token,
      conflictError: () => new ReceiptStoreError('LEASE_CONFLICT', 'an active lease already owns this work'),
      unavailableError: () => new ReceiptStoreError('LEASE_CONFLICT', 'the work lease could not be acquired'),
      invalidError: () => new ReceiptStoreError('LEASE_CONFLICT', 'the active lease record is malformed'),
      physicalRoot: this.root,
    });
    return deepFreeze(lease);
  }

  releaseLease(lease) {
    const candidate = deepFreeze(cloneJsonData(lease));
    assertSafeId(candidate.workId, 'workId');
    assertSafeId(candidate.ownerId, 'ownerId');
    const leaseDirectory = this._leasePath(candidate.workId);
    return releaseLeaseJournal({
      directory: leaseDirectory,
      expected: candidate,
      encode: (current) => `${canonicalJson(current)}\n`,
      decode: decodeLease,
      generationFor: (current) => current.generation,
      tokenFor: (current) => current.token,
      matches: (expected, current) => current.workId === expected.workId
        && current.generation === expected.generation
        && current.ownerId === expected.ownerId
        && current.token === expected.token,
      ownershipError: () => new ReceiptStoreError('LEASE_OWNERSHIP', 'lease ownership does not match the active lease'),
      invalidError: () => new ReceiptStoreError('LEASE_CONFLICT', 'the active lease record is malformed'),
      physicalRoot: this.root,
    });
  }

  append({ expectedRevision, event, receipts = [] } = {}) {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      fail('REVISION_CONFLICT', 'expectedRevision must be a non-negative integer');
    }
    const cleanEvent = immutableEvidence(event);
    const cleanReceipts = immutableEvidence(receipts);
    this._validateEvent(cleanEvent);
    if (!Array.isArray(cleanReceipts)) fail('MALFORMED_EVIDENCE', 'receipts must be an array');
    for (const receipt of cleanReceipts) this._validateReceipt(receipt, cleanEvent);

    const lease = this.acquireLease(cleanEvent.workId, { ownerId: `append-${process.pid}` });
    try {
      const current = this._replay(cleanEvent.workId);
      const eventDigest = digestFor(cleanEvent);
      const receiptDigests = cleanReceipts.map(digestFor);
      const existingIndex = current.events.findIndex((entry) => entry.eventId === cleanEvent.eventId);
      if (existingIndex >= 0) {
        const existing = current.sequences[existingIndex];
        if (existing.eventDigest === eventDigest
          && canonicalJson(existing.receiptDigests) === canonicalJson(receiptDigests)) {
          return deepFreeze({
            status: 'DUPLICATE',
            revision: existing.revision,
            eventDigest,
            receiptDigests,
            chainDigest: existing.chainDigest,
          });
        }
        fail('IDEMPOTENCY_CONFLICT', 'event identity is already bound to different evidence');
      }
      if (current.revision !== expectedRevision) {
        fail('REVISION_CONFLICT', 'expected revision does not match the stored revision');
      }

      this._writeObject(cleanEvent, eventDigest);
      cleanReceipts.forEach((receipt, index) => this._writeObject(receipt, receiptDigests[index]));
      this._assertLeaseOwnership(lease);
      const revision = expectedRevision + 1;
      const record = {
        schema: SEQUENCE_SCHEMA,
        workId: cleanEvent.workId,
        revision,
        previousChainDigest: current.chainDigest,
        eventDigest,
        receiptDigests,
      };
      const chainDigest = digestFor(record);
      const authenticated = { ...record, chainDigest };
      const persisted = {
        ...authenticated,
        integrityMac: integrityMacFor(INTEGRITY_KEYS.get(this), authenticated),
      };
      const sequencePath = path.join(this._eventsPath(cleanEvent.workId), `${String(revision).padStart(12, '0')}.json`);
      writeImmutable(sequencePath, `${canonicalJson(persisted)}\n`, { physicalRoot: this.root });
      return deepFreeze({ status: 'APPENDED', revision, eventDigest, receiptDigests, chainDigest });
    } finally {
      this.releaseLease(lease);
    }
  }

  replay({
    workId,
    expectedRevision,
    expectedChainDigest,
    expectedIdentity = null,
  } = {}) {
    assertSafeId(workId, 'workId');
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      fail('MALFORMED_EVIDENCE', 'trusted expectedRevision must be a non-negative integer');
    }
    if ((expectedRevision === 0 && expectedChainDigest !== null)
      || (expectedRevision > 0 && !/^sha256:[a-f0-9]{64}$/.test(expectedChainDigest || ''))) {
      fail('MALFORMED_EVIDENCE', 'trusted expectedChainDigest does not match expectedRevision');
    }
    const result = this._replay(workId, expectedIdentity);
    if (result.revision !== expectedRevision || result.chainDigest !== expectedChainDigest) {
      fail('TAMPERED_EVIDENCE', 'replayed history does not match the trusted expected head');
    }
    return deepFreeze({
      workId,
      revision: result.revision,
      chainDigest: result.chainDigest,
      events: result.events,
      receipts: result.receipts,
    });
  }

  inspect({
    workId,
    waveId = null,
    expectedRevision,
    expectedChainDigest,
    expectedIdentity = null,
  } = {}) {
    const replayed = this.replay({ workId, expectedRevision, expectedChainDigest, expectedIdentity });
    if (waveId === null || waveId === undefined) return replayed;
    assertSafeId(waveId, 'waveId');
    return deepFreeze({
      ...replayed,
      events: replayed.events.filter((event) => event.waveId === waveId),
      receipts: replayed.receipts.filter((receipt) => receipt.waveId === waveId),
    });
  }

  _validateEvent(event) {
    if (event.schema !== STORE_EVENT_SCHEMA) fail('UNSUPPORTED_SCHEMA', 'event schema is unsupported');
    validateCommonRecord(event, 'eventId');
    assertSafeId(event.eventType, 'eventType');
    const trusted = this.trustPolicy.producers.some((entry) => (
      entry.producer === event.producer
      && entry.adapter === event.adapter
      && Array.isArray(entry.eventTypes)
      && entry.eventTypes.includes(event.eventType)
    ));
    if (!trusted) fail('UNTRUSTED_PRODUCER', 'event producer is not trusted for this event type');
  }

  _validateReceipt(receipt, event) {
    if (receipt.schema !== EVIDENCE_RECEIPT_SCHEMA) fail('UNSUPPORTED_SCHEMA', 'receipt schema is unsupported');
    validateCommonRecord(receipt, 'receiptId');
    if (!RECEIPT_KINDS.includes(receipt.kind)) fail('MALFORMED_EVIDENCE', 'receipt kind is invalid');
    for (const field of ['workId', 'waveId', 'sessionId', 'sourceCommit', 'sourceTree', 'policyVersion', 'contractVersion']) {
      if (receipt[field] !== event[field]) fail('FOREIGN_EVIDENCE', 'receipt identity does not match its event');
    }
    const trusted = this.trustPolicy.producers.some((entry) => (
      entry.producer === receipt.producer
      && entry.adapter === receipt.adapter
      && Array.isArray(entry.receiptKinds)
      && entry.receiptKinds.includes(receipt.kind)
    ));
    if (!trusted) fail('UNTRUSTED_PRODUCER', 'receipt producer is not trusted for this receipt kind');
  }

  _replay(workId, expectedIdentity = null) {
    assertSafeId(workId, 'workId');
    const eventsPath = this._eventsPath(workId);
    assertPhysicalContainment(this.root, eventsPath);
    if (!fs.existsSync(eventsPath)) {
      return { revision: 0, chainDigest: null, events: [], receipts: [], sequences: [] };
    }
    const events = [];
    const receipts = [];
    const sequences = [];
    const eventIds = new Set();
    const replayed = replayJsonSequence({
      directory: eventsPath,
      expectedName: (revision) => `${String(revision).padStart(12, '0')}.json`,
      initialChain: null,
      validateRecord: (sequence, { sequence: revision, report }) => {
        if (!sequence || sequence.schema !== SEQUENCE_SCHEMA) {
          report({ code: 'UNSUPPORTED_SCHEMA', message: 'sequence schema is unsupported' });
        }
        if (sequence.revision !== revision || sequence.workId !== workId) {
          report({ code: 'OUT_OF_ORDER', message: 'sequence identity is out of order' });
        }
        if (!Array.isArray(sequence.receiptDigests)) {
          report({ code: 'MALFORMED_EVIDENCE', message: 'sequence receipt digests are invalid' });
        }
        const { integrityMac, ...authenticated } = sequence;
        if (!integrityMacMatches(INTEGRITY_KEYS.get(this), authenticated, integrityMac)) {
          report({ code: 'TAMPERED_EVIDENCE', message: 'sequence integrity authentication does not match' });
        }
      },
      payloadForDigest: (sequence) => {
        const { chainDigest, integrityMac: _integrityMac, ...chainInput } = sequence;
        return chainInput;
      },
      digestForPayload: digestFor,
      previousChain: (sequence) => sequence.previousChainDigest,
      chainFor: (_previous, digest) => digest,
      storedChain: (sequence) => sequence.chainDigest,
      onIssue: ({ type, sequence: revision, code, message }) => {
        if (code) fail(code, message);
        if (type === 'ORDER') {
          fail(revision === 1 ? 'MISSING_SEQUENCE' : 'OUT_OF_ORDER', 'sequence history is not contiguous');
        }
        if (type === 'UNREADABLE') fail('MALFORMED_EVIDENCE', 'sequence evidence is unreadable');
        if (type === 'PREVIOUS_CHAIN') fail('TAMPERED_EVIDENCE', 'sequence predecessor does not match');
        if (type === 'CHAIN') fail('TAMPERED_EVIDENCE', 'sequence chain digest does not match');
        fail('MALFORMED_EVIDENCE', 'sequence evidence is invalid');
      },
      onRecord: (sequence) => {
        const event = this._readObject(sequence.eventDigest);
        this._validateEvent(event);
        if (event.workId !== workId) fail('FOREIGN_EVIDENCE', 'event belongs to a different work item');
        if (eventIds.has(event.eventId)) fail('IDEMPOTENCY_CONFLICT', 'event identity appears more than once');
        eventIds.add(event.eventId);
        this._validateExpectedIdentity(expectedIdentity, event);
        const loadedReceipts = sequence.receiptDigests.map((digest) => this._readObject(digest));
        for (const receipt of loadedReceipts) {
          this._validateReceipt(receipt, event);
          this._validateExpectedIdentity(expectedIdentity, receipt);
        }
        events.push(event);
        receipts.push(...loadedReceipts);
        sequences.push(sequence);
      },
    });
    return {
      revision: replayed.recordCount,
      chainDigest: replayed.chainDigest,
      events,
      receipts,
      sequences,
    };
  }

  _validateExpectedIdentity(expectedIdentity, record) {
    if (expectedIdentity === null || expectedIdentity === undefined) return;
    const expected = immutableEvidence(expectedIdentity);
    if (!expected || typeof expected !== 'object' || Array.isArray(expected)) {
      fail('MALFORMED_EVIDENCE', 'expected identity must be a record');
    }
    for (const [field, value] of Object.entries(expected)) {
      if (!compareIdentity({ [field]: value }, record).ok) {
        fail(STALE_IDENTITY_FIELDS.has(field) ? 'STALE_EVIDENCE' : 'FOREIGN_EVIDENCE', 'evidence identity does not match');
      }
    }
  }

  _writeObject(value, digest) {
    const objectPath = this._objectPath(digest);
    assertPhysicalContainment(this.root, objectPath);
    const content = `${canonicalJson(value)}\n`;
    if (fs.existsSync(objectPath)) {
      if (fs.readFileSync(objectPath, 'utf8') !== content) fail('TAMPERED_EVIDENCE', 'content-addressed object bytes do not match');
      return;
    }
    try {
      writeImmutable(objectPath, content, { physicalRoot: this.root });
    } catch (error) {
      if (!/refusing to overwrite/.test(error.message)
        || fs.readFileSync(objectPath, 'utf8') !== content) throw error;
    }
  }

  _readObject(digest) {
    const body = digestBody(digest);
    if (!/^[a-f0-9]{64}$/.test(body)) fail('MALFORMED_EVIDENCE', 'object digest is invalid');
    const objectPath = this._objectPath(digest);
    assertPhysicalContainment(this.root, objectPath);
    let bytes;
    try {
      bytes = fs.readFileSync(objectPath, 'utf8');
    } catch (_) {
      fail('MISSING_SEQUENCE', 'referenced evidence object is missing');
    }
    let value;
    try {
      value = JSON.parse(bytes);
    } catch (_) {
      fail('MALFORMED_EVIDENCE', 'evidence object is unreadable');
    }
    const raw = deepFreeze(cloneJsonData(value));
    if (digestFor(raw) !== `sha256:${body}`) fail('TAMPERED_EVIDENCE', 'evidence object digest does not match');
    return immutableEvidence(raw);
  }

  _nowMs() {
    const value = Number(this.now());
    if (!Number.isFinite(value)) fail('STORE_CONFIG', 'store clock returned an invalid time');
    return value;
  }

  _assertLeaseOwnership(lease) {
    return assertLeaseJournalOwnership({
      directory: this._leasePath(lease.workId),
      expected: lease,
      decode: decodeLease,
      generationFor: (current) => current.generation,
      tokenFor: (current) => current.token,
      matches: (expected, current) => current.workId === expected.workId
        && current.generation === expected.generation
        && current.ownerId === expected.ownerId
        && current.token === expected.token,
      isStale: (current) => Date.parse(current.expiresAt) <= this._nowMs()
        && !this.isLeaseOwnerAlive(current.processId),
      ownershipError: () => new ReceiptStoreError('LEASE_OWNERSHIP', 'lease ownership does not match the active lease'),
      invalidError: () => new ReceiptStoreError('LEASE_CONFLICT', 'the active lease record is malformed'),
      physicalRoot: this.root,
    });
  }

  _eventsPath(workId) {
    return path.join(this.root, 'works', workId, 'events');
  }

  _leasePath(workId) {
    return path.join(this.root, 'works', workId, '.leases');
  }

  _objectPath(digest) {
    const body = digestBody(digest);
    return path.join(this.root, 'objects', 'sha256', body.slice(0, 2), `${body}.json`);
  }
}

module.exports = {
  ReceiptStore,
  ReceiptStoreError,
  STORE_EVENT_SCHEMA,
  EVIDENCE_RECEIPT_SCHEMA,
  SEQUENCE_SCHEMA,
  RECEIPT_KINDS,
};
