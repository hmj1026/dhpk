---
description: 'Mine behavioral specs from a brownfield codebase into openspec/specs/<capability>/spec.md. Thin front door that delegates to the spec-miner agent.'
argument-hint: '[capability or path to mine first]'
allowed-tools: 'Read, Grep, Glob, Bash(ls:*), Agent'
---

# /spec-mine

Front door for behavioral-spec extraction. This command does **not** mine inline — it dispatches the `spec-miner` agent (opus), which owns the sampling budget, metadata rules, and the flat Requirement / Invariant output format. Mirrors how `/post-dev-test` delegates Playwright suites to `e2e-runner`.

## When to use

- Onboarding an existing project to spec-driven development ("mine specs", "extract specs from the codebase", "萃取規格").
- A module's existing behavior needs documenting as OpenSpec baseline truth before `opsx-goal` / `/opsx:apply` changes can reference it.

## Steps

1. **Pre-flight** — confirm this is (or should be) an OpenSpec project:
   ```bash
   ls openspec/specs 2>/dev/null && echo "specs dir present" || echo "no openspec/specs yet"
   ```
   If `openspec/` is absent, ask before creating it — `spec-miner` never scatters spec files outside `openspec/specs/`.
2. **Dispatch** the `spec-miner` agent via the `Agent` tool (`subagent_type: dhpk:spec-miner`), passing `$ARGUMENTS` (the capability or path to mine first; omit to let the agent present the capability list and ask).
3. **Relay** the agent's result: the written `openspec/specs/<capability>/spec.md` path, the capability name, the `Last verified` commit stamp, and any `<!-- deferred: -->` files to schedule for a follow-up pass.

## Constraints

- The deliverable is `openspec/specs/<capability>/spec.md` (the agent's only Write target) — not a `.claude/artifacts/` report.
- Do not mine every module at once; mine the requested capability (or ask which one first). Spec rot starts when specs outpace usage.

$ARGUMENTS: optional capability name or path to mine first.
