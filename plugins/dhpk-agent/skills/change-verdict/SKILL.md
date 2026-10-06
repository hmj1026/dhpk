---
name: change-verdict
description: "Read-only verdicts for code changes, pull requests, security, tests, documents, or change risk. Use when judging an existing change or evidence set. Not for implementing fixes, generating tests, editing documents, clearing gates, or architecture-only design. Output: evidence-backed findings, degradation state, and READY, BLOCKED, or INCONCLUSIVE."
metadata:
  dhpk-invocation-class: "implicit-eligible"
---

# Change Verdict

Use the smallest mode and scope that answer the request. This skill reads
evidence and returns a verdict with text-only recommendations; it does not
change repository or review state.

## Modes

| Mode | Question answered | Read when |
|---|---|---|
| `code` | Is the selected code change sound against applicable standards and specifications? | Reviewing a code diff or branch. |
| `pr` | Is a proposed PR complete and hygienic for its declared merge method? | Reviewing branch changes or PR metadata. |
| `security` | Are security-sensitive paths exposed to OWASP risks or unsafe dependencies? | Auditing auth, input, secrets, dependencies, or security-sensitive changes. |
| `tests` | Do existing tests and acceptance evidence cover the behavior? | Reviewing test adequacy or tracing acceptance criteria to evidence. |
| `docs` | Is a document accurate, complete, and consistent with the code? | Reviewing Markdown, specs, READMEs, or design documents. |
| `risk` | What breaking surface, blast radius, and change-scope signals are present? | Assessing an uncommitted diff or large refactor. |

Choose one mode. If the mode or requested scope is ambiguous or cannot be
resolved, return `INCONCLUSIVE` and state the minimum evidence or clarification
needed.

## When NOT to Use

- Implement or fix a finding: use `flow-drive`.
- Trace an unfamiliar code path: use `code-trace`.
- Specialized skill governance scoring or stocktake: the former audit capability is retired. For an existing skill document or change, select this skill's `docs` or `risk` mode within its declared scope.

## Procedure

Follow [`references/shared/review-workflow.md`](references/shared/review-workflow.md)
for scope resolution, fixed-point handling, evidence collection, and aggregation.
It owns the shared read-only sequence.

Load only the selected mode's references:

- `code`: use the branch prompt for a branch scope; otherwise use the fast or
  full prompt matching the selected depth. The shared code research instructions
  own Git reads; apply the code-only Standards and Spec status rules in
  [`references/shared/review-common.md`](references/shared/review-common.md).
- `pr`: read PR metadata and use `scripts/check-unrelated-changes.sh` only as a
  read-only advisory scan when PR metadata is available.
- `security`: use `references/security/codex-prompt-security.md` and label
  findings with their OWASP category.
- `tests`: read source, tests, acceptance criteria, and available runtime
  evidence. `--ac-trace` maps criteria to evidence; `--coverage` loads
  `references/tests/codex-prompt-test-review.md`. Legacy `--scope tests` means
  `--mode tests`.
- `docs`: read the full target and enough source or configuration to check it.
  Load `references/docs/review-loop-doc.md` only when a prior snapshot is
  supplied.
- `risk`: run `scripts/risk-analyze.js --json` on the current read-only tree and
  use `references/risk/` to interpret its score.

For every mode, report evidence gaps and use the response shape in
[`templates/review_output.md`](templates/review_output.md). The code-only
Standards and Spec section is omitted from all other modes. Severity and final
verdict meanings are owned by
[`references/shared/review-rubric.md`](references/shared/review-rubric.md).

## Optional CLI second opinion

Only explicit `--second-opinion=codex-exec` may invoke
`scripts/review-cli.sh --backend cli`. Pass the selected scope and fixed point,
not the primary conclusion. Keep the CLI result separate, redact it, and
record its status. The primary review is complete without this optional check;
an unavailable CLI is reported as degraded evidence.

## Read-only boundary

Return the review in the response. Keep repository state unchanged: do not run
formatters, fixers, generators, staging, commits, artifact writers, gate or
sentinel emitters, or a writer-dispatch loop. A re-review is a new observation
of a caller-supplied snapshot.

## References

- `references/shared/review-workflow.md` — shared sequence and fixed-point handling.
- `references/shared/review-common.md` — evidence, source labels, and finding normalization.
- `references/shared/review-rubric.md` — severity and final verdict definitions.
- `references/shared/codex-research-instructions.md` — research guidance used by code prompts.
- `references/shared/cli-backend.md` — explicit CLI transport contract.
- `references/code/`, `references/security/`, `references/tests/`, `references/docs/`, `references/risk/` — mode-specific instructions.
- `scripts/review-cli.sh`, `scripts/check-unrelated-changes.sh`, `scripts/risk-analyze.js` — read-only helpers.

## Completion check

- One mode and a readable, resolved scope are recorded.
- The reported fixed point and evidence anchors match the reviewed snapshot.
- Findings are normalized and ranked; missing evidence remains visible.
- Only an explicitly requested CLI opinion is reported, with its actual status.
- No repository state or review artifact was written.
