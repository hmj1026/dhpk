# Create PR workflow

1. Resolve the selected head and base once. An explicit `--head` is the
   selected head. When `--head` is omitted, the selected head is the current
   branch from `git rev-parse --abbrev-ref HEAD`. An explicit `--base` is the
   selected base. An explicit `--base` wins. When `--base` is omitted and the
   consumer project's instructions supply `{TARGET_BRANCH}`, use that value.
   dhpk does not define a userConfig key for `{TARGET_BRANCH}` or
   `{TICKET_PATTERN}`. When `{TARGET_BRANCH}` is unset, the generic fallback is
   `main`. The consumer project's Project Convention supplies any project-specific
   base; use the explicit option or project instructions to select it. Confirm
   both refs with `git rev-parse --verify`. A missing
   repository, or a head or base that does not resolve, is a terminal
   `BLOCKED` result. Do not substitute the checkout branch, `HEAD`, or
   another ref, and do not commit, check out, or push.
2. Record the checkout branch separately from the selected head. Gather
   recent commits and the pull-request diff for the selected range only:

   ```bash
   git log --oneline <selected-base>..<selected-head>
   git diff --stat <selected-base>...<selected-head>
   ```

   The two-dot log is the commit list. The three-dot diff is the change from
   the merge base, which is the pull-request comparison. Keep those formulas
   distinct, and do not replace either one with checkout `HEAD`.
3. Extract the first ticket matching `{TICKET_PATTERN}` from the selected
   head name. When the project does not set `{TICKET_PATTERN}`, use `[A-Z]+-\d+`. Use the repository's ticket URL
   convention when building the ticket link. If no ticket can be resolved,
   state that in the report and do not invent one.
4. Derive the title as `<type>: [<TICKET>] <summary>` unless `--title` is
   supplied. Build a concise body with the summary, the ticket link when
   resolved, and a verification section. List commands and results only for
   checks observed on the selected range. A result observed only on a
   different checkout is `NOT RUN` for this request, and the reason names
   that checkout. Put planned or unavailable checks under `NOT RUN` with the
   reason. For a behavior change, show a compact before/after example or
   evidence, and label an unobserved after-state as expected with its check
   marked `NOT RUN`. Include rollback and blast-radius details only when they
   materially affect review. Add a visual aid only when it clarifies the
   change; do not include one by default. Keep shell quoting intact in the
   emitted command.
5. Count commits on the selected range:

   ```bash
   git rev-list --count <selected-base>..<selected-head>
   ```

   If the result is `0`, stop before any `gh pr create` call and report
   `No commits between <selected-base> and <selected-head> — nothing to open a PR for`.
   The message names the refs actually selected. A zero count on the checkout
   does not reject a selected head that has commits. A non-zero count on the
   checkout does not allow a selected head whose selected range is empty.
6. Verify the selected head has a remote ref. The workflow does not push it.
   Query existing PRs for that same head and base. An unpushed selected head
   or an existing matching PR is a terminal `BLOCKED` result.
7. Construct the `gh pr create` command with `--head <selected-head>`,
   `--base <selected-base>`, `--title`, and `--body`. `--dry-run` and omitted
   mode print the command only. Do not call `gh pr create` in that mode.
8. For `--execute`, show the final command, ask for confirmation, and call it
   only after confirmation. Use the caller's existing `gh` credentials and
   report the returned URL. A rejected confirmation, auth error, or command
   failure is `FAIL`, not a created PR.

The command contract is `[--head <branch>] [--base <branch>] [--title <text>]
[--execute] [--dry-run]`; no other mode or push option is inferred.
