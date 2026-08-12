## MODIFIED Requirements

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

## ADDED Requirements

### Requirement: Generic Codex roles remain stack-neutral
Hand-maintained generic Codex roles SHALL not hard-code one framework, language, database, or advisor product as a universal contract. Stack-specific behavior SHALL be selected through conditional trap references or a specialized role.

#### Scenario: Generic root-cause role runs in a non-PHP repository
- **WHEN** `bug-investigator` is dispatched in a Node, Swift, or Python repository
- **THEN** its base instructions remain applicable without imposing Yii/PHP/MySQL assumptions

#### Scenario: Stack-specific guidance is needed
- **WHEN** a task requires framework-specific investigation
- **THEN** the dispatcher loads the relevant conditional trap or specialized role explicitly
