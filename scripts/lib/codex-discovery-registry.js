'use strict';

// Deep discovery module for Codex skill/agent surfaces. Callers provide the
// already discovered providers; this module owns identity, de-duplication,
// precedence, and conflict semantics. Filesystem discovery remains an
// adapter concern so the same interface is usable by release gates and the
// read-only diagnostic CLI.

const VERDICTS = Object.freeze({ PASS: 'PASS', WARN: 'WARN', BLOCKED: 'BLOCKED' });

function asList(value) {
  return Array.isArray(value) ? value : [];
}

function canonicalProviderPath(provider) {
  const candidate = provider.canonicalPath || provider.sourcePath;
  return typeof candidate === 'string' && candidate.trim() ? candidate : null;
}

function normalizeProvider(provider) {
  if (!provider || typeof provider !== 'object') {
    throw new TypeError('discovery provider must be an object');
  }
  const providedId = typeof provider.id === 'string' ? provider.id.trim() : '';
  const name = typeof provider.name === 'string' && provider.name.trim()
    ? provider.name.trim()
    : providedId;
  const kind = typeof provider.kind === 'string' ? provider.kind.trim() : '';
  if (!name) throw new TypeError('discovery provider is missing a public name/id');
  if (!kind) throw new TypeError(`discovery provider '${name}' is missing kind`);
  if (typeof provider.surface !== 'string' || !provider.surface.trim()) {
    throw new TypeError(`discovery provider '${name}' is missing surface`);
  }
  if (typeof provider.fingerprint !== 'string' || !provider.fingerprint) {
    throw new TypeError(`discovery provider '${kind}:${name}' is missing fingerprint`);
  }
  const sourcePath = canonicalProviderPath(provider);
  return Object.freeze({
    ...provider,
    id: providedId || name,
    name,
    kind,
    surface: provider.surface.trim(),
    sourcePath: sourcePath || undefined,
    current: provider.current === true,
    owned: provider.owned === true,
    experimental: provider.experimental === true,
  });
}

function providerIdentity(provider) {
  return [
    provider.surface,
    provider.kind,
    provider.name,
    provider.sourcePath || '',
    provider.fingerprint,
  ].join('\0');
}

function sortProviders(providers, precedence) {
  const rank = new Map(asList(precedence).map((surface, index) => [surface, index]));
  return [...providers].sort((left, right) => {
    const leftRank = rank.has(left.surface) ? rank.get(left.surface) : Number.MAX_SAFE_INTEGER;
    const rightRank = rank.has(right.surface) ? rank.get(right.surface) : Number.MAX_SAFE_INTEGER;
    return leftRank - rightRank
      || `${left.surface}:${left.kind}:${left.name}:${left.sourcePath || ''}`
        .localeCompare(`${right.surface}:${right.kind}:${right.name}:${right.sourcePath || ''}`);
  });
}

function choosePrecedenceProvider(providers, precedence) {
  for (const surface of asList(precedence)) {
    const candidate = providers.find((provider) => (
      provider.surface === surface && provider.current === true && provider.owned === true
    ));
    if (candidate) return candidate;
  }
  return null;
}

function compactProvider(provider) {
  const compact = {
    id: provider.id,
    name: provider.name,
    kind: provider.kind,
    surface: provider.surface,
    version: provider.version,
    fingerprint: provider.fingerprint,
    sourcePath: provider.sourcePath,
    current: provider.current,
    owned: provider.owned,
    experimental: provider.experimental,
  };
  if (provider.fingerprintError) compact.fingerprintError = provider.fingerprintError;
  if (provider.provenance) compact.provenance = { ...provider.provenance };
  return compact;
}

function compactProviders(providers) {
  return providers.map(compactProvider);
}

