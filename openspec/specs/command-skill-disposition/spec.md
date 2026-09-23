# command-skill-disposition Specification

## Purpose

Keep the canonical Host command inventory aligned with reusable Skill ownership,
thin front doors, authority boundaries, and evidence states before publication.

## Requirements

### Requirement: Every canonical command has one explicit disposition

The command inventory SHALL classify every canonical command as an existing
Skill owner, thin front door, newly approved reusable Skill, Host-only Command,
or retired entry. Each disposition SHALL identify the owning capability, Host
surface, public name, argument contract, authority boundary, and evidence
needed to support the classification.

The v3 inventory SHALL include commands under both `commands/` and
`modules/*/commands/`, excluding navigation indexes. A command has exactly one
Skill owner; several command entry points MAY share that owner. A forwarding
record names the selected action and fixed argument tokens. Legacy v2
inventories remain readable with their historical root-only scope.

#### Scenario: Command inventory is complete

- **WHEN** the disposition compiler processes the canonical command inventory
- **THEN** every command receives exactly one disposition and an unclassified
  command fails validation with its stable path

#### Scenario: A command has conflicting owners

- **WHEN** a command points to more than one Skill owner or front door
- **THEN** validation fails before projection and reports the conflicting owners

### Requirement: Promotion to a Portable Skill is bounded by reuse and authority

A command SHALL be promoted to a Portable Skill only when its capability is
reusable beyond one Host, its authority can be expressed by the Skill
contract, and its procedure has one canonical owner. Host-specific behavior,
operator-only actions, and capabilities without a settled owner SHALL remain
Host-only unless a later decision changes the disposition.

#### Scenario: Reusable command has an existing Skill owner

- **WHEN** a command provides a Host-specific entry to an existing reusable
  Skill
- **THEN** the inventory records a thin front door and does not create a second
  procedure or capability owner

#### Scenario: Host-only capability is not portable

- **WHEN** a command depends on Host-only authority or interaction
- **THEN** the inventory records Host-only with a reason and does not fabricate
  Codex or Portable Skill parity

### Requirement: Thin front doors do not duplicate behavior

A thin front door SHALL forward to its owning Skill while preserving the
Skill's public identity, arguments, authority, and terminal evidence. It SHALL
not add workflow logic, silently broaden authority, or define a second Usage
Grammar.

#### Scenario: Thin front door forwards valid arguments

- **WHEN** a user invokes an approved thin front door with valid arguments
- **THEN** the owning Skill receives the same normalized invocation contract
  and the result reports the Skill-owned evidence

#### Scenario: Thin front door changes authority

- **WHEN** a front door attempts to grant more authority than its Skill owner
- **THEN** validation fails and the front door is not published

### Requirement: Public skill renames preserve stable identity

The approved portable-command migration MAY rename a Skill's public name and
canonical directory while retaining its stable ID and capability ID. Individual
unprefixed workflows use `portable-skill`; capability families retain their
existing `portable-family` classification. Claude command names remain stable.

#### Scenario: An installed skill is renamed

- **WHEN** a receipt-owned unchanged skill has an approved public-name rename
- **THEN** installation migrates it by stable identity, preserves edited or
  unowned destinations, and reports collisions without overwriting them

#### Scenario: A previous public name is requested

- **WHEN** a retired public name has a rename-ledger entry
- **THEN** discovery reports the current name without installing a duplicate
  compatibility Skill

### Requirement: Portable execution includes required resources

A published Skill SHALL resolve required procedures, scripts, and runtime
dependencies from its installed package or declared dependency closure.
Consumer availability SHALL be based on observed execution, separately from
structural and package checks.

#### Scenario: Consumer has no source checkout

- **WHEN** an installed portable command Skill runs without a dhpk checkout or
  `CLAUDE_PLUGIN_ROOT`
- **THEN** its required packaged resources resolve, or it reports the exact
  unavailable capability without claiming execution success
