'use strict';

const { test, run, assert } = require('./_lib/tinytest');
const {
  ReceiptJsonPrimitiveError,
  cloneBoundedJson,
  deepFreeze,
  immutableJson,
} = require('../scripts/lib/receipt-json-primitives');
const receiptPrimitives = require('../scripts/lib/receipt-primitives');

function rejects(call, reason) {
  assert.throws(call, (error) => {
    assert.ok(error instanceof ReceiptJsonPrimitiveError, 'shared primitive must expose its error type');
    if (reason) assert.strictEqual(error.reason, reason);
    return true;
  });
}

test('receipt primitives facade re-exports the bounded JSON seam', () => {
  assert.strictEqual(receiptPrimitives.cloneBoundedJson, cloneBoundedJson);
  assert.strictEqual(receiptPrimitives.deepFreeze, deepFreeze);
  assert.strictEqual(receiptPrimitives.immutableJson, immutableJson);
});

test('descriptor traversal never invokes accessors or echoes hidden values', () => {
  const marker = 'RECEIPT_JSON_PRIMITIVE_SECRET_1234567890';
  let invoked = false;
  const input = {};
  Object.defineProperty(input, 'secret', {
    enumerable: true,
    get: () => {
      invoked = true;
      return marker;
    },
  });

  try {
    cloneBoundedJson(input);
    assert.fail('accessor input should be rejected');
  } catch (error) {
    assert.strictEqual(error instanceof ReceiptJsonPrimitiveError, true);
    assert.strictEqual(invoked, false);
    assert.doesNotMatch(`${error.message}${JSON.stringify(error)}`, new RegExp(marker));
  }
});

test('symbols, non-enumerable properties, and non-plain prototypes fail closed', () => {
  const symbolInput = { visible: 'ok' };
  symbolInput[Symbol('hidden')] = 'secret';
  rejects(() => cloneBoundedJson(symbolInput), 'SYMBOL_KEY');

  const hiddenInput = {};
  Object.defineProperty(hiddenInput, 'hidden', { value: 'secret', enumerable: false });
  rejects(() => cloneBoundedJson(hiddenInput), 'NON_ENUMERABLE');

  const customInput = Object.create({ inherited: true });
  customInput.visible = 'ok';
  rejects(() => cloneBoundedJson(customInput), 'NON_PLAIN_PROTOTYPE');
});

test('arrays must be dense, ordinary, and free of extra properties', () => {
  const sparse = [];
  sparse.length = 1;
  rejects(() => cloneBoundedJson(sparse), 'SPARSE_ARRAY');

  const customArray = [];
  customArray.push('value');
  Object.setPrototypeOf(customArray, { custom: true });
  rejects(() => cloneBoundedJson(customArray), 'NON_PLAIN_PROTOTYPE');

  const extra = ['value'];
  extra.extra = true;
  rejects(() => cloneBoundedJson(extra), 'SPARSE_ARRAY');
});

test('cycles fail while repeated non-cyclic references are detached independently', () => {
  const cyclic = {};
  cyclic.self = cyclic;
  rejects(() => cloneBoundedJson(cyclic), 'CYCLE');

  const shared = { nested: { value: 1 } };
  const input = { left: shared, right: shared };
  const output = cloneBoundedJson(input);
  assert.notStrictEqual(output.left, shared);
  assert.notStrictEqual(output.right, shared);
  assert.notStrictEqual(output.left, output.right);
  output.left.nested.value = 2;
  assert.strictEqual(output.right.nested.value, 1);
  assert.strictEqual(shared.nested.value, 1);
});

test('undefined handling is an explicit policy', () => {
  rejects(() => cloneBoundedJson({ missing: undefined }), 'UNDEFINED');
  const allowed = cloneBoundedJson({ missing: undefined }, { undefinedPolicy: 'allow' });
  assert.strictEqual(Object.prototype.hasOwnProperty.call(allowed, 'missing'), true);
  assert.strictEqual(allowed.missing, undefined);
  assert.throws(
    () => cloneBoundedJson({ missing: undefined }, { undefinedPolicy: 'unknown' }),
    /undefinedPolicy/
  );
});

test('node, depth, string, key, and aggregate byte limits are configurable', () => {
  rejects(() => cloneBoundedJson({ a: { b: 1 } }, { limits: { maxNodes: 2 } }), 'MAX_NODES');
  rejects(() => cloneBoundedJson({ a: { b: 1 } }, { limits: { maxDepth: 1 } }), 'MAX_DEPTH');
  rejects(() => cloneBoundedJson({ a: '12345' }, { limits: { maxStringBytes: 4 } }), 'MAX_STRING_BYTES');
  rejects(() => cloneBoundedJson({ longKey: 1 }, { limits: { maxKeyBytes: 4 } }), 'MAX_KEY_BYTES');
  rejects(() => cloneBoundedJson({ a: '12345', b: '12345' }, { limits: { maxTotalBytes: 5 } }), 'MAX_TOTAL_BYTES');
  rejects(() => cloneBoundedJson({ a: 1, b: 2 }, { limits: { maxKeys: 1 } }), 'MAX_KEYS');
  rejects(() => cloneBoundedJson(['a', 'b'], { limits: { maxArrayLength: 1 } }), 'MAX_ARRAY_LENGTH');
});

test('clones are detached and deepFreeze recursively freezes all descendants', () => {
  const source = { nested: { list: [{ value: 1 }] } };
  const clone = immutableJson(source);
  assert.notStrictEqual(clone, source);
  assert.ok(Object.isFrozen(clone));
  assert.ok(Object.isFrozen(clone.nested));
  assert.ok(Object.isFrozen(clone.nested.list));
  assert.ok(Object.isFrozen(clone.nested.list[0]));
  source.nested.list[0].value = 9;
  assert.strictEqual(clone.nested.list[0].value, 1);
  assert.throws(() => { clone.nested.list[0].value = 2; });

  const repeated = {};
  repeated.left = repeated;
  deepFreeze(repeated);
  assert.ok(Object.isFrozen(repeated));
});

test('property and context policy receives a safe path without reading descriptors', () => {
  const context = { mode: 'test' };
  const paths = [];
  let invoked = false;
  const input = { outer: {} };
  Object.defineProperty(input.outer, 'getter', {
    enumerable: true,
    get: () => {
      invoked = true;
      return 'must-not-read';
    },
  });

  rejects(() => cloneBoundedJson(input, {
    context,
    propertyPolicy: ({ key, path, descriptor, policyContext }) => {
      paths.push({ key, path, descriptor, policyContext });
      return key !== 'getter';
    },
  }), 'PROPERTY_POLICY');
  assert.strictEqual(invoked, false);
  assert.deepStrictEqual(paths.map((entry) => entry.path), [['outer'], ['outer', 'getter']]);
  assert.strictEqual(paths[1].policyContext, context);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(paths[1].descriptor, 'get'), true);
});

test('caller rejection errors preserve caller code and bounded context', () => {
  const input = { nested: { value: 'x' } };
  const seen = [];
  const custom = new Error('MALFORMED_INPUT');
  custom.code = 'MALFORMED_INPUT';
  assert.throws(() => cloneBoundedJson(input, {
    propertyPolicy: ({ path, policyContext }) => {
      seen.push({ path, policyContext });
      if (path.join('.') === 'nested.value') throw custom;
      return true;
    },
    context: { source: 'adapter' },
  }), (error) => error === custom);
  assert.deepStrictEqual(seen[1].path, ['nested', 'value']);
  assert.deepStrictEqual(seen[1].policyContext, { source: 'adapter' });
});

run('receipt-json-primitives');
