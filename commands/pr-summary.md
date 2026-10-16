---
description: 'Summarize accessible open GitHub pull requests from structured gh JSON, filtering bots and grouping results by ticket. Use for a read-only PR status report. Not for: changing PR state, reviewing code, merging, or closing PRs. Output: grouped Markdown written to /tmp/pr-summary.md and displayed for copying.'
argument-hint: '[--author <user>] [--label <label>]'
allowed-tools: 'Bash(git:*), Bash(gh:*), Bash(bash:*), Skill'
metadata:
  dhpk-invocation-class: implicit-eligible
---

Load `skills/pr-summary/SKILL.md` and follow the owning Skill with `$ARGUMENTS`.
Keep its argument contract, authority boundary, verification, and output.
