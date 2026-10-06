# Code review prompt: branch

Apply this prompt when the selected scope is a branch comparison. Use the exact
merge-base SHA already recorded by
[`review-workflow.md`](../shared/review-workflow.md). The branch name is an
input to that resolution, not a new comparison anchor. Follow the branch
research steps in
[`codex-research-instructions.md`](../shared/codex-research-instructions.md);
do not recompute a moving base reference. If the pinned point or branch scope
cannot be read consistently, return `INCONCLUSIVE`.

Review all changes in the selected branch scope, including relevant commit
history, affected callers, tests, and documentation. Apply the depth supplied
for this review. Report only evidence-backed issues and gaps.

Assess Standards and Spec evidence separately, using the code-only status
rules in [`review-common.md`](../shared/review-common.md). An absent normative
specification is a visible `UNAVAILABLE` gap, not evidence of satisfaction.

Return normalized findings in severity order and one final verdict using
[`review_output.md`](../../templates/review_output.md). No branch overview,
rating table, or second reviewer is required.
