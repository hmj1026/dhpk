---
description: 'Create a GitHub pull request from a pushed branch with ticket-aware title and body generation. Not for: committing, pushing, merging, releasing, or editing an existing PR. Output: a dry-run gh pr create command by default, or the created PR URL after explicit execution.'
argument-hint: '[--head <branch>] [--base <branch>] [--title <text>] [--execute] [--dry-run]'
disable-model-invocation: true
metadata:
  dhpk-invocation-class: explicit-only
---

Load the canonical `$create-pr` Skill from [SKILL.md](../skills/create-pr/SKILL.md) and follow it with `$ARGUMENTS`.
Keep its argument contract, authority boundary, verification, and output.
