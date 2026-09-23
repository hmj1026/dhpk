---
description: 'Short Claude front door for the $git-worktree Skill and native Git worktree lifecycle.'
argument-hint: '[add|list|remove|prune] [--branch <name>] [--base <ref>]'
allowed-tools: 'Bash(git:*), Read, Grep, Glob, Skill'
metadata:
  dhpk-invocation-class: explicit-only
disable-model-invocation: true
---

# `/dhpk:git-worktree`

Forward the supplied sub-command and options unchanged to the canonical
`$git-worktree` Skill. It owns native Git target resolution, dirty checks,
`wt-{repo-shortname}-{purpose}` naming, confirmation for remove/prune, and
the resulting status. This command adds no lifecycle procedure.

Completion: relay the Skill result and preserve its `PASS`, `FAIL`,
`BLOCKED`, `NOT_RUN`, or `UNAVAILABLE` evidence state.
