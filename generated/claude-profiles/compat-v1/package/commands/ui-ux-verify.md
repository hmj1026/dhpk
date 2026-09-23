---
description: 'Short Claude front door for implicit-eligible $ui-ux-verify single-page UI/spec audits.'
argument-hint: '[<url>] [spec:<path>]'
allowed-tools: 'Read, Grep, Glob, Bash(git:*), Skill, Task'
metadata:
  dhpk-invocation-class: implicit-eligible
---

# `/dhpk:ui-ux-verify`

This is a thin Claude front door to the canonical `$ui-ux-verify` Skill.
Forward `$ARGUMENTS` unchanged; the Skill owns target selection, the
read-only browser probe, the Content/Structure/Behavior comparison, and the
shared audit report.

Not for: E2E journey authoring, application edits, data mutation, or a runtime API smoke test.

Claude may use the existing `ui-ux-verifier` reviewer. Codex performs the same
single-page check directly when a browser capability is available and returns
`UNAVAILABLE` when it is not; an E2E journey is not a substitute. This command
adds no URL policy, target-selection mode, or second report grammar.

Completion: return the canonical audit path and severity counts, preserving
`APPROVE`, `WARNING`, `BLOCK`, `UNAVAILABLE`, or `NOT_RUN` evidence.
