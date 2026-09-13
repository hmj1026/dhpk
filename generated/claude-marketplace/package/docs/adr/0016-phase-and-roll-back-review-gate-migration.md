# Phase and roll back Review Gate migration

Status: superseded

Implementation status: historical migration design. It is superseded for this
project by the direct-retirement decision recorded in ADR-0018: the Review Gate
is current authority and the former Sentinel/migration compatibility surfaces
are removed.

## Context

Replacing a fail-closed review lifecycle in one cutover would make missing,
foreign, stale, or concurrent evidence failures hard to distinguish from
migration defects. Keeping two permanent authorities would instead preserve the
cost and drift the redesign is intended to remove.

## Historical Decision (superseded)

Migrate through six explicit authority phases:

1. `BASELINE`: collect current Sentinel outcome and cost telemetry.
2. `OBSERVE`: Review Gate computes receipts and status, but Sentinel remains the
   enforcement authority; disagreements are observations.
3. `DUAL_ENFORCE`: both mechanisms must pass and any disagreement fails closed.
4. `CUTOVER`: Review Gate is the authority while Sentinel continues as a
   compatibility projection; a safety disagreement fails closed.
5. `RETIRE`: remove Sentinel state and hook enforcement after the exit gate.
6. `CLEANUP`: remove compatibility schemas, mappings, tests, and documentation.

Until `RETIRE`, preserve Sentinel projection data, the legacy adapter,
schema/version mappings, migration observations, and an explicit rollback flag.
An unsafe disagreement returns exactly one phase: `CUTOVER` returns to
`DUAL_ENFORCE`, where Sentinel and Review Gate both enforce; `DUAL_ENFORCE`
returns to `OBSERVE`, where Sentinel is the sole authority; and `OBSERVE`
returns to `BASELINE`, disabling Review Gate observation. Evidence Receipts
remain diagnostic evidence and are never converted into synthetic Sentinel
clearance.

One Migration Coordinator proposes and records phase transitions. A merged,
non-enforcing configuration may start `OBSERVE`; promotion to `DUAL_ENFORCE`,
`CUTOVER`, `RETIRE`, or `CLEANUP` requires a maintainer Human Authority receipt
bound to the current phase, evidence bundle, and target phase. Promotion is
never automatic. A hard invariant failure may trigger an automatic one-phase
rollback, and a maintainer may request the same scoped rollback with an
authority receipt.

At `RETIRE`, remove `.pending-*`, `.resumed-review-obligations`,
`.unresolved-verdict`, reviewer `SubagentStop` clearance, Stop-time reviewer
reconciliation, the clear-Sentinel state machine, reviewer process-identity and
self-clear rules, and their installation, test, and documentation projections.

Do not retire deterministic PreToolUse secret, path, or shell protection;
SessionStart health and environment checks; tests and CI; branch protection; or
the platform adapters and Review Gate receipt validation.

Compare Accepted-Outcome Cost within like-for-like Material Risk cohorts using
model tokens, dispatch count, semantic review count, remediation rounds, human
turns, elapsed time, receipt reuse, false blocks, unsafe clearance, missed
required review, and post-merge escapes. The exit gate requires at least 20
accepted outcomes, zero unsafe clearance, zero cross-identity receipt reuse,
and zero missed required review. Cost must improve directionally before a
percentage target is calibrated from larger samples.

## Consequences

- Authority is explicit at every migration phase and rollback remains possible
  until legacy state is deliberately retired.
- `OBSERVE` can expose semantic drift without blocking current work;
  `DUAL_ENFORCE` proves enforcement agreement before cutover.
- Sentinel cleanup is bounded to review lifecycle machinery and cannot be used
  to retire unrelated deterministic safety hooks.
- A telemetry failure does not block ordinary work, but its outcome does not
  count toward the retirement sample.

## Alternatives considered

- Cut directly from Sentinel to Review Gate: rejected because there is no
  measured attribution or safe rollback window.
- Run both mechanisms as permanent authorities: rejected because disagreement,
  duplicated state, and token cost would become permanent operating policy.
- Require a fixed percentage cost improvement from the first 20 outcomes:
  rejected because the sample is an exit minimum, not a calibrated benchmark.

## Related decisions

- [ADR-0005 — Separate resumed-review lifecycle clearance from approval](0005-resumed-review-lifecycle-clearance.md)
- [ADR-0011 — Adopt one risk-adaptive workflow](0011-adopt-one-risk-adaptive-workflow.md)
- [ADR-0013 — Migrate Sentinel to evidence receipts](0013-migrate-sentinel-to-evidence-receipts.md)
- [ADR-0015 — Derive workflow state from typed receipts](0015-derive-workflow-state-from-typed-receipts.md)
- [ADR-0017 — Implement Review Gate as a local event module](0017-implement-review-gate-as-a-local-event-module.md)

## Current Decision: direct retirement and schema cleanup

This phased migration is not an active runtime contract for this project.
Sentinel retirement is authorized directly by the maintainer under ADR-0018;
there is no phase transition, rollback coordinator, or dual-authority path.
The retired migration coordinator, Sentinel baseline/runtime-provenance and
legacy-observation modules, migration-observation receipt kind, and associated
compatibility tests are removed. Review Gate review, verification, and
authority receipts remain the current typed evidence contract.
