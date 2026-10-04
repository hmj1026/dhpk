# orchestration-evidence-lifecycle Specification

## Purpose

Define the durable lifecycle and evidence bindings that let orchestration
consume worker and reviewer results without confusing readiness, freshness,
scope, or gate enforcement with task completion.

## Requirements

### Requirement: Dispatch lifecycle states are observable and terminal states are honest

Every dispatched worker or reviewer SHALL expose a lifecycle state from `planned`, `dispatched`, `started`, `artifact-ready`, and `verdicted`, or a terminal `failed-start`, `quota-blocked`, `blocked`, or `incomplete` state. A coordinator SHALL NOT report completion or approval from a non-terminal state.

#### Scenario: Worker reaches artifact-ready

- **WHEN** a worker starts and writes its required artifact durably
- **THEN** the lifecycle records `started` followed by `artifact-ready` before a consumer reads the artifact

#### Scenario: Session quota interrupts a worker

- **WHEN** a worker stops because the session quota is exhausted before its required output
- **THEN** the task is `quota-blocked` and remains resumable, not completed

#### Scenario: A dispatch never starts

- **WHEN** no started event or artifact appears within the bounded start window
- **THEN** the attempt is recorded as `failed-start` and is eligible for at most one corrected retry

### Requirement: Artifact consumers wait for producer readiness

Any consumer that reads a generated report or review artifact SHALL depend on an explicit producer-ready marker or equivalent durable completion evidence. Fixed sleeps or a successful dispatch call SHALL not satisfy artifact readiness.

#### Scenario: Consumer races the producer

- **WHEN** a consumer requests a report before the producer has emitted its ready marker
- **THEN** the consumer records `waiting` or `incomplete` and does not treat the missing file as a permanent path failure

#### Scenario: Producer completes before consumption

- **WHEN** the producer writes the artifact and its ready marker
- **THEN** the consumer reads the artifact and records the producer identity and completion boundary

### Requirement: Review closure requires fresh scope-bound evidence

A review obligation SHALL close only when a fresh artifact exists for the current review wave, its canonical identity record has the required scope, diff, session, dispatch, and applicable context bindings, and the artifact contains a parseable verdict. A verbal verdict without fresh evidence SHALL leave the obligation pending. Legacy artifacts with no new identity fields MAY use the characterized compatibility path, but an artifact that declares a new binding and disagrees with the current obligation MUST remain unresolved.

#### Scenario: Reviewer approves without a fresh artifact

- **WHEN** a reviewer returns `APPROVE` but no artifact matches the current wave identity
- **THEN** the obligation remains pending and the coordinator reports incomplete review evidence

#### Scenario: Fresh artifact contains actionable findings

- **WHEN** the artifact is fresh, identity-bound, and contains `BLOCK`, `FAIL`, or configured actionable severity
- **THEN** lifecycle completion may be recorded, but the review gate remains unresolved

#### Scenario: Fresh clean artifact matches scope

- **WHEN** a fresh artifact has a parseable clean verdict, canonical identity matching, and matching scope/diff identity
- **THEN** the review obligation closes and records the artifact path and verdict

### Requirement: Quota and retry handling is bounded and resumable

The coordinator SHALL distinguish quota blocks from failed starts, retain the exact task identity for resume, and permit no more than one corrected retry for an identical missing-start or missing-artifact condition. A retry SHALL require a changed dispatch condition, such as bounded context, corrected namespace, or explicit resumed quota state.

#### Scenario: Quota reset permits resume

- **WHEN** a quota-blocked task becomes runnable and its task identity is resumed
- **THEN** the resumed attempt links to the original task and does not create a false second completion

#### Scenario: Identical reviewer retry is attempted twice

- **WHEN** the same reviewer has no start or artifact after one corrected retry
- **THEN** the gate remains pending or escalates with a recorded reason and no unbounded third retry

### Requirement: Evidence binds producer, artifact, stage, adapter, and obligation

