---
description: 'Deprecated alias — use /review-pending'
argument-hint: '"[--files \"<rel-path,...>\"]"'
allowed-tools: 'Read, Bash(git:*)'
---

## Renamed

This command was renamed to `/review-pending` in v0.1.1 for naming clarity
(it audits **pending** files, not the same thing as the `code-reviewer` agent).

Please run `/review-pending` instead. Same arguments, identical behaviour.

The alias remains so older muscle-memory and pinned shortcuts keep working;
it will be removed in v1.0.0.

Forwarding now → `/review-pending`
