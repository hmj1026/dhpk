# Code review prompt: fast

Use the resolved scope and fixed point from
[`review-workflow.md`](../shared/review-workflow.md). Follow the code research
steps in [`codex-research-instructions.md`](../shared/codex-research-instructions.md);
that reference owns how Git reads follow the selected scope. If the scope or
fixed point is missing, contradictory, or unreadable, return `INCONCLUSIVE`.

Review only the selected change set and enough surrounding context to assess
material correctness, security, data-integrity, and regression risks. Check
relevant existing tests and project guidance. Keep Standards and Spec evidence
separate, using the code-only status rules in
[`review-common.md`](../shared/review-common.md).

Return normalized, evidence-backed findings in severity order using
[`review_output.md`](../../templates/review_output.md). Include one final
verdict from the shared rubric. A CLI opinion is optional and is used only
when explicitly requested.
