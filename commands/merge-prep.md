---
description: 'Prepare a read-only branch merge analysis with native git merge-tree conflict detection and copy-pasteable manual commands. Use when deciding whether to merge one branch into another. Not for: checkout, merge, rebase, conflict edits, or branch mutation. Output: commits, files, conflicts, evidence, and manual commands.'
argument-hint: '<source-branch> [--target <branch>]'
allowed-tools: 'Bash(git:*), Read, Grep, Glob, Skill'
metadata:
  dhpk-invocation-class: implicit-eligible
---

Load `skills/merge-prep/SKILL.md` and follow the owning Skill with `$ARGUMENTS`.
Keep its argument contract, authority boundary, verification, and output.
