# Pending review

Use this action for a read-only review delegated to `code-reviewer`. It returns
the reviewer's report, not merge or release clearance.

1. Resolve an explicit `--files "<rel-path,...>"` list first. Split and
   normalize relative paths within the selected repository root; reject
   escaping or unreadable paths with `BLOCKED`. Otherwise select files with
   `git diff HEAD --name-only`. An empty scope returns `無待審檔案` without
   starting an agent.
2. Read `git status -sb` and `git diff --stat HEAD`. Pin `HEAD` and keep the
   selected paths and diff statistics as separate evidence. An explicit path
   list is authoritative even when it differs from the current diff.
3. Resolve `code-reviewer` from the active agent catalog. Its absence returns
   `UNAVAILABLE` with the attempted scope and missing capability. Do not
   substitute self-review, another agent, or another model.
4. Delegate a self-contained prompt with the exact relative paths, pinned
   revision, diff statistics, and an instruction to return the report while
   keeping the repository unchanged. The reviewer may read source and tests;
   editing, staging, commits, fixers, report files, and sentinels are outside
   this action.
5. Relay the report without rewriting findings. Preserve its `PASS/WARN/FIX`
   items and `APPROVE/WARNING/BLOCK` verdict. Reviewer failure remains
   `FAIL`/`UNAVAILABLE`. Append: `Review result is informational; it is not
   merge-gate clearance.`

Completion requires the scope, fixed point, actual reviewer status, and
unchanged tracked/untracked files, index, and dependency lockfiles. A failed
scope or unavailable reviewer is terminal; no writer or gate-clearing action
follows it.
