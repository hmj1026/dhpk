---
description: 'Summarize accessible open GitHub pull requests from structured gh JSON, filtering bots and grouping results by ticket. Use for a read-only PR status report. Not for: changing PR state, reviewing code, merging, or closing PRs. Output: grouped Markdown written to /tmp/pr-summary.md and displayed for copying.'
argument-hint: '[--author <user>] [--label <label>]'
metadata:
  dhpk-invocation-class: implicit-eligible
---

Load the canonical `$pr-summary` Skill from [SKILL.md](../skills/pr-summary/SKILL.md) and follow it with `$ARGUMENTS`.
Keep its argument contract, authority boundary, verification, and output.
