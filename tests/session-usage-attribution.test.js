'use strict';

const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const LIB = path.join(ROOT, 'skills', 'dhpk-session-usage-audit', 'scripts', 'lib');
const FIXTURE = path.join(__dirname, 'fixtures', 'session-usage-telemetry', 'attribution.json');
const NORMALIZATION = path.join(__dirname, 'fixtures', 'session-usage-telemetry', 'normalization.json');
const usageContract = require(path.join(LIB, 'usage-contract'));
const usageAdapters = require(path.join(LIB, 'usage-adapters'));
const usageReconciliation = require(path.join(LIB, 'usage-reconciliation'));
let usageAttribution;
try {
  usageAttribution = require(path.join(LIB, 'usage-attribution'));
} catch (error) {
  usageAttribution = { __loadError: error };
}

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const digest = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');
const evidenceRef = (value) => `evidence:${digest(value)}`;
const opaqueId = (value) => `id:${digest(value)}`;
const fixture = readJson(FIXTURE);
const profile = readJson(NORMALIZATION).profiles.disjoint;

function typedIdentity(field, label, ref) {
  return label === undefined || label === null
    ? usageContract.createScalar({ field, status: 'unavailable' })
    : usageContract.createScalar({ field, value: label, status: 'observed', evidence_refs: [ref] });
}

function normalizedInputs() {
  return fixture.observations.map((item) => {
    const observationRef = evidenceRef(`physical:${item.ref}`);
    const invocationRefs = new Set();
    const proofRefs = [];
    for (const root of Object.values(fixture.proofs.roots)) {
      if (root.session === item.session && root.evidence_available !== false) {
        invocationRefs.add(root.invocation);
        proofRefs.push(evidenceRef(root.proof));
      }
    }
    for (const binding of Object.values(fixture.proofs.bindings)) {
      if (binding.observation === item.ref) {
        invocationRefs.add(binding.invocation);
        proofRefs.push(evidenceRef(binding.proof));
      }
    }
    for (const edge of Object.values(fixture.proofs.ancestry)) {
      if (invocationRefs.has(edge.parent) || invocationRefs.has(edge.child)) proofRefs.push(evidenceRef(edge.proof));
    }
    const evidence = Object.fromEntries(Object.keys(item.counters)
      .map((field) => [field, [evidenceRef(`counter:${item.ref}:${field}`)]]));
    const normalized = usageAdapters.normalizeUsage({ counters: item.counters, profile, evidence });
    const aliases = { session_id: 'session', message_id: 'message', request_id: 'request', event_id: 'event', attempt_id: 'attempt' };
    const identities = Object.fromEntries(Object.entries(aliases)
      .map(([field, alias]) => [field, typedIdentity(field, item[alias], observationRef)]));
    return {
      observation_ref: observationRef, evidence_refs: [observationRef, ...new Set(proofRefs)], adapter_id: profile.id,
      adapter_version: profile.version, identities, metrics: normalized.metrics, total: normalized.total,
      semantics: { basis: 'per-event', input_relation: 'disjoint' },
      context_ref: evidenceRef(`selected:${item.context}`),
    };
  });
}

function typedProofs(entry) {
  const { roots, bindings, ancestry } = fixture.proofs;
  return {
    roots: entry.roots.map((name) => {
      const item = roots[name];
      return { invocation_ref: opaqueId(item.invocation), session_ref: opaqueId(item.session), selected_context_ref: evidenceRef(`selected:${item.context}`), proof_ref: evidenceRef(item.proof) };
    }),
    bindings: entry.bindings.map((name) => {
      const item = bindings[name];
      return { observation_ref: evidenceRef(`physical:${item.observation}`), invocation_ref: opaqueId(item.invocation), session_ref: opaqueId(item.session), attempt_ref: item.attempt ? opaqueId(item.attempt) : null, selected_context_ref: evidenceRef(`selected:${item.context}`), proof_ref: evidenceRef(item.proof) };
    }),
    ancestry: entry.ancestry.map((name) => {
      const item = ancestry[name];
      return { parent_invocation_ref: opaqueId(item.parent), child_invocation_ref: opaqueId(item.child), selected_context_ref: evidenceRef(`selected:${item.context}`), proof_ref: evidenceRef(item.proof) };
    }),
  };
}

