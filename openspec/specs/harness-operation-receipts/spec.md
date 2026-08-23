# harness-operation-receipts Specification

## Purpose

Provide a durable, identity-bound operation receipt that makes workflow phases, retries, evidence readiness, exact checkout provenance, and rollback decisions auditable without treating stale metadata as current runtime proof.

## Requirements

### Requirement: Every harness attempt emits one append-only receipt

Each harness attempt SHALL emit one logical append-only `dhpk.harness.receipt.v1` receipt composed of an immutable attempt envelope and immutable, monotonically sequenced transition events. The envelope and every event SHALL contain the command, lifecycle phase, outcome, task identity, attempt identity, session and dispatch identity when applicable, timestamps, bounded diagnostics, artifacts, and a resumable command. A later attempt SHALL append a new attempt record and MUST NOT overwrite the prior attempt's outcome.

#### Scenario: A phase completes

- **WHEN** a phase reaches a terminal outcome
- **THEN** its receipt records the outcome, command identity, evidence references, and completion timestamp in the append-only receipt store

#### Scenario: A retry is started

- **WHEN** a retry is launched for an existing task
- **THEN** the new receipt preserves the original task identity, uses a distinct attempt identity, and links to the prior attempt

#### Scenario: A transition is appended

- **WHEN** a phase changes the lifecycle state of an active attempt
- **THEN** the writer creates the next immutable event sequence and leaves every prior envelope and event byte-identical

### Requirement: Receipt provenance binds the exact source checkout

An operation receipt that claims source or package evidence SHALL record the exact source, base, and target SHA values applicable to the attempt, the resolved target tree identity, and the inventory, plan, and artifact fingerprints used to produce the evidence. Tracked package provenance SHALL record the generated-input identity (`generatedFromCommit` and, when available, `generatedFromTree`) separately from the final target identity. A syntactically valid or historical commit string SHALL NOT satisfy exact-checkout binding by itself.

#### Scenario: Receipt targets the current checkout

- **WHEN** a phase claims exact-head reproducibility
- **THEN** the receipt proves that `targetCommit` and `targetTree` match the clean checkout used to verify the artifact, while the package generated-input commit is resolved and is an ancestor of that target

#### Scenario: Package receipt points to an older tree

- **WHEN** a tracked package receipt references a valid ancestor and the canonical adapter proves the package bytes match the current target inputs
- **THEN** the package evidence remains eligible, and the workflow receipt binds the final target commit/tree without requiring a self-referential provenance rewrite

#### Scenario: Generated package inputs drift from the target

- **WHEN** a tracked package receipt references an ancestor but the canonical adapter reports stale package bytes or a generated-input commit that is not an ancestor of the target
- **THEN** exact-head evidence is rejected and the result remains `NOT_RUN` or `NO_SHIP` until the package is regenerated from the target inputs

### Requirement: Receipt digests have an immutable event boundary

Each receipt event SHALL expose an `event_sha256` over its canonical serialized bytes and a `chain_sha256` over the previous chain digest plus the current event digest. The event digest SHALL never be rewritten when later events are appended. Consumers SHALL identify the exact event sequence and digest they consumed, and verification SHALL reject missing, duplicated, reordered, or chain-mismatched events.

#### Scenario: Later event does not invalidate prior evidence

- **WHEN** a new transition event is appended after a consumer has accepted an earlier terminal or readiness event
- **THEN** the earlier event digest remains valid while the new chain tip is recorded separately

#### Scenario: Event stream is rewritten

- **WHEN** an event's bytes, sequence, or chain predecessor differs from its recorded digest
- **THEN** receipt verification fails closed and the affected evidence cannot satisfy a phase

### Requirement: Receipt identity is strong enough for evidence matching

Receipt matching SHALL treat task ID, attempt ID, scope or diff identity, session identity, and the dispatch tuple as strong bindings when declared. Plan fingerprint, artifact fingerprint, surface, adapter, stage, and producer SHALL be retained as context bindings whose applicability is checked by the consuming phase. A mismatch SHALL fail closed rather than reuse an earlier passing result.

