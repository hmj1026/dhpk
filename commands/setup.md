---
description: 'Configure or inspect the dhpk harness, or install selected host assets. Not for: ordinary harness audits, application changes, or silent credential/configuration changes. Output: a host-specific setup report with preserved-file, receipt, and terminal evidence.'
argument-hint: '[--show] [--source-artifact <dir>] [--install hooks|rules|scripts|all] [--dry-run] [--force] [--vendor]'
allowed-tools: 'Read, Grep, Glob, Bash(bash:*), Bash(node:*), Bash(git rev-parse:*), Bash(ls:*), Bash(mkdir:*), Bash(cp:*), Bash(chmod:*), Skill, AskUserQuestion'
disable-model-invocation: true
metadata:
  dhpk-invocation-class: explicit-only
---

Load `skills/harness-setup/SKILL.md` and follow the owning Skill with `$ARGUMENTS`.
Keep its argument contract, authority boundary, verification, and output.
