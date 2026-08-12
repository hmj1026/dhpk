## MODIFIED Requirements

### Requirement: Sentinel auto-clear requires a fresh review artifact
The subagent-stop auto-clear path for reviewer sentinels SHALL clear a review sentinel only when a review artifact matching that reviewer's artifact glob exists, is fresh within the current dispatch window, matches the current review-wave scope or diff identity, and contains a parseable verdict. A reviewer subagent that stops with exit 0 but no matching review artifact SHALL leave the sentinel in place, log the event (e.g. `agent-failures.log` `no review doc`), and thereby keep the review gate unmet so the orchestrator re-dispatches per the existing no-op-reviewer rules. The artifact glob SHALL stay aligned with the reviewer Closing-hook artifact naming convention. Misplaced-artifact diagnostics SHALL be freshness-, session-, and wave-aware, deterministic, and diagnostic-only; stale historical files SHALL never be attributed to the current stop or used for auto-clear.

#### Scenario: Reviewer exits cleanly with no artifact
- **WHEN** a dispatched `doc-reviewer` stops with exit 0 having written no review document
- **THEN** `.pending-doc-review` is NOT auto-cleared, the failure is logged, and the gate remains unmet

#### Scenario: Reviewer produces a fresh artifact
- **WHEN** a dispatched reviewer stops after writing a review artifact matching the expected glob within the dispatch window and matching the current wave
- **THEN** the sentinel auto-clears as today and the matching verdict is recorded

#### Scenario: Stale artifact from a prior round does not satisfy the clear
- **WHEN** the only matching artifact predates the current reviewer dispatch or carries another wave identity
- **THEN** the auto-clear does not fire on that stale artifact

#### Scenario: Stale misplaced artifact is not attributed to a new stop
- **WHEN** a reviewer stops cleanly, the canonical artifact is absent, and the only non-canonical matching files predate the current sentinel/session
- **THEN** the hook logs `no fresh review doc` or an equivalent stale-diagnostic outcome, leaves the sentinel armed, and does not name an old file as the current reviewer output

#### Scenario: Fresh misplaced artifact is diagnosed without clearing
- **WHEN** a matching non-canonical artifact is created at or after the current dispatch-attempt baseline and either belongs to the current session or has no session metadata
- **THEN** the hook logs its relative path as misplaced with a current-session or `current-unknown-session` reason, leaves the sentinel armed, and requires relocation or a new canonical review before clearance

#### Scenario: Explicitly foreign misplaced artifact is ignored
- **WHEN** a matching non-canonical artifact carries provenance for another session or dispatch attempt
- **THEN** the hook ignores it for current diagnostics, leaves the sentinel armed when no current artifact exists, and does not attribute the foreign path to the current reviewer

#### Scenario: Verbal approval without fresh evidence does not close the gate
- **WHEN** a reviewer returns `APPROVE` but no fresh canonical artifact matches the current wave
- **THEN** the sentinel remains armed and the coordinator records incomplete review evidence

## ADDED Requirements

### Requirement: Reviewer liveness and review approval are separate contracts
Reviewer liveness SHALL record whether a dispatch is still running independently from whether a fresh artifact proves an approved review. Clearing an in-flight marker SHALL never clear a pending review obligation without fresh scope-bound evidence.

#### Scenario: Reviewer stops successfully without an artifact
- **WHEN** a known reviewer stops with success but no fresh matching artifact exists
- **THEN** its in-flight marker is cleared while the review sentinel remains armed

#### Scenario: Reviewer fails with an artifact from an older wave
- **WHEN** a reviewer reports failure and only an older artifact exists
- **THEN** liveness is reconciled but the current review obligation remains pending

#### Scenario: Reviewer has fresh actionable findings
- **WHEN** a fresh artifact has a clean transport result but actionable findings
- **THEN** liveness may close while unresolved-verdict evidence remains visible
