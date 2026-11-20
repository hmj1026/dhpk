---
name: harness-setup
description: "Configure or inspect the dhpk harness, or install selected host assets. Not for: ordinary harness audits, application changes, or silent credential/configuration changes. Output: a host-specific setup report with preserved-file, receipt, and terminal evidence. Explicit user request only; stop and ask before any side effect if selected by the model."
---

# Harness Setup

Run this skill only on an explicit user request; otherwise stop and ask before any stage or side effect.
Follow [the Manual Procedure](references/manual-procedure.md) for inspection, dry runs,
and authorized setup. Require user confirmation before writing and use an explicitly
selected local source artifact for asset installation. Report `mode: manual`.
