# Pending review workflow

1. Parse the preserved argument contract `"[--files \"<rel-path,...>\"]"`.
   If present, split the comma-separated relative paths, normalize them
   without escaping the repository root, and use that list. Otherwise run:

   ```bash
   git diff HEAD --name-only
   ```

   If the selected list is empty, return `無待審檔案` and do not invoke an
   agent. Invalid or unreadable paths are a terminal scope failure.
2. Capture `git status -sb` and `git diff --stat HEAD`. Keep the selected list
   and stat as separate evidence; do not replace an explicit list with the
   diff list.
3. Resolve the `code-reviewer` agent from the active agent catalog. If it is
   unavailable, return `UNAVAILABLE` with the attempted scope and next action;
   never silently select a general agent or a model-generated substitute.
4. Delegate a self-contained prompt containing the exact relative paths, the
   current `git diff --stat`, and the instruction to return the review report.
   The reviewer remains read-only; it does not edit, stage, commit, or emit a
   merge sentinel.
5. Relay the reviewer output directly. Preserve `PASS/WARN/FIX` items and
   `APPROVE/WARNING/BLOCK` verdicts, then append: `Review result is
   informational; it is not merge-gate clearance.` A reviewer failure is
   `FAIL`/`UNAVAILABLE`, not an approval.