#### Scenario: Evidence has a foreign attempt

- **WHEN** a phase receives evidence with a different declared task, attempt, session, or dispatch binding
- **THEN** the evidence is rejected as foreign or stale and cannot satisfy the current phase

#### Scenario: Evidence has a stale artifact fingerprint

- **WHEN** the evidence artifact fingerprint differs from the candidate artifact under verification
- **THEN** the phase records a stale-evidence failure and does not promote the earlier verdict

### Requirement: Lifecycle transitions are monotonic and explicit

Receipt lifecycle state SHALL use `PLANNED`, `RED`, `GREEN`, `REFACTOR`, `VERIFIED`, and `COMPLETE` for the normal path. The receipt outcome is a separate field using `PASS`, `FAIL`, `BLOCKED`, `NOT_RUN`, `NOT_CONFIGURED`, `SKIP_INCOMPATIBLE`, `UNAVAILABLE`, `NO_SHIP`, `PARTIAL`, `PUBLISHED_PENDING`, `PUBLISHED_UNHEALTHY`, or `OVERRIDDEN`. Invalid or backward transitions SHALL be rejected. An override SHALL remain visibly distinct from PASS and SHALL carry actor, reason, skipped gates, accepted risk, scope, and expiry metadata.

#### Scenario: Behavior change passes verification

- **WHEN** a behavior change records RED evidence, a GREEN implementation, refactor evidence, and independent verification
- **THEN** the receipt may transition to `COMPLETE` only after all applicable gates are terminal and identity-bound

#### Scenario: Unsupported adapter is requested

- **WHEN** a native adapter cannot execute a requested phase
- **THEN** the receipt records `NOT_CONFIGURED`, `UNAVAILABLE`, or `BLOCKED` with a resume reason and never transitions directly to `COMPLETE`

#### Scenario: Authorized override is recorded

- **WHEN** an authorized human or reviewer accepts a bounded skipped gate
- **THEN** the receipt records outcome `OVERRIDDEN` with actor, reason, skipped gates, risk, scope, and expiry, and does not convert the missing evidence to `PASS` or `COMPLETE`

### Requirement: Readiness requires revalidation of persisted bytes

Before a receipt or artifact is accepted by a consuming phase, the harness SHALL re-read and rehash the referenced receipt/report/artifact bytes and compare them with the persisted digest and identity bindings. File existence, size, mtime, or a ready marker alone SHALL NOT satisfy readiness.

#### Scenario: Ready artifact was modified

- **WHEN** a consumer finds a ready marker but the current bytes no longer match the recorded digest
- **THEN** the consumer records stale or incomplete evidence and refuses to use the artifact

#### Scenario: Ready artifact remains unchanged

- **WHEN** the current bytes, digest, and identity tuple all match the recorded receipt
- **THEN** the artifact becomes eligible for the next phase without changing its producer verdict

### Requirement: Retries and rollback preserve operation identity

Mutating or retryable operations SHALL record an idempotency or operation key, previous receipt reference, target surface, durable backup reference when applicable, and phase transitions for planned, staged, published, verified, rolled-back, partial, stale, or blocked outcomes. A replay with an existing terminal operation key SHALL be resolved from the prior receipt or rejected; it MUST NOT silently perform a second unrelated mutation.

#### Scenario: Atomic publish fails during staging

- **WHEN** generation or installation fails before publication
- **THEN** the receipt records the failure and the previously accepted artifact remains available for rollback or retry

#### Scenario: Rollback targets a foreign receipt

- **WHEN** rollback identity, surface ownership, exact SHA, plan, or artifact fingerprint does not match the target
- **THEN** rollback fails closed without deleting or replacing the foreign target

#### Scenario: Consumer verification fails after publication

- **WHEN** a required consumer fails after an immutable release is published
- **THEN** the receipt records `PUBLISHED_UNHEALTHY` or `NO_SHIP`, preserves the immutable release, and provides a repair/resume path instead of deleting or editing the release
