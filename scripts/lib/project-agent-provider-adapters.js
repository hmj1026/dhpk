'use strict';

// Provider-shaped renderers for the shared project skill artifact. Selection
// stays in project-agent-projection-plan.js; this module only validates the
// compiler-owned Host bindings and describes how each Host reads the shared
// output.

const path = require('node:path');

const PROJECT_AGENT_PROVIDER_ADAPTER_SCHEMA = 'dhpk.project-agent-provider-adapters.v1';
const PROJECT_AGENT_PROVIDER_ADAPTER_VERSION = '1.0.0';
const DIRECTORY_SHAPE = 'project-skill-directory';
const DIRECT_FILE_SHAPE = 'project-skill-direct-file';
const DIRECTORY_KIND = 'directory';
const DIRECT_FILE_KIND = 'direct-file';
const AGY_DIRECT_FILE_TRANSFORM_ID = 'agy-project-direct-file';
const DIRECTORY_OUTPUT_TRANSFORM = Object.freeze({ id: 'project-agent-directory-skill', version: '1' });
const AGY_PROJECT_PROBE_PRODUCER = 'consumer-platform-probe';
const AGY_PROJECT_PROBE_ADAPTER = Object.freeze({ id: AGY_DIRECT_FILE_TRANSFORM_ID, version: '1.0.0' });
const AGY_PROJECT_PROBE_CLAIMS = Object.freeze(['project-artifact-structure', 'project-agent-direct-file']);

const HOST_IDS = Object.freeze(['agy', 'claude', 'codex', 'cursor']);
const CLAUDE_PROJECT_DISCOVERY_ADAPTER_ID = 'claude-project-discovery';
const CLAUDE_PROJECT_DISCOVERY_ADAPTER_VERSION = '1.0.0';
const CLAUDE_PROJECT_DISCOVERY_SOURCE_ROOT = '.agents/skills';
const CLAUDE_PROJECT_DISCOVERY_DESTINATION_ROOT = '.claude/skills';
const CURSOR_PROJECT_DISCOVERY_ADAPTER_ID = 'cursor-project-discovery';
const CURSOR_PROJECT_DISCOVERY_ADAPTER_VERSION = '1.0.0';
const CURSOR_PROJECT_DISCOVERY_DESTINATION_ROOT = '.cursor/skills';
const CODEX_PROJECT_DISCOVERY_ADAPTER_ID = 'codex-project-discovery';
const CODEX_PROJECT_DISCOVERY_ADAPTER_VERSION = '1.0.0';
const CODEX_PROJECT_DISCOVERY_DESTINATION_ROOT = '.codex/skills';
const NATIVE_LINK_SHAPE = 'native-link';
const DIRECT_SHAPE = 'direct';
const CURSOR_PROJECT_PROBE_PRODUCER = 'consumer-platform-probe';
const CURSOR_PROJECT_PROBE_ADAPTER = Object.freeze({ id: CURSOR_PROJECT_DISCOVERY_ADAPTER_ID, version: CURSOR_PROJECT_DISCOVERY_ADAPTER_VERSION });
const CURSOR_PROJECT_PROBE_CLAIMS = Object.freeze(['project-artifact-structure', 'cursor-project-discovery', 'consumer-route']);
const CURSOR_PROJECT_PROBE_SURFACE = 'cursor-project';
const CODEX_PROJECT_PROBE_PRODUCER = 'consumer-platform-probe';
const CODEX_PROJECT_PROBE_ADAPTER = Object.freeze({ id: CODEX_PROJECT_DISCOVERY_ADAPTER_ID, version: CODEX_PROJECT_DISCOVERY_ADAPTER_VERSION });
const CODEX_PROJECT_PROBE_CLAIMS = Object.freeze(['project-artifact-structure', 'codex-project-discovery', 'consumer-route']);
const CODEX_PROJECT_PROBE_SURFACE = 'codex-project';

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, clone(value[key])]));
  }
  return value;
}

