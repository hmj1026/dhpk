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

Auto-discovery is conditional on the consuming session, not on the role file:
Codex populates the `spawn_agent` `agent_type` enumeration from
`.codex/agents/*.toml` only when the project directory is trusted in the
effective `$CODEX_HOME/config.toml` and configuration loading is not
suppressed. Documentation and validation SHALL state that precondition rather
than treating an unregistered role as a defective role file.

Every installed role SHALL additionally be a physical regular file. The
supported installer SHALL NOT use symlinks for agent TOMLs even when the
selected top-level mode is `symlink`. Skills and supporting assets MAY retain
the selected mode. Static source validation and receipt discovery SHALL NOT be
reported as named-role runtime proof.

#### Scenario: Existing role files are fixed
- **WHEN** a user runs `install-codex-skills.sh` and starts Codex CLI in the synced project
- **THEN** Codex loads `bug-investigator`, `explorer`, `monitor`, and `worker`
- **AND** no `Ignoring malformed agent role definition: ... must define a non-empty name`
  warning is printed for any dhpk role file

#### Scenario: Auto-discovery works without an active config.toml
- **WHEN** synced `.codex/agents/*.toml` files are present in a trusted project
  under normal configuration loading, and the project has no active
  `config.toml` declaring `[agents.<name>]` (only `config.toml.example` was copied)
- **THEN** Codex auto-discovers each role by the `name` in its role file and
  offers it as an `agent_type` value
- **AND** an optional later `[agents.<name>]` declaration for the same role is de-duplicated
  by Codex (the declared file is skipped from auto-discovery), not double-loaded

#### Scenario: Untrusted project does not register roles
- **WHEN** the same well-formed role files are present but the project
  directory is not trusted in the effective `$CODEX_HOME/config.toml`, or the
  session runs with `--ignore-user-config`
- **THEN** no `agent_type` value is offered for those roles
- **AND** the condition is attributed to the unloaded project role source, not
  to the role files, role names, or the installed materialization mode

#### Scenario: Clean projection resolves every referenced asset
- **WHEN** a clean consumer fixture materializes the complete generated-role set and all
  receipt-managed `supporting_assets` through the supported Codex installer
- **THEN** every trap-sheet, reviewer-contract, and output-contract reference is reachable
  from the documented Codex root and no role retains a dangling required reference

#### Scenario: Default project-local install uses hybrid materialization
- **WHEN** a user runs `install-codex-skills.sh` without `--copy`
- **THEN** managed skills remain symlinks and managed agent TOMLs are physical
  files
- **AND** the schema-v3 receipt records the top-level mode as `symlink`, skill
  entries as `symlink`, and agent entries as `copy`

#### Scenario: Fresh Codex session dispatches projected roles
- **WHEN** a fresh Codex session starts in the installed project and dispatches
  a receipt-managed named role with a cold standalone packet
- **THEN** the role starts without `Symbolic link loop` or
  `agent type is currently not available`

#### Scenario: Historical managed agent symlink is migrated
- **WHEN** an unchanged schema-v3 receipt-owned agent symlink is present and the
  operator runs ordinary `--update`
- **THEN** only that stale agent entry is replaced by a physical file and its
  receipt entry mode becomes `copy`
- **AND** a retargeted, edited, or unowned role remains a fail-closed collision

### Requirement: Codex agent role files are generated from canonical agents

The repository SHALL generate the curated Codex direct-role projection from
canonical agent sources. Provider-specific roles SHALL use canonical IDs,
including `codex-worker`, `codex-reasoner`, and `codex-reviewer` where their
read/write contracts are supported. Legacy aliases SHALL be accepted only by
the boundary resolver and SHALL not produce duplicate generated role files.
Generic native Codex roles remain target-runtime roles and are not renamed by
this provider vocabulary change.

#### Scenario: Canonical Codex worker is generated once

- **WHEN** the Codex generator runs against canonical sources
- **THEN** the write-capable provider role is emitted as `codex-worker` and no
  second `codex-fast-worker` projection is generated

#### Scenario: Native Codex reviewer remains capability-gated

- **WHEN** the first canonical-role generator runs without installed-CLI proof
  of the `codex-reviewer` read-only contract
- **THEN** coverage records its shared-runner outcome and no native direct-role
  file is emitted for `codex-reviewer`
- **AND** Codex-host discovery records an explicit capability-gated unavailable
  outcome rather than a callable target

#### Scenario: Alias remains an input only

- **WHEN** a legacy alias appears in a handoff or config fixture
- **THEN** validation resolves it through the compatibility seam and does not
  require a duplicate native role file

#### Scenario: Expanded allowlist is generated

- **WHEN** the generator runs against the canonical agent sources
- **THEN** it emits the documented curated direct-role set, including every
  approved planning, review, and execution role
- **AND** hand-maintained generic roles remain present

#### Scenario: e2e-runner keeps its execution boundary

- **WHEN** the generator emits `e2e-runner`
- **THEN** the role remains `workspace-write` and reports `BLOCKED` when its
  required browser capability is unavailable

#### Scenario: Generator remains idempotent

- **WHEN** the generator runs twice without canonical source changes
- **THEN** the emitted role files are byte-identical

### Requirement: Validation guardrail rejects malformed codex role files

