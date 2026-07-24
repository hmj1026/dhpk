---
name: codex-code-review
description: 'Code review using Codex MCP. Use when: PR review, code audit, or a second opinion on changes. Not for: document review (use doc-review), security-specific audit (use security-review), or test coverage review (use test-review). Output: severity-ranked findings with file:line evidence, a reviewer-degradation state, and a fail-closed merge gate.'
allowed-tools: 'mcp__codex__codex, mcp__codex__codex-reply, Bash(git:*), Bash(yarn:*), Bash(npm:*), Bash(bash:*), Read, Grep, Glob, Task'
---

# Codex Code Review

Use this skill for an independent code review of a diff, branch, or pull
request. Select one scope, load `references/review-workflow.md`, and preserve
the gate state from initialization through final output.

> Security note: `Bash(bash:*)` is broader than ideal because the host cannot
> yet resolve `${CLAUDE_PLUGIN_ROOT}` in command frontmatter. Invoke Bash only
> for project review scripts and the commands named by the selected workflow.

## When NOT to Use

- Document review — use `doc-review`.
- Security-specific review — use `security-review`.
- Test adequacy or coverage review — use `test-review`.
- Understanding code without reviewing a diff — use `code-explore`.

## Variants

| Variant | Command | Scope | Pre-checks |
|---|---|---|---|
| Fast | `/codex-review-fast` | Current diff | None |
| Full | `/codex-review` | Current diff plus local checks | Resolved lint and build |
| Branch | `/codex-review-branch` | Full branch against base | None unless requested |

## Workflow

1. Choose the variant and identify the exact diff scope.
2. Read `references/review-workflow.md` and execute its PENDING → dual-review
   → aggregation → gate sequence.
3. Keep Codex and the secondary reviewer independent; pass metadata, not one
   reviewer's conclusions, to the other.
4. Reconcile severity, duplicate findings, late results, and degraded reviewer
   availability through `references/review-common.md`.
5. Re-review after every code edit and emit `READY` or `BLOCKED` state before
   returning the report.

## Output

Return normalized, severity-ranked findings with file:line evidence, reviewer
source and degradation status, unresolved questions, and the final `✅ Ready`
or `⛔ Blocked` gate. The emitted state file and report must agree; no P0/P1
finding may be hidden by a degraded secondary review.

## Verification

- [ ] The variant and exact diff scope are recorded.
- [ ] PENDING was emitted before review and a final gate was emitted afterward.
- [ ] Codex independently read the diff and project context.
- [ ] The secondary reviewer was dispatched or its degradation reason is explicit.
- [ ] Each finding has severity, file:line evidence, and a concrete fix path.
- [ ] P0/P1 findings block the gate; every code edit resets the review loop.

## References

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
/codex-review-fast  # when Codex is unavailable, report degraded mode
```
