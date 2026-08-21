'use strict';

// Compiler-bound projection parity.  This module observes declared plans and
// artifacts only; it never selects entries, reads budgets, or scans a package
// directory.

const {
  VERDICTS,
  createEvidenceResult,
  fingerprint,
} = require('./distribution-projection-contract');

const PARITY_SCHEMA = 'dhpk.distribution-projection-parity-result.v1';
const CHECKER = Object.freeze({ id: 'distribution-projection-parity', version: '1' });
const CHECKED_FIELDS = Object.freeze([
  'stableId',
  'name',
  'target',
  'selector',
  'invocationClass',
  'source',
  'sourceFingerprint',
  'transform',
  'owner',
  'destination',
  'outputFingerprint',
]);

function value(value) {
  if (Buffer.isBuffer(value)) return { type: 'buffer', sha256: fingerprint(value.toString('base64')) };
  return value;
}

function normalized(valueToNormalize) {
  if (Array.isArray(valueToNormalize)) return valueToNormalize.map(normalized);
  if (valueToNormalize && typeof valueToNormalize === 'object') {
    const output = Object.create(null);
    for (const key of Object.keys(valueToNormalize).sort()) output[key] = normalized(valueToNormalize[key]);
    return output;
  }
  return value(valueToNormalize);
}

function safeCanonicalize(valueToCanonicalize) {
  if (Array.isArray(valueToCanonicalize)) return `[${valueToCanonicalize.map(safeCanonicalize).join(',')}]`;
  if (valueToCanonicalize && typeof valueToCanonicalize === 'object') {
    return `{${Object.keys(valueToCanonicalize).sort().map((key) => `${JSON.stringify(key)}:${safeCanonicalize(valueToCanonicalize[key])}`).join(',')}}`;
  }
  return JSON.stringify(valueToCanonicalize);
}

function entryId(entry, index) {
  if (!entry || typeof entry !== 'object') return `<entry-${index}>`;
  return entry.stableId || entry.id || entry.name || `<entry-${index}>`;
}

function asEntries(valueToRead) {
  if (Array.isArray(valueToRead)) return valueToRead;
  if (!valueToRead || typeof valueToRead !== 'object') return [];
  return Object.entries(valueToRead).map(([id, entry]) => ({
    ...(entry && typeof entry === 'object' ? entry : {}),
    stableId: entry && typeof entry === 'object' && (entry.stableId || entry.id) || id,
  }));
}

function subjectProjection(subject) {
  return subject && (subject.projection || subject.routingProjection || subject.plan && subject.plan.projection) || null;
}

function subjectPlan(subject) {
  return subject && (subject.plan || subject.expectedPlan || subject.distributionPlan) || null;
}

function subjectArtifact(subject) {
  return subject && (subject.artifact || subject.actualArtifact || subject.distributionArtifact) || null;
}

function surfaceOf(subject) {
  return subject && (subject.surface || subject.plan && subject.plan.surface || subject.projection && subject.projection.surface) || null;
}

function profileIdOf(subject) {
  const profile = subject && (subject.profile || subject.plan && subject.plan.profile || subject.plan && subject.plan.profileSelection);
  return profile && (profile.id || profile.profileId) || null;
}

function declaredProfileIdOf(subject) {
  const profile = subject && subject.profile;
  return profile && (profile.id || profile.profileId) || (subject && typeof subject.profileId === 'string' ? subject.profileId : null);
}

function planFingerprintOf(plan) {
  return plan && typeof plan.planFingerprint === 'string' ? plan.planFingerprint : null;
}

function artifactFingerprintOf(artifact) {
  return artifact && typeof artifact.artifactFingerprint === 'string' ? artifact.artifactFingerprint : null;
}

function compareField(mismatches, diagnostics, stableId, field, expectedValue, actualValue, surface) {
  if (safeCanonicalize(normalized(expectedValue)) === safeCanonicalize(normalized(actualValue))) return;
  mismatches.push({ stableId, surface, type: 'field', field, expected: expectedValue, actual: actualValue });
  diagnostics.push(`stable id '${stableId}' on surface '${surface}' field drift '${field}'`);
}

