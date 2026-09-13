# Adopt one risk-adaptive workflow

Status: accepted

Implementation status: target design accepted; the current execution policy
remains operative until a planned migration applies this decision.

## Context

The current execution path can serially stack planning, reasoning, TDD,
implementation, specialist review, verification, and human confirmation even
when several steps repeat the same judgment. High-capability models and
parallel agents can reduce elapsed time, but unnecessary dispatches, repeated
context, and redundant approvals increase the total cost of reaching an
accepted result.

## Decision

Adopt one Default Workflow from Work Request through verified merge and
post-merge archive, with temporary compatibility or shadow paths only during
migration. Optimize Accepted-Outcome Cost while preserving deterministic
safety, required test and CI evidence, specialist review for material risks,
and human authority over material product or architecture choices, hard-rule
exceptions, merge, tag, and deployment.

Use Risk-Adaptive Gates instead of applying every discretionary gate to every
change. Give each decision one Judgment Owner; a second opinion requires a
hard-risk condition, premise-changing evidence, or an explicit request.
Preserve review debt as a durable, platform-neutral Review Obligation owned by
a Review Gate. Retire the physical hook-backed Review Sentinel after a measured
migration rather than treating it as the permanent domain authority.

Release and deployment workflow redesign is outside this decision. Their
irreversible authority boundaries must remain compatible with the Default
Workflow.

## Consequences

- Parallelism is justified by independent ownership or risk, not by agent
  availability alone; lower wall-clock time is not assumed to mean lower cost.
- Deterministic safety checks and material-risk specialists remain mandatory
  where applicable, while routine model judgments are not stacked by default.
- Human intervention is concentrated at true authority boundaries and routine
  reversible choices may be batched.
- ADR-0005's separation of lifecycle clearance from reviewer verdict remains
  valid. The hook-backed mechanism may serve as a compatibility projection
  while Review Gate semantics are introduced.
- This decision supersedes only ADR-0009's assignment of permanent review-debt
  ownership to Sentinel. ADR-0009's distribution and orchestration boundaries
  remain unchanged.

## Alternatives considered

- Keep permanent classic and lean workflow profiles: rejected because their
  policies would drift and make outcome evidence incomparable.
- Keep universal gates and optimize individual prompts: rejected because it
  leaves redundant ownership and human turns intact.
- Remove durable review debt together with Sentinel hooks: rejected because
  parallel sessions and interrupted reviewers still require attributable,
  fail-closed lifecycle evidence.

## Related decisions

- [ADR-0005 — Separate resumed-review lifecycle clearance from approval](0005-resumed-review-lifecycle-clearance.md)
- [ADR-0009 — Distribution projection and orchestration ownership](0009-distribution-projection-and-orchestration-ownership.md)
- [ADR-0010 — Flow and usage ownership](0010-flow-and-usage-ownership.md)
- [ADR-0012 — Route work by named material risk](0012-route-work-by-named-material-risk.md)
- [ADR-0013 — Migrate Sentinel to evidence receipts](0013-migrate-sentinel-to-evidence-receipts.md)
- [ADR-0014 — Standardize the reviewer contract](0014-standardize-the-reviewer-contract.md)
- [ADR-0015 — Derive workflow state from typed receipts](0015-derive-workflow-state-from-typed-receipts.md)
- [ADR-0016 — Phase and roll back Review Gate migration](0016-phase-and-roll-back-review-gate-migration.md)
- [ADR-0017 — Implement Review Gate as a local event module](0017-implement-review-gate-as-a-local-event-module.md)
