'use strict';

const DEFAULT_LIMITS = Object.freeze({
  maxNodes: 4096,
  maxDepth: 32,
  maxStringBytes: 4096,
  maxTotalBytes: 1024 * 1024,
  maxKeys: 200,
  maxArrayKeys: 10001,
  maxKeyBytes: 4096,
  maxArrayLength: 10000,
});

const LIMIT_NAMES = Object.freeze(Object.keys(DEFAULT_LIMITS));

class ReceiptJsonPrimitiveError extends TypeError {
  constructor(reason, path = []) {
    super(reason);
    this.name = 'ReceiptJsonPrimitiveError';
    this.reason = reason;
    this.path = Object.freeze(path.slice());
  }
}

function own(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isDataDescriptor(descriptor) {
  return descriptor && own(descriptor, 'value');
}

function normalizeLimits(options) {
  const supplied = {
    ...(options.limits || {}),
  };
  for (const name of LIMIT_NAMES) {
    if (own(options, name)) supplied[name] = options[name];
  }
  const limits = {};
  for (const name of LIMIT_NAMES) {
    const value = supplied[name] === undefined ? DEFAULT_LIMITS[name] : supplied[name];
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new RangeError(`${name} must be a non-negative safe integer`);
    }
    limits[name] = value;
  }
  return limits;
}

function rejectWith(options, reason, path) {
  const details = Object.freeze({
    reason,
    path: Object.freeze(path.slice()),
    context: options.context,
  });
  if (typeof options.onReject === 'function') {
    const result = options.onReject(details);
    if (result !== undefined) throw result;
  }
  if (typeof options.errorFactory === 'function') {
    const result = options.errorFactory(details);
    if (result !== undefined) throw result;
  }
  throw new ReceiptJsonPrimitiveError(reason, path);
}

function rejectIf(condition, options, reason, path) {
  if (condition) rejectWith(options, reason, path);
}

function readDescriptors(value, options, path) {
  try {
    return Object.getOwnPropertyDescriptors(value);
  } catch (_) {
    rejectWith(options, 'DESCRIPTOR_ACCESS', path);
  }
}

function readPrototype(value, options, path) {
  try {
    return Object.getPrototypeOf(value);
  } catch (_) {
    rejectWith(options, 'PROTOTYPE_ACCESS', path);
  }
}

function readArrayShape(value, descriptors, limits, options, path) {
  const lengthDescriptor = descriptors.length;
  rejectIf(!isDataDescriptor(lengthDescriptor), options, 'ACCESSOR', path);
  const length = lengthDescriptor.value;
  rejectIf(!Number.isSafeInteger(length) || length < 0, options, 'ARRAY_LENGTH', path);
  rejectIf(length > limits.maxArrayLength, options, 'MAX_ARRAY_LENGTH', path);
  const keys = Object.keys(descriptors);
  rejectIf(keys.length > limits.maxArrayKeys, options, 'MAX_KEYS', path);
  const expected = ['length', ...Array.from({ length }, (_, index) => String(index))];
  rejectIf(keys.length !== expected.length || !expected.every((key) => own(descriptors, key)), options, 'SPARSE_ARRAY', path);
  return { keys, length };
}

function inspectKey(key, descriptor, path, options, limits, state, policyContext) {
  const keyBytes = Buffer.byteLength(key, 'utf8');
  rejectIf(keyBytes > limits.maxKeyBytes, options, 'MAX_KEY_BYTES', path);
  state.bytes += keyBytes;
  rejectIf(state.bytes > limits.maxTotalBytes, options, 'MAX_TOTAL_BYTES', path);
  if (typeof options.propertyPolicy === 'function') {
    const accepted = options.propertyPolicy({
      key,
      path: path.slice(),
      descriptor,
      policyContext,
    });
    rejectIf(accepted === false, options, 'PROPERTY_POLICY', path);
  }
}

function clonePrimitive(candidate, path, depth, options, state) {
  state.nodes += 1;
  rejectIf(state.nodes > options.limits.maxNodes, options, 'MAX_NODES', path);
  rejectIf(depth > options.limits.maxDepth, options, 'MAX_DEPTH', path);
  if (candidate === undefined) {
    rejectIf(options.undefinedPolicy === 'reject', options, 'UNDEFINED', path);
    return { handled: true, value: undefined };
  }
  if (candidate === null || typeof candidate === 'boolean') return { handled: true, value: candidate };
  if (typeof candidate === 'string') {
    const bytes = Buffer.byteLength(candidate, 'utf8');
    rejectIf(bytes > options.limits.maxStringBytes, options, 'MAX_STRING_BYTES', path);
    state.bytes += bytes;
    rejectIf(state.bytes > options.limits.maxTotalBytes, options, 'MAX_TOTAL_BYTES', path);
    return { handled: true, value: candidate };
  }
  if (typeof candidate === 'number') {
    rejectIf(!Number.isFinite(candidate), options, 'FINITE_NUMBER', path);
    return { handled: true, value: candidate };
  }
  rejectIf(typeof candidate !== 'object', options, 'JSON_VALUE', path);
  return { handled: false, value: candidate };
}

