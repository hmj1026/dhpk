---
description: 'Maintain documentation through stale-doc refresh, architecture codemap generation, or a bounded Markdown refactor. Selects update, codemap, or refactor while preserving each output and evidence contract. Not for application source, tests, manifests, route tables, generated projections, or broad policy review.'
argument-hint: '<file path>'
allowed-tools: 'Read, Grep, Glob, Edit'
metadata:
  dhpk-invocation-class: implicit-eligible
---

Load the canonical `$doc-maintain` Skill from [SKILL.md](../skills/doc-maintain/SKILL.md) and follow it with `refactor $ARGUMENTS`.
Keep its argument contract, authority boundary, verification, and output.