function reconciledParentAggregate() {
  const inputs = normalizedInputs();
  const observationRef = evidenceRef('physical:parent-inclusive-aggregate');
  const membershipProof = evidenceRef('parent-aggregate-membership');
  const bindingProof = evidenceRef('parent-aggregate-consumption');
  const normalized = usageAdapters.normalizeUsage({
    counters: { fresh_input: 67, cache_read_input: 0, cache_write_input: 0, output: 0 },
    profile,
    evidence: Object.fromEntries(['fresh_input', 'cache_read_input', 'cache_write_input', 'output']
      .map((field) => [field, [evidenceRef(`aggregate-counter:${field}`)]])),
  });
  const identities = Object.fromEntries(usageContract.VOCABULARY.identities.map((field) => [
    field,
    typedIdentity(field, field === 'session_id' ? 'parent-session'
      : field === 'attempt_id' ? 'aggregate-attempt' : null, observationRef),
  ]));
  const aggregate = {
    observation_ref: observationRef,
    evidence_refs: [observationRef, membershipProof, bindingProof],
    adapter_id: profile.id,
    adapter_version: profile.version,
    identities,
    metrics: normalized.metrics,
    total: normalized.total,
    semantics: {
      basis: 'aggregate', input_relation: 'disjoint', descendant_inclusion: 'includes',
      complete_aggregate: true, membership_proof_ref: membershipProof,
      included_observation_refs: inputs.map((item) => item.observation_ref),
    },
    context_ref: evidenceRef('selected:selected-run-context'),
  };
  const reconciled = usageReconciliation.reconcileUsage([...inputs, aggregate], { selection: fixture.selection });
  return {
    reconciled,
    proof: { observationRef, bindingProof },
  };
}

function reconciledCumulativeInterval() {
  const refs = {
    baseline: evidenceRef('physical:cumulative-baseline'),
    target: evidenceRef('physical:cumulative-target'),
  };
  const context = evidenceRef('selected:cumulative-context');
  const stream = opaqueId('cumulative-stream');
  const epoch = opaqueId('cumulative-epoch');
  const rootProof = evidenceRef('cumulative-planner-root');
  const baselineBinding = evidenceRef('cumulative-baseline-binding');
  const targetBinding = evidenceRef('cumulative-target-binding');
  const semantics = {
    basis: 'cumulative-snapshot', input_relation: 'disjoint', stream, epoch,
    continuity_verified: true, date_allocation_verified: true,
  };
  const inputs = [
    { ref: 'baseline', total: 100, at: '2026-08-06T00:10:00Z' },
    { ref: 'target', total: 140, at: '2026-08-06T00:20:00Z' },
  ].map((item) => {
    const observationRef = refs[item.ref];
    const proofRefs = [rootProof, item.ref === 'baseline' ? baselineBinding : targetBinding];
    const normalized = usageAdapters.normalizeUsage({
      counters: { fresh_input: item.total, cache_read_input: 0, cache_write_input: 0, output: 0 },
      profile,
      evidence: Object.fromEntries(['fresh_input', 'cache_read_input', 'cache_write_input', 'output']
        .map((field) => [field, [evidenceRef(`cumulative-counter:${item.ref}:${field}`)]])),
    });
    const identities = Object.fromEntries(usageContract.VOCABULARY.identities.map((field) => [
      field, typedIdentity(field, field === 'session_id' ? 'cumulative-session' : null, observationRef),
    ]));
    return {
      observation_ref: observationRef,
      evidence_refs: [observationRef, ...proofRefs],
      adapter_id: profile.id,
      adapter_version: profile.version,
      identities,
      metrics: normalized.metrics,
      total: normalized.total,
      semantics: item.ref === 'target' ? {
        ...semantics,
        observed_at: item.at,
        covered_interval: { from: '2026-08-06T00:10:00Z', to: item.at },
        baseline_ref: refs.baseline,
        interval_proof_ref: evidenceRef('cumulative-interval-proof'),
      } : { ...semantics, observed_at: item.at },
      context_ref: context,
    };
  });
  return {
    reconciled: usageReconciliation.reconcileUsage(inputs, { selection: fixture.selection }),
    refs: { ...refs, context, stream, rootProof, baselineBinding, targetBinding },
  };
}

test('T-6 requires the public attribution consumer seam', () => {
  assert.ifError(usageAttribution.__loadError);
  assert.strictEqual(typeof usageAttribution.attributeUsage, 'function');
  assert.strictEqual(typeof usageAttribution.isAttributedUsage, 'function');
});

