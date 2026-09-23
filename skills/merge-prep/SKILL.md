---
name: merge-prep
description: 'Prepare a read-only branch merge analysis with native git merge-tree conflict detection and copy-pasteable manual commands. Use when deciding whether to merge one branch into another. Not for: checkout, merge, rebase, conflict edits, or branch mutation. Output: commits, files, conflicts, evidence, and manual commands.'
argument-hint: '<source-branch> [--target=<branch>]'
metadata:
  dhpk-invocation-class: implicit-eligible
---

# Merge Prep

## Workflow

Require `<source-branch>` and resolve `--target` to `{TARGET_BRANCH}` or
`main` when omitted. Validate both refs and a clean worktree before analysis.
Use native, read-only Git evidence: merge-base, commit log, changed-file
summary, and `git merge-tree --write-tree <target> <source>` (or report
`UNAVAILABLE` when the installed Git cannot provide that read-only operation).

Report commits, files, conflict details, likely conflict patterns, and
text-only resolution strategies. Emit copy-pasteable commands for a human to
execute later. Never run `git checkout`, `git switch`, `git merge`, `git
rebase`, or a conflict edit. See
[`references/workflow.md`](references/workflow.md) for the exact sequence.

## When NOT to Use

- The worktree is dirty or either branch/ref is missing.
- A merge, checkout, rebase, or conflict resolution should happen now.
- A write-capable branch operation is requested.

## Output

Pre-merge evidence includes source/target refs, merge-base, commits, files,
`merge-tree` output, conflict status, and copy-pasteable manual commands.
Conflicts are findings, not permission to mutate. A complete read-only
analysis ends `PASS` (with its conflict status); missing preconditions or
unexpected Git failures are terminal `BLOCKED`/`FAIL` results. No merge claim
is made.

## Verification

- [ ] Source and target resolve and `git status --porcelain` is empty.
- [ ] Native merge-tree analysis ran without changing the worktree.
- [ ] Commit/file/conflict evidence is included, including clean conflicts
      when none were found.
- [ ] Suggested merge commands are output only and were not executed.

## References

- [`references/workflow.md`](references/workflow.md) — native analysis,
  conflict interpretation, and manual command output.
