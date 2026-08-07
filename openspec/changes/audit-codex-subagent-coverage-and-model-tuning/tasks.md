## 1. OpenSpec artifacts

- [x] 1.1 Complete proposal, delta specs, design, and this task list.
- [x] 1.2 Validate the change artifacts and reconcile any requirement/task gaps.

## 2. Role projection

- [x] 2.1 Extend `scripts/gen-codex-agents.js` with the five new generated roles
  and approved runtime metadata.
- [x] 2.2 Adapt generated planner/spec-miner/reviewer/e2e bodies so all Codex
  paths, handoffs, and lifecycle language are valid.
- [x] 2.3 Regenerate the 12 generated `codex/agents/*.toml` files.
- [x] 2.4 Update hand-maintained `explorer`, `monitor`, `worker`, and
  `bug-investigator` metadata, including worker Luna/max.
- [x] 2.5 Update `codex/config.toml.example` global defaults to Luna/medium.
- [x] 2.6 Update Codex README and AGENTS role map, including the complete
  canonical coverage classification.
- [x] 2.7 Update `rules/model-economics.md` with the Codex model map and
  worker/tdd maximum-effort exception.

## 3. Tests and validation

- [x] 3.1 Update generator tests for 12 generated roles, idempotence, sandbox
  derivation, and e2e-runner capability/fallback wording.
- [x] 3.2 Update runtime contract tests for all 16 direct roles, model/effort
  values, global defaults, and unavailable handoff rejection.
- [x] 3.3 Add coverage-matrix validation so every canonical role has exactly
  one explicit outcome.
- [x] 3.4 Run focused Node tests and clean consumer projection validation.
- [x] 3.5 Run `openspec validate --all --strict --no-interactive` and the
  repository's relevant CI checks.
- [x] 3.6 Run `git diff --check`, inspect `git diff`, and run final code/doc
  review before reporting completion.
