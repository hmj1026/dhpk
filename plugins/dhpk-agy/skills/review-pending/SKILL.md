---
name: review-pending
description: 'Delegate the current diff or explicitly selected files to an available code-reviewer and relay its report. Use for a read-only pending-change review. Not for: implementing findings, clearing a merge gate, or silently substituting another reviewer. Output: the reviewer report, or UNAVAILABLE when code-reviewer is absent.'
argument-hint: '[--files=<rel-paths>]'
metadata:
  dhpk-invocation-class: implicit-eligible
---

# Review Pending

## Workflow

Select the review scope in order: an explicit `--files "<rel-path,...>"`
list, otherwise `git diff HEAD --name-only`. If neither yields files, report
`無待審檔案` and do not start an agent. Read `git status -sb` and
`git diff --stat HEAD` for context, then check whether the `code-reviewer`
agent is available.

When available, delegate the exact relative paths and diff-stat context to
`code-reviewer`, then relay its report without rewriting its findings. When
unavailable, return `UNAVAILABLE`; do not choose another reviewer or claim a
review occurred. The review result is informational and is not merge-gate
clearance. See [`references/workflow.md`](https://github.com/hmj1026/dhpk/blob/main/skills/review-pending/references/workflow.md).

## When NOT to Use

- Files need edits, fixes, staging, or test generation.
- The requested output is merge approval or release clearance.
- No reviewer is available and a substitute reviewer has not been approved.

## Output

Relay:

```text
## Code Review
PASS/WARN/FIX: <items>
Verdict: APPROVE | WARNING | BLOCK
```

Preserve reviewer evidence and state clearly that it is not gate clearance.
No files are changed. Scope failures and missing reviewer capability are
terminal `BLOCKED`/`UNAVAILABLE` results.

## Verification

- [ ] Explicit files took precedence over the current diff.
- [ ] Empty scope did not start an agent.
- [ ] Prompt included exact relative paths and current diff statistics.
- [ ] Only `code-reviewer` was used, and its result was not promoted to a
      merge/release gate.

## References

- [`references/workflow.md`](https://github.com/hmj1026/dhpk/blob/main/skills/review-pending/references/workflow.md) — scope selection,
  reviewer availability, prompt context, and result relay.
