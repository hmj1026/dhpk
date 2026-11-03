---
description: 'Read-only check of one rendered page against one OpenSpec UI specification: content, structure, and behavior. Not for E2E authoring, application edits, data mutation, or API smoke tests. Output: a severity-ranked audit with APPROVE, WARNING, BLOCK, or UNAVAILABLE.'
argument-hint: '[<url>] [spec:<path>]'
metadata:
  dhpk-invocation-class: implicit-eligible
---

Load the canonical `$ui-ux-verify` Skill from [SKILL.md](../skills/ui-ux-verify/SKILL.md) and follow it with `$ARGUMENTS`.
Keep its argument contract, authority boundary, verification, and output.
