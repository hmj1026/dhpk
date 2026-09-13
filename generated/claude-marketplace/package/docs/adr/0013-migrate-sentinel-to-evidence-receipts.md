# Migrate Sentinel to evidence receipts

Status: accepted

Implementation status: target design accepted; the current execution policy
remains operative until a planned migration applies this decision.

## Context

Hook-backed Sentinel files preserve review debt across interrupted and resumed
reviewers, but their platform-specific lifecycle has grown into a second state
machine. Re-running equivalent semantic reviews at close, commit, and pull
request gates also spends tokens without producing new evidence.

## Decision

Represent durable evidence with a shared immutable Evidence Receipt envelope
and typed `decision`, `review`, `verification`, `authority`, and
`migration-observation` payloads. One receipt kind cannot substitute for
another: reviewer approval cannot erase a failed verification, and a passing
test cannot satisfy semantic review.

A review receipt binds at minimum to decision ID, implementation wave ID,
obligation ID, reviewer lane, Reviewer Contract version, applicable Material
Risk Signals, patch hash, Scope Manifest hash, Governing Inputs hash, executed
commands, observed results, and verdict. General work uses those scoped
identities for Receipt Reuse. Material-risk work also binds the reviewed tree
identity when a safe dependency closure cannot be established.

Close, pre-commit, and pull-request gates reuse a receipt only while those
inputs and relevant policy versions remain valid. Empty diffs produce a
deterministic `NOT_APPLICABLE` result without a semantic reviewer. An unchanged
valid receipt produces a reuse observation rather than a new verdict. Changed
patches, governing inputs, risk applicability, policy, or contract invalidate
only the affected receipt lanes.

Required review or verification fails closed when its lane is `NOT_RUN` or
`UNAVAILABLE`, a receipt is malformed, stale, foreign, or identity-incompatible,
a `MUST_FIX` finding remains unresolved, or deterministic verification fails.
During `DUAL_ENFORCE` and `CUTOVER`, disagreement between Review Gate and the
Sentinel projection also fails closed; `OBSERVE` records disagreement without
changing Sentinel authority. The orchestrator may retry within a bound or
replace an unavailable reviewer with another instance of the same lane; an
unresolved failure becomes `BLOCKED`, not an automatic request for human
approval.

`FOLLOW_UP` and `NOTE` findings, an unavailable non-applicable advisory lane,
and telemetry delivery failures do not block completion. An outcome missing
required migration telemetry cannot count toward Sentinel retirement.

Migrate through the measured phases defined by ADR-0016. Sentinel remains the
authority during `OBSERVE`; both mechanisms enforce during `DUAL_ENFORCE`;
Review Gate becomes the authority at `CUTOVER` while hook-backed Review Sentinel
state remains temporarily as a compatibility projection and rollback path. Do
not remove the physical Sentinel state machine until at least 20 accepted
outcomes show no missed required review, unsafe lifecycle clearance, or
cross-session or cross-diff receipt reuse; demonstrate lower Accepted-Outcome
Cost and an executable rollback path as part of the exit gate.

## Consequences

- Lifecycle clearance remains separate from reviewer approval, preserving
  ADR-0005 while moving its durable proof behind a platform-neutral contract.
- Repeated gates validate receipt identity and freshness instead of asking a
  model to repeat unchanged semantic judgment.
- Parallel sessions require exact identity binding; a missing, stale, foreign,
  or inapplicable receipt fails closed.
- Scoped freshness avoids invalidating review for unrelated repository changes;
  hard-risk work falls back to the reviewed tree identity when the dependency
  boundary is uncertain.
- Twenty accepted outcomes are a minimum migration sample, not a permanent
  workflow tuning constant or proof of statistical significance.

## Alternatives considered

- Delete Sentinel without a durable replacement: rejected because interruption
  and concurrency can still lose or misattribute review obligations.
- Keep canonical review files as the cross-platform API: rejected because their
  paths and lifecycle are adapter-specific.
- Re-run every review at every gate: rejected because unchanged inputs cannot
  justify repeated semantic cost.

## Related decisions

- [ADR-0005 — Separate resumed-review lifecycle clearance from approval](0005-resumed-review-lifecycle-clearance.md)
- [ADR-0011 — Adopt one risk-adaptive workflow](0011-adopt-one-risk-adaptive-workflow.md)
- [ADR-0012 — Route work by named material risk](0012-route-work-by-named-material-risk.md)
- [ADR-0014 — Standardize the reviewer contract](0014-standardize-the-reviewer-contract.md)
- [ADR-0015 — Derive workflow state from typed receipts](0015-derive-workflow-state-from-typed-receipts.md)
- [ADR-0016 — Phase and roll back Review Gate migration](0016-phase-and-roll-back-review-gate-migration.md)
- [ADR-0017 — Implement Review Gate as a local event module](0017-implement-review-gate-as-a-local-event-module.md)