function prepareContainer(candidate, path, options) {
  const descriptors = readDescriptors(candidate, options, path);
  const symbols = Reflect.ownKeys(descriptors).filter((key) => typeof key === 'symbol');
  rejectIf(symbols.length > 0, options, 'SYMBOL_KEY', path);
  const prototype = readPrototype(candidate, options, path);
  const array = Array.isArray(candidate);
  rejectIf(array ? prototype !== Array.prototype
    : prototype !== Object.prototype && prototype !== null,
  options, 'NON_PLAIN_PROTOTYPE', path);
  if (array) {
    const shape = readArrayShape(candidate, descriptors, options.limits, options, path);
    return { descriptors, array, ...shape, result: [] };
  }
  const keys = Object.keys(descriptors);
  rejectIf(keys.length > options.limits.maxKeys, options, 'MAX_KEYS', path);
  return {
    descriptors,
    array: false,
    keys,
    length: null,
    result: Object.create(prototype === null ? null : Object.prototype),
  };
}

function containerContext(shape, path, policyContext, options) {
  if (typeof options.contextPolicy !== 'function') return policyContext;
  const candidate = options.contextPolicy({
    path: path.slice(),
    descriptors: shape.descriptors,
    keys: shape.keys.slice(),
    array: shape.array,
    policyContext,
  });
  return candidate === undefined ? policyContext : candidate;
}

function cloneChildren(shape, path, depth, context, options, state) {
  for (const key of shape.keys) {
    if (shape.array && key === 'length') continue;
    const descriptor = shape.descriptors[key];
    const childPath = path.concat(key);
    inspectKey(key, descriptor, childPath, options, options.limits, state, context);
    rejectIf(!descriptor.enumerable, options, 'NON_ENUMERABLE', childPath);
    rejectIf(!isDataDescriptor(descriptor), options, 'ACCESSOR', childPath);
    const child = visitValue(descriptor.value, childPath, depth + 1, context, options, state);
    Object.defineProperty(shape.result, key, {
      value: child,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
}

function cloneContainer(candidate, path, depth, policyContext, options, state) {
  rejectIf(state.active.has(candidate), options, 'CYCLE', path);
  state.active.add(candidate);
  try {
    const shape = prepareContainer(candidate, path, options);
    const context = containerContext(shape, path, policyContext, options);
    cloneChildren(shape, path, depth, context, options, state);
    if (shape.array) shape.result.length = shape.length;
    return shape.result;
  } finally {
    state.active.delete(candidate);
  }
}

function visitValue(candidate, path, depth, policyContext, options, state) {
  const primitive = clonePrimitive(candidate, path, depth, options, state);
  if (primitive.handled) return primitive.value;
  return cloneContainer(candidate, path, depth, policyContext, options, state);
}

function cloneBoundedJson(value, inputOptions = {}) {
  if (!inputOptions || typeof inputOptions !== 'object' || Array.isArray(inputOptions)) {
    throw new TypeError('options must be an object');
  }
  const options = { ...inputOptions, limits: normalizeLimits(inputOptions) };
  options.undefinedPolicy = options.undefinedPolicy === undefined ? 'reject' : options.undefinedPolicy;
  if (!['reject', 'allow'].includes(options.undefinedPolicy)) {
    throw new RangeError('undefinedPolicy must be reject or allow');
  }
  const state = { nodes: 0, bytes: 0, active: new WeakSet() };
  return visitValue(value, [], 0, options.context, options, state);
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  let descriptors;
  try {
    descriptors = Object.getOwnPropertyDescriptors(value);
    Object.freeze(value);
  } catch (_) {
    return value;
  }
  for (const descriptor of Object.values(descriptors)) {
    if (isDataDescriptor(descriptor)) deepFreeze(descriptor.value, seen);
  }
  return value;
}

function immutableJson(value, options = {}) {
  return deepFreeze(cloneBoundedJson(value, options));
}

module.exports = {
  DEFAULT_LIMITS,
  ReceiptJsonPrimitiveError,
  cloneBoundedJson,
  deepFreeze,
  immutableJson,
};
