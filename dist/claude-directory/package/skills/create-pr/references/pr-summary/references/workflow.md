# PR summary workflow

1. Resolve repository identity with:

   ```bash
   gh repo view --json nameWithOwner --jq '.nameWithOwner'
   ```

   If `gh` is missing, unauthenticated, or the query fails, return
   `UNAVAILABLE` and do not fabricate a report.
2. Query open pull requests as structured JSON. Request at least
   `number,title,author,labels,headRefName,baseRefName,url,updatedAt` and
   retain the exact JSON records. Apply `--author <user>` and
   `--label <label>` as PR-list filters when provided; do not reinterpret
   their values or add a second argument grammar.
3. Exclude records whose structured author marks them as a bot. For each
   remaining record, extract the first ticket matching `[A-Z]+-\d+` from the
   head branch, title, or body metadata. Place records without a match in an
   explicit `unassigned` group. Sort groups and records deterministically.
4. Mark a group as stacked when it contains more than one PR for the same
   ticket, and include each PR's number, title, author, labels, base/head,
   updated time, and URL. Do not infer mergeability or review approval.
5. Write the formatted Markdown to `/tmp/pr-summary.md`, then display the
   same content and say it can be copied from that path. A write failure is a
   terminal `FAIL`; an empty successful query still writes a report stating
   that no open PRs matched.

The workflow is read-only with respect to GitHub and the repository. It does
not call a missing shell helper, mutate PR state, or claim that a grouped
summary is a merge gate.
