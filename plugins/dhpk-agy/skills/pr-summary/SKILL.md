---
name: pr-summary
description: 'Summarize accessible open GitHub pull requests from structured gh JSON, filtering bots and grouping results by ticket. Use for a read-only PR status report. Not for: changing PR state, reviewing code, merging, or closing PRs. Output: grouped Markdown written to /tmp/pr-summary.md and displayed for copying.'
argument-hint: '[--author=<user>] [--label=<label>]'
metadata:
  dhpk-invocation-class: implicit-eligible
---

# PR Summary

## Workflow

Run in the consumer repository and preserve `--author <user>` and
`--label <label>`. Resolve the repository with `gh repo view`, then query open
PRs with `gh pr list --json ...`; consume structured JSON rather than scraping
terminal formatting. Stop when `gh` is unavailable, the repository query
fails, or the PR query fails.

Filter bot-authored PRs, group the remaining records by ticket ID (including
stacked PR annotations), format the report, write the same report to
`/tmp/pr-summary.md`, and display it with copy instructions. The exact JSON
fields and grouping rules are in
[`references/workflow.md`](https://github.com/hmj1026/dhpk/blob/main/skills/pr-summary/references/workflow.md). This workflow never
changes GitHub state.

## When NOT to Use

- A PR must be created, edited, merged, closed, or labeled.
- A code review or merge-readiness verdict is requested.
- `gh` repository credentials or access are unavailable.

## Output

Formatted open-PR groups with ticket IDs and stacked-PR annotations, plus the
path `/tmp/pr-summary.md` and copy instructions. An empty result is a valid
report. Query or report-write failures are terminal `UNAVAILABLE`/`FAIL`
results and must be surfaced.

## Verification

- [ ] Repository and PR data came from successful structured `gh` JSON calls.
- [ ] `--author`/`--label` filters were preserved and bot PRs were handled.
- [ ] Every included PR appears in exactly one ticket group (or an explicit
      `unassigned` group).
- [ ] `/tmp/pr-summary.md` exists and matches the displayed report.

## References

- [`references/workflow.md`](https://github.com/hmj1026/dhpk/blob/main/skills/pr-summary/references/workflow.md) — `gh` fields, filters,
  bot exclusion, ticket grouping, and report format.
