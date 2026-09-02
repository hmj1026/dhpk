---
name: dhpk-change-review
disable-model-invocation: true
description: 'Portable code review using the current model and an optional CLI second opinion. Purpose: review a PR, audit code, or obtain a second opinion on changes. Not for: document review (use dhpk-doc-review), security-specific audit (use dhpk-security-review), or test coverage review (use dhpk-test-review). Output: severity-ranked findings with file:line evidence, a reviewer-degradation state, and a fail-closed merge gate.'
allowed-tools: 'Bash(git:*), Bash(yarn:*), Bash(npm:*), Bash(bash:*), Read, Grep, Glob, Task'
metadata:
  dhpk-invocation-class: explicit-only
---

# Change review

Use this skill for an independent code review of a diff, branch, or pull
request. Select one scope, load `references/review-workflow.md`, and preserve
the gate state from initialization through final output.

Dispatch and findings are host-neutral: name the selected review capability and
backend, not a host-only tool, agent, or slash-command alias. The current model
is the default primary reviewer. Keep the secondary reviewer independent and
report a degradation reason when it cannot run; never describe a primary-only
result as an independent check.

For environments with the Codex CLI, the same contract is available through an
explicit `scripts/review.sh --backend cli` selection; the wrapper uses argument
arrays, never `eval`, and accepts literal user values. CLI output is an
additional labeled review input and is never a hidden fallback.

```text
scripts/review.sh --backend cli \
  --scope diff|branch|doc|security|tests \
  --depth fast|full [--base <branch>] [--title <text>] [--prompt <text>]
```

`--scope` narrows the review contract and `--depth` controls local checks and
context. Read `references/cli-backend.md` when selecting the CLI backend.

Every review records a non-empty, pinned `git merge-base` (or `HEAD` for an
uncommitted diff) before reading findings. This keeps re-reviews comparable and
prevents a moving branch reference from hiding changes.

> Security note: `Bash(bash:*)` is broader than ideal because the host cannot
> yet resolve `${CLAUDE_PLUGIN_ROOT}` in command frontmatter. Invoke Bash only
> for project review scripts and the commands named by the selected workflow.

## Scope boundary

The consolidated CLI supports `--scope diff|branch|doc|security|tests` for a
single second-opinion entrypoint. For a standalone document, security, or test
audit, the dedicated reviewer/skill is preferred; use these modes when that
scope is part of the consolidated review flow.

## When NOT to Use

- Document review — use `dhpk-doc-review`.
- Security-specific review — use `dhpk-security-review`.
- Test adequacy or coverage review — use `dhpk-test-review`.
- Understanding code without reviewing a diff — use `dhpk-codebase-exploration`.

## Variants

| Variant | Command | Scope | Pre-checks |
|---|---|---|---|
| Fast | `/codex-review-fast` | Current diff | None |
| Full | `/codex-review` | Current diff plus local checks | Resolved lint and build |
| Branch | `/codex-review-branch` | Full branch against base | None unless requested |

## Workflow

1. Choose the variant and identify the exact diff scope.
2. Pin a non-empty fixed point (`git merge-base`, or `HEAD` for an uncommitted
   diff) before reading findings and emit `PENDING`.
3. Read `references/review-workflow.md` and execute its PENDING → dual-review
   → aggregation → gate sequence.
4. Keep the primary and secondary reviewers independent; pass metadata, not
   one reviewer's conclusions, to the other. If the secondary cannot run,
   record the reason and mark the result degraded.
5. Review two separate axes: **Standards** (repository rules, security, tests,
   compatibility, and maintainability) and **Spec** (the request, acceptance
   criteria, behavior, and edge cases). A pass on one axis never substitutes
   for the other.
6. Reconcile severity, duplicate findings, late results, and degraded reviewer
   availability through `references/review-common.md`.
7. Rank every finding by severity and attach file:line evidence plus a concrete
   fix path. Any code edit invalidates the prior review: re-pin freshness,
   re-run both axes, and emit `READY` or `BLOCKED` before returning the report.

## Output

Return normalized, severity-ranked findings with file:line evidence, reviewer
source and degradation status, unresolved questions, and the final `✅ Ready`
or `⛔ Blocked` gate. The emitted state file and report must agree; no P0/P1
finding may be hidden by a degraded secondary review.

## Verification

- [ ] The variant and exact diff scope are recorded.
- [ ] A non-empty merge-base (or `HEAD` for an uncommitted diff) is pinned.
- [ ] Standards and Spec axes are reported separately.
- [ ] PENDING was emitted before review and a final gate was emitted afterward.
- [ ] The primary reviewer independently read the diff and project context.
- [ ] The secondary reviewer was dispatched or its degradation reason is explicit.
- [ ] Each finding has severity, file:line evidence, and a concrete fix path.
- [ ] P0/P1 findings block the gate; every code edit resets the review loop.

## References

- `references/cli-backend.md` — CLI backend options, literal argument handling,
  and the wrapper's failure behavior.
- `references/review-workflow.md` — exact workflow, dispatch, sanitization, and
  gate steps.
- `references/review-common.md` — severity, dimensions, gates, re-review,
  sentinels, and dual-review aggregation.
- `references/codex-prompt-fast.md` — Fast prompt.
- `references/codex-prompt-full.md` — Full prompt.
- `references/codex-prompt-branch.md` — Branch prompt.
- `references/codex-research-instructions.md` — independent research rules.
- `references/command-context.md` — command-specific context.
- `review_rubric.md` — review dimensions.
- `templates/review_output.md` — output template.

## Examples

```text
/codex-review-fast
/codex-review-branch origin/develop
/codex-review-fast  # when the optional CLI reviewer is unavailable, report degraded mode
```