function adapterError(code, message, details = {}) {
  return Object.assign(new Error(message), {
    providerAdapterCode: code,
    projectionCode: code,
    projectionDetails: details,
  });
}

function isObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function validateTransform(transform, hostId) {
  if (!isObject(transform) || !isNonEmptyString(transform.id) || !isNonEmptyString(transform.version)) {
    throw adapterError('INVALID_PROVIDER_TRANSFORM', `project Host '${hostId}' requires a transform id and version`, {
      details: { host: hostId, transform },
    });
  }
  if (hostId === 'agy' && transform.id !== AGY_DIRECT_FILE_TRANSFORM_ID) {
    throw adapterError(
      'INVALID_PROVIDER_TRANSFORM',
      `AGY project skill adapter must use transform '${AGY_DIRECT_FILE_TRANSFORM_ID}'`,
      { details: { host: hostId, transform } },
    );
  }
  return clone(transform);
}

function bindingValue(binding, hostId) {
  if (!isObject(binding)) {
    throw adapterError('INVALID_PROVIDER_BINDING', `project Host '${hostId}' binding must be an object`, {
      details: { host: hostId },
    });
  }
  const shape = binding.shape;
  const expectedShape = hostId === 'agy' ? DIRECT_FILE_SHAPE : DIRECTORY_SHAPE;
  if (shape !== expectedShape) {
    throw adapterError(
      'INCOMPATIBLE_PROVIDER_SHAPE',
      `${hostId === 'agy' ? 'AGY' : hostId} project skill adapter requires shape '${expectedShape}'`,
      { details: { host: hostId, expectedShape, actualShape: shape } },
    );
  }
  if (!isNonEmptyString(binding.surface)) {
    throw adapterError('INVALID_PROVIDER_BINDING', `project Host '${hostId}' binding is missing its surface`, {
      details: { host: hostId },
    });
  }
  const transform = validateTransform(binding.transform, hostId);
  return {
    host: hostId,
    surface: binding.surface,
    evidenceSource: binding.evidenceSource || binding.evidence_source || null,
    shape,
    kind: hostId === 'agy' ? DIRECT_FILE_KIND : DIRECTORY_KIND,
    transform,
  };
}

function safeProjectRelative(value, label) {
  if (!isNonEmptyString(value)
    || value.startsWith('/')
    || value.includes('\\')
    || value.includes('\0')
    || value.split('/').some((segment) => !segment || segment === '.' || segment === '..')) {
    throw adapterError('UNSAFE_PROVIDER_REFERENCE', `${label} must be a normalized project-relative path`, {
      details: { path: value },
    });
  }
  return value;
}

function createProjectDiscoveryAdapter({
  id,
  version,
  entries = [],
  sourceRoot,
  destinationRoot,
  hostLabel,
  bindingShape = null,
} = {}) {
  safeProjectRelative(sourceRoot, `${hostLabel} shared source root`);
  safeProjectRelative(destinationRoot, `${hostLabel} discovery destination root`);
  if (sourceRoot === destinationRoot || sourceRoot.startsWith(`${destinationRoot}/`)) {
    throw adapterError('UNSAFE_PROVIDER_REFERENCE', `${hostLabel} discovery source and destination roots must be distinct`);
  }
  if (!Array.isArray(entries)) throw adapterError('INVALID_PROVIDER_OUTPUT', `${hostLabel} discovery entries must be an array`);
  const seenIds = new Set();
  const seenNames = new Set();
  const normalizedEntries = entries.map((entry) => {
    if (!isObject(entry) || !isNonEmptyString(entry.stableId) || !isNonEmptyString(entry.name)) {
      throw adapterError('INVALID_PROVIDER_OUTPUT', `${hostLabel} discovery entries require stableId and name`);
    }
    const stableId = entry.stableId.trim();
    const name = entry.name.trim();
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
      throw adapterError('UNSAFE_PROVIDER_REFERENCE', `${hostLabel} discovery skill name is unsafe: ${name}`);
    }
    if (seenIds.has(stableId) || seenNames.has(name)) {
      throw adapterError('DUPLICATE_PROVIDER_OUTPUT', `${hostLabel} discovery entry is duplicated: ${name}`);
    }
    seenIds.add(stableId);
    seenNames.add(name);
    const pathName = `${destinationRoot}/${name}`;
    const target = path.posix.relative(destinationRoot, `${sourceRoot}/${name}`);
    if (!target || path.posix.isAbsolute(target)
      || path.posix.normalize(path.posix.join(destinationRoot, target)) !== `${sourceRoot}/${name}`) {
      throw adapterError('UNSAFE_PROVIDER_REFERENCE', `${hostLabel} discovery target is unsafe: ${name}`);
    }
    return { stableId, name, path: pathName, target };
  }).sort((left, right) => left.name.localeCompare(right.name));
  const adapter = {
    id,
    version,
    kind: 'symlink',
    sourceRoot,
    destinationRoot,
    owner: 'dhpk.project-agent-projection',
    entries: normalizedEntries,
  };
  if (bindingShape) adapter.bindingShape = bindingShape;
  return adapter;
}

