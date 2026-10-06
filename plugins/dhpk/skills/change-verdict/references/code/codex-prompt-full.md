# Code review prompt: full

Use the resolved scope and fixed point from
[`review-workflow.md`](../shared/review-workflow.md). Follow the code research
steps in [`codex-research-instructions.md`](../shared/codex-research-instructions.md);
that reference owns how Git reads follow the selected scope. If the scope or
fixed point is missing, contradictory, or unreadable, return `INCONCLUSIVE`.

Review the complete selected change set and enough surrounding context to
assess correctness, error handling, security, performance, maintainability,
regression risk, and test evidence. Trace relevant callers, dependencies, and
tests where they bear on the selected change. Do not run checks that write
artifacts or alter repository state.

Assess Standards and Spec evidence separately, using the code-only status
rules in [`review-common.md`](../shared/review-common.md). Keep unavailable
evidence visible and do not claim an axis is met without its supporting source.

Return normalized, evidence-backed findings in severity order using
[`review_output.md`](../../templates/review_output.md). Include one final
verdict from the shared rubric. A CLI opinion is optional and is used only
when explicitly requested.
