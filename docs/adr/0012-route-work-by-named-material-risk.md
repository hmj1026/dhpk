# Route work by named material risk

Status: accepted

Implementation status: target design accepted; the current execution policy
remains operative until a planned migration applies this decision.

## Context

Uniform planning, delegation, TDD, and review gates repeat context and judgment
for low-risk work, while file and task counts are weak proxies for actual
risk. Parallel agents reduce elapsed time only when their ownership is truly
independent.

## Decision

Every Work Request receives a minimal Work Record and stable decision identity.
Full OpenSpec artifacts are required for behavioral or public-contract changes,
cross-module or multi-wave work, architecture decisions, and other materially
risky work; bounded mechanical or local changes may remain at the Work Record
level.

Route gates by named Material Risk Signals rather than an aggregate score or
hard file-count threshold. The initial signals cover irreversible or external
actions; security, privacy, authentication, or money; database, schema, or
migration; public contract, release, or compatibility; cross-domain,
shared-state, or multi-writer work; and high uncertainty, unknown root cause,
or failed verification.

The Planning Review Gate requires Human Authority only for material product or
architecture choices, hard-rule exceptions, or irreversible decisions. Other
plans may proceed after Artifact Validation and a Decision Receipt.

Give each decision one Judgment Owner and each Implementation Wave one
Implementation Owner. Route unknown root causes or complex algorithms to a
reasoner, cross-domain architecture to an architect, and multi-owner sequencing
to a planner. The Implementation Owner performs ordinary test-driven work;
specialized TDD or end-to-end assistance is reserved for risk or an unclear
test seam.

Inline work, worker dispatch, and Parallel Dispatch depend on ownership,
coupling, context locality, and closed write scope rather than file count.
Parallel writers require non-overlapping scopes, stable shared decisions, and
one reconciliation owner.

Run one Review Wave per unchanged Implementation Wave. A normal source change
has one code-quality owner; applicable security, database, migration, frontend,
or other orthogonal specialist lanes may run in parallel. Repeating the same
semantic review requires a changed diff, changed risk applicability, or a
prior finding that invalidated the reviewed premise.

## Consequences

- Routine work does not pay for a full specification, separate TDD handoff,
  planner, and serial reviewer stack by default.
- Material safety remains fail-closed because explicit risk signals, not a
  global low-risk score, activate required specialists and Human Authority.
- Reviewers may return premise-changing findings to the Judgment Owner, but do
  not silently become a second design owner.
- File and task counts remain observable telemetry but are not policy gates.

## Alternatives considered

- Require full OpenSpec and human planning approval for every change: rejected
  because it turns routine reversible work into serial coordination overhead.
- Use a composite numeric risk score immediately: rejected because the project
  lacks calibrated runtime outcome data and a score can hide one hard risk.
- Dispatch by file count or available agent count: rejected because neither
  proves independent ownership or lower Accepted-Outcome Cost.

## Related decisions

- [ADR-0011 — Adopt one risk-adaptive workflow](0011-adopt-one-risk-adaptive-workflow.md)
- [ADR-0010 — Flow and usage ownership](0010-flow-and-usage-ownership.md)
- [ADR-0013 — Migrate Sentinel to evidence receipts](0013-migrate-sentinel-to-evidence-receipts.md)
- [ADR-0014 — Standardize the reviewer contract](0014-standardize-the-reviewer-contract.md)
- [ADR-0015 — Derive workflow state from typed receipts](0015-derive-workflow-state-from-typed-receipts.md)
