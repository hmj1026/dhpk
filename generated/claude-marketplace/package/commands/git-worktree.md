---
description: 'Manage Git worktree lifecycle with exact native git targets, branch/path validation, and dirty-worktree safety. Covers adding, listing, removing, and pruning worktrees. Not for: branch merging, broad cleanup, or removing or pruning without confirmation. Output: exact commands plus resulting worktree status.'
argument-hint: '[add|list|remove|prune] [--branch <name>] [--base <ref>]'
allowed-tools: 'Bash(git:*), Read, Grep, Glob, Skill'
disable-model-invocation: true
metadata:
  dhpk-invocation-class: explicit-only
---

Load the canonical `$git-worktree` Skill from [SKILL.md](../skills/git-worktree/SKILL.md) and follow it with `$ARGUMENTS`.
Keep its argument contract, authority boundary, verification, and output.
