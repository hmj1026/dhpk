---
description: 'Short Claude front door for the read-only $merge-prep Skill; native conflict analysis only.'
argument-hint: '<source-branch> [--target <branch>]'
allowed-tools: 'Bash(git:*), Read, Grep, Glob, Skill'
metadata:
  dhpk-invocation-class: implicit-eligible
---

# `/dhpk:merge-prep`

Forward the source branch and options unchanged to the canonical `$merge-prep`
Skill. It owns clean-worktree validation, native `git merge-tree` analysis,
conflict evidence, and manual command output. It never checks out, merges,
rebases, or edits branches.

Completion: relay the Skill result and preserve its `PASS`, `FAIL`,
`BLOCKED`, `NOT_RUN`, or `UNAVAILABLE` evidence state.
