# codex-deep-reasoner Specification

## Purpose

Define the read-only execution, configuration, and registration contract for
the Codex deep-reasoning agent.

## Requirements

### Requirement: codex-deep-reasoner is a CLI-backed read-only reasoning agent

`agents/codex-reasoner.md` SHALL define a CLI-backed deep-reasoning agent mirroring `codex-worker`'s shell (one-shot `codex exec`, BLOCKED-never-simulated) but with `deep-reasoner`'s read-only contract: it SHALL run codex in a read-only sandbox, SHALL NOT modify the working tree, and SHALL return the deep-reasoner conclusion contract (conclusion + file:line evidence + fast-worker-ready next actions). Default model/effort SHALL be `gpt-6.1-sol` @ `high`, overridable per the `--reasoner` precedence chain. The retired forwarder identity `codex-deep-reasoner` SHALL NOT remain an invokable agent. REQ-7.

#### Scenario: Read-only execution

- **WHEN** `codex-reasoner` completes a reasoning task
- **THEN** `git status` shows no working-tree modification attributable to the agent, and its report follows the conclusion contract

#### Scenario: Missing CLI is honestly blocked

- **WHEN** the codex executable is absent or the model is rejected at execution time
- **THEN** the agent reports `RESULT: BLOCKED` with the exact failure and never fabricates a reasoning result

#### Scenario: Retired forwarder is requested

- **WHEN** a caller requests `codex-deep-reasoner` after cutover
- **THEN** the result is a retirement diagnostic naming `codex-reasoner` and no reasoning dispatch occurs

### Requirement: codex-deep-reasoner userConfig keys

`.claude-plugin/plugin.json` SHALL declare `codex_reasoner_model` (default `gpt-6.1-sol`) and `codex_reasoner_effort` (default `high`), following the existing configured-role mechanism: validated and announced-when-non-default by `session-start.sh`, applied per dispatch, invalid values warn once per session and fall back to defaults without failing the dispatch. One-release aliases `codex_deep_reasoner_model` and `codex_deep_reasoner_effort` SHALL be retired with the forwarder; a remaining alias key SHALL fail closed or warn with successor guidance rather than silently drive dispatch. REQ-7.

#### Scenario: userConfig override applies

- **WHEN** `codex_reasoner_effort=medium` is configured and no flag segment overrides it
- **THEN** the canonical key supplies effort `medium` for `codex-reasoner` dispatches and session start announces the non-default value once

### Requirement: Agent inventory and registration stay current

The canonical inventory SHALL register `codex-reasoner` and SHALL NOT retain
`codex-deep-reasoner` as an active agent after cutover. The catalog SHALL
report computed inventory counts; human-readable count claims are informational
and are not checked for exact prose parity. REQ-7.

#### Scenario: Catalog check preserves machine-readable invariants

- **WHEN** `node scripts/ci/catalog.js --check all` runs after the forwarder is retired
- **THEN** machine-readable retirement and projection invariants pass and the retired name is absent from active agent counts

#### Scenario: Printed count reflects the current inventory

- **WHEN** `node scripts/ci/catalog.js` prints the inventory after the forwarder is retired
- **THEN** the computed agent count includes `codex-reasoner` and does not count `codex-deep-reasoner` as active