function createClaudeProjectDiscoveryAdapter({
  entries = [],
  sourceRoot = CLAUDE_PROJECT_DISCOVERY_SOURCE_ROOT,
  destinationRoot = CLAUDE_PROJECT_DISCOVERY_DESTINATION_ROOT,
} = {}) {
  return createProjectDiscoveryAdapter({
    id: CLAUDE_PROJECT_DISCOVERY_ADAPTER_ID,
    version: CLAUDE_PROJECT_DISCOVERY_ADAPTER_VERSION,
    entries,
    sourceRoot,
    destinationRoot,
    hostLabel: 'Claude',
  });
}

function nativeLinkBindingShape(requested, recorded) {
  return requested === DIRECT_SHAPE || recorded === DIRECT_SHAPE ? DIRECT_SHAPE : NATIVE_LINK_SHAPE;
}

function selectedAdapterEntries(entries, hostBinding) {
  const selected = hostBinding && Array.isArray(hostBinding.selectedStableIds)
    ? hostBinding.selectedStableIds
    : null;
  if (!selected) return entries;
  const allowed = new Set(selected);
  return entries.filter((entry) => allowed.has(entry.stableId));
}

function createNativeLinkDiscoveryAdapter({
  id,
  version,
  hostLabel,
  destinationRoot,
  entries = [],
  sourceRoot = CLAUDE_PROJECT_DISCOVERY_SOURCE_ROOT,
  bindingShape = NATIVE_LINK_SHAPE,
} = {}) {
  if (bindingShape !== NATIVE_LINK_SHAPE && bindingShape !== DIRECT_SHAPE) {
    throw adapterError(
      'INCOMPATIBLE_PROVIDER_SHAPE',
      `${hostLabel} project skill adapter requires bindingShape '${NATIVE_LINK_SHAPE}' or '${DIRECT_SHAPE}'`,
      { details: { bindingShape } },
    );
  }
  const adapter = createProjectDiscoveryAdapter({
    id,
    version,
    entries,
    sourceRoot,
    destinationRoot,
    hostLabel,
    bindingShape,
  });
  if (bindingShape === DIRECT_SHAPE) {
    adapter.kind = 'direct';
    adapter.entries = adapter.entries.map(({ stableId, name }) => ({ stableId, name }));
  }
  return adapter;
}

function createCursorProjectDiscoveryAdapter({
  entries = [],
  sourceRoot = CLAUDE_PROJECT_DISCOVERY_SOURCE_ROOT,
  destinationRoot = CURSOR_PROJECT_DISCOVERY_DESTINATION_ROOT,
  bindingShape = NATIVE_LINK_SHAPE,
} = {}) {
  return createNativeLinkDiscoveryAdapter({
    id: CURSOR_PROJECT_DISCOVERY_ADAPTER_ID,
    version: CURSOR_PROJECT_DISCOVERY_ADAPTER_VERSION,
    hostLabel: 'Cursor',
    destinationRoot,
    entries,
    sourceRoot,
    bindingShape,
  });
}

