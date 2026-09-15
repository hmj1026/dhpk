---
name: flow-guide
description: "Short Claude front door for read-only flow-guide routing, policy, progression, closeout, and Codex usage discovery."
---
# `/dhpk:flow-guide`

This is a thin Host front door to the canonical `$flow-guide` Skill. Forward
the supplied arguments unchanged; the Skill owns the route, help, policy,
progression, closeout, read-only boundary, and terminal evidence.

The `help` action is metadata-only and may return the inventory-owned Codex
usage catalog or one usage card. This front door does not add a mode, a second
grammar, target procedure, or target authority.

Completion: report the canonical Skill result and preserve its `PASS`,
`BLOCKED`, `NOT_RUN`, or `UNAVAILABLE` evidence state.
