# Derive workflow state from typed receipts

Status: accepted

Implementation status: target design accepted; the current execution policy
remains operative until a planned migration applies this decision.

## Context

Agent messages, task checkboxes, review artifacts, CI status, and merge state
currently expose overlapping notions of completion. Extra confirmation prompts
then compensate for the absence of one authoritative lifecycle, increasing
human turns without strengthening evidence.

## Decision

Use the lifecycle `RECORDED`, `DECISION_PENDING`, `READY`, `EXECUTING`,
`EVIDENCE_PENDING`, `MERGE_READY`, `POST_MERGE_PENDING`, `ARCHIVE_READY`, and
`ARCHIVED`. Inapplicable states may be skipped. `BLOCKED` is a resumable
condition; `CANCELLED` and `SUPERSEDED` are terminal outcomes.

One Workflow Coordinator derives transitions from typed Evidence Receipts.
Judgment Owners, Implementation Owners, reviewers, test and CI adapters, and
human or provider observations emit evidence only for their own authority.
They do not directly mark the workflow complete. Deterministic hooks may veto
unsafe actions but do not advance lifecycle state.

Evidence failure returns only as far as necessary. `CHANGES_REQUIRED` or a
failed test returns to `EXECUTING`; changed Governing Inputs or a material
premise returns to `DECISION_PENDING`; expired evidence stays
`EVIDENCE_PENDING` while the affected lane is refreshed. Required unavailable
evidence becomes `BLOCKED` after bounded retry rather than restarting the
workflow.

Batch Human Authority decisions that can safely wait into one Decision Packet
containing each question, recommendation, alternatives and impact, consequence
of deferral, and blocking status. An imminent irreversible action or safety
event still stops immediately; routine follow-up does not interrupt the user.

When the Work Record authorizes delivery, reaching `MERGE_READY` authorizes the
agent to create or update a pull request without another confirmation. Human
Authority remains required for merge, tag, and deployment. If delivery was not
authorized, stop at `MERGE_READY` and report the missing external authority.

Pull-request CI emits verification receipts for the remote commit. Existing
semantic review receipts are reused when their bound inputs remain valid;
semantic review runs again only for an affected diff, risk, policy, or Governing
Input. CI failure returns to `EVIDENCE_PENDING` or `EXECUTING`.

Use three explicit completion levels:

- Implementation Complete: implementation, semantic review, and local
  verification receipts are satisfied;
- Delivery Complete: Human Authority merged the intended change and the merge
  commit plus required post-merge CI were observed; and
- Workflow Complete: required specification synchronization and archive
  transitions finished after Delivery Complete.

Synchronize canonical specifications in the implementation pull request, but
archive only after merge and post-merge validation. If archive materialization
itself requires a versioned repository change, batch it into a later maintenance
pull request without reopening the original Implementation Wave.

## Consequences

- A passing test, reviewer message, opened pull request, or checked task cannot
  individually overstate completion.
- Normal delivery reaches one Human Authority merge boundary without a second
  confirmation merely to open the pull request.
- Failed or stale evidence refreshes a bounded portion of the workflow.
- Post-merge archive remains observable even when its physical update is
  deferred to a maintenance batch.

## Alternatives considered

- Let each agent or hook write lifecycle status directly: rejected because
  overlapping authorities create contradictory completion claims.
- Restart the workflow after any changed evidence: rejected because unaffected
  decisions and receipts remain valid.
- Archive before merge: rejected because local or pull-request success is not
  proof that the intended merge and post-merge CI occurred.

## Related decisions

- [ADR-0011 — Adopt one risk-adaptive workflow](0011-adopt-one-risk-adaptive-workflow.md)
- [ADR-0012 — Route work by named material risk](0012-route-work-by-named-material-risk.md)
- [ADR-0013 — Migrate Sentinel to evidence receipts](0013-migrate-sentinel-to-evidence-receipts.md)
- [ADR-0014 — Standardize the reviewer contract](0014-standardize-the-reviewer-contract.md)
- [ADR-0016 — Phase and roll back Review Gate migration](0016-phase-and-roll-back-review-gate-migration.md)
- [ADR-0017 — Implement Review Gate as a local event module](0017-implement-review-gate-as-a-local-event-module.md)
