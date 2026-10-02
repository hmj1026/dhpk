'use strict';

// The receipt store is intentionally bounded independently from the generic
// JSON primitive limits.  These ceilings are part of the on-disk threat
// boundary: callers must account for prospective work before allocating or
// persisting another record.
const LIMITS = Object.freeze({
  revisions: 10000,
  receiptsPerSequence: 200,
  receiptsPerWork: 10000,
  replayBytesPerWork: 16 * 1024 * 1024,
  leaseClaims: 20000,
  leaseReleases: 20000,
  leaseRecordBytes: 4096,
});

const DATA_FIELDS = Object.freeze([
  'revisions',
  'receiptsPerSequence',
  'receiptsPerWork',
  'replayBytesPerWork',
]);

const LEASE_FIELDS = Object.freeze([
  'leaseClaims',
  'leaseReleases',
  'leaseRecordBytes',
]);

const FIELDS = Object.freeze([...DATA_FIELDS, ...LEASE_FIELDS]);

class StoreBudgetError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'StoreBudgetError';
    this.code = code;
  }
}

const errorCodeFor = (field) => LEASE_FIELDS.includes(field)
  ? 'LEASE_CONFLICT' : 'MALFORMED_EVIDENCE';

const emptyAccounting = () => Object.freeze(FIELDS.reduce((result, field) => {
  result[field] = 0;
  return result;
}, {}));

const readCounter = (accounting, field) => {
  const value = accounting && accounting[field] === undefined ? 0 : accounting[field];
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new StoreBudgetError(errorCodeFor(field), 'store budget accounting is invalid');
  }
  return value;
};

const readIncrement = (increments, field) => {
  const value = increments && increments[field] === undefined ? 0 : increments[field];
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new StoreBudgetError(errorCodeFor(field), 'store budget increment is invalid');
  }
  return value;
};

const addAccounting = (accounting = emptyAccounting(), increments = {}, _payload = null) => {
  const next = {};
  for (const field of FIELDS) {
    const current = readCounter(accounting, field);
    const increment = readIncrement(increments, field);
    const value = current + increment;
    if (!Number.isSafeInteger(value) || value > LIMITS[field]) {
      // Do not include a payload, field value, path, or serialized record in
      // the error.  Boundary failures must be stable and non-sensitive.
      throw new StoreBudgetError(errorCodeFor(field), 'store budget exceeded');
    }
    next[field] = value;
  }
  return Object.freeze(next);
};

const assertLeaseRecordBytes = (value, _payload = null, errorFactory = null) => {
  const bytes = Buffer.isBuffer(value) || ArrayBuffer.isView(value)
    ? value.byteLength
    : typeof value === 'string' ? Buffer.byteLength(value, 'utf8') : NaN;
  if (!Number.isSafeInteger(bytes) || bytes > LIMITS.leaseRecordBytes) {
    if (typeof errorFactory === 'function') throw errorFactory();
    throw new StoreBudgetError('LEASE_CONFLICT', 'lease record exceeds the bounded byte budget');
  }
  return true;
};

module.exports = {
  LIMITS,
  DATA_FIELDS,
  LEASE_FIELDS,
  StoreBudgetError,
  emptyAccounting,
  addAccounting,
  assertLeaseRecordBytes,
};