function createCodexProjectDiscoveryAdapter({
  entries = [],
  sourceRoot = CLAUDE_PROJECT_DISCOVERY_SOURCE_ROOT,
  destinationRoot = CODEX_PROJECT_DISCOVERY_DESTINATION_ROOT,
  bindingShape = NATIVE_LINK_SHAPE,
} = {}) {
  return createNativeLinkDiscoveryAdapter({
    id: CODEX_PROJECT_DISCOVERY_ADAPTER_ID,
    version: CODEX_PROJECT_DISCOVERY_ADAPTER_VERSION,
    hostLabel: 'Codex',
    destinationRoot,
    entries,
    sourceRoot,
    bindingShape,
  });
}

function createProjectAgentProviderAdapters(hostBindings = {}, {
  entries = [],
  claudeSourceRoot = CLAUDE_PROJECT_DISCOVERY_SOURCE_ROOT,
  claudeDestinationRoot = CLAUDE_PROJECT_DISCOVERY_DESTINATION_ROOT,
  cursorBindingShape = null,
  codexBindingShape = null,
} = {}) {
  if (!isObject(hostBindings)) {
    throw adapterError('INVALID_PROVIDER_BINDING', 'project Host bindings must be an object');
  }
  const hostIds = Object.keys(hostBindings).sort();
  if (hostIds.length === 0) {
    throw adapterError('INVALID_PROVIDER_BINDING', 'project projection requires at least one Host binding');
  }
  const unknown = hostIds.filter((hostId) => !HOST_IDS.includes(hostId));
  if (unknown.length > 0) {
    throw adapterError('INVALID_PROVIDER_BINDING', `project projection contains unsupported Host bindings: ${unknown.join(', ')}`, {
      details: { hosts: unknown },
    });
  }

  const normalized = Object.fromEntries(hostIds.map((hostId) => [hostId, bindingValue(hostBindings[hostId], hostId)]));
  if (normalized.claude) {
    normalized.claude.discovery = createClaudeProjectDiscoveryAdapter({
      entries,
      sourceRoot: claudeSourceRoot,
      destinationRoot: claudeDestinationRoot,
    });
  }
  if (normalized.cursor) {
    const shape = nativeLinkBindingShape(
      cursorBindingShape,
      hostBindings.cursor && hostBindings.cursor.bindingShape,
    );
    normalized.cursor.discovery = createCursorProjectDiscoveryAdapter({
      entries: selectedAdapterEntries(entries, hostBindings.cursor),
      sourceRoot: claudeSourceRoot,
      bindingShape: shape,
    });
  }
  if (normalized.codex) {
    const shape = nativeLinkBindingShape(
      codexBindingShape,
      hostBindings.codex && hostBindings.codex.bindingShape,
    );
    normalized.codex.discovery = createCodexProjectDiscoveryAdapter({
      entries: selectedAdapterEntries(entries, hostBindings.codex),
      sourceRoot: claudeSourceRoot,
      bindingShape: shape,
    });
  }
  const directoryHosts = hostIds.filter((hostId) => normalized[hostId].kind === DIRECTORY_KIND);
  const directFileHosts = hostIds.filter((hostId) => normalized[hostId].kind === DIRECT_FILE_KIND);
  return {
    schema: PROJECT_AGENT_PROVIDER_ADAPTER_SCHEMA,
    version: PROJECT_AGENT_PROVIDER_ADAPTER_VERSION,
    forHost: normalized,
    directory: {
      kind: DIRECTORY_KIND,
      shape: DIRECTORY_SHAPE,
      hosts: directoryHosts,
      // Directory output is shared by Codex, Cursor, and any future Host
      // using the same Agent Skills contract. Host-specific binding transforms
      // remain in the receipt; this is the physical artifact transform.
      transform: clone(DIRECTORY_OUTPUT_TRANSFORM),
    },
    directFile: {
      kind: DIRECT_FILE_KIND,
      shape: DIRECT_FILE_SHAPE,
      hosts: directFileHosts,
      transform: directFileHosts.length > 0
        ? clone(normalized[directFileHosts[0]].transform)
        : null,
    },
  };
}

