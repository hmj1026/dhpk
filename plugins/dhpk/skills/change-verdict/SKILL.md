---
name: change-verdict
description: 'Review code, PRs, security, tests, documents, change risk, pending changes, or dependency vulnerabilities. Verdicts and dependency audits are read-only; explicit dependency remediation delegates only the bounded fix to an available authorized writer, followed by independent security review. Not for arbitrary source repair, gate clearing, or architecture-only design. Output: evidence-backed findings, actual review status, and separate remediation/security results.'
allowed-tools: 'Bash(git diff:*), Bash(git status:*), Bash(git merge-base:*), Bash(git rev-parse:*), Bash(git show:*), Bash(git log:*), Bash(git ls-files:*), Bash(git hash-object:*), Bash(gh pr view:*), Bash(node skills/change-verdict/scripts/risk-analyze.js:*), Bash(bash skills/change-verdict/scripts/check-unrelated-changes.sh:*), Bash(bash skills/change-verdict/scripts/review-cli.sh:*), Bash(codex review:*), Read, Grep, Glob, Task'
metadata:
  dhpk-invocation-class: implicit-eligible
  dhpk-modes: [code, pr, security, tests, docs, risk]
  dhpk-next:
    PASS: none
    FAIL: none
    BLOCKED: none
    NOT_RUN: none
    UNAVAILABLE: none
    code:PASS: precommit
    docs:PASS: git-smart-commit
---

# Change Verdict

Use the smallest mode or action and scope that answer the request. The six
modes, `pending`, and default `deps` read evidence and return results without
changing workspace or review state. Explicit dependency-remediation authority
permits only a bounded `deps fix` delegation to an available authorized writer.
The parent retains its read-only command grants; neither action metadata nor
the user's fix request adds direct shell, `Write`, or `Edit` capability.

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

## Actions

Natural-language pending-review and dependency requests select these actions;
selectors are optional when the task is clear. Select one action or mode per
observation and load only its local procedure.

| Action | Procedure and authority |
|---|---|
| `pending [--files "<rel-path,...>"]` | Read [`references/actions/pending.md`](references/actions/pending.md). Delegate read-only to the available `code-reviewer` and relay its report. Missing reviewer returns `UNAVAILABLE`, with no substitute. |
| `deps [--level <severity>]` | Read [`references/actions/deps.md`](references/actions/deps.md). Use an available read-only audit capability and obtain a separate independent security verdict. |
| `deps fix [--level <severity>]` or `deps --fix` | Read the same dependency procedure. Delegate only the explicitly authorized dependency scope to an available writer, followed by an independent read-only security verdict. Missing bounded writer capability returns `UNAVAILABLE`; reuse existing authority for that scope. |

## When NOT to Use

- Implement or fix a source finding: use `flow-drive`. Explicit dependency
  remediation belongs to `deps fix` within its declared bound.
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

## Authority boundary

Return review results in the response. The six modes, `pending`, and default
`deps` keep tracked/untracked files, index, and lockfiles unchanged. Their
read-only scope excludes fixers, generators, staging, commits, artifact
writers, gate/sentinel emitters, and writer dispatch. `deps fix` is the sole
bounded writer-delegation exception described above; fix success cannot clear a gate or
replace the independent security verdict. A re-review is a new observation
of a caller-supplied snapshot. Missing required local resources fail closed
before dependent action; obtain no replacement from sibling skills or an
ambient source checkout.

## References

- `references/shared/review-workflow.md` — shared sequence and fixed-point handling.
- `references/shared/review-common.md` — evidence, source labels, and finding normalization.
- `references/shared/review-rubric.md` — severity and final verdict definitions.
- `references/shared/codex-research-instructions.md` — research guidance used by code prompts.
- `references/shared/cli-backend.md` — explicit CLI transport contract.
- `references/actions/pending.md`, `references/actions/deps.md` — delegated
  pending review and dependency audit/remediation procedures.
- `references/code/`, `references/security/`, `references/tests/`, `references/docs/`, `references/risk/` — mode-specific instructions.
- `scripts/review-cli.sh`, `scripts/check-unrelated-changes.sh`, `scripts/risk-analyze.js` — read-only helpers.

## Completion check

- One mode or action and a readable, resolved scope are recorded.
- The reported fixed point and evidence anchors match the reviewed snapshot.
- Findings are normalized and ranked; missing evidence remains visible.
- Only an explicitly requested CLI opinion is reported, with its actual status.
- Read-only observations leave repository state unchanged; an explicit
  dependency fix records the authorized writer, bounded changes, and a
  separate independent security result. No review artifact, gate, or
  sentinel was written.