The codex validation path (`multi_ai_sync_lib.validation.validate_codex`) SHALL assert that every `codex/agents/*.toml` declares non-empty `name`, `description`, and `developer_instructions`, SHALL require filename/name equality, SHALL validate model, reasoning-effort, and sandbox values against the running Codex catalog, and SHALL fail when a generated role contains an unreachable required asset reference, ghost target, unavailable supporting handoff, or stale package-owned TOML outside the ownership manifest. Generated and hand-maintained roles SHALL be validated together, while explicitly declared workspace-local extensions SHALL be reported separately. For roles named by the ownership manifest's `generated_roles`, generation SHALL validate the final adapted description and body before writing, and committed plus fresh-consumer projection validation SHALL reapply the same role-neighbor fence. The fence SHALL use `codex/agent-role-map.json` as its sole role-status authority: a known fenced role token MUST have `direct` status regardless of nearby prose and its matrix target MUST be declared by the ownership manifest's `package_roles`. Generation MUST resolve that target against the complete preflight output set plus existing hand-maintained package roles without depending on write order; committed and consumer validation MUST resolve it to a physical TOML in the complete role root being checked. An unknown fenced role-shaped token MUST fail only when it occurs in the same logical line, list item, or table cell as an exact lower-case dispatch, delegate, handoff, hand off, invoke, or spawn context; fenced code blocks are excluded, and the role candidate MUST be a single-backtick inline identifier matching `[a-z][a-z0-9]*(?:-[a-z0-9]+)*`. The fence MUST NOT infer or auto-map a replacement for a non-direct or unknown token, MUST exclude the ownership manifest's hand-maintained package roles from this new scan, and MUST report the source role, token, matrix status or `unknown`, and the required direct-role or explicit-manual-fallback remediation.

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

#### Scenario: Generated source with a known non-direct neighbor fails before write
- **WHEN** an ownership-manifest `generated_roles` source is adapted and its
  description or body still contains the fenced token `silent-failure-hunter`,
  whose role-map status is `merged`
- **THEN** generation fails before writing that generated role TOML
- **AND** the diagnostic names the source role, `silent-failure-hunter`, its
  `merged` status, and requires a direct Codex role or an explicit manual
  fallback

#### Scenario: Unknown executable ghost fails closed
- **WHEN** an adapted `generated_roles` description or body contains an
  unknown fenced token such as `ghost-role` in the same list item, table cell,
  or line as explicit `dispatch`, `delegate`, `handoff`, `hand off`, `invoke`,
  or `spawn` context
- **THEN** generation fails before writing that generated role TOML
- **AND** the diagnostic names the source role and `ghost-role`, identifies
  its state as `unknown`, and requires a direct Codex role or an explicit
  manual fallback

#### Scenario: Committed generated TOML mutation fails validation
- **WHEN** a committed generated TOML or a generated TOML in a fresh,
  otherwise-clean consumer checkout named by `generated_roles` is mutated to
  contain an executable handoff to an unknown fenced token such as `ghost-role`
- **THEN** the committed/consumer projection validator rejects the mutation
- **AND** the diagnostic names the source role and token, identifies the state
  as `unknown`, and requires a direct Codex role or an explicit manual
  fallback

#### Scenario: Later projection rejects a known non-direct neighbor

- **WHEN** a committed generated TOML or a generated TOML in a fresh,
  otherwise-clean consumer checkout is mutated to contain the fenced token
  `silent-failure-hunter`, whose role-map status is `merged`
- **THEN** the committed/consumer projection validator rejects the mutation
  regardless of nearby dispatch wording
- **AND** the diagnostic names the source role, token, `merged` status, and
  required direct-role or explicit-manual-fallback remediation

#### Scenario: Direct role handoff passes
- **WHEN** an adapted `generated_roles` description or body contains a fenced
  executable handoff to a role whose `agent-role-map.json` status is `direct`
  and whose direct Codex role is declared
- **THEN** generation and the committed/consumer projection validation pass
  that handoff without requiring a fallback

#### Scenario: Direct status with an unresolved target fails

- **WHEN** a fenced token has role-map status `direct` but its matrix target is
  absent from the ownership manifest's `package_roles`, absent from the
  generator's complete preflight role set, or lacks a physical TOML in the
  committed or consumer role root being checked
- **THEN** generation or validation fails closed and identifies the token and
  unresolved direct target

#### Scenario: Non-role tokens avoid false positives
- **WHEN** adapted generated-role text contains fenced `data-testid`,
  `playwright-cli`, file names or path fragments, version strings, and a
  historical or descriptive mention of an unknown role-shaped token without
  explicit dispatch context
- **THEN** the role-neighbor fence reports no error for those non-role uses
  while the existing metadata, ownership, and reference checks remain active

#### Scenario: Hand-maintained package roles retain existing validation

- **WHEN** validation inspects `bug-investigator`, `explorer`, `monitor`, or
  `worker`
- **THEN** the new role-neighbor fence does not scan that hand-maintained role
  while all existing metadata, ownership, and reference checks remain active

### Requirement: Every canonical agent has an explicit Codex coverage outcome

The coverage matrix SHALL classify canonical provider-specific roles using the
canonical IDs and SHALL distinguish direct, merged, fallback,
capability-gated, and intentionally-unavailable outcomes. References to legacy
aliases are allowed only in documented migration/compatibility contexts.

#### Scenario: Coverage names resolve

- **WHEN** coverage validation runs after canonical migration
- **THEN** every canonical Codex role reference resolves to a declared target
  or explicit availability outcome

#### Scenario: No canonical role is unclassified

- **WHEN** coverage validation runs
- **THEN** every canonical root and module role has exactly one coverage outcome

#### Scenario: Unsupported platform capability is explicit

- **WHEN** a role requires a capability that the Codex consumer does not
  provide
- **THEN** the matrix records a capability gate and the instructions provide
  an observable fallback result

#### Scenario: A merged role points at a ghost target

- **WHEN** a coverage entry maps a canonical role to a non-existent target
- **THEN** coverage validation fails with the source role and target name

#### Scenario: All supporting targets resolve

- **WHEN** supporting assets and dispatch namespaces reference roles
- **THEN** every reference resolves to a declared direct role or documented
  fallback

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