function compareEntries({ expectedEntries, actualEntries, surface, mismatches, diagnostics, fields }) {
  const expectedMap = new Map();
  const actualMap = new Map();
  for (const [index, entry] of asEntries(expectedEntries).entries()) {
    const stableId = entryId(entry, index);
    if (expectedMap.has(stableId)) {
      mismatches.push({ stableId, surface, type: 'duplicate', side: 'expected', expected: entry });
      diagnostics.push(`stable id '${stableId}' on surface '${surface}' is duplicated in expected projection`);
    } else expectedMap.set(stableId, entry);
  }
  for (const [index, entry] of asEntries(actualEntries).entries()) {
    const stableId = entryId(entry, index);
    if (actualMap.has(stableId)) {
      mismatches.push({ stableId, surface, type: 'duplicate', side: 'actual', actual: entry });
      diagnostics.push(`stable id '${stableId}' on surface '${surface}' is duplicated in actual projection`);
    } else actualMap.set(stableId, entry);
  }
  const ids = [...new Set([...expectedMap.keys(), ...actualMap.keys()])].sort();
  for (const stableId of ids) {
    const expectedEntry = expectedMap.get(stableId);
    const actualEntry = actualMap.get(stableId);
    if (!expectedEntry) {
      mismatches.push({ stableId, surface, type: 'extra', expected: undefined, actual: actualEntry });
      diagnostics.push(`stable id '${stableId}' on surface '${surface}' is extra in actual projection`);
      continue;
    }
    if (!actualEntry) {
      mismatches.push({ stableId, surface, type: 'missing', expected: expectedEntry, actual: undefined });
      diagnostics.push(`stable id '${stableId}' on surface '${surface}' is missing from actual projection`);
      continue;
    }
    for (const field of fields) {
      let expectedValue = expectedEntry[field];
      let actualValue = actualEntry[field];
      if (field === 'outputFingerprint') {
        expectedValue = expectedEntry.outputFingerprint || expectedEntry.expectedFingerprint || expectedEntry.fingerprint;
        actualValue = actualEntry.outputFingerprint || actualEntry.expectedFingerprint || actualEntry.fingerprint;
      }
      compareField(mismatches, diagnostics, stableId, field, expectedValue, actualValue, surface);
    }
  }
}

function validateSubject(subject, label, diagnostics) {
  const plan = subjectPlan(subject);
  const artifact = subjectArtifact(subject);
  const surface = surfaceOf(subject);
  if (!surface) diagnostics.push(`${label} projection requires a target surface`);
  if (!plan || typeof plan !== 'object') diagnostics.push(`${label} projection requires a compiler-owned plan`);
  if (!artifact || typeof artifact !== 'object') diagnostics.push(`${label} projection requires a materialized artifact`);
  if (plan && typeof plan === 'object' && !Array.isArray(plan.entries)) diagnostics.push(`${label} compiler-owned plan must contain an entries array`);
  if (artifact && typeof artifact === 'object' && !Array.isArray(artifact.outputs)) diagnostics.push(`${label} materialized artifact must contain an outputs array`);
  const planFingerprint = planFingerprintOf(plan);
  const artifactFingerprint = artifactFingerprintOf(artifact);
  if (!planFingerprint) diagnostics.push(`${label} projection has no plan fingerprint`);
  if (!artifactFingerprint) diagnostics.push(`${label} projection has no artifact fingerprint`);
  if (plan && artifact && artifact.planFingerprint !== planFingerprint) {
    diagnostics.push(`${label} artifact is stale: artifact plan fingerprint does not match plan`);
  }
  const declaredSurface = subject && typeof subject.surface === 'string' ? subject.surface : null;
  if (declaredSurface && plan && typeof plan.surface === 'string' && declaredSurface !== plan.surface) {
    diagnostics.push(`${label} outer surface identity '${declaredSurface}' does not match plan surface '${plan.surface}'`);
  }
  const declaredProfile = declaredProfileIdOf(subject);
  const planProfile = plan && plan.profile && (plan.profile.id || plan.profile.profileId)
    || plan && plan.profileSelection && (plan.profileSelection.id || plan.profileSelection.profileId)
    || null;
  if (plan && plan.surface === 'claude-profile' && !planProfile) {
    diagnostics.push(`${label} claude-profile plan requires compiler profile identity`);
  }
  if (declaredProfile && planProfile && declaredProfile !== planProfile) {
    diagnostics.push(`${label} outer profile identity '${declaredProfile}' does not match plan profile '${planProfile}'`);
  }
  if (plan && plan.surface === 'claude-profile' && !declaredProfile) {
    diagnostics.push(`${label} claude-profile plan requires an explicit outer profile identity`);
  }
  return { plan, artifact, surface, planFingerprint, artifactFingerprint };
}

