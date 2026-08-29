---
description: 'Thin Claude adapter for the portable dhpk-do router. Not for: independent workflow, a second dispatch table, or bypassing invocation class. Output: $ARGUMENTS forwarded to @skills/dhpk-do/SKILL.md with host=claude.'
argument-hint: '[--route-only] [--codex] [--plan[=<model>[:<effort>]]] [--worker=<claude|codex|agy|auto>] [--reasoner=<claude|codex>[:<model>[:<effort>]]] [--execute-explicit] [--openspec|--opsx] <task>'
disable-model-invocation: true
metadata:
  dhpk-invocation-class: explicit-only
---

# /dhpk:do

Thin Claude host adapter. Pass `$ARGUMENTS` and `host=claude` to
`@skills/dhpk-do/SKILL.md`. Do not parse flags or copy execution-policy here.

User request: $ARGUMENTS
