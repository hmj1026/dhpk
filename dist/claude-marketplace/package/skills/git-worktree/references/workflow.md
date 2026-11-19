# Git worktree workflow

1. Confirm the current directory is a Git repository. Read
   `git rev-parse --show-toplevel`, `git rev-parse --abbrev-ref HEAD`, and
   `git worktree list --porcelain`. Keep the absolute paths returned by Git;
   do not identify a target with an unresolved glob or a substring match.
2. For `add`, collect `--branch` and a short purpose. If `--branch` is absent,
   ask for it. Build the destination in the repository's parent directory as
   `wt-{repo-shortname}-{purpose}` and reject an existing path. Resolve
   `--base` when supplied; otherwise use the current `HEAD` as the base. Check
   the source worktree with `git status --porcelain` before running:

   ```bash
   git worktree add -b <branch> <repo-parent>/wt-<repo-shortname>-<purpose> <base>
   ```

   If the branch already exists, use the explicit existing-branch form only
   after confirming its exact ref and use `git worktree add <path> <branch>`.
3. For `list`, use `git worktree list --porcelain`; for each `worktree` path,
   read its `branch`/`HEAD` record and run `git -C <exact-path> status
   --porcelain` to label it clean or dirty. A status-read failure is reported
   against that path rather than silently omitted.
4. For `remove`, require one exact path from the recorded list. Check that
   path's status, show `git worktree remove <exact-path>`, and wait for
   confirmation. A dirty path is a terminal safety failure; never substitute
   `--force`. After confirmation, run the command and re-read the list.
5. For `prune`, show the native preview `git worktree prune --dry-run`, list
   the stale records, and wait for confirmation. Only then run
   `git worktree prune`; re-read the list and report the exit status. Without
   confirmation, return `NOT_RUN`.
6. With no sub-command, show the current worktree table and suggest `add`,
   `list`, `remove`, or `prune`; do not mutate anything.

The command has no shell-helper dependency. Preserve the exact argument
contract and report native Git errors without claiming a lifecycle change.
