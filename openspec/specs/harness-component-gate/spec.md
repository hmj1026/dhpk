# harness-component-gate Specification

## Purpose
TBD - created by archiving change dhpk-harness-integrity-guards. Update Purpose after archive.
## Requirements
### Requirement: Adding a component requires a documented justification

`rules/execution-policy.md` SHALL require that any change adding a new reviewer agent, a new
sentinel slot, or a new hook first record — in the relevant INDEX (`agents/INDEX.md`,
`payload.sh` header, or the hook wiring doc) — why the existing components cannot cover the need.
The justification is the precondition for the addition, moving the cost of "add" up front so that
a later removal does not leave undocumented residue.

#### Scenario: A new reviewer agent is proposed

- **WHEN** a change adds `agents/<new-reviewer>.md`
- **THEN** `agents/INDEX.md` records why an existing reviewer cannot cover the new concern, before the agent is wired

#### Scenario: A new sentinel slot is proposed

- **WHEN** a change extends the `SENTINEL_NAMES` array with a new slot
- **THEN** the `payload.sh` slot documentation states why an existing slot cannot cover the trigger

#### Scenario: An addition lacks justification

- **WHEN** a new agent / sentinel slot / hook is added with no recorded justification
- **THEN** the change is considered incomplete under this policy and is sent back for the justification
