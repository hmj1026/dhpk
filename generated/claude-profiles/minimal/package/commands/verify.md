---
description: 'Short Claude front door for the runner-first $repo-verify Skill.'
argument-hint: '[fast|full] [--integration <path>] [--e2e <path>]'
allowed-tools: 'Bash(node:*), Bash(pnpm:*), Bash(yarn:*), Bash(npm:*), Bash(npx:*), Bash(git:*), Bash(python*:*), Bash(pytest:*), Bash(ruff:*), Bash(mypy:*), Bash(cargo:*), Bash(go:*), Bash(golangci-lint:*), Bash(./gradlew:*), Bash(mvn:*), Bash(bundle:*), Read, Grep, Glob, Skill'
metadata:
  dhpk-invocation-class: implicit-eligible
---

# `/dhpk:verify`

Forward `[fast|full] [--integration <path>] [--e2e <path>]` unchanged to the
canonical `$repo-verify` Skill. The public command remains `/dhpk:verify`,
while `$repo-verify` owns normalization, runner precedence, fallback stages,
and the PASS/FAIL/SKIP report. This front door adds no verification grammar.

Completion: relay the Skill result and preserve its `PASS`, `FAIL`,
`BLOCKED`, `NOT_RUN`, or `UNAVAILABLE` evidence state.
