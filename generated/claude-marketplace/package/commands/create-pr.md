---
description: 'Create a GitHub pull request from a pushed branch with ticket-aware title and body generation. Not for: committing, pushing, merging, releasing, or editing an existing PR. Output: a dry-run gh pr create command by default, or the created PR URL after explicit execution.'
argument-hint: '[--head <branch>] [--base <branch>] [--title <text>] [--execute] [--dry-run]'
allowed-tools: 'Bash(git:*), Bash(gh:*), Read, Grep, Glob, Skill'
disable-model-invocation: true
metadata:
  dhpk-invocation-class: explicit-only
---

Load `skills/create-pr/SKILL.md` and follow the owning Skill with `$ARGUMENTS`.
Keep its argument contract, authority boundary, verification, and output.
