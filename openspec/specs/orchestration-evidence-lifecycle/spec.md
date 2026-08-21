# orchestration-evidence-lifecycle Specification

## Purpose
TBD - created by archiving change harden-session-audit-and-agent-orchestration. Update Purpose after archive.
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

Every `EvidenceResult` consumed by orchestration SHALL identify the producer dispatch/session, current obligation or review-wave identity, verification stage, consumer adapter identity/version, `DistributionPlan` fingerprint when applicable, `DistributionArtifact` fingerprint when applicable, creation time, checked scope, and a canonical lifecycle identity record or an explicit legacy-compatibility marker. Missing, foreign, or mismatched binding fields MUST leave the obligation unresolved.

#### Scenario: Current projection verification closes its obligation

- **WHEN** evidence names the current dispatch/review wave, requested stage and adapter, exact plan/artifact fingerprints, and a matching canonical lifecycle identity with a passing verdict
- **THEN** orchestration may accept that verification boundary and record its durable evidence path

#### Scenario: Evidence belongs to another artifact

- **WHEN** a passing result carries a different plan or artifact fingerprint from the candidate being accepted
- **THEN** orchestration classifies it as stale or foreign and leaves the current obligation pending

#### Scenario: Evidence stage is weaker than requested

- **WHEN** structural evidence is presented for an obligation that requires consumer-runtime verification
- **THEN** orchestration records the structural result separately and does not close the runtime obligation

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
