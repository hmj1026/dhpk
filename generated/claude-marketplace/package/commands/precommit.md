---
description: 'Run the deterministic pre-commit pipeline in fast or full mode through the packaged runner. Use when handing off repository changes. Not for: ad hoc replacement checks, dependency audits, or read-only verification. Output: runner-owned changed-file reporting and final verdict.'
argument-hint: '[--fast]'
metadata:
  dhpk-invocation-class: implicit-eligible
---

Load the canonical `$precommit` Skill from [SKILL.md](../skills/precommit/SKILL.md) and follow it with `$ARGUMENTS`.
Keep its argument contract, authority boundary, verification, and output.
