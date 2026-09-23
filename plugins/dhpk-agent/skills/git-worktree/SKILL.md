---
name: git-worktree
description: "Manage Git worktree lifecycle with exact native git targets, branch/path validation, and dirty-worktree safety. Covers adding, listing, removing, and pruning worktrees. Not for: branch merging, broad cleanup, or removing or pruning without confirmation. Output: exact commands plus resulting worktree status."
metadata:
  dhpk-invocation-class: "explicit-only"
---

# Git Worktree

## Workflow

Run from the consumer repository. Resolve one sub-command and preserve
`[add|list|remove|prune] [--branch <name>] [--base <ref>]`. Inspect
`git worktree list --porcelain` and the current branch first. Resolve every
target path and branch explicitly; a missing branch/path or dirty relevant
worktree stops the operation.

Use native Git operations only. `add` uses the repository parent and the
`wt-{repo-shortname}-{purpose}` naming convention, then reports the exact
`git worktree add` command and next steps. `list` reports each worktree and
status. `remove` and `prune` preview their exact targets and require explicit
confirmation before mutation; never use a force option to bypass a dirty
check. The detailed command sequence is in
[`references/workflow.md`](references/workflow.md).

## When NOT to Use

- A merge, rebase, branch deletion, or remote operation is requested.
- The target worktree is missing, ambiguous, or dirty.
- Removal or pruning has not received explicit confirmation.

## Output

- `add`: exact command, created path, branch, and next steps.
- `list`: a formatted table derived from native worktree records.
- `remove`/`prune`: confirmation state, exact target/command, and resulting
  status; no confirmation means `NOT_RUN`.
- Missing or dirty targets and native Git failures are terminal failures.

## Verification

- [ ] Every target path and branch was resolved before a write.
- [ ] Relevant worktrees were checked with `git status --porcelain`.
- [ ] Remove/prune has explicit confirmation, or no mutation was attempted.
- [ ] Final `git worktree list --porcelain` evidence matches the report.

## References

- [`references/workflow.md`](references/workflow.md) — native commands,
  naming, dirty checks, confirmation, and output details.
