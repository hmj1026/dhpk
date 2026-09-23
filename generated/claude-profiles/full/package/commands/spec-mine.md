---
description: 'Mine behavioral specs from a brownfield codebase into openspec/specs/<capability>/spec.md. Thin front door that delegates to the spec-miner agent.'
argument-hint: '[capability or path to mine first]'
allowed-tools: 'Read, Grep, Glob, Bash(ls:*), Agent'
metadata:
  dhpk-invocation-class: implicit-eligible
---

# /spec-mine

Forward to the canonical [`$spec-mine` skill](../skills/spec-mine/SKILL.md) with
`$ARGUMENTS` unchanged. It performs the OpenSpec pre-flight, dispatches the
registered `spec-miner` role, and relays the artifact path, capability,
`Last verified` commit, and deferred files.

Not for: mining every module, refactoring, or applying a change.

Preserve `UNAVAILABLE` when the required role is not registered; do not remap
to another role or inline mining. The only successful artifact is
`openspec/specs/<capability>/spec.md`.