function isPassingAgyConsumerProbe(evidence, expected = null) {
  if (!isObject(evidence) || !isObject(expected)) return false;

  const layers = [evidence];
  if (isObject(evidence.surfaceEvidence)) layers.push(evidence.surfaceEvidence);
  if (Array.isArray(evidence.surfaceResults) && evidence.surfaceResults.length === 1 && isObject(evidence.surfaceResults[0])) {
    layers.push(evidence.surfaceResults[0]);
  }
  const readConsistent = (key, normalize = (value) => value) => {
    let found = false;
    let value;
    for (const layer of layers) {
      if (!Object.prototype.hasOwnProperty.call(layer, key)) continue;
      const candidate = normalize(layer[key]);
      if (!found) {
        found = true;
        value = candidate;
      } else if (candidate !== value) {
        return { found: true, consistent: false, value: null };
      }
    }
    return { found, consistent: true, value };
  };
  const normalizeFingerprint = (value) => {
    if (typeof value !== 'string') return value;
    return /^[a-f0-9]{64}$/i.test(value) ? `sha256:${value}` : value;
  };
  const sameSortedList = (left, right) => Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && new Set(left).size === left.length
    && left.slice().sort().every((value, index) => value === right.slice().sort()[index]);
  const expectedPlan = normalizeFingerprint(expected.planFingerprint);
  const expectedArtifact = normalizeFingerprint(expected.artifactFingerprint);
  const fingerprint = (value) => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/i.test(value);
  if (!fingerprint(expectedPlan) || !fingerprint(expectedArtifact)) return false;
  if (expected.producer !== AGY_PROJECT_PROBE_PRODUCER) return false;
  if (!isObject(expected.adapter)
    || expected.adapter.id !== AGY_PROJECT_PROBE_ADAPTER.id
    || expected.adapter.version !== AGY_PROJECT_PROBE_ADAPTER.version) return false;
  if (!sameSortedList(expected.checkedClaims, AGY_PROJECT_PROBE_CLAIMS)) return false;

  const stage = readConsistent('stage');
  const surface = readConsistent('surface');
  const status = readConsistent('status');
  const producer = readConsistent('producer');
  const plan = readConsistent('planFingerprint', normalizeFingerprint);
  const artifact = readConsistent('artifactFingerprint', normalizeFingerprint);
  const claims = readConsistent('checkedClaims', (value) => Array.isArray(value) ? value.slice().sort().join('\u0000') : value);
  const adapters = layers
    .filter((layer) => Object.prototype.hasOwnProperty.call(layer, 'adapter'))
    .map((layer) => layer.adapter);
  const adapterMatches = adapters.length > 0 && adapters.every((adapter) => isObject(adapter)
    && adapter.id === AGY_PROJECT_PROBE_ADAPTER.id
    && adapter.version === AGY_PROJECT_PROBE_ADAPTER.version);
  return stage.found && stage.consistent && stage.value === 'CONSUMER'
    && surface.found && surface.consistent && surface.value === 'agy-plugin'
    && status.found && status.consistent && status.value === 'PASS'
    && producer.found && producer.consistent && producer.value === expected.producer
    && plan.found && plan.consistent && fingerprint(plan.value) && plan.value === expectedPlan
    && artifact.found && artifact.consistent && fingerprint(artifact.value) && artifact.value === expectedArtifact
    && claims.found && claims.consistent && claims.value === AGY_PROJECT_PROBE_CLAIMS.slice().sort().join('\u0000')
    && adapterMatches;
}

