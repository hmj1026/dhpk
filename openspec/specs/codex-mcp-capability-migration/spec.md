# codex-mcp-capability-migration Specification

## Purpose

Defines the shared parity, second-opinion, and honesty contract that every capability migrated off Codex MCP must satisfy before the MCP grant behind it is retired, so migration is evidence-based rather than an assumed-equivalent swap.

## Requirements

### Requirement: Every migration target has a recorded capability-parity matrix

Each of the 8 migration targets SHALL have a recorded parity matrix row: original capability, original MCP behavior, new owner skill, retained transport (if any), gate/verification mechanism, session-continuity difference, migration evidence, and rollback path. A migration SHALL NOT be considered complete for a target whose row is missing any field.

#### Scenario: Matrix row is incomplete

- **WHEN** a migration target's parity-matrix row is missing the new-owner, gate, or rollback field
- **THEN** that target's MCP grant is not eligible for removal until the row is completed

#### Scenario: Matrix row is complete

- **WHEN** a migration target's parity-matrix row has all required fields with cited evidence (file:line, test name, or verification run)
- **THEN** that target's MCP grant is eligible for removal

### Requirement: Codex second opinion is explicit-only, never a silent default

Where a migrated capability retains `codex exec` as an optional second opinion (blind review, adversarial critique, independent verdict), it SHALL be invoked only on an explicit, named opt-in — never as the automatic default path. The backend-neutral owner's core capability SHALL fully function using the current in-process model alone.

#### Scenario: Second opinion is not requested

- **WHEN** a caller invokes the migrated skill without opting into a second opinion
- **THEN** the skill completes its full capability using only the current in-process model, with no `codex exec` invocation

#### Scenario: Second opinion is explicitly requested

- **WHEN** a caller explicitly opts into a second opinion
- **THEN** the skill invokes `codex exec` (or, where the target names it, the external app-server plugin) as an additional, clearly labeled input, not a replacement for the primary verdict

### Requirement: Degraded state is reported honestly when no second opinion runs

A migrated skill whose original MCP behavior included an independent/blind verdict SHALL NOT claim independent verification occurred when no second opinion was requested or available. It SHALL report a degraded state explicitly.

#### Scenario: Independent verdict is claimed without a second opinion

- **WHEN** a migrated skill's output claims an independent or blind verdict occurred but no second-opinion invocation ran
- **THEN** this is a defect — the correct output states the verdict came from the primary model alone and names the degraded state

#### Scenario: No second opinion is available and none was requested

- **WHEN** a caller does not opt into a second opinion
- **THEN** the skill's output states plainly that only the primary model's verdict is present, without describing that as an independent check

### Requirement: Rollback is version pinning, not hidden MCP fallback

If a migrated capability regresses after MCP retirement, rollback SHALL use the last compatible release with the MCP grant intact, per the existing `skill-retirement-migration` rollback contract. The retiring release MUST NOT retain a hidden MCP invocation path for silent fallback.

#### Scenario: Migrated capability regresses in production use

- **WHEN** a migrated skill's backend-neutral behavior is found to regress a capability the MCP version provided
- **THEN** the documented rollback pins the last release with the MCP grant, rather than reintroducing a hidden MCP call in the current release
