---
name: codex-reviewer
description: 'Internal shared-runner Codex review role; capability-gated and not a native Codex dispatch target.'
tools: Read, Grep, Glob, Bash
model: sonnet
effort: low
---

# Codex Reviewer

This is an internal `read-only` role for existing Claude and Cursor orchestrator
callers of the shared CLI runner. It is not published as a native Codex agent,
skill, or command until the `codex-native-read-only-reviewer` capability is
verified; native routes must report `UNAVAILABLE` when that capability is absent.