function renderAgyDirectFile({ name, description, body, siblingPackage = null, consumerEvidence = null, consumerExpectation = null } = {}) {
  if (!isNonEmptyString(name) || !(typeof body === 'string' || Buffer.isBuffer(body)) || body.length === 0) {
    throw adapterError('INVALID_PROVIDER_OUTPUT', 'AGY direct-file rendering requires a name and body');
  }
  if (!siblingPackage) return { resolution: 'self-contained', content: body };
  if (!isNonEmptyString(siblingPackage) || siblingPackage.includes('\\') || siblingPackage.startsWith('/') || siblingPackage.includes('..')) {
    throw adapterError('UNSAFE_PROVIDER_REFERENCE', 'AGY sibling package reference must be a safe relative path');
  }
  if (!isPassingAgyConsumerProbe(consumerEvidence, consumerExpectation)) {
    throw adapterError(
      'AGY_SIBLING_UNVERIFIED',
      'AGY sibling package resolution requires a passing bounded consumer probe',
      { details: { siblingPackage } },
    );
  }
  const frontmatterDescription = isNonEmptyString(description) ? description : name;
  return {
    resolution: 'verified-sibling-package',
    content: [
      '---',
      `name: ${name}`,
      `description: ${JSON.stringify(frontmatterDescription)}`,
      '---',
      '',
      '# Generated Antigravity project adapter',
      '',
      `Read and follow the verified sibling package at \`${siblingPackage}\` from this project artifact.`,
      '',
    ].join('\n'),
  };
}

module.exports = {
  PROJECT_AGENT_PROVIDER_ADAPTER_SCHEMA,
  PROJECT_AGENT_PROVIDER_ADAPTER_VERSION,
  DIRECTORY_SHAPE,
  DIRECT_FILE_SHAPE,
  DIRECTORY_KIND,
  DIRECT_FILE_KIND,
  AGY_DIRECT_FILE_TRANSFORM_ID,
  DIRECTORY_OUTPUT_TRANSFORM,
  AGY_PROJECT_PROBE_PRODUCER,
  AGY_PROJECT_PROBE_ADAPTER,
  AGY_PROJECT_PROBE_CLAIMS,
  CLAUDE_PROJECT_DISCOVERY_ADAPTER_ID,
  CLAUDE_PROJECT_DISCOVERY_ADAPTER_VERSION,
  CLAUDE_PROJECT_DISCOVERY_SOURCE_ROOT,
  CLAUDE_PROJECT_DISCOVERY_DESTINATION_ROOT,
  CURSOR_PROJECT_DISCOVERY_ADAPTER_ID,
  CURSOR_PROJECT_DISCOVERY_ADAPTER_VERSION,
  CURSOR_PROJECT_DISCOVERY_DESTINATION_ROOT,
  CODEX_PROJECT_DISCOVERY_ADAPTER_ID,
  CODEX_PROJECT_DISCOVERY_ADAPTER_VERSION,
  CODEX_PROJECT_DISCOVERY_DESTINATION_ROOT,
  NATIVE_LINK_SHAPE,
  DIRECT_SHAPE,
  CURSOR_PROJECT_PROBE_PRODUCER,
  CURSOR_PROJECT_PROBE_ADAPTER,
  CURSOR_PROJECT_PROBE_CLAIMS,
  CURSOR_PROJECT_PROBE_SURFACE,
  CODEX_PROJECT_PROBE_PRODUCER,
  CODEX_PROJECT_PROBE_ADAPTER,
  CODEX_PROJECT_PROBE_CLAIMS,
  CODEX_PROJECT_PROBE_SURFACE,
  createClaudeProjectDiscoveryAdapter,
  createCursorProjectDiscoveryAdapter,
  createCodexProjectDiscoveryAdapter,
  createProjectAgentProviderAdapters,
  isPassingAgyConsumerProbe,
  renderAgyDirectFile,
};
