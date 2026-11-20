# Git Smart Commit — Manual Procedure

Use this fallback when `packaged-collect-changes.js` is absent (such as in the
instruction-only Directory Plugin) or cannot execute. The result must match what
the script reports.

## Safety Rules

- Run this skill **only on an explicit user request**; stop and ask before any
  write if selected autonomously.
- Stop immediately on any failing Git check, conflict, active rebase/merge/
  cherry-pick/revert/sequencer operation, configured `filter.*.clean` /
  `filter.*.process`, or indexed submodule. Never invent an empty change list or
  guess missed files when a query fails.
- Preserve existing index state, partial staging, and unrelated work. Inspect
  actual staged and unstaged diffs (and new untracked file contents) before
  committing; exclude secrets and credentials.
- Never bypass Git hooks (`--no-verify`).
- Validate `--scope` before use. Reject an empty value, a NUL byte, an absolute
  path, any Windows-absolute form (`C:\`, `C:/x`, `\foo`, `\\host\`; the
  Node `path.win32.isAbsolute` rule), and any path that
  leaves the repository (`..` or `../...` after normalization). Normalize with
  `/` separators and no trailing `/`; the result `.` means no scope. Scope is a
  literal repository-relative path, never a glob.
- Apply scope only to the file list you build, never to Git. If a Git command
  must take a pathspec, run it as `git --literal-pathspecs ...`. A file is in
  scope when its path or its rename origin equals the scope or starts with
  `<scope>/`. Safety checks always cover the whole repository.
- Report `mode: manual` and keep any unexecuted stage as `NOT_RUN` (never an
  overall `PASS` when a required check was skipped or could not run).

## Stage: resolve-repo-and-head

1. Confirm no ambient repository/index redirect environment variables are set
   (`GIT_DIR`, `GIT_WORK_TREE`, `GIT_COMMON_DIR`, `GIT_INDEX_FILE`,
   `GIT_OBJECT_DIRECTORY`, `GIT_ALTERNATE_OBJECT_DIRECTORIES`, `GIT_PREFIX`). If
   set, stop and warn before proceeding.
2. Run read-only commands in the current consumer working directory. Prefix every
   Git command in this procedure with
   `git --no-optional-locks -c core.fsmonitor=false`. Each command must finish
   within 30 seconds and print at most 16 MiB of valid UTF-8; otherwise stop.
   ```bash
   git --no-optional-locks -c core.fsmonitor=false rev-parse --show-toplevel
   git --no-optional-locks -c core.fsmonitor=false rev-parse --verify --quiet HEAD
   git --no-optional-locks -c core.fsmonitor=false symbolic-ref --quiet --short HEAD
   ```
   Run all later commands from the repository root. Treat a missing `HEAD` as
   `null` in an unborn repository, and a missing branch as `null` on a detached
   `HEAD`. Any other failing query stops the procedure.

## Stage: collect-status-and-numstat

1. Check clean/process filters and submodules before trusting diffs:
   ```bash
   git --no-optional-locks -c core.fsmonitor=false config --null --get-regexp '^filter\..*\.(clean|process)$'
   git --no-optional-locks -c core.fsmonitor=false ls-files --stage -z
   ```
   Stop if any filter has a non-empty value (exit status 1 means none is set).
   Stop if any `ls-files` record starts with mode `160000` (an indexed
   submodule).
2. Collect status and both numstats from the repository root. Keep the exact
   output of each command for the drift check:
   ```bash
   git --no-optional-locks -c core.fsmonitor=false status --porcelain=v1 -z --untracked-files=all --renames --ignore-submodules=none
   git --no-optional-locks -c core.fsmonitor=false diff --cached --numstat -z --no-ext-diff --no-textconv --ignore-submodules=none --find-renames
   git --no-optional-locks -c core.fsmonitor=false diff --numstat -z --no-ext-diff --no-textconv --ignore-submodules=none --find-renames
   ```
   Parse the output as NUL-separated records. A status record is
   `XY<space>path`; for a rename or copy (`R` or `C` in `XY`) the next record is
   the original path. A numstat record is `added<TAB>deleted<TAB>path`; when the
   path is empty, the next two records are the original and the new path. A `-`
   count means binary. Stop on any incomplete or unparseable record.
3. Filter the status list to the validated scope in memory. An untracked file
   has no numstat and is not sized: record `added` and `deleted` as `null`.
4. Keep the `HEAD` value and the three outputs for the drift check in
   `detect-hooks`.

## Stage: inspect-safety-and-staging

1. Resolve the Git directory once:
   ```bash
   git --no-optional-locks -c core.fsmonitor=false rev-parse --path-format=absolute --git-dir
   ```
   Test whether each of these exists under it: `MERGE_HEAD`, `rebase-merge`,
   `rebase-apply`, `CHERRY_PICK_HEAD`, `REVERT_HEAD`, `sequencer`. A marker found
   means an in-progress merge, rebase, cherry-pick, revert, or sequencer
   operation.
2. Inspect the status codes (`indexStatus` then `worktreeStatus`) for:
   - Unmerged conflict entries (`DD`, `AU`, `UD`, `UA`, `DU`, `AA`, `UU`)
   - Existing staged changes (`indexStatus` not `' '` and not `'?'`), partial
     staging (staged, not conflicted, and `worktreeStatus` not `' '`), or
     staged changes outside the requested scope (checked over all files).
3. Stop immediately if conflicts or in-progress operations exist. If staged or
   out-of-scope staged files exist, follow Step 4 of [SKILL.md](../SKILL.md) to
   preserve the index or offer manual staging steps instead of running broad
   `git add`.

## Stage: detect-hooks

1. Resolve the effective hooks path without executing any hook:
   ```bash
   git --no-optional-locks -c core.fsmonitor=false rev-parse --path-format=absolute --git-path hooks
   ```
2. For `pre-commit` and `commit-msg` in that directory, a hook is present and
   executable only when it is a regular file (not a directory) and `test -x`
   succeeds. Record hook presence accurately — existence never implies a
   precommit pass. Do not run any hook here.
3. Always re-run the drift check before any commit, even when nothing seems to
   have changed. Re-run the status command, both numstat commands, and the
   `HEAD` query, then compare each result with the kept output. Any difference
   is `SOURCE_DRIFT`: stop and restart from the first stage. Equal output does
   not prove equal file content, so read the diffs again before commit.
4. After each group commit, re-read `git status --porcelain=v1 -z` and
   `git diff --cached --name-status`, and compare `HEAD` with the starting
   `HEAD` to verify the commit paths. Include `mode: manual` in the final report
   (marking unexecuted checks `NOT_RUN`).
