## MODIFIED Requirements

### Requirement: No-op reviewer recovery is bounded
A reviewer with no evidence of review work or no required artifact SHALL fail the gate, receive at most one corrected retry, and then be replaced or left pending with a recorded reason. A corrected retry SHALL carry the same review-wave identity plus a changed bounded condition, such as a reduced context, corrected namespace, or explicit resumed quota state. The orchestrator SHALL not perform unbounded identical reviewer retries.

#### Scenario: Reviewer exits without an artifact
- **WHEN** a reviewer exits successfully but writes no matching review artifact
- **THEN** the sentinel remains pending, one corrected retry is permitted, and a third identical retry is prohibited

#### Scenario: Reviewer start is never observed
- **WHEN** a reviewer dispatch has no started event within the bounded start window
- **THEN** the attempt is recorded as failed-start and only one corrected retry is allowed

#### Scenario: Quota blocks a reviewer
- **WHEN** a reviewer cannot run because the session quota is exhausted
- **THEN** the attempt is recorded as quota-blocked and resumable, not treated as an ordinary successful retry or completed review

## ADDED Requirements

### Requirement: Review telemetry distinguishes attempts, verdicts, and artifacts
The orchestrator SHALL report reviewer dispatch attempts, started/completed verdicts, fresh artifacts, retries, and unresolved obligations as separate counters keyed by role and review-wave identity. Spawn count alone SHALL not be presented as completed review coverage.

#### Scenario: A dispatch attempt produces no start
- **WHEN** a reviewer spawn is issued but no started event or artifact appears
- **THEN** it increments attempts and failed-start counters but not completed verdicts or fresh artifacts

#### Scenario: One reviewer produces a fresh verdict
- **WHEN** a reviewer starts and writes one fresh artifact with a parseable verdict
- **THEN** attempts, completed verdicts, and fresh artifacts each reflect one event

### Requirement: Re-review requires changed scope or explicit escalation
A confirm-only re-review SHALL carry the prior finding set and the current scope/diff identity. The same role SHALL not be dispatched again for an unchanged wave unless the coordinator records an explicit failed-start, quota, or escalation reason.

#### Scenario: Missing artifact is corrected once
- **WHEN** a reviewer has one missing-artifact attempt and a corrected bounded retry produces a fresh artifact
- **THEN** the retry is linked to the same wave and no identical third attempt is dispatched

#### Scenario: No new scope exists
- **WHEN** a clean verdict already has fresh evidence for the current wave and no files changed
- **THEN** the orchestrator does not dispatch another full review
