# Issue tracker: GitHub

Issues and specs for this repo live as GitHub issues. Use the `gh` CLI for all operations.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body-file -`; stream the body through stdin.
- **Read an issue**: `gh issue view <number> --comments`, filtering comments by `jq` and also fetching labels.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters.
- **Comment on an issue**: `gh issue comment <number> --body-file -`; stream the body through stdin.
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Close**: publish any closing evidence as a streamed comment first, then run `gh issue close <number> --reason completed` without an inline comment.

Infer the repo from `git remote -v`; `gh` does this automatically when run inside a clone.

### Shell-safe bodies

Treat issue bodies and comments as byte streams, not shell arguments. A
single-quoted heredoc keeps Markdown backticks, `$()` text, and `$VARIABLE`
text inert:

```sh
gh issue comment <number> --body-file - <<'ISSUE_BODY'
Evidence may contain `code`, $(literal), and $VARIABLE.
ISSUE_BODY
```

For generated content, validate the final bytes and pipe them to
`--body-file -`, or pass a previously written file. Keep shell-sensitive
Markdown out of `--body` and `--comment` arguments.

## Pull requests as a triage surface

**PRs as a request surface: no.**

When a skill says “publish to the issue tracker”, create a GitHub issue.

When a skill says “fetch the relevant ticket”, run `gh issue view <number> --comments`.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a single issue with **child** issues as tickets.

- **Map**: a single issue labelled `wayfinder:map`, holding the Notes / Decisions-so-far / Fog body. `gh issue create --label wayfinder:map`.
- **Child ticket**: an issue linked to the map as a GitHub sub-issue (`gh api` on the sub-issues endpoint). Where sub-issues aren't enabled, add the child to a task list in the map body and put `Part of #<map>` at the top of the child body. Labels: `wayfinder:<type>` (`research`/`prototype`/`grilling`/`task`). Once claimed, the ticket is assigned to the driving dev.
- **Blocking**: GitHub's native issue dependencies, the canonical, UI-visible representation. Add an edge with `gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`, where `<blocker-db-id>` is the blocker's numeric database id (`gh api repos/<owner>/<repo>/issues/<n> --jq .id`). GitHub reports `issue_dependencies_summary.blocked_by` for open blockers. If dependencies aren't available, fall back to a `Blocked by: #<n>, #<n>` line at the top of the child body. A ticket is unblocked when every blocker is closed.
- **Frontier query**: list the map's open children (`gh issue list --state open`), drop any with an open blocker or an assignee, and take the first remaining ticket in map order.
- **Claim**: `gh issue edit <n> --add-assignee @me`; this is the session's first write.
- **Resolve**: stream the answer with `gh issue comment <n> --body-file -`, then run `gh issue close <n>`, then append a context pointer to the map's Decisions-so-far.
