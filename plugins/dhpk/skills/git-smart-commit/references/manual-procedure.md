# Git Smart Commit — Manual Procedure

Use this fallback when `scripts/collect-changes.js` is absent (such as in the
instruction-only Directory Plugin) or cannot execute.

## Safety Rules

- Run this skill **only on an explicit user request**; stop and ask before any
  write if selected autonomously.
- Stop immediately on any failing Git check, conflict, active rebase/merge/
  cherry-pick/bisect, configured `filter.*.clean` / `filter.*.process`, or
  uninitialized/conflicting submodule. Never invent an empty change list or
  guess missed files when a query fails.
- Preserve existing index state, partial staging, and unrelated work. Inspect
  actual staged and unstaged diffs (and new untracked file contents) before
  committing; exclude secrets and credentials.
- Never bypass Git hooks (`--no-verify`).
- Report `mode: manual` and keep any unexecuted stage as `NOT_RUN` (never an
  overall `PASS` when a required check was skipped or could not run).

## Stage: resolve-repo-and-head

1. Confirm no ambient repository/index redirect environment variables are set
   (`GIT_DIR`, `GIT_WORK_TREE`, `GIT_COMMON_DIR`, `GIT_INDEX_FILE`,
   `GIT_OBJECT_DIRECTORY`, `GIT_ALTERNATE_OBJECT_DIRECTORIES`, `GIT_PREFIX`). If
   set, stop and warn before proceeding.
2. Run read-only commands in the current consumer working directory:
   ```bash
   git --no-optional-locks rev-parse --show-toplevel
   git --no-optional-locks rev-parse --verify HEAD
   git --no-optional-locks branch --show-current
   ```
   (Treat missing `HEAD` as `null` in an unborn repository.)

## Stage: collect-status-and-numstat

1. Check clean/smudge filters and submodules before trusting diffs:
   ```bash
   git --no-optional-locks config --get-regexp '^filter\..*\.(clean|process)$'
   git --no-optional-locks ls-files --stage
   ```
   Stop if any non-empty filter config or `160000` gitlink submodule appears.
2. Collect full status and staged/unstaged line statistics using literal
   pathspecs (applying `-- <scope>` only for the filtered file list, never to
   suppress repo-wide safety checks):
   ```bash
   git --no-optional-locks -c core.fsmonitor=false status --porcelain=v1 -uall
   git --no-optional-locks -c core.fsmonitor=false diff --numstat
   git --no-optional-locks -c core.fsmonitor=false diff --cached --numstat
   ```
3. Re-check `git rev-parse --verify HEAD` and `status --porcelain=v1` if any
   concurrent edits occurred, stopping if drift is detected.

## Stage: inspect-safety-and-staging

1. Inspect status codes and Git metadata directories (`$(git rev-parse --git-dir)`)
   for:
   - Unmerged conflict entries (`UU`, `AA`, `DD`, `AU`, `UA`, `DU`, `UD`)
   - In-progress operations (`MERGE_HEAD`, `REBASE_HEAD`, `rebase-merge`,
     `rebase-apply`, `CHERRY_PICK_HEAD`, `REVERT_HEAD`, `BISECT_LOG`)
   - Existing staged changes (`indexStatus` not `' '` or `'?'`), partial staging
     (both index and worktree modified on the same file), or staged changes
     outside requested `--scope`.
2. Stop immediately if conflicts or in-progress operations exist. If staged or
   out-of-scope staged files exist, follow Step 4 of [SKILL.md](../SKILL.md) to
   preserve the index or offer manual staging steps instead of running broad
   `git add`.

## Stage: detect-hooks

1. Resolve the effective hooks path without executing any hook:
   ```bash
   git --no-optional-locks rev-parse --git-path hooks
   ```
2. Check whether `pre-commit` or `commit-msg` exists and is executable (`test -x`).
   Record hook presence accurately — existence never implies a precommit pass.
3. Re-read `git status --porcelain=v1` / `git diff --cached --name-status` after
   each group commit, track the starting `HEAD` to verify commit paths, and
   include `mode: manual` in the final report (marking unexecuted checks
   `NOT_RUN`).
