## ADDED Requirements

### Requirement: Evidence binds producer, artifact, stage, adapter, and obligation

Every `EvidenceResult` consumed by orchestration SHALL identify the producer dispatch/session, current obligation or review-wave identity, verification stage, consumer adapter identity/version, `DistributionPlan` fingerprint when applicable, `DistributionArtifact` fingerprint when applicable, creation time, checked scope, and parseable verdict. Missing or mismatched binding fields MUST leave the obligation unresolved.

#### Scenario: Current projection verification closes its obligation

- **WHEN** evidence names the current dispatch/review wave, requested stage and adapter, and exact plan/artifact fingerprints with a passing verdict
- **THEN** orchestration may accept that verification boundary and record its durable evidence path

#### Scenario: Evidence belongs to another artifact

- **WHEN** a passing result carries a different plan or artifact fingerprint from the candidate being accepted
- **THEN** orchestration classifies it as stale or foreign and leaves the current obligation pending

#### Scenario: Evidence stage is weaker than requested

- **WHEN** structural evidence is presented for an obligation that requires consumer-runtime verification
- **THEN** orchestration records the structural result separately and does not close the runtime obligation

### Requirement: Handoffs preserve one traceable lifecycle identity

Dispatch, follow-up handoff, corrected retry, artifact readiness, evidence production, and final acceptance SHALL remain linked by one task identity plus explicit attempt identities. A handoff MUST preserve the prior context boundary and obligation identity; it MUST NOT create a false second completion or silently detach evidence from the originating task.

#### Scenario: Existing worker receives a related follow-up

- **WHEN** orchestration reuses a worker for the same scope or journey
- **THEN** the new attempt links to the original task identity and records the handoff before its evidence can be consumed

#### Scenario: Corrected retry succeeds

- **WHEN** one bounded corrected retry produces valid current evidence
- **THEN** the lifecycle records both attempts and only the valid attempt satisfies the original obligation

#### Scenario: Unrelated task uses a new dispatch

- **WHEN** a request has no shared scope, journey, artifact, or accumulated context with the prior task
- **THEN** orchestration creates a new task identity rather than attaching its evidence to the prior lifecycle

### Requirement: Evidence persistence is separate from gate enforcement

Artifact stores and consumer adapters SHALL persist and report evidence but SHALL NOT clear review sentinels or mark orchestration tasks complete. Orchestration SHALL present current evidence to the existing enforcement boundary, and acceptance SHALL require both a terminal orchestration lifecycle state and every applicable Sentinel gate to be resolved.

#### Scenario: Verification adapter reports PASS

- **WHEN** a consumer adapter persists a passing `EvidenceResult`
- **THEN** the result becomes eligible input to reconciliation but does not itself clear a sentinel or complete the task

#### Scenario: Lifecycle is terminal but sentinel remains armed

- **WHEN** a worker and reviewer have reached terminal states but current qualifying Sentinel evidence is absent
- **THEN** orchestration reports incomplete review closure and does not declare completion
