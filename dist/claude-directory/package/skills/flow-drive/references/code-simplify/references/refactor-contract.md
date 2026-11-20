# Simplification contract

Use this reference only when a review angle is incomplete or a
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

## Execution evidence

- `current Host/Model single-pass`: the standard path completes all four angles.
- `optional fan-out`: supported read-only subagents supply independent angles.
- `mixed`: subagent observations and inline review complete the four angles.

Name every unreviewed angle as incomplete evidence; preserve completed angles.

## Heavy-cleanup handoff

Keep implementation within the resolved scope using the current Host and Model.
Return unresolved cross-module design or dependency-direction decisions to the
caller with baseline test command/result, finding records, affected files and
the required verification. A plan is not an applied cleanup.

## Safety boundary

Preserve dynamic-dispatch and framework-injected hooks unless a call-graph or
other direct proof establishes they are unused. Public or cross-repository API
symbols require a deprecation/migration decision; do not raw-delete them in a
simplification pass. Use GitNexus impact/rename when available; otherwise build
a complete native reference list before editing and never use blind
find-and-replace for a symbol rename. Run small batches and rerun the baseline
command after each meaningful batch when practical.