Every `EvidenceResult` consumed by orchestration SHALL identify the producer dispatch/session, current obligation or review-wave identity, verification stage, consumer adapter identity/version, `DistributionPlan` fingerprint when applicable, `DistributionArtifact` fingerprint when applicable, creation time, checked scope, normalized per-surface results when the evidence covers multiple consumers, and parseable verdict. A result with no new identity fields MAY carry an explicit legacy-compatibility marker and use the characterized legacy path; once a new identity field is declared, missing or mismatched required binding fields MUST leave the obligation unresolved.

#### Scenario: Current projection verification closes its obligation

- **WHEN** evidence names the current dispatch/review wave, requested stage and adapter, exact plan/artifact fingerprints, normalized surface result, and a passing verdict
- **THEN** orchestration may accept that verification boundary and record its durable evidence path

#### Scenario: Evidence belongs to another artifact

- **WHEN** a passing result carries a different plan or artifact fingerprint from the candidate being accepted
- **THEN** orchestration classifies it as stale or foreign and leaves the current obligation pending

#### Scenario: Evidence stage is weaker than requested

- **WHEN** structural evidence is presented for an obligation that requires consumer-runtime verification
- **THEN** orchestration records the structural result separately and does not close the runtime obligation

#### Scenario: One surface is unavailable in a multi-surface result

- **WHEN** normalized evidence includes a passing structural result for one surface and `UNAVAILABLE` or `NOT_RUN` consumer evidence for another
- **THEN** orchestration retains both surface outcomes and does not treat the structural result as proof of the unavailable consumer

#### Scenario: Legacy evidence uses the compatibility path

- **WHEN** an evidence result has no new identity fields and carries an explicit legacy-compatibility marker
- **THEN** orchestration applies the characterized legacy binding path and does not require fields that were not declared by that result

### Requirement: Verification evidence is applicability-bound and mutation-ordered

An evidence result SHALL be reusable only when its recorded scope, relevant source
and specification content, command and configuration, tool identity, and execution
environment still apply to the current obligation. A source, specification,
lockfile, configuration, tool, environment, or acceptance change SHALL invalidate
the affected evidence and SHALL trigger re-evaluation of that scope; unrelated
changes MAY retain applicable evidence. Mutating checks SHALL run before the final
affected review or verification, or the affected evidence SHALL be regenerated
after the mutation. Unsupported runners, missing capabilities, skipped checks,
and `NOT_RUN` SHALL remain non-passing outcomes, and a manual alternative SHALL
be recorded as separate evidence rather than promoted to a pass for the original
runner.

#### Scenario: Unchanged evidence is reused

- **WHEN** a prior result matches the current scope, source and specification fingerprints, command/configuration, tool, and environment
- **THEN** orchestration reuses the result without rerunning unrelated checks

#### Scenario: Changed source invalidates affected evidence

- **WHEN** a source, lockfile, configuration, tool, environment, or acceptance criterion changes within the result's scope
- **THEN** orchestration marks that result stale and re-evaluates the affected obligation while retaining unaffected evidence

#### Scenario: Mutation precedes final verification

- **WHEN** a formatter, generator, fixture refresh, package materialization, or migration changes the candidate after an earlier check
- **THEN** orchestration runs the affected final verification after the mutation and does not use the earlier result as completion evidence

#### Scenario: Unsupported verification remains visible

- **WHEN** the requested runner is unavailable or a capability is missing and a manual alternative is performed
- **THEN** orchestration records the original check as `UNAVAILABLE`, `BLOCKED`, or `NOT_RUN` and records the manual observation separately without claiming the runner passed

### Requirement: Handoffs preserve one traceable lifecycle identity

Dispatch, follow-up handoff, corrected retry, artifact readiness, evidence production, and final acceptance SHALL remain linked by one canonical task identity plus explicit attempt identities. A handoff MUST preserve the prior context boundary and obligation identity; it MUST NOT create a false second completion or silently detach evidence from the originating task.

#### Scenario: Existing worker receives a related follow-up

