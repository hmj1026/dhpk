# Standardize the reviewer contract

Status: accepted

Implementation status: target design accepted; the current execution policy
and reviewer prompts remain operative until a planned migration applies this
decision.

## Context

Reviewer rules are repeated across agent definitions, prompts, skills, hooks,
and canonical artifact checks. This makes platform behavior drift, encourages
reviewers to restate large inputs, and couples lifecycle safety to a particular
subagent process.

## Decision

Create one versioned, platform-neutral Reviewer Contract as the SSOT for Review
Request, Review Result, evidence, verdict, no-op, read-only, remediation, and
output rules. Platform adapters render that contract; specialist lanes add only
their risk-specific checks and may not redefine its lifecycle semantics.

A Review Request binds decision, wave, obligation, Reviewer Lane, scope, base
and head identities, diff hash, Material Risk Signals, Governing Inputs,
excluded scope, prior findings, and contract version. A reviewer may fetch
additional dependencies read-only, but cannot silently expand its obligation;
missing material scope produces `BLOCKED`.

A Review Result separates:

- execution status: `COMPLETE`, `NOT_RUN`, `INTERRUPTED`, or `UNAVAILABLE`;
- applicability: `REQUIRED` or `NOT_APPLICABLE`; and
- semantic verdict: `PASS`, `CHANGES_REQUIRED`, or `BLOCKED`.

`BLOCKED` means no reliable judgment could be formed. A code or document defect
produces `CHANGES_REQUIRED`; `FAIL` is not a reviewer verdict. An empty diff is
handled deterministically as `NOT_APPLICABLE`, and a valid receipt for unchanged
inputs is reused without invoking a reviewer or inventing a new `PASS`.

Reviewer instances are read-only. The Implementation Owner remediates findings,
then the affected lane checks the resolved findings and the complete updated
scope. Lane continuity requires the same contract and complete handoff, not the
same process identity; a new instance may replace an unavailable resumed
reviewer.

Record impact severity independently from Finding Disposition. Critical and
high findings are always `MUST_FIX`; medium findings default to `MUST_FIX` and
require a Judgment Owner's Decision Receipt to become `FOLLOW_UP`. Low and info
findings default to non-blocking `FOLLOW_UP` or `NOTE`.

Do not resolve reviewer disagreement by majority vote. Technical conflicts
return to the Judgment Owner. A premise-changing finding creates or reopens a
decision, and only material product or architecture choices or hard-rule
exceptions escalate to Human Authority.

Reviewer output is findings-first and structured. It does not repeat the
request, full diff, test logs, generic checklists, or chain-of-thought. A passing
result records inspected scope, evidence references, and verdict. Initial
context contains the contract, changed scope, and Governing Inputs; reviewers
load additional source only when needed. Collect output telemetry before
setting fixed prose or token limits.

## Consequences

- Reviewer content rules and Review Gate lifecycle semantics can evolve without
  duplicating normative prose across platforms.
- Re-review follows lane and evidence identity instead of keeping a particular
  subagent alive, removing the target workflow's need for resumed-process
  clearance machinery.
- Findings retain actionable evidence while successful reviews become compact.
- A reviewer cannot clear its own obligation or repair the implementation it
  judges.

## Alternatives considered

- Keep platform-specific reviewer prompts as separate authorities: rejected
  because lifecycle and verdict semantics would continue to drift.
- Require the same reviewer process for remediation: rejected because process
  liveness is not evidence continuity.
- Let severity alone control completion: rejected because impact and required
  workflow disposition answer different questions.
- Ask another reviewer to vote on disagreements: rejected because it adds cost
  without assigning decision ownership.

## Related decisions

- [ADR-0005 — Separate resumed-review lifecycle clearance from approval](0005-resumed-review-lifecycle-clearance.md)
- [ADR-0011 — Adopt one risk-adaptive workflow](0011-adopt-one-risk-adaptive-workflow.md)
- [ADR-0012 — Route work by named material risk](0012-route-work-by-named-material-risk.md)
- [ADR-0013 — Migrate Sentinel to evidence receipts](0013-migrate-sentinel-to-evidence-receipts.md)
- [ADR-0015 — Derive workflow state from typed receipts](0015-derive-workflow-state-from-typed-receipts.md)
- [ADR-0017 — Implement Review Gate as a local event module](0017-implement-review-gate-as-a-local-event-module.md)
