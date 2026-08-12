# codex-agent-role-parity Specification

## Purpose
TBD - created by archiving change codex-flow-parity-and-do-openspec-flag. Update Purpose after archive.
## Requirements
### Requirement: Codex agent role files load under auto-discovery

Every agent role file under `codex/agents/*.toml` SHALL declare non-empty `name`,
`description`, and `developer_instructions` top-level keys so that Codex loads it under
**auto-discovery** from `.codex/agents/*.toml` — the path dhpk's install script produces,
since it ships only `config.toml.example` and never writes an active `config.toml` to
declare agents. The role file SHALL be self-sufficient (carry its own `name`) and SHALL NOT
depend on an active `config.toml` `[agents.<name>]` declaration to supply the identifier.
All paths and contracts referenced by `developer_instructions` SHALL resolve from a clean
project-local `.codex/` projection. Shared trap sheets and reviewer contracts SHALL be
materialized as `supporting_assets` in the distribution inventory and receipt, while any
remaining contract text is explicitly inlined in the role.

#### Scenario: Existing role files are fixed
- **WHEN** a user runs `install-codex-skills.sh` and starts Codex CLI in the synced project
- **THEN** Codex loads `bug-investigator`, `explorer`, `monitor`, and `worker`
- **AND** no `Ignoring malformed agent role definition: ... must define a non-empty name`
  warning is printed for any dhpk role file

#### Scenario: Auto-discovery works without an active config.toml
- **WHEN** the synced `.codex/agents/*.toml` files are present but the project has no active
  `config.toml` declaring `[agents.<name>]` (only `config.toml.example` was copied)
- **THEN** Codex auto-discovers each role by the `name` in its role file
- **AND** an optional later `[agents.<name>]` declaration for the same role is de-duplicated
  by Codex (the declared file is skipped from auto-discovery), not double-loaded

#### Scenario: Clean projection resolves every referenced asset
- **WHEN** a clean consumer fixture materializes the complete generated-role set and all
  receipt-managed `supporting_assets` through the supported Codex installer
- **THEN** every trap-sheet, reviewer-contract, and output-contract reference is reachable
  from the documented Codex root and no role retains a dangling required reference

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

### Requirement: Validation guardrail rejects malformed codex role files

The codex validation path (`multi_ai_sync_lib.validation.validate_codex`) SHALL assert that every `codex/agents/*.toml` declares non-empty `name`, `description`, and `developer_instructions`, SHALL require filename/name equality, SHALL validate model, reasoning-effort, and sandbox values against the running Codex catalog, and SHALL fail when a generated role contains an unreachable required asset reference, ghost target, unavailable supporting handoff, or stale package-owned TOML outside the ownership manifest. Generated and hand-maintained roles SHALL be validated together, while explicitly declared workspace-local extensions SHALL be reported separately.

#### Scenario: Missing name fails validation
- **WHEN** a `codex/agents/*.toml` lacks a non-empty `name`
- **THEN** `validate_codex` reports a failure identifying the file and the missing field

#### Scenario: Invalid metadata fails validation
- **WHEN** a role has a filename/name mismatch or an unknown model, effort, or sandbox value
- **THEN** `validate_codex` reports the file and invalid field and exits non-zero

#### Scenario: Well-formed role files pass validation
- **WHEN** all package-owned role files declare required fields, valid metadata, and resolvable references
- **THEN** `validate_codex` passes with no agent-role errors

#### Scenario: Broken reviewer contract link fails validation
- **WHEN** a generated reviewer role points to a path outside the synced Codex projection
- **THEN** validation reports the unreachable reference and names the supported replacement

#### Scenario: Supporting handoff names an unavailable role
- **WHEN** a Codex supporting trap instructs dispatch to a role absent from the Codex surface
- **THEN** validation reports the dangling role target and requires a direct role or explicit manual fallback

#### Scenario: Stale package-owned TOML fails loudly
- **WHEN** generation leaves a package-owned generated TOML outside the declared generated set
- **THEN** generation or validation fails and identifies the stale file without deleting a separately declared local extension

### Requirement: Every canonical agent has an explicit Codex coverage outcome

The repository SHALL maintain a coverage matrix for every canonical agent, including root and module-shipped roles, classifying it as `direct`, `merged`, `skill/manual-fallback`, `capability-gated`, or `intentionally-unavailable`. Every direct, merged, fallback, and capability-gated target SHALL resolve to a declared outcome. A Codex developer instruction SHALL NOT name a role absent from `codex/agents/*.toml` unless the reference is explicitly documented as a manual or capability-gated fallback.

#### Scenario: No canonical role is unclassified
- **WHEN** the coverage validation runs
- **THEN** every canonical root role and module-shipped role has exactly one coverage outcome

#### Scenario: Unsupported platform capability is explicit
- **WHEN** a role requires Playwright, MCP, or a module that the Codex consumer does not provide
- **THEN** the matrix records the capability gate and the role instructions provide an observable fallback result instead of promising execution

#### Scenario: A merged role points at a ghost target
- **WHEN** a coverage entry maps a canonical role to a non-existent target
- **THEN** coverage validation fails with the source role and target name

#### Scenario: All supporting targets resolve
- **WHEN** every supporting asset and dispatch namespace references a declared direct role or documented fallback
- **THEN** the coverage graph passes validation

### Requirement: Codex direct role metadata is complete

Every `codex/agents/*.toml` SHALL declare non-empty `name`, `description`,
`model`, `model_reasoning_effort`, and `developer_instructions`. Generated and
hand-maintained role sets SHALL be validated together.

#### Scenario: Expanded role set passes metadata validation
- **WHEN** all 16 direct roles are present
- **THEN** the Codex runtime validator passes and reports no missing metadata,
  stale role handoff, or unreachable required asset

### Requirement: Generic Codex roles remain stack-neutral
Hand-maintained generic Codex roles SHALL not hard-code one framework, language, database, or advisor product as a universal contract. Stack-specific behavior SHALL be selected through conditional trap references or a specialized role.

#### Scenario: Generic root-cause role runs in a non-PHP repository
- **WHEN** `bug-investigator` is dispatched in a Node, Swift, or Python repository
- **THEN** its base instructions remain applicable without imposing Yii/PHP/MySQL assumptions

#### Scenario: Stack-specific guidance is needed
- **WHEN** a task requires framework-specific investigation
- **THEN** the dispatcher loads the relevant conditional trap or specialized role explicitly