- **WHEN** orchestration reuses a worker for the same scope or journey
- **THEN** the new attempt links to the original canonical task identity and records the handoff before its evidence can be consumed

#### Scenario: Corrected retry succeeds

- **WHEN** one bounded corrected retry produces valid current evidence with a matching canonical identity
- **THEN** the lifecycle records both attempts and only the valid attempt satisfies the original obligation

#### Scenario: Unrelated task uses a new dispatch

- **WHEN** a request has no shared scope, journey, artifact, or accumulated context with the prior task
- **THEN** orchestration creates a new canonical task identity rather than attaching its evidence to the prior lifecycle

### Requirement: Evidence persistence is separate from gate enforcement

Artifact stores and consumer adapters SHALL persist and report evidence but SHALL NOT clear review sentinels or mark orchestration tasks complete. Orchestration SHALL present current evidence to the existing enforcement boundary, and acceptance SHALL require both a terminal orchestration lifecycle state and every applicable Sentinel gate to be resolved.

#### Scenario: Verification adapter reports PASS

- **WHEN** a consumer adapter persists a passing `EvidenceResult`
- **THEN** the result becomes eligible input to reconciliation but does not itself clear a sentinel or complete the task

#### Scenario: Lifecycle is terminal but sentinel remains armed

- **WHEN** a worker and reviewer have reached terminal states but current qualifying Sentinel evidence is absent
- **THEN** orchestration reports incomplete review closure and does not declare completion

### Requirement: REQ-851-02 Per-capability reuse is exact and execution-authority separated

An orchestration evidence result SHALL be reused only for the same gate-owned
semantic check key and complete current capability identity. The identity
SHALL bind relevant canonical source and specification content, delivered
artifact bytes and bindings, selected capability and proof claims, exact
current Host version, and effective configuration. Producer, workflow,
request ID, reason, question, timestamp, and authorization are not capability
identity. A change to an identity component invalidates only checks whose
fixed descriptor includes that component; unrelated source or attribution
changes MUST NOT require unrelated capability re-execution.

Reuse SHALL require the candidate check's own `PASS` status and the existing
typed proof for its native capability. Installation/static evidence and a
generic runtime flag are insufficient. Current installation validation and
required prerequisites SHALL still run and may independently block acceptance.
Reuse satisfies an obligation but MUST NOT grant authority for a new native
execution. When current authorization is false, exact valid prior evidence may
satisfy the obligation without a new native call; absent or mismatched evidence
remains `BLOCKED`. If current authorization separately permits a fresh probe,
its observation remains distinct from prior evidence and does not erase prior
conflicts. Exact-identity contradictory `PASS` and `FAIL` records are
ambiguous and MUST be retained as an explicit conflict rather than resolved by
last-wins selection. Consumed evidence remains immutable.

#### Scenario: Attribution changes do not invalidate a capability result

- **WHEN** the semantic check and complete current identity are unchanged but
  request ID, producer, workflow, reason, or question changes
- **THEN** the prior typed proof may satisfy the current check without another
  native call, and its origin remains traceable

#### Scenario: A relevant resource change invalidates only its role check

- **WHEN** a source, specification, delivered role/resource, Host version, or
  effective setting inside one role descriptor changes
- **THEN** that role's historical evidence is rejected with its changed
  identity field, while independent checks outside that closure remain
  reusable

#### Scenario: Old evidence does not authorize execution

- **WHEN** prior evidence is absent or mismatched and current authorization is
  false
- **THEN** the required native obligation remains `BLOCKED` without invoking
  the native adapter

#### Scenario: Authorized replacement preserves a historical conflict

- **WHEN** contradictory same-identity `PASS` and `FAIL` evidence is present
  and current authorization permits a new native probe
- **THEN** the fresh observation may resolve the current required check, but
  the rejection record retains both historical outcomes and their origins

#### Scenario: Reuse preserves the not-run observation

- **WHEN** matching prior native evidence satisfies an unauthorized current
  check
- **THEN** the current obligation may pass with zero native calls while the
  current runtime observation remains `NOT_RUN`
