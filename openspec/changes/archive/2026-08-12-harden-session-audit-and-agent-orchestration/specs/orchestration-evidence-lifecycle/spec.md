## ADDED Requirements

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
A review obligation SHALL close only when a fresh artifact exists for the current review wave, its scope or diff identity matches the dispatched request, and the artifact contains a parseable verdict. A verbal verdict without fresh evidence SHALL leave the obligation pending.

#### Scenario: Reviewer approves without a fresh artifact
- **WHEN** a reviewer returns `APPROVE` but no artifact matches the current wave identity
- **THEN** the obligation remains pending and the coordinator reports incomplete review evidence

#### Scenario: Fresh artifact contains actionable findings
- **WHEN** the artifact is fresh and contains `BLOCK`, `FAIL`, or configured actionable severity
- **THEN** lifecycle completion may be recorded, but the review gate remains unresolved

#### Scenario: Fresh clean artifact matches scope
- **WHEN** a fresh artifact has a parseable clean verdict and matching scope/diff identity
- **THEN** the review obligation closes and records the artifact path and verdict

### Requirement: Quota and retry handling is bounded and resumable
The coordinator SHALL distinguish quota blocks from failed starts, retain the exact task identity for resume, and permit no more than one corrected retry for an identical missing-start or missing-artifact condition. A retry SHALL require a changed dispatch condition, such as bounded context, corrected namespace, or explicit resumed quota state.

#### Scenario: Quota reset permits resume
- **WHEN** a quota-blocked task becomes runnable and its task identity is resumed
- **THEN** the resumed attempt links to the original task and does not create a false second completion

#### Scenario: Identical reviewer retry is attempted twice
- **WHEN** the same reviewer has no start or artifact after one corrected retry
- **THEN** the gate remains pending or escalates with a recorded reason and no unbounded third retry