function inspectCodexDiscovery({ project = [], native = [], precedence = [], receipt = null } = {}) {
  const projectProviders = asList(project)
    .map((provider) => ({ ...provider, surface: provider.surface || 'project-local' }))
    .map(normalizeProvider);
  const nativeProviders = asList(native)
    .map((provider) => ({ ...provider, surface: provider.surface || 'native-experimental' }))
    .map(normalizeProvider);
  const input = [...projectProviders, ...nativeProviders];
  const groups = new Map();
  const seenProviders = new Set();

  for (const provider of input) {
    const identity = providerIdentity(provider);
    if (seenProviders.has(identity)) continue;
    seenProviders.add(identity);
    const key = `${provider.kind}:${provider.name}`;
    const group = groups.get(key) || [];
    group.push(provider);
    groups.set(key, group);
  }

  const effective = [];
  const duplicates = [];
  const conflicts = [];
  let verdict = VERDICTS.PASS;

  for (const [identity, rawProviders] of [...groups.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const providers = sortProviders(rawProviders, precedence);
    const fingerprints = [...new Set(providers.map((provider) => provider.fingerprint))];
    if (providers.length > 1 && fingerprints.length === 1) {
      if (providers.some((provider) => provider.current !== true || provider.owned !== true)) {
        verdict = VERDICTS.BLOCKED;
        conflicts.push({
          identity,
          name: providers[0].name,
          kind: providers[0].kind,
          providers: compactProviders(providers),
          reason: 'identical fingerprints do not override stale or unowned provider evidence',
        });
        continue;
      }
      duplicates.push({
        identity,
        name: providers[0].name,
        kind: providers[0].kind,
        fingerprint: fingerprints[0],
        providers: compactProviders(providers),
        reason: 'identical fingerprints merged into one effective entry',
      });
      effective.push({
        identity,
        name: providers[0].name,
        kind: providers[0].kind,
        status: 'merged',
        fingerprint: fingerprints[0],
        provider: compactProvider(providers[0]),
        providers: compactProviders(providers),
      });
      continue;
    }

    if (fingerprints.length === 1) {
      effective.push({
        identity,
        name: providers[0].name,
        kind: providers[0].kind,
        status: 'single',
        fingerprint: fingerprints[0],
        provider: compactProvider(providers[0]),
        providers: compactProviders(providers),
      });
      continue;
    }

    const winner = choosePrecedenceProvider(providers, precedence);
    if (!winner) {
      verdict = VERDICTS.BLOCKED;
      conflicts.push({
        identity,
        name: providers[0].name,
        kind: providers[0].kind,
        providers: compactProviders(providers),
        reason: 'different fingerprints require an explicit valid precedence',
      });
      continue;
    }

    const fallbackIsExperimental = providers.some((provider) => (
      provider !== winner && provider.experimental === true
    ));
    if (fallbackIsExperimental && verdict === VERDICTS.PASS) verdict = VERDICTS.WARN;
    const conflict = {
      identity,
      name: providers[0].name,
      kind: providers[0].kind,
      providers: compactProviders(providers),
      resolvedBy: winner.surface,
      winner: compactProvider(winner),
      reason: `different fingerprints resolved by explicit precedence '${winner.surface}'`,
    };
    conflicts.push(conflict);
    effective.push({
      identity,
      name: winner.name,
      kind: winner.kind,
      status: 'selected',
      fingerprint: winner.fingerprint,
      provider: compactProvider(winner),
      providers: compactProviders(providers),
    });
  }

  return Object.freeze({
    ok: verdict !== VERDICTS.BLOCKED,
    verdict,
    effective,
    duplicates,
    conflicts,
    receipt,
    providers: {
      project: projectProviders.map(compactProvider),
      native: nativeProviders.map(compactProvider),
    },
  });
}

function inspectCodexActivation({
  project = [],
  native = [],
  precedence = [],
  receipt = null,
  nonInvokableSkillNames = [],
} = {}) {
  const integrity = inspectCodexDiscovery({ project, native, precedence, receipt });
  const nonInvokable = new Set(asList(nonInvokableSkillNames).filter(
    (name) => typeof name === 'string' && name.trim(),
  ));
  const projectSkillNames = new Set(
    integrity.providers.project
      .filter((provider) => provider.kind === 'skills')
      .map((provider) => provider.name),
  );
  const duplicateInvokableNames = [...new Set(
    integrity.providers.native
      .filter((provider) => (
        provider.kind === 'skills'
        && projectSkillNames.has(provider.name)
        && !nonInvokable.has(provider.name)
      ))
      .map((provider) => provider.name),
  )].sort((left, right) => left.localeCompare(right));
  const blockedByDuplicate = duplicateInvokableNames.length > 0;
  return Object.freeze({
    ...integrity,
    ok: !blockedByDuplicate && integrity.ok,
    verdict: blockedByDuplicate ? VERDICTS.BLOCKED : integrity.verdict,
    reasonCode: blockedByDuplicate ? 'DUPLICATE_CODEX_PROVIDER' : null,
    duplicateInvokableNames,
    integrityVerdict: integrity.verdict,
  });
}

module.exports = { VERDICTS, inspectCodexActivation, inspectCodexDiscovery };
