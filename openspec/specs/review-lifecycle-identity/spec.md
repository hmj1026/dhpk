# review-lifecycle-identity Specification

## Purpose
TBD - created by archiving change deepen-review-lifecycle-identity. Update Purpose after archive.
## Requirements
### Requirement: Review lifecycle identity has one canonical record

The review lifecycle SHALL construct, parse, canonicalize, serialize, and compare identity through one source-only record module. The canonical record MUST distinguish `task_id` from `attempt_id` and MUST represent the current scope, diff, session, dispatch identity tuple `(session_id, dispatch_attempt, dispatch_id)`, wave, producer, adapter, stage, plan fingerprint, and artifact fingerprint when those fields are available.

#### Scenario: Retry preserves task identity

- **WHEN** a task is retried under a new attempt
- **THEN** the canonical record retains the same `task_id`, assigns a distinct `attempt_id`, and links both attempts without treating the retry as a second task completion

#### Scenario: Equivalent aliases canonicalize identically

- **WHEN** records use aliases such as `scope`/`scope_id`, `wave`/`wave_id`, `adapter`/`adapter_id`, or `stage`/`verification_stage`
- **THEN** canonicalization maps them to the same named fields before equality or freshness checks

### Requirement: Identity binding classes are explicit

The canonical identity module SHALL classify `task_id`, `attempt_id`, `scope_id`, `diff_id`, `session_id`, and the dispatch identity tuple `(session_id, dispatch_attempt, dispatch_id)` as strong bindings. Producer, wave, adapter, stage, plan fingerprint, and artifact fingerprint SHALL be context-bound fields whose applicability is evaluated by the consuming obligation.

#### Scenario: Strong binding differs

- **WHEN** a declared artifact identity has a different task, attempt, scope, diff, session, or dispatch binding from the current obligation
- **THEN** identity comparison fails closed and the evidence cannot satisfy the obligation

#### Scenario: Context-bound field is not applicable

- **WHEN** a legacy record does not declare a context-bound field that the current obligation does not require
- **THEN** canonicalization preserves the missing field as not applicable rather than inventing a value

### Requirement: Identity serialization remains compatibility-preserving

The canonical record MUST preserve existing external TSV/frontmatter formats, field order, artifact paths, and shell invocation boundaries during the first migration wave. Existing positional APIs SHALL remain available through compatibility shims, and the module MUST NOT require a new external runtime dependency.

#### Scenario: Legacy shell caller uses positional arguments

- **WHEN** an existing lifecycle or stop hook invokes its positional API
- **THEN** the compatibility shim produces the same serialized record and lifecycle-visible result as the characterized legacy path

#### Scenario: Canonical record is round-tripped

- **WHEN** a record is serialized and parsed by the canonical module
- **THEN** its normalized fields and stable field ordering round-trip without losing empty optional values or delimiter-safe content

### Requirement: Legacy and malformed artifacts fail according to declared identity

An artifact with no new identity fields SHALL remain eligible for the existing legacy compatibility path. Once an artifact declares any new identity field, strong-binding mismatches MUST fail closed; context-bound mismatches MUST remain visible as stale or unresolved evidence and MUST NOT clear a review obligation. Malformed or actionable verdicts SHALL remain separate from lifecycle completion.

#### Scenario: Legacy artifact has no identity fields

- **WHEN** a pre-migration artifact contains no new identity fields
- **THEN** the consuming path uses the existing compatibility behavior and records that the legacy path was used

#### Scenario: New artifact has a foreign session

- **WHEN** an artifact declares a session identity that differs from the current obligation
- **THEN** reconciliation leaves the obligation and Sentinel gate unresolved and reports the foreign binding

#### Scenario: Context fingerprint is stale

- **WHEN** an artifact's declared plan or artifact fingerprint differs from the candidate being accepted
- **THEN** the result is stale/unresolved and cannot satisfy the current review obligation

### Requirement: Identity records do not perform enforcement

The identity module SHALL only construct, parse, normalize, serialize, and compare records. It MUST NOT clear sentinels, mark orchestration tasks complete, or convert a `BLOCK`/`FAIL` verdict into approval. Sentinel clearance, evidence eligibility, and review approval remain owned by their existing enforcement boundaries.

#### Scenario: Identity comparison succeeds

- **WHEN** a canonical record matches the current obligation
- **THEN** the comparison becomes eligible input to reconciliation but does not itself clear a sentinel or complete the task

#### Scenario: Lifecycle completes with an actionable verdict

- **WHEN** a lifecycle path records a `BLOCK` or `FAIL` artifact that is otherwise identity-bound
- **THEN** lifecycle bookkeeping may complete according to its existing rules while review approval and unresolved evidence remain unsatisfied