if (!usageAttribution.__loadError) {
  for (const entry of fixture.cases) {
    test(`attribution: ${entry.name}`, () => {
      const reconciled = usageReconciliation.reconcileUsage(normalizedInputs(), { selection: fixture.selection });
      const result = usageAttribution.attributeUsage(reconciled, {
        ...typedProofs(entry), selection: fixture.selection, partial: false,
      });
      assert.ok(usageAttribution.isAttributedUsage(result));
      const labels = new Map(fixture.observations.map((item) => [evidenceRef(`physical:${item.ref}`), item.ref]));
      const classes = Object.fromEntries(result.contributions.map((item) => [labels.get(item.observation_refs[0]), item.attribution]));
      const totals = Object.fromEntries(Object.entries(result.totals).map(([key, value]) => [key, value.known_subtotal.value]));
      assert.deepStrictEqual(classes, entry.expected.classes);
      assert.deepStrictEqual(totals, entry.expected.totals);
      assert.strictEqual(
        result.coverage.attribution.counts.unresolved,
        result.contributions.filter((item) => item.attribution === 'unattributed').length,
      );
      if (entry.name.includes('cycle through the planner root')) {
        assert.strictEqual(result.coverage.attribution.status, 'conflict');
        assert.strictEqual(result.coverage.attribution.counts.cycles, 3);
      }
      if (entry.name.includes('conflicting parent claims on the planner root')) {
        assert.strictEqual(result.coverage.attribution.status, 'conflict');
        assert.strictEqual(result.coverage.attribution.counts.conflicting_ancestry_links, 1);
        assert.strictEqual(result.coverage.attribution.counts.cycles, 0);
      }
      assert.strictEqual(result.contributions.reduce((sum, item) => sum + item.total.value, 0), entry.expected.consumed);
      assert.strictEqual(result.coverage.attribution.complete, false);
      assert.ok(Object.values(result.totals).every((item) => item.complete === false && item.complete_total.value === null));
      if (entry.expected.nullIdentityObservation) {
        const reference = evidenceRef(`physical:${entry.expected.nullIdentityObservation}`);
        const observation = result.observations.find((item) => item.observation_ref === reference);
        for (const field of entry.expected.nullIdentityFields) assert.strictEqual(observation.identities[field].value, null);
      }
    });
  }

  test('attribution is immutable, rejects unbranded input, and does not leak fixture labels', () => {
    const reconciled = usageReconciliation.reconcileUsage(normalizedInputs(), { selection: fixture.selection });
    const before = JSON.stringify(reconciled);
    const result = usageAttribution.attributeUsage(reconciled, typedProofs(fixture.cases[0]));
    assert.strictEqual(JSON.stringify(reconciled), before);
    assert.ok(Object.isFrozen(result) && Object.isFrozen(result.contributions));
    assert.throws(() => usageAttribution.attributeUsage({ ...reconciled }, {}), /reconciled/i);
    const serialized = JSON.stringify(result);
    for (const label of ['planner-root', 'child-invocation', 'selected-run-context', 'planner-agent', 'exact-child-consumption']) {
      assert.strictEqual(serialized.includes(label), false);
    }
  });

  test('the sidecar serializes only branded attribution results', () => {
    const reconciled = usageReconciliation.reconcileUsage(normalizedInputs(), { selection: fixture.selection });
    const attributed = usageAttribution.attributeUsage(reconciled, typedProofs(fixture.cases[0]));
    const sidecar = usageContract.buildTelemetry({ selection: fixture.selection, usage: attributed });
    assert.deepStrictEqual(sidecar.contributions, attributed.contributions);
    assert.deepStrictEqual(sidecar.totals, attributed.totals);
    const unbranded = usageContract.buildTelemetry({ selection: fixture.selection, usage: { ...attributed } });
    assert.strictEqual(Object.hasOwn(unbranded, 'contributions'), false);
    assert.ok(Object.values(unbranded.totals).every((value) => value.known_subtotal.value === null));
  });

  test('a parent-inclusive aggregate cannot inherit planner ownership without decomposition', () => {
    const { reconciled, proof } = reconciledParentAggregate();
    const result = usageAttribution.attributeUsage(reconciled, {
      roots: [{
        invocation_ref: opaqueId('planner-root'),
        session_ref: opaqueId('parent-session'),
        selected_context_ref: evidenceRef('selected:selected-run-context'),
        proof_ref: evidenceRef('verified-selected-invocation'),
      }],
      bindings: [{
        observation_ref: proof.observationRef,
        invocation_ref: opaqueId('planner-root'),
        session_ref: opaqueId('parent-session'),
        attempt_ref: opaqueId('aggregate-attempt'),
        selected_context_ref: evidenceRef('selected:selected-run-context'),
        proof_ref: proof.bindingProof,
      }],
      selection: fixture.selection,
    });
    assert.strictEqual(result.contributions.length, 1);
    assert.strictEqual(result.contributions[0].total.value, 67);
    assert.strictEqual(result.contributions[0].attribution, 'unattributed');
    assert.strictEqual(result.contributions[0].attribution_evidence.reason, 'unsupported-consumption-binding');
    assert.strictEqual(result.totals.planner.known_subtotal.value, null);
    assert.strictEqual(result.totals.descendants.known_subtotal.value, null);
    assert.strictEqual(result.totals.unattributed.known_subtotal.value, 67);
    assert.strictEqual(result.coverage.attribution.counts.unsupported_consumption, 1);
  });

  test('a cumulative baseline binding does not bind the consumed interval', () => {
    const { reconciled, refs } = reconciledCumulativeInterval();
    const result = usageAttribution.attributeUsage(reconciled, {
      roots: [{
        invocation_ref: opaqueId('cumulative-planner'),
        session_ref: opaqueId('cumulative-session'),
        selected_context_ref: refs.context,
        proof_ref: refs.rootProof,
      }],
      bindings: [
        {
          observation_ref: refs.baseline,
          invocation_ref: opaqueId('cumulative-planner'),
          session_ref: opaqueId('cumulative-session'),
          selected_context_ref: refs.context,
          proof_ref: refs.baselineBinding,
        },
        {
          observation_ref: refs.target,
          invocation_ref: opaqueId('cumulative-planner'),
          session_ref: opaqueId('cumulative-session'),
          selected_context_ref: refs.context,
          proof_ref: refs.targetBinding,
        },
      ],
    });
    assert.strictEqual(result.contributions.length, 1);
    assert.strictEqual(result.contributions[0].total.value, 40);
    assert.strictEqual(result.contributions[0].attribution, 'unattributed');
    assert.strictEqual(result.contributions[0].attribution_evidence.reason, 'unsupported-consumption-binding');
    assert.strictEqual(result.totals.planner.known_subtotal.value, null);
    assert.strictEqual(result.totals.unattributed.known_subtotal.value, 40);
    assert.strictEqual(result.coverage.attribution.counts.unsupported_consumption, 1);
  });

  test('truncated binding, root, or ancestry links cannot retain partial ownership claims', () => {
    const reconciled = usageReconciliation.reconcileUsage(normalizedInputs(), { selection: fixture.selection });
    const proofs = typedProofs(fixture.cases[0]);
    const repeated = (item) => Array.from({ length: 50000 }, () => item);
    const assertFailClosed = (result) => {
      assert.ok(result.contributions.every((item) => item.attribution === 'unattributed'));
      assert.ok(result.contributions.every((item) => item.attribution_evidence.reason === 'truncated-input'));
      assert.strictEqual(result.totals.planner.known_subtotal.value, null);
      assert.strictEqual(result.totals.descendants.known_subtotal.value, null);
      assert.strictEqual(result.totals.unattributed.known_subtotal.value, 67);
      assert.strictEqual(result.coverage.attribution.counts.truncated, 1);
      assert.strictEqual(result.coverage.attribution.complete, false);
    };

    const plannerBinding = proofs.bindings.find((item) => item.observation_ref === evidenceRef('physical:planner-usage'));
    const conflictingBinding = {
      ...plannerBinding,
      invocation_ref: opaqueId('different-planner'),
      proof_ref: evidenceRef('conflicting-planner-consumption'),
    };
    assertFailClosed(usageAttribution.attributeUsage(reconciled, {
      ...proofs, bindings: [...repeated(plannerBinding), conflictingBinding], selection: fixture.selection,
    }));

    const plannerRoot = proofs.roots[0];
    const conflictingRoot = {
      ...plannerRoot,
      session_ref: opaqueId('child-session'),
      proof_ref: evidenceRef('exact-child-consumption'),
    };
    assertFailClosed(usageAttribution.attributeUsage(reconciled, {
      ...proofs, roots: [...repeated(plannerRoot), conflictingRoot], selection: fixture.selection,
    }));

    const rootChild = proofs.ancestry.find((item) => item.parent_invocation_ref === opaqueId('planner-root'));
    const conflictingEdge = typedProofs({ roots: [], bindings: [], ancestry: ['other-child'] }).ancestry[0];
    assert.ok(conflictingEdge);
    const childObservation = normalizedInputs().find((item) => item.observation_ref === evidenceRef('physical:child-usage'));
    const otherObservation = normalizedInputs().find((item) => item.observation_ref === evidenceRef('physical:unrelated-parent-usage'));
    assert.ok(childObservation.evidence_refs.includes(conflictingEdge.proof_ref));
    assert.ok(otherObservation.evidence_refs.includes(conflictingEdge.proof_ref));
    assertFailClosed(usageAttribution.attributeUsage(reconciled, {
      ...proofs,
      ancestry: [...repeated(rootChild), conflictingEdge, ...proofs.ancestry.filter((item) => item !== rootChild && item !== conflictingEdge)],
      selection: fixture.selection,
    }));
  });
}

run('session-usage-attribution');
