---
description: 'Alias of $repo-verify; same contract.'
argument-hint: '[fast|full] [--integration <path>] [--e2e <path>]'
allowed-tools: 'Bash(node:*), Bash(pnpm:*), Bash(yarn:*), Bash(npm:*), Bash(npx:*), Bash(git:*), Bash(python*:*), Bash(pytest:*), Bash(ruff:*), Bash(mypy:*), Bash(cargo:*), Bash(go:*), Bash(golangci-lint:*), Bash(./gradlew:*), Bash(mvn:*), Bash(bundle:*), Read, Grep, Glob, Skill'
metadata:
  dhpk-invocation-class: implicit-eligible
---

Load the canonical `$repo-verify` Skill from [SKILL.md](../skills/repo-verify/SKILL.md) and follow it with `$ARGUMENTS`.
Keep its argument contract, authority boundary, verification, and output.
