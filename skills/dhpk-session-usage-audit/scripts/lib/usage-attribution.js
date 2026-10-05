'use strict';

const { createScalar } = require('./usage-contract');
const { isReconciledUsage } = require('./usage-reconciliation');

const EVIDENCE_REF = /^evidence:[a-f0-9]{64}$/;
const IDENTITY_REF = /^id:[a-f0-9]{64}$/;
const MAX_LINKS = 50000;
const MAX_ANCESTRY_DEPTH = 256;
const BRANDED = new WeakSet();

function plain(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

function scalarValue(value) {
  return value && ['observed', 'derived'].includes(value.status) ? value.value : null;
}

function evidenceSet(observation) {
  return new Set(Array.isArray(observation?.evidence_refs)
    ? observation.evidence_refs.filter((value) => typeof value === 'string' && EVIDENCE_REF.test(value))
    : []);
}

function sessionRef(observation) {
  const identity = observation?.identities?.session_id;
  const value = scalarValue(identity);
  return typeof value === 'string' && IDENTITY_REF.test(value) ? value : null;
}

function attemptRef(observation) {
  const identity = observation?.identities?.attempt_id;
  const value = scalarValue(identity);
  return typeof value === 'string' && IDENTITY_REF.test(value) ? value : null;
}

function addScope(scopes, invocationRef, session, context) {
  if (!scopes.has(invocationRef)) scopes.set(invocationRef, []);
  const entries = scopes.get(invocationRef);
  if (!entries.some((entry) => entry.session_ref === session && entry.context_ref === context)) {
    entries.push({ session_ref: session, context_ref: context });
  }
}

function matchingScope(scopes, invocationRef, context) {
  const entries = scopes.get(invocationRef) || [];
  if (entries.length !== 1) return null;
  return entries[0].context_ref === context ? entries[0] : null;
}

function coverage(status, reason, count, counts, complete = false) {
  const safeCounts = Object.freeze({ ...counts });
  return {
    status,
    complete,
    reason,
    count,
    ...safeCounts,
    counts: safeCounts,
  };
}

function contributionSubtotal(items, emptyReason) {
  if (items.length === 0) {
    return createScalar({
      field: 'reported_total', status: 'unavailable', reason: emptyReason,
    });
  }
  let sum = 0;
  const refs = [...new Set(items.flatMap((item) => item.observation_refs || []))]
    .filter((value) => EVIDENCE_REF.test(value)).sort();
  for (const item of items) {
    const value = scalarValue(item.total);
    if (!Number.isSafeInteger(value) || value < 0 || !Number.isSafeInteger(sum + value)) {
      return createScalar({ field: 'reported_total', status: 'conflict', evidence_refs: refs, reason: 'invalid-counter' });
    }
    sum += value;
  }
  return createScalar({
    field: 'reported_total', value: sum, status: 'derived', evidence_refs: refs,
    derivation: { rule: 'subtotal-sum', inputs: refs },
  });
}

function attributeUsage(reconciled, {
  roots = [], bindings = [], ancestry = [], selection = {}, partial = false,
} = {}) {
  if (!isReconciledUsage(reconciled)) throw new TypeError('Expected branded reconciled usage');

  const observations = Array.isArray(reconciled.observations) ? reconciled.observations : [];
  const contributions = Array.isArray(reconciled.contributions) ? reconciled.contributions : [];
  const observationByRef = new Map(observations.map((item) => [item.observation_ref, item]));
  const contributionByRef = new Map(contributions.map((item) => [item.contribution_ref, item]));
  const evidenceByObservation = new Map(observations.map((item) => [item.observation_ref, evidenceSet(item)]));
  const sourceEvidence = new Set([...evidenceByObservation.values()].flatMap((refs) => [...refs]));
  const rootEvidenceObservations = new Map();
  for (const item of observations) {
    const session = sessionRef(item);
    const context = item.context_ref;
    if (!session || !EVIDENCE_REF.test(context || '')) continue;
    for (const proofRef of evidenceByObservation.get(item.observation_ref) || []) {
      const key = `${session}|${context}|${proofRef}`;
      if (!rootEvidenceObservations.has(key)) rootEvidenceObservations.set(key, []);
      rootEvidenceObservations.get(key).push(item);
    }
  }
  const selectedContext = typeof selection?.selected_context_ref === 'string'
    && EVIDENCE_REF.test(selection.selected_context_ref) ? selection.selected_context_ref
    : typeof selection?.context_ref === 'string' && EVIDENCE_REF.test(selection.context_ref)
      ? selection.context_ref : null;

  const inputTruncated = [roots, bindings, ancestry].some((items) => Array.isArray(items) && items.length > MAX_LINKS);
  const bounded = (items) => Array.isArray(items) ? items.slice(0, MAX_LINKS) : [];
  const malformedInput = !Array.isArray(roots) || !Array.isArray(bindings) || !Array.isArray(ancestry);
  const rootInputs = inputTruncated || malformedInput ? [] : bounded(roots);
  const bindingInputs = inputTruncated || malformedInput ? [] : bounded(bindings);
  const ancestryInputs = inputTruncated || malformedInput ? [] : bounded(ancestry);
  const scopes = new Map();
  const bindingClaims = new Map();
  const invocationEvidence = new Map();
  const counters = {
    planner: 0,
    descendants: 0,
    unattributed: 0,
    missing_binding: 0,
    conflicting_binding: 0,
    conflicting_ancestry: 0,
    conflicting_ancestry_links: 0,
    cycles: 0,
    scope_mismatch: 0,
    unsupported_consumption: 0,
    unknown_relationship: 0,
    invalid_evidence: 0,
  };

  const rootClaims = new Map();
  for (const raw of rootInputs) {
    if (!plain(raw) || !IDENTITY_REF.test(raw.invocation_ref || '')
      || !IDENTITY_REF.test(raw.session_ref || '') || !EVIDENCE_REF.test(raw.selected_context_ref || '')
      || !EVIDENCE_REF.test(raw.proof_ref || '') || !sourceEvidence.has(raw.proof_ref)) {
      counters.invalid_evidence += 1;
      continue;
    }
    if (selectedContext && raw.selected_context_ref !== selectedContext) {
      counters.scope_mismatch += 1;
      continue;
    }
    const rootEvidence = rootEvidenceObservations.get(
      `${raw.session_ref}|${raw.selected_context_ref}|${raw.proof_ref}`,
    ) || [];
    if (rootEvidence.length === 0) {
      counters.invalid_evidence += 1;
      continue;
    }
    if (!rootClaims.has(raw.invocation_ref)) rootClaims.set(raw.invocation_ref, []);
    const claims = rootClaims.get(raw.invocation_ref);
    if (!claims.some((item) => item.session_ref === raw.session_ref
      && item.context_ref === raw.selected_context_ref)) {
      claims.push({ session_ref: raw.session_ref, context_ref: raw.selected_context_ref, proof_ref: raw.proof_ref });
    }
    addScope(scopes, raw.invocation_ref, raw.session_ref, raw.selected_context_ref);
    if (!invocationEvidence.has(raw.invocation_ref)) invocationEvidence.set(raw.invocation_ref, new Set());
    for (const item of rootEvidence) {
      for (const ref of evidenceByObservation.get(item.observation_ref) || []) invocationEvidence.get(raw.invocation_ref).add(ref);
    }
  }

  for (const raw of bindingInputs) {
    if (!plain(raw) || !EVIDENCE_REF.test(raw.observation_ref || '')
      || !IDENTITY_REF.test(raw.invocation_ref || '') || !IDENTITY_REF.test(raw.session_ref || '')
      || !EVIDENCE_REF.test(raw.selected_context_ref || '') || !EVIDENCE_REF.test(raw.proof_ref || '')) {
      counters.invalid_evidence += 1;
      continue;
    }
    const observation = observationByRef.get(raw.observation_ref);
    const contributionRef = observation?.reconciliation?.contribution_ref;
    const contribution = contributionByRef.get(contributionRef);
    if (!observation || !contribution || !contribution.observation_refs.includes(raw.observation_ref)
      || !['included', 'duplicate', 'baseline', 'corroborating'].includes(observation.reconciliation?.disposition)) {
      counters.invalid_evidence += 1;
      continue;
    }
    const proofValid = evidenceByObservation.get(raw.observation_ref)?.has(raw.proof_ref) === true;
    const contextValid = observation.context_ref === raw.selected_context_ref
      && (!selectedContext || selectedContext === raw.selected_context_ref);
    const sessionValid = sessionRef(observation) === raw.session_ref;
    const expectedAttempt = attemptRef(observation);
    const attemptValid = !expectedAttempt || raw.attempt_ref === expectedAttempt;
    const reason = !proofValid ? 'invalid-evidence'
      : !contextValid || !sessionValid || !attemptValid ? 'scope-mismatch' : null;
    const claim = {
      contribution_ref: contributionRef,
      observation_ref: raw.observation_ref,
      invocation_ref: raw.invocation_ref,
      session_ref: raw.session_ref,
      context_ref: raw.selected_context_ref,
      attempt_ref: expectedAttempt,
      proof_ref: raw.proof_ref,
      reason,
      basis: observation.semantics?.basis || 'unknown',
      disposition: observation.reconciliation?.disposition,
    };
    if (!bindingClaims.has(contributionRef)) bindingClaims.set(contributionRef, []);
    bindingClaims.get(contributionRef).push(claim);
    if (reason) {
      counters[reason === 'scope-mismatch' ? 'scope_mismatch' : 'invalid_evidence'] += 1;
      continue;
    }
    if (claim.basis === 'per-event' && ['included', 'duplicate'].includes(claim.disposition)) {
      addScope(scopes, claim.invocation_ref, claim.session_ref, claim.context_ref);
      if (!invocationEvidence.has(claim.invocation_ref)) invocationEvidence.set(claim.invocation_ref, new Set());
      for (const ref of evidenceByObservation.get(claim.observation_ref) || []) invocationEvidence.get(claim.invocation_ref).add(ref);
    }
  }

  const validRoots = new Map();
  const conflictingRoots = new Set();
  for (const [invocationRef, claims] of rootClaims) {
    const uniqueScopes = new Set(claims.map((item) => `${item.session_ref}|${item.context_ref}`));
    if (uniqueScopes.size !== 1) {
      conflictingRoots.add(invocationRef);
      continue;
    }
    const claim = claims[0];
    const hasRootConsumption = observations.some((item) => (
      item.reconciliation?.disposition === 'included' && item.reconciliation.contribution_ref
      && sessionRef(item) === claim.session_ref && item.context_ref === claim.context_ref
      && bindingClaims.get(item.reconciliation.contribution_ref)?.some((binding) => (
        binding.reason === null && binding.invocation_ref === invocationRef
          && ['included', 'duplicate'].includes(binding.disposition)
      ))
    ));
    if (!hasRootConsumption) {
      conflictingRoots.add(invocationRef);
      continue;
    }
    validRoots.set(invocationRef, { ...claim, proof_refs: claims.map((item) => item.proof_ref).sort() });
  }

  const edgeClaims = new Map();
  for (const raw of ancestryInputs) {
    if (!plain(raw) || !IDENTITY_REF.test(raw.parent_invocation_ref || '')
      || !IDENTITY_REF.test(raw.child_invocation_ref || '') || raw.parent_invocation_ref === raw.child_invocation_ref
      || !EVIDENCE_REF.test(raw.selected_context_ref || '') || !EVIDENCE_REF.test(raw.proof_ref || '')) {
      counters.invalid_evidence += 1;
      continue;
    }
    const parentScope = matchingScope(scopes, raw.parent_invocation_ref, raw.selected_context_ref);
    const childScope = matchingScope(scopes, raw.child_invocation_ref, raw.selected_context_ref);
    const evidenceValid = sourceEvidence.has(raw.proof_ref)
      && invocationEvidence.get(raw.parent_invocation_ref)?.has(raw.proof_ref) === true
      && invocationEvidence.get(raw.child_invocation_ref)?.has(raw.proof_ref) === true;
    if (!parentScope || !childScope || !evidenceValid
      || (selectedContext && selectedContext !== raw.selected_context_ref)) {
      counters.scope_mismatch += 1;
      continue;
    }
    if (!edgeClaims.has(raw.child_invocation_ref)) edgeClaims.set(raw.child_invocation_ref, []);
    const claims = edgeClaims.get(raw.child_invocation_ref);
    let parentClaim = claims.find((item) => item.parent_ref === raw.parent_invocation_ref
      && item.context_ref === raw.selected_context_ref);
    if (!parentClaim) {
      parentClaim = { parent_ref: raw.parent_invocation_ref, context_ref: raw.selected_context_ref, proof_refs: [] };
      claims.push(parentClaim);
    }
    if (!parentClaim.proof_refs.includes(raw.proof_ref)) parentClaim.proof_refs.push(raw.proof_ref);
  }

  const conflictingParents = new Set();
  const parentByChild = new Map();
  for (const [child, claims] of edgeClaims) {
    if (claims.length !== 1) {
      conflictingParents.add(child);
      counters.conflicting_ancestry_links += 1;
      continue;
    }
    const edge = claims[0];
    edge.proof_refs.sort();
    parentByChild.set(child, edge);
  }

  const cyclicInvocations = new Set();
  const checkedAncestry = new Set();
  for (const start of parentByChild.keys()) {
    if (checkedAncestry.has(start)) continue;
    const path = [];
    const pathIndex = new Map();
    let current = start;
    while (current && !checkedAncestry.has(current) && !conflictingParents.has(current)) {
      if (pathIndex.has(current)) {
        for (const invocationRef of path.slice(pathIndex.get(current))) cyclicInvocations.add(invocationRef);
        break;
      }
      const edge = parentByChild.get(current);
      if (!edge) break;
      pathIndex.set(current, path.length);
      path.push(current);
      current = edge.parent_ref;
    }
    for (const invocationRef of path) checkedAncestry.add(invocationRef);
  }

  function resolveInvocation(invocationRef, contextRef, session) {
    if (conflictingRoots.has(invocationRef)) return { reason: 'conflicting-root' };
    if (cyclicInvocations.has(invocationRef)) return { reason: 'cycle' };
    if (conflictingParents.has(invocationRef)) return { reason: 'conflicting-ancestry' };
    const root = validRoots.get(invocationRef);
    if (root) {
      if (root.context_ref !== contextRef || root.session_ref !== session) return { reason: 'scope-mismatch' };
      return { attribution: 'planner', root_ref: root.proof_refs[0], binding_refs: [], ancestry_refs: [] };
    }
    const visited = new Set();
    const ancestryRefs = [];
    let current = invocationRef;
    for (let depth = 0; depth < MAX_ANCESTRY_DEPTH; depth += 1) {
      if (visited.has(current)) return { reason: 'cycle' };
      visited.add(current);
      if (cyclicInvocations.has(current)) return { reason: 'cycle' };
      if (conflictingParents.has(current)) return { reason: 'conflicting-ancestry' };
      const edge = parentByChild.get(current);
      if (!edge) return { reason: 'unknown-relationship' };
      if (edge.context_ref !== contextRef) return { reason: 'scope-mismatch' };
      ancestryRefs.push(...edge.proof_refs);
      current = edge.parent_ref;
      if (cyclicInvocations.has(current)) return { reason: 'cycle' };
      if (conflictingParents.has(current)) return { reason: 'conflicting-ancestry' };
      if (conflictingRoots.has(current)) return { reason: 'conflicting-root' };
      const reachedRoot = validRoots.get(current);
      if (reachedRoot) {
        if (reachedRoot.context_ref !== contextRef) return { reason: 'scope-mismatch' };
        return {
          attribution: 'descendant', root_ref: reachedRoot.proof_refs[0],
          binding_refs: [], ancestry_refs: [...new Set(ancestryRefs)],
        };
      }
    }
    return { reason: 'unknown-relationship' };
  }

  const decisions = new Map();
  const totals = { planner: [], descendants: [], unattributed: [] };
  const invalidLinkInput = counters.invalid_evidence > 0 || counters.scope_mismatch > 0;
  for (const contribution of contributions) {
    const members = contribution.observation_refs
      .map((ref) => observationByRef.get(ref))
      .filter((item) => item && item.reconciliation?.contribution_ref === contribution.contribution_ref);
    const included = members.filter((item) => item.reconciliation.disposition === 'included');
    let decision = { attribution: 'unattributed', root_ref: null, binding_refs: [], ancestry_refs: [], reason: null };
    if (inputTruncated) {
      decision.reason = 'truncated-input';
    } else if (malformedInput) {
      decision.reason = 'malformed-input';
    } else if (invalidLinkInput) {
      decision.reason = counters.scope_mismatch ? 'scope-mismatch' : 'invalid-evidence';
    } else if (included.length !== 1) {
      decision.reason = 'unsupported-consumption-binding';
    } else if (included[0].semantics?.basis !== 'per-event') {
      decision.reason = 'unsupported-consumption-binding';
    } else {
      const claims = (bindingClaims.get(contribution.contribution_ref) || []).filter((item) => (
        contribution.observation_refs.includes(item.observation_ref)
          && ['included', 'duplicate'].includes(item.disposition)
      ));
      if (claims.some((item) => item.reason)) {
        decision.reason = claims.some((item) => item.reason === 'scope-mismatch') ? 'scope-mismatch' : 'invalid-evidence';
      } else if (claims.length === 0) {
        decision.reason = 'missing-binding';
      } else {
        const signatures = new Set(claims.map((item) => `${item.invocation_ref}|${item.session_ref}|${item.context_ref}|${item.attempt_ref || ''}`));
        if (signatures.size !== 1) {
          decision.reason = 'conflicting-binding';
        } else {
          const binding = claims[0];
          const resolved = resolveInvocation(binding.invocation_ref, binding.context_ref, binding.session_ref);
          decision = {
            attribution: resolved.attribution || 'unattributed',
            root_ref: resolved.root_ref || null,
            binding_refs: [...new Set(claims.map((item) => item.proof_ref))].sort(),
            ancestry_refs: resolved.ancestry_refs || [],
            reason: resolved.reason || null,
          };
        }
      }
    }
    if (decision.attribution === 'planner' || decision.attribution === 'descendant') {
      counters[decision.attribution === 'planner' ? 'planner' : 'descendants'] += 1;
    } else {
      counters.unattributed += 1;
      if (decision.reason === 'missing-binding') counters.missing_binding += 1;
      if (decision.reason === 'conflicting-binding' || decision.reason === 'conflicting-root') counters.conflicting_binding += 1;
      if (decision.reason === 'conflicting-ancestry') counters.conflicting_ancestry += 1;
      if (decision.reason === 'cycle') counters.cycles += 1;
      if (decision.reason === 'scope-mismatch') counters.scope_mismatch += 1;
      if (decision.reason === 'unsupported-consumption-binding') counters.unsupported_consumption += 1;
      if (decision.reason === 'unknown-relationship') counters.unknown_relationship += 1;
      if (decision.reason === 'invalid-evidence') counters.invalid_evidence += 1;
    }
    decisions.set(contribution.contribution_ref, decision);
    const totalKey = decision.attribution === 'planner' ? 'planner'
      : decision.attribution === 'descendant' ? 'descendants' : 'unattributed';
    totals[totalKey].push(contribution);
  }

  const outputContributions = contributions.map((item) => {
    const decision = decisions.get(item.contribution_ref);
    return {
      ...item,
      attribution: decision.attribution,
      attribution_evidence: {
        status: decision.attribution,
        root_ref: decision.root_ref,
        binding_refs: decision.binding_refs,
        ancestry_refs: decision.ancestry_refs,
        reason: decision.reason,
      },
    };
  });
  const outputObservations = observations.map((item) => {
    const decision = decisions.get(item.reconciliation?.contribution_ref) || {
      attribution: 'unattributed', root_ref: null, binding_refs: [], ancestry_refs: [], reason: 'no-included-contribution',
    };
    return {
      ...item,
      attribution: decision.attribution,
      attribution_evidence: {
        status: decision.attribution,
        root_ref: decision.root_ref,
        binding_refs: decision.binding_refs,
        ancestry_refs: decision.ancestry_refs,
        reason: decision.reason,
      },
    };
  });

  const emptyReason = contributions.length ? 'missing-evidence' : 'adapter-not-supported';
  const outputTotals = Object.fromEntries(['planner', 'descendants', 'unattributed'].map((key) => [key, {
    known_subtotal: contributionSubtotal(totals[key], emptyReason),
    complete_total: createScalar({ field: 'reported_total', status: 'unavailable', reason: 'missing-evidence' }),
    complete: false,
  }]));

  const hasLinks = [roots, bindings, ancestry].some((items) => Array.isArray(items) && items.length > 0);
  const attributed = counters.planner + counters.descendants;
  const unresolved = counters.unattributed;
  const conflict = counters.conflicting_ancestry_links || counters.conflicting_ancestry
    || counters.conflicting_binding || counters.cycles;
  const incomplete = unresolved || counters.invalid_evidence || counters.scope_mismatch
    || partial || malformedInput || inputTruncated;
  const status = malformedInput ? 'partial'
    : !hasLinks ? 'unavailable'
      : conflict ? 'conflict' : incomplete ? 'partial' : 'observed';
  const reason = malformedInput ? 'missing-evidence'
    : !hasLinks ? 'adapter-not-supported'
      : conflict ? 'conflicting-evidence' : incomplete ? 'missing-evidence' : null;
  const attributionCoverage = coverage(status, reason, contributions.length, {
    ...counters,
    attributed,
    unresolved,
    truncated: inputTruncated ? 1 : 0,
    malformed_input: malformedInput ? 1 : 0,
  }, contributions.length > 0 && unresolved === 0 && counters.invalid_evidence === 0
    && counters.scope_mismatch === 0 && counters.conflicting_ancestry_links === 0
    && !partial && !malformedInput && !inputTruncated);
  const result = {
    observations: outputObservations,
    contributions: outputContributions,
    totals: outputTotals,
    coverage: { ...reconciled.coverage, attribution: attributionCoverage },
  };
  deepFreeze(result);
  BRANDED.add(result);
  return result;
}

function isAttributedUsage(value) {
  return Boolean(value && typeof value === 'object' && BRANDED.has(value));
}

module.exports = { attributeUsage, isAttributedUsage };
