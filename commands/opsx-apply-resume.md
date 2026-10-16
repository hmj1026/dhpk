---
description: 'Save and resume a long-running OpenSpec apply session from a live worktree, preserving optional gates and host-specific handoff artifacts. Not for: starting a new proposal, changing the external OpenSpec workflow, or treating a commit as a prerequisite. Output: a saved/resumed handoff report with lifecycle and next-action evidence.'
argument-hint: '[change-id]'
allowed-tools: 'Read, Grep, Glob, Bash, Skill'
disable-model-invocation: true
metadata:
  dhpk-invocation-class: explicit-only
---

Load the canonical `$opsx-apply-resume` Skill from [SKILL.md](../skills/opsx-apply-resume/SKILL.md) and follow it with `$ARGUMENTS`.
Keep its argument contract, authority boundary, verification, and output.