function compareDistributionProjections({ expected, actual, stage = 'structural', checker = null, observedAt = undefined } = {}) {
  const diagnostics = [];
  const mismatches = [];
  let configurationFailure = false;
  if (stage !== 'structural') {
    configurationFailure = true;
    diagnostics.push(`projection parity is structural-only; requested stage '${stage}' is not configured`);
  }
  const expectedState = validateSubject(expected, 'expected', diagnostics);
  const actualState = validateSubject(actual, 'actual', diagnostics);
  const surface = expectedState.surface || actualState.surface || '<missing>';
  const expectedProfile = profileIdOf(expected);
  const actualProfile = profileIdOf(actual);
  if (expectedState.surface && actualState.surface && expectedState.surface !== actualState.surface) {
    mismatches.push({ stableId: '<projection>', surface, type: 'field', field: 'surface', expected: expectedState.surface, actual: actualState.surface });
    diagnostics.push(`projection surface drift: expected '${expectedState.surface}', actual '${actualState.surface}'`);
  }
  if (surface === 'claude-profile' && (!expectedProfile || !actualProfile)) {
    configurationFailure = true;
    diagnostics.push('claude-profile parity requires explicit profile identity on both projections');
  }
  if (expectedProfile !== actualProfile) diagnostics.push(`profile identity drift: expected '${expectedProfile || '<none>'}', actual '${actualProfile || '<none>'}'`);
  if (expectedState.planFingerprint && actualState.planFingerprint && expectedState.planFingerprint !== actualState.planFingerprint) {
    diagnostics.push(`stale plan identity: expected '${expectedState.planFingerprint}', actual '${actualState.planFingerprint}'`);
  }
  if (expectedState.artifactFingerprint && actualState.artifactFingerprint && expectedState.artifactFingerprint !== actualState.artifactFingerprint) {
    diagnostics.push(`stale artifact identity: expected '${expectedState.artifactFingerprint}', actual '${actualState.artifactFingerprint}'`);
  }
  if (expectedState.plan && actualState.plan) {
    compareField(mismatches, diagnostics, '<plan>', 'selectedStableIds', expectedState.plan.selectedStableIds, actualState.plan.selectedStableIds, surface);
    compareField(mismatches, diagnostics, '<plan>', 'selectionPolicy', expectedState.plan.selectionPolicy, actualState.plan.selectionPolicy, surface);
    compareEntries({
      expectedEntries: expectedState.plan.selectionEntries || expectedState.plan.entries,
      actualEntries: actualState.plan.selectionEntries || actualState.plan.entries,
      surface,
      mismatches,
      diagnostics,
      fields: ['stableId', 'name', 'target', 'selector', 'invocationClass', 'source', 'sourceFingerprint', 'transform', 'owner', 'destination', 'outputFingerprint'],
    });
  }
  if (expectedState.artifact && actualState.artifact) {
    compareEntries({
      expectedEntries: expectedState.artifact.outputs,
      actualEntries: actualState.artifact.outputs,
      surface,
      mismatches,
      diagnostics,
      fields: ['stableId', 'destination', 'source', 'sourceFingerprint', 'owner', 'transform', 'outputFingerprint'],
    });
  }
  const expectedProjection = subjectProjection(expected);
  const actualProjection = subjectProjection(actual);
  if (expectedProjection || actualProjection) {
    if (!expectedProjection || !actualProjection) diagnostics.push('declared projection is missing on one side');
    else {
      compareField(mismatches, diagnostics, '<projection>', 'surface', expectedProjection.surface, actualProjection.surface, surface);
      compareEntries({
        expectedEntries: expectedProjection.entries,
        actualEntries: actualProjection.entries,
        surface,
        mismatches,
        diagnostics,
        fields: CHECKED_FIELDS.filter((field) => field !== 'outputFingerprint'),
      });
    }
  }
  const configured = configurationFailure || diagnostics.some((diagnostic) => /requires|has no|missing on one side/.test(diagnostic));
  const verdict = diagnostics.length === 0 && mismatches.length === 0
    ? 'PASS'
    : configured ? 'NOT_CONFIGURED' : 'FAIL';
  const checkerIdentity = checker && typeof checker === 'object'
    ? { id: checker.id || CHECKER.id, version: checker.version || CHECKER.version }
    : { ...CHECKER };
  const evidenceStage = stage === 'structural' ? stage : 'structural';
  const evidenceResult = createEvidenceResult({
    stage: evidenceStage,
    adapter: checkerIdentity,
    planFingerprint: expectedState.planFingerprint,
    artifactFingerprint: expectedState.artifactFingerprint,
    claims: ['compiler-selected projection membership and provenance parity'],
    observations: [`checked surface ${surface}`, `checked fields ${CHECKED_FIELDS.join(', ')}`],
    verdict: VERDICTS.includes(verdict) ? verdict : 'FAIL',
    diagnostics,
    observedAt,
  });
  const evidence = evidenceResult.ok ? evidenceResult.value : {
    stage: evidenceStage,
    adapter: checkerIdentity,
    planFingerprint: expectedState.planFingerprint,
    artifactFingerprint: expectedState.artifactFingerprint,
    verdict: 'NOT_CONFIGURED',
    diagnostics: [...diagnostics, 'unable to construct canonical projection parity evidence'],
  };
  return {
    schema: PARITY_SCHEMA,
    ok: verdict === 'PASS',
    surface,
    profile: expectedProfile || actualProfile || null,
    planFingerprint: expectedState.planFingerprint,
    artifactFingerprint: expectedState.artifactFingerprint,
    checker: checkerIdentity,
    checkedFields: [...CHECKED_FIELDS],
    mismatches,
    diagnostics,
    evidence,
    receipt: {
      schema: PARITY_SCHEMA,
      surface,
      profile: expectedProfile || actualProfile || null,
      planFingerprint: expectedState.planFingerprint,
      artifactFingerprint: expectedState.artifactFingerprint,
      checker: checkerIdentity,
      stage: evidenceStage,
      checkedFields: [...CHECKED_FIELDS],
      verdict,
      diagnostics,
    },
  };
}

