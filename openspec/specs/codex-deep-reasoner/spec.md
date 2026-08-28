# codex-deep-reasoner Specification

## Purpose
TBD - created by archiving change do-flags-and-harness-consolidation. Update Purpose after archive.
## Requirements
### Requirement: codex-deep-reasoner is a CLI-backed read-only reasoning agent
`agents/codex-reasoner.md` SHALL define a CLI-backed deep-reasoning agent mirroring `codex-worker`'s shell (one-shot `codex exec`, BLOCKED-never-simulated; legacy alias: `codex-fast-worker`) but with `deep-reasoner`'s read-only contract: it SHALL run codex in a read-only sandbox, SHALL NOT modify the working tree, and SHALL return the deep-reasoner conclusion contract (conclusion + file:line evidence + fast-worker-ready next actions). Default model/effort SHALL be `gpt-5.6-sol` @ `high`, overridable per the `--reasoner` precedence chain.

#### Scenario: Read-only execution
- **WHEN** codex-deep-reasoner completes a reasoning task
- **THEN** `git status` shows no working-tree modification attributable to the agent, and its report follows the conclusion contract

#### Scenario: Missing CLI is honestly blocked
- **WHEN** the codex executable is absent or the model is rejected at execution time
- **THEN** the agent reports `RESULT: BLOCKED` with the exact failure and never fabricates a reasoning result

### Requirement: codex-deep-reasoner userConfig keys
`.claude-plugin/plugin.json` SHALL declare `codex_reasoner_model` (default `gpt-5.6-sol`) and `codex_reasoner_effort` (default `high`), with one-release aliases `codex_deep_reasoner_model` and `codex_deep_reasoner_effort`, following the existing configured-role mechanism: validated and announced-when-non-default by `session-start.sh`, applied per dispatch, invalid values warn once per session and fall back to defaults without failing the dispatch.

#### Scenario: userConfig override applies
- **WHEN** `codex_deep_reasoner_effort=medium` is configured and no flag segment overrides it
- **THEN** the alias supplies effort `medium` for `codex-reasoner` dispatches and session start announces the non-default value once

### Requirement: Agent count claims are updated atomically
Adding `codex-deep-reasoner` SHALL bump every catalog-enforced agent count in the same change: agentsTotal 31→32 and root 30→31 across `README.md`, `README.zh-TW.md`, `agents/INDEX.md`, and the execution-policy roster table, such that `node scripts/ci/catalog.js --check all` passes.

#### Scenario: Catalog check stays green
- **WHEN** `node scripts/ci/catalog.js --check all` runs after the agent is added
- **THEN** all exact-count claims match the live inventory
