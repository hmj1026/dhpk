## ADDED Requirements

### Requirement: Orchestration owns dispatch and handoff while Sentinel owns enforcement

The orchestration layer SHALL own worker/reviewer selection, dispatch, follow-up handoff, bounded retry, lifecycle transitions, result collection, and acceptance sequencing. The existing Sentinel enforcement core SHALL remain the independent source of pending review debt, reviewer-slot identity, evidence eligibility, and fail-closed clearance. Sentinel hooks MUST NOT become an agent scheduler, and orchestration MUST NOT directly erase or synthesize passing Sentinel evidence.

#### Scenario: Edit arms a review obligation

- **WHEN** an implementation edit matches a configured review trigger
- **THEN** Sentinel records the pending obligation and orchestration dispatches the resolved reviewer without transferring clearance ownership to that reviewer

#### Scenario: Reviewer hands back a final result

- **WHEN** a reviewer returns a result for the current dispatch
- **THEN** orchestration records the handoff and invokes the existing evidence reconciliation path while Sentinel alone determines whether the obligation can clear

#### Scenario: Reviewer result lacks qualifying evidence

- **WHEN** a reviewer message appears successful but its artifact is missing, stale, malformed, out of scope, or non-passing
- **THEN** orchestration leaves the task unresolved and Sentinel keeps the obligation armed

### Requirement: Dispatch lifecycle integration is additive

Architecture migration SHALL reuse the current dispatch table, reviewer slots, sentinel names, evidence artifact contract, and public orchestration commands. New coordination ports MAY wrap these behaviors, but MUST NOT introduce a second dispatch policy, second sentinel-clear implementation, parallel public command version, or alternate verdict vocabulary.

#### Scenario: Orchestration port wraps an existing reviewer dispatch

- **WHEN** a dispatch/handoff adapter is introduced during migration
- **THEN** it resolves the same agent, sentinel slot, and acceptance contract as the characterized existing flow

#### Scenario: Proposed component duplicates enforcement

- **WHEN** a new coordinator attempts to clear review debt independently of the Sentinel core
- **THEN** architecture validation rejects the duplicate enforcement path
