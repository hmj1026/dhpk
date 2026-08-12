## MODIFIED Requirements

### Requirement: Codex agent role files are generated from canonical agents

The repository SHALL provide a deterministic generator for the curated Codex
direct-role allowlist. The allowlist SHALL include the existing 11 roles plus
`planner`, `spec-miner`, `frontend-reviewer`, `migration-reviewer`, and
`e2e-runner`, for 16 direct Codex roles. Generated roles SHALL set explicit
`model`, `model_reasoning_effort`, and `sandbox_mode` metadata and SHALL adapt
Claude-only paths, tools, and handoffs into Codex-readable instructions.

#### Scenario: Expanded allowlist is generated
- **WHEN** the generator runs against the canonical agent sources
- **THEN** it emits exactly the 12 generated roles documented by the runtime
  metadata map, including `planner`, `spec-miner`, `frontend-reviewer`,
  `migration-reviewer`, and `e2e-runner`
- **AND** the four hand-maintained generic roles remain present

#### Scenario: e2e-runner keeps its execution boundary
- **WHEN** the generator emits `e2e-runner`
- **THEN** the role is `workspace-write`
- **AND** its instructions require a fail-loud `BLOCKED` result when the
  required Playwright/browser capability is unavailable

#### Scenario: Generator remains idempotent
- **WHEN** the generator runs twice without canonical source changes
- **THEN** the emitted role files are byte-identical

## ADDED Requirements

### Requirement: Every canonical agent has an explicit Codex coverage outcome

The repository SHALL maintain a coverage matrix for every canonical agent,
classifying it as `direct`, `merged`, `skill/manual-fallback`,
`capability-gated`, or `intentionally-unavailable`. A Codex developer
instruction SHALL NOT name a role absent from `codex/agents/*.toml` unless the
reference is explicitly documented as a manual or capability-gated fallback.

#### Scenario: No canonical role is unclassified
- **WHEN** the coverage validation runs
- **THEN** every canonical root role and module-shipped role has exactly one
  coverage outcome

#### Scenario: Unsupported platform capability is explicit
- **WHEN** a role requires Playwright, MCP, or a module that the Codex consumer
  does not provide
- **THEN** the matrix records the capability gate and the role instructions
  provide an observable fallback result instead of promising execution

### Requirement: Codex direct role metadata is complete

Every `codex/agents/*.toml` SHALL declare non-empty `name`, `description`,
`model`, `model_reasoning_effort`, and `developer_instructions`. Generated and
hand-maintained role sets SHALL be validated together.

#### Scenario: Expanded role set passes metadata validation
- **WHEN** all 16 direct roles are present
- **THEN** the Codex runtime validator passes and reports no missing metadata,
  stale role handoff, or unreachable required asset
