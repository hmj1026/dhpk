---
description: '掃描程式碼結構，產生或更新 docs/CODEMAPS/ 架構文件，供 AI 快速載入專案全貌。'
allowed-tools: 'Read, Grep, Glob, Bash(ls:*), Bash(git:*), Write, Edit'
metadata:
  dhpk-invocation-class: implicit-eligible
---

# Update Codemaps

Forward to the canonical [`$update-codemaps` skill](../skills/update-codemaps/SKILL.md)
with `$ARGUMENTS` unchanged (including an empty argument list). It owns the
live structure scan, five codemap outputs, metadata header, 30% confirmation
guard, and `.reports/codemap-diff.txt` report.

Not for: rewriting application source or updating user documentation outside codemaps.

Preserve `PASS`, `BLOCKED`, `CONFIRMATION_REQUIRED`, or `NOT_RUN` exactly. This
command does not duplicate generation procedure or authorize source changes.
