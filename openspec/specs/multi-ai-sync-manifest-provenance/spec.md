# multi-ai-sync-manifest-provenance Specification

## Purpose
TBD - created by archiving change scope-multi-ai-sync-validation-to-configured-platforms. Update Purpose after archive.
## Requirements
### Requirement: Codex sync manifest is required only for parity-managed agent output
`multi-ai-sync` SHALL require `.codex/agents/sync-manifest.json` only when the requested operation or an existing managed-state marker establishes that multi-ai parity apply owns the Codex agent output. The manifest SHALL identify its owner and schema version.

#### Scenario: Multi-ai parity apply owns Codex agents
- **WHEN** validation inspects Codex agent output created or managed by multi-ai parity apply
- **THEN** a missing, malformed, or ownership-mismatched sync manifest reports `FAIL`

#### Scenario: Parity receipt is valid
- **WHEN** parity-managed Codex agent output has a manifest with the expected owner, schema version, and managed entries
- **THEN** validation uses the receipt to verify managed output

### Requirement: Standard Codex installation does not imply parity ownership
A repository that uses the standard Codex skill installer without multi-ai parity apply SHALL validate its installed skill contract without requiring `.codex/agents/sync-manifest.json`.

#### Scenario: Installer-only repository has no parity manifest
- **WHEN** `install-codex-skills.sh` installed or updated skills and no parity ownership marker exists
- **THEN** validation does not fail because `.codex/agents/sync-manifest.json` is absent

#### Scenario: Standard installation and parity apply coexist
- **WHEN** a repository uses the standard skill installer and separately applies parity-managed Codex agents
- **THEN** skill installation follows the installer contract while agent output follows the parity manifest contract

### Requirement: Validation reports which installation contract was selected
The validation report SHALL state whether Codex was checked as a standard installation, parity-managed output, both, or `NOT_CONFIGURED`, and SHALL list the evidence used to select that contract.

#### Scenario: User investigates a missing manifest result
- **WHEN** validation completes for a configured Codex target
- **THEN** the report identifies the selected ownership contract and the marker or operation that selected it

### Requirement: Every generated platform surface has owner-scoped provenance

Generated `agent-plugin`, `codex-native`, `codex-sync`, `cursor-plugin`, and `agy-plugin` outputs SHALL carry or reference a receipt that identifies the
owning generator, schema version, source commit/version, inventory digest,
selected stable IDs, public names, transformations, and output fingerprints.
A receipt for one surface SHALL not authorize mutation or parity claims for
another.

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
native provenance, Agent Plugin provenance, Cursor marketplace metadata, and
AGY provenance SHALL remain independently addressable and rollbackable.

#### Scenario: User-owned Cursor file collides with generated output

- **WHEN** Cursor projection encounters an edited rule or agent at its target
  path without matching receipt ownership
- **THEN** migration reports a collision, preserves the file, and requires an
  explicit owner decision

#### Scenario: One surface is rolled back

- **WHEN** a Cursor projection is rolled back after a failed consumer gate
- **THEN** only Cursor-owned generated files and receipts are reverted; Codex,
  Claude, and user-owned project files remain unchanged

### Requirement: AGY installation is receipt-owned and collision-safe

AGY install, update, uninstall, and rollback SHALL operate only at
`~/.gemini/config/plugins/dhpk/` and SHALL require a matching `agy-plugin`
provenance receipt for replacement or removal. The installer SHALL expose
read-only target ownership evidence through `plan`/`status`, including target
manifest/version, physical `.git` marker, source fingerprint, receipt validity,
and bounded changed/missing previews. Foreign or changed files SHALL be preserved
and reported as collisions; a physical Git checkout without an AGY receipt
SHALL be classified `FOREIGN_CHECKOUT`/`BLOCKED` rather than treated as a
discovery or runtime pass.

#### Scenario: AGY-owned update succeeds

- **WHEN** the target receipt and every existing generated fingerprint match
- **THEN** update replaces only AGY-owned files and refreshes the receipt

#### Scenario: AGY target contains a user file

- **WHEN** installation would overwrite a target file without matching AGY
  ownership
- **THEN** the operation fails closed and leaves the user file untouched

#### Scenario: Validation consumes ownership evidence separately

- **WHEN** configured-platform validation inspects an AGY target with a
  foreign-checkout diagnostic
- **THEN** it can report ownership as `BLOCKED` without upgrading package,
  discovery, or runtime rows to `PASS`
