---
name: pr-summary
description: "PR status summary — list open PRs, filter bots, group by ticket ID"
---
## Contract

Use to summarize accessible pull requests; not to change PR state. See the
[command contract](https://github.com/hmj1026/dhpk/blob/main/docs/agent-guidance/command-contract.md). Stop when
`gh` is unavailable or the query fails; completion reports the output path and
the grouped result.

## Context

- Repo: !`gh repo view --json nameWithOwner --jq '.nameWithOwner' 2>/dev/null || echo 'unknown'`

## Task

Follow the `pr-summary` skill workflow:

1. Run `skills/pr-summary/scripts/pr-summary.sh` with any provided arguments
2. Display the formatted output to user
3. Provide copy instructions

Arguments:
- `--author <user>`: Filter PRs by author
- `--label <label>`: Filter PRs by label

## Output

Formatted PR list grouped by ticket ID, with stacked PRs annotated.
File written to `/tmp/pr-summary.md` for easy copying.
