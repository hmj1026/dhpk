# Simplification contract

Use this reference only when a review angle fails, fan-out is unavailable, or a
cleanup exceeds the bounded single-file path. The main skill owns the ordered
workflow; this file defines the evidence and handoff shape.

## Finding record

Every finding must contain:

```text
file: <repository-relative path>
line: <line number or narrow range>
summary: <one line>
cost: <what is duplicated, wasted, retained, or harder to maintain>
angle: reuse | simplification | efficiency | altitude
```

Do not treat an absence of a textual match as proof that a dynamic dispatch,
reflection hook, framework callback, or public consumer is unused. Keep such a
finding or mark it for human confirmation.

## Degraded review

- `4-agent fan-out`: all four independent read-only angles completed.
- `degraded: mixed`: some registered reviewers completed and missing angles ran
  inline.
- `degraded: single-pass`: the current worker performed all four angles inline;
  explicitly say that no independent fan-out ran.

An unavailable worker is degraded evidence, not permission to invent a role or
silently drop an angle.

## Heavy-cleanup handoff

Use a registered `worker` for scoped implementation and a registered
`architect` for cross-module design or dependency-direction decisions. Pass the
resolved scope, baseline test command/result, finding records, assigned files,
and the exact requested verification. If neither role is registered, keep the
current change bounded, document deferred files and why they were deferred, and
recommend one concrete follow-up dispatch. A plan is not an applied cleanup.

## Safety boundary

Preserve dynamic-dispatch and framework-injected hooks unless a call-graph or
other direct proof establishes they are unused. Public or cross-repository API
symbols require a deprecation/migration decision; do not raw-delete them in a
simplification pass. Use GitNexus impact/rename when available; otherwise build
a complete native reference list before editing and never use blind
find-and-replace for a symbol rename. Run small batches and rerun the baseline
command after each meaningful batch when practical.
