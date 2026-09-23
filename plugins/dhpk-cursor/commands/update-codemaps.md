---
name: update-codemaps
description: "掃描程式碼結構，產生或更新 docs/CODEMAPS/ 架構文件，供 AI 快速載入專案全貌。"
---
# Update Codemaps

Forward to the canonical [`$update-codemaps` skill](https://github.com/hmj1026/dhpk/blob/main/skills/update-codemaps/SKILL.md)
with `$ARGUMENTS` unchanged (including an empty argument list). It owns the
live structure scan, five codemap outputs, metadata header, 30% confirmation
guard, and `.reports/codemap-diff.txt` report.

Preserve `PASS`, `BLOCKED`, `CONFIRMATION_REQUIRED`, or `NOT_RUN` exactly. This
command does not duplicate generation procedure or authorize source changes.
