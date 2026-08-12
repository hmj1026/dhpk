## ADDED Requirements

### Requirement: Every generated platform surface has owner-scoped provenance

Generated `agent-plugin`, `codex-native`, `codex-sync`, and `cursor-plugin` outputs SHALL
carry or reference a receipt that identifies the owning
generator, schema version, source commit/version, inventory digest, selected
stable IDs, public names, transformations, and output fingerprints. A receipt
for one surface SHALL not authorize mutation or parity claims for another.

#### Scenario: Standard package receipt is valid

- **WHEN** the Agent Plugins package is generated from the current inventory
- **THEN** its provenance names the standard generator, package root, selected
  IDs, version, inventory digest, and fingerprints, and validation passes

#### Scenario: Cursor receipt is used for Codex output

- **WHEN** a Cursor receipt is presented to validate a Codex-native or
  project-local Codex projection
- **THEN** validation reports an ownership mismatch and does not claim parity

### Requirement: Migration preserves independent consumer ownership

Migration/update operations SHALL adopt, replace, or remove only entries proven
owned by the target surface. Existing `.codex/.dhpk-installed.json`, Codex
native provenance, Agent Plugin provenance, and Cursor marketplace metadata
SHALL remain independently addressable and rollbackable.

#### Scenario: User-owned Cursor file collides with generated output

- **WHEN** Cursor projection encounters an edited rule or agent at its target
  path without matching receipt ownership
- **THEN** migration reports a collision, preserves the file, and requires an
  explicit owner decision

#### Scenario: One surface is rolled back

- **WHEN** a Cursor projection is rolled back after a failed consumer gate
- **THEN** only Cursor-owned generated files and receipts are reverted; Codex,
  Claude, and user-owned project files remain unchanged
