'use strict';

// Pure selection, discovery, and receipt policy for per-Host skill bindings.
// Physical path normalization and filesystem ownership stay in the publisher.

const DIRECT_SHAPE = 'direct';
const NATIVE_LINK_SHAPE = 'native-link';

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, clone(value[key])]));
  }
  return value;
}

function uniqueSorted(values) {
  return [...new Set(values.filter((value) => typeof value === 'string' && value.trim() !== '').map((value) => value.trim()))].sort();
}

function boundStableIds(hostBinding) {
  if (!hostBinding || typeof hostBinding !== 'object' || Array.isArray(hostBinding)) return [];
  if (Array.isArray(hostBinding.emittedStableIds)) return uniqueSorted(hostBinding.emittedStableIds);
  if (Array.isArray(hostBinding.selectedStableIds)) return uniqueSorted(hostBinding.selectedStableIds);
  if (Array.isArray(hostBinding.bindings)) {
    return uniqueSorted(hostBinding.bindings.map((entry) => entry && entry.stableId));
  }
  return [];
}

function selectedAdapterEntries(entries, hostBinding) {
  const selected = hostBinding && Array.isArray(hostBinding.emittedStableIds)
    ? hostBinding.emittedStableIds
    : (hostBinding && Array.isArray(hostBinding.selectedStableIds) ? hostBinding.selectedStableIds : null);
  if (!selected) return entries;
  const allowed = new Set(selected);
  return entries.filter((entry) => allowed.has(entry.stableId));
}

function discoveryVisibleEntries(entries, sourceEntries = entries) {
  const hiddenIds = new Set(sourceEntries
    .filter((entry) => entry.discoveryVisible === false)
    .map((entry) => entry.stableId));
  return entries.filter((entry) => !hiddenIds.has(entry.stableId));
}

function applyHostSelections(hostBindings, hostSelections) {
  if (!hostSelections || typeof hostSelections !== 'object' || Array.isArray(hostSelections)) {
    return hostBindings;
  }
  const next = clone(hostBindings);
  for (const hostId of Object.keys(hostSelections)) {
    if (!next[hostId]) continue;
    const ids = Array.isArray(hostSelections[hostId])
      ? [...new Set(hostSelections[hostId])].sort()
      : [];
    next[hostId] = {
      ...next[hostId],
      selectedStableIds: ids,
      emittedStableIds: ids,
    };
  }
  return next;
}

function restorePreservedHostBindings(hostBindings, preserveHostBindings) {
  if (!preserveHostBindings || typeof preserveHostBindings !== 'object' || Array.isArray(preserveHostBindings)) {
    return hostBindings;
  }
  const next = clone(hostBindings);
  for (const hostId of Object.keys(preserveHostBindings)) {
    next[hostId] = clone(preserveHostBindings[hostId]);
  }
  return next;
}

function stampDiscoveryHost(hostBindings, bindingPaths, providers, {
  hostId,
  bindingShape = null,
  bindingReason = null,
}) {
  const discovery = providers.forHost[hostId] && providers.forHost[hostId].discovery;
  if (!discovery) return { hostBindings, bindingPaths };

  const direct = bindingShape === DIRECT_SHAPE;
  const nextHostBindings = { ...hostBindings };
  const nextBindingPaths = { ...bindingPaths };
  nextBindingPaths[hostId] = direct
    ? []
    : discovery.entries.map(({ path: bindingPath, target }) => ({ path: bindingPath, target }));
  const stamped = {
    ...hostBindings[hostId],
    discovery: {
      adapterId: discovery.id,
      adapterVersion: discovery.version,
      kind: direct ? DIRECT_SHAPE : discovery.kind,
      sourceRoot: discovery.sourceRoot,
      destinationRoot: discovery.destinationRoot,
      paths: nextBindingPaths[hostId].map((entry) => entry.path),
    },
  };
  if (bindingShape) {
    stamped.bindingShape = bindingShape;
    stamped.bindings = discovery.entries.map((entry) => (direct
      ? { stableId: entry.stableId, name: entry.name, shape: DIRECT_SHAPE }
      : { stableId: entry.stableId, name: entry.name, path: entry.path, target: entry.target, shape: bindingShape }));
  }
  if (bindingReason) stamped.bindingReason = bindingReason;
  nextHostBindings[hostId] = stamped;
  return { hostBindings: nextHostBindings, bindingPaths: nextBindingPaths };
}

function policyError(message) {
  return new Error(message);
}

function validateLegacyUnboundFlag(receipt) {
  const legacyUnbound = receipt.legacyUnbound === true;
  if (receipt.legacyUnbound !== undefined && typeof receipt.legacyUnbound !== 'boolean') {
    throw policyError('project projection receipt legacyUnbound flag is invalid');
  }
  return legacyUnbound;
}

