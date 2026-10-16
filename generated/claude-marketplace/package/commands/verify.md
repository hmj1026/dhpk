---
description: 'Run a repository verification loop with runner-first execution, deterministic stages, and explicit PASS/FAIL/SKIP output. Use for fast or full validation of a consumer repository. Not for: mutation, fixing failures, dependency remediation, or merge approval. Output: runner summary or a complete fallback stage table.'
argument-hint: '[fast|full] [--integration <path>] [--e2e <path>]'
allowed-tools: 'Bash(node:*), Bash(pnpm:*), Bash(yarn:*), Bash(npm:*), Bash(npx:*), Bash(git:*), Bash(python*:*), Bash(pytest:*), Bash(ruff:*), Bash(mypy:*), Bash(cargo:*), Bash(go:*), Bash(golangci-lint:*), Bash(./gradlew:*), Bash(mvn:*), Bash(bundle:*), Read, Grep, Glob, Skill'
metadata:
  dhpk-invocation-class: implicit-eligible
---

Load the canonical `$repo-verify` Skill from [SKILL.md](../skills/repo-verify/SKILL.md) and follow it with `$ARGUMENTS`.
Keep its argument contract, authority boundary, verification, and output.