function compareRoutingProjections({ expected, actual, includeBudget = false } = {}) {
  const diagnostics = [];
  const mismatches = [];
  const expectedSurface = expected && typeof expected.surface === 'string' ? expected.surface : '<missing>';
  const actualSurface = actual && typeof actual.surface === 'string' ? actual.surface : '<missing>';
  const surface = expectedSurface === actualSurface ? expectedSurface : `${expectedSurface} vs ${actualSurface}`;
  if (!expected || typeof expected !== 'object' || !actual || typeof actual !== 'object') {
    diagnostics.push(`projection surface '${surface}' is missing or not an object`);
    return { ok: false, diagnostics, mismatches: [{ stableId: '<projection>', surface, type: 'invalid', expected, actual }] };
  }
  compareField(mismatches, diagnostics, '<projection>', 'schema', expected.schema, actual.schema, surface);
  compareField(mismatches, diagnostics, '<projection>', 'surface', expected.surface, actual.surface, surface);
  if (!Array.isArray(expected.entries)) {
    mismatches.push({ stableId: '<projection>', surface, type: 'invalid', field: 'entries', expected: expected.entries, actual: undefined });
    diagnostics.push(`projection surface '${surface}' expected projection must contain an entries array`);
  }
  if (!Array.isArray(actual.entries)) {
    mismatches.push({ stableId: '<projection>', surface, type: 'invalid', field: 'entries', expected: undefined, actual: actual.entries });
    diagnostics.push(`projection surface '${surface}' actual projection must contain an entries array`);
  }
  const fields = [
    'name', 'familyId', 'routerId', 'selector', 'target', 'invocationClass', 'surfaces',
    'sourceFingerprint',
    ...(includeBudget ? ['words', 'tokens', 'wordBudget', 'tokenBudget'] : []),
  ];
  compareEntries({
    expectedEntries: expected.entries,
    actualEntries: actual.entries,
    surface,
    mismatches,
    diagnostics,
    fields,
  });
  return { ok: mismatches.length === 0, diagnostics, mismatches };
}

module.exports = {
  PARITY_SCHEMA,
  CHECKED_FIELDS,
  CHECKER,
  compareDistributionProjections,
  compareDistributionProjection: compareDistributionProjections,
  compareRoutingProjections,
};
