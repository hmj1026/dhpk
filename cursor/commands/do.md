---
name: do
description: "Thin Claude adapter for the portable dhpk-do router. Not for: independent workflow, a second dispatch table, or bypassing invocation class. Output: $ARGUMENTS forwarded to @skills/dhpk-do/SKILL.md with host=claude."
---
# /dhpk:do

Thin Claude host adapter. Pass `$ARGUMENTS` and `host=claude` to
`@skills/dhpk-do/SKILL.md`. Do not parse flags or copy execution-policy here.

User request: $ARGUMENTS
