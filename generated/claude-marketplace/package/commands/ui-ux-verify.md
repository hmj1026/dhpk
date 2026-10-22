---
description: 'Read-only verification of one rendered page against one OpenSpec UI specification. Use when: checking a page against a spec, auditing a controller/action render, or reviewing UI content, structure, and behavior. Not for: E2E journey authoring, application edits, data mutation, or a runtime API smoke test. Output: one severity-ranked audit report with APPROVE, WARNING, BLOCK, or UNAVAILABLE evidence.'
argument-hint: '[<url>] [spec:<path>]'
metadata:
  dhpk-invocation-class: implicit-eligible
---

Load the canonical `$ui-ux-verify` Skill from [SKILL.md](../skills/ui-ux-verify/SKILL.md) and follow it with `$ARGUMENTS`.
Keep its argument contract, authority boundary, verification, and output.
