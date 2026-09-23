# Create PR workflow

1. Resolve the target repository with `gh repo view --json nameWithOwner` and
   record the current branch, selected head, selected base, recent commits,
   and diff statistics. A missing repository, branch, or base is a terminal
   `BLOCKED` result.
2. Extract the first branch ticket matching the configured
   `{TICKET_PATTERN}`. The default is `[A-Z]+-\d+`. Use the repository's
   ticket URL convention when building the ticket link. If no ticket can be
   resolved, state that in the report rather than inventing one.
3. Derive the title as `<type>: [<TICKET>] <summary>` unless `--title` is
   supplied. Build the body from summary bullets, the ticket link, and a test
   plan. Keep shell quoting intact in the emitted command.
4. Resolve `{TARGET_BRANCH}` first and `main` second when `--base` is absent.
   Run:

   ```bash
   git rev-list --count <base>..HEAD
   ```

   If the result is `0`, stop before any `gh pr create` call and report:
   `No commits between <base> and HEAD — nothing to open a PR for`.
5. Verify the selected head has a remote ref (the workflow does not push it),
   and query existing PRs for the same head/base. An unpushed head or an
   existing matching PR is a terminal `BLOCKED` result.
6. Construct the `gh pr create` command with `--head`, `--base`, `--title`,
   and `--body`. `--dry-run` and omitted mode print the command only. Do not
   call `gh pr create` in that mode.
7. For `--execute`, show the final command, ask for confirmation, and call it
   only after confirmation. Use the caller's existing `gh` credentials and
   report the returned URL. A rejected confirmation, auth error, or command
   failure is `FAIL`, not a created PR.

The command contract is `[--head <branch>] [--base <branch>] [--title <text>]
[--execute] [--dry-run]`; no other mode or push option is inferred.