function validateReceiptBindingState(receipt, bindingPaths) {
  const legacyUnbound = validateLegacyUnboundFlag(receipt);
  const allowedBindingHosts = new Set(['claude', 'codex', 'cursor']);
  for (const hostId of Object.keys(bindingPaths)) {
    if (!allowedBindingHosts.has(hostId)) {
      throw policyError(`project projection receipt has unsupported Host binding paths: ${hostId}`);
    }
  }
  if (legacyUnbound && Object.keys(receipt.hostBindings || {}).length > 0) {
    throw policyError('legacy-unbound project projection receipt cannot claim active Host bindings');
  }
  return legacyUnbound;
}

function assertDiscoveryBindingSet(receipt, providers, bindingPaths, {
  hostId,
  label,
  bindingShape = null,
  required = true,
}) {
  const discovery = providers.forHost[hostId] && providers.forHost[hostId].discovery;
  if (!required) {
    if (bindingPaths[hostId] && bindingPaths[hostId].length > 0) {
      throw policyError(`project projection receipt has ${label} paths without a ${label} Host binding`);
    }
    return;
  }
  if (bindingShape === DIRECT_SHAPE) {
    if ((bindingPaths[hostId] || []).length > 0) {
      throw policyError(`project projection receipt ${label} direct bindings must not publish native-link paths`);
    }
    const descriptor = receipt.hostBindings[hostId] && receipt.hostBindings[hostId].discovery;
    if (!descriptor || descriptor.adapterId !== (discovery && discovery.id)
      || descriptor.adapterVersion !== (discovery && discovery.version)) {
      throw policyError(`project projection receipt ${label} discovery adapter identity is invalid`);
    }
    if (receipt.hostBindings[hostId].bindingShape !== DIRECT_SHAPE) {
      throw policyError(`project projection receipt ${label} bindingShape must be ${DIRECT_SHAPE}`);
    }
    const expectedNames = (discovery && discovery.entries ? discovery.entries : [])
      .map((entry) => entry.name)
      .sort();
    const bindings = Array.isArray(receipt.hostBindings[hostId].bindings) ? receipt.hostBindings[hostId].bindings : [];
    const actualNames = bindings.map((entry) => entry && entry.name).sort();
    if (bindings.some((entry) => !entry || entry.shape !== DIRECT_SHAPE || entry.path || entry.target)
      || actualNames.join('\0') !== expectedNames.join('\0')) {
      throw policyError(`project projection receipt ${label} direct bindings do not match the selected artifact`);
    }
    return;
  }
  if (discovery) {
    const expected = discovery.entries.map((entry) => ({ path: entry.path, target: entry.target }));
    const actual = bindingPaths[hostId] || [];
    if (actual.length !== expected.length || actual.some((entry, index) => entry.path !== expected[index].path || entry.target !== expected[index].target)) {
      throw policyError(`project projection receipt ${label} discovery bindings do not match the selected artifact`);
    }
    const descriptor = receipt.hostBindings[hostId] && receipt.hostBindings[hostId].discovery;
    if (!descriptor || descriptor.adapterId !== discovery.id || descriptor.adapterVersion !== discovery.version) {
      throw policyError(`project projection receipt ${label} discovery adapter identity is invalid`);
    }
    if (bindingShape && receipt.hostBindings[hostId].bindingShape !== bindingShape) {
      throw policyError(`project projection receipt ${label} bindingShape must be ${bindingShape}`);
    }
  } else if (bindingPaths[hostId] && bindingPaths[hostId].length > 0) {
    throw policyError(`project projection receipt has ${label} paths without a ${label} Host binding`);
  }
}

function validateReceiptBindings(receipt, providers, bindingPaths) {
  if (!providers) throw policyError('project projection receipt Host binding descriptors are unavailable');
  for (const hostId of Object.keys(bindingPaths)) {
    if (!providers.forHost[hostId]) {
      throw policyError(`project projection receipt has an unbound Host path set: ${hostId}`);
    }
  }

  assertDiscoveryBindingSet(receipt, providers, bindingPaths, {
    hostId: 'claude',
    label: 'Claude',
  });
  for (const [hostId, label] of [['cursor', 'Cursor'], ['codex', 'Codex']]) {
    const binding = receipt.hostBindings && receipt.hostBindings[hostId];
    const shape = binding && (
      binding.bindingShape === DIRECT_SHAPE || binding.bindingShape === NATIVE_LINK_SHAPE
    ) ? binding.bindingShape : null;
    const discoveryRecorded = Boolean(
      binding && (
        binding.discovery
        || shape
        || (bindingPaths[hostId] && bindingPaths[hostId].length > 0)
      )
    );
    assertDiscoveryBindingSet(receipt, providers, bindingPaths, {
      hostId,
      label,
      bindingShape: discoveryRecorded ? (shape || NATIVE_LINK_SHAPE) : null,
      required: discoveryRecorded,
    });
  }
  return bindingPaths;
}

module.exports = {
  DIRECT_SHAPE,
  NATIVE_LINK_SHAPE,
  uniqueSorted,
  boundStableIds,
  selectedAdapterEntries,
  discoveryVisibleEntries,
  applyHostSelections,
  restorePreservedHostBindings,
  stampDiscoveryHost,
  validateReceiptBindingState,
  validateReceiptBindings,
  validateLegacyUnboundFlag,
};
