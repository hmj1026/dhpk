# host-adapter-test-tables Specification

## Purpose

Keeps shared Host Adapter invariants in one capability table so a new Host adds a row instead of another file-stack, while Host-unique installers stay isolated.

## Requirements

### Requirement: Shared Host Adapter invariants use capability tables

Shared invariants that apply to more than one Host Adapter (manifest shape, consumer invocation contract, projection identity) SHALL be asserted from a table whose rows are Hosts and whose columns are capabilities. Each row SHALL carry Host-specific expected values or per-row assertions. The suite SHALL be a flat `tests/*.test.js` file discovered by `tests/run-all.js`. Table helpers SHALL live under `tests/_lib/` and SHALL NOT be placed under `scripts/`.

#### Scenario: Four Hosts share one conformance table

- **WHEN** Claude, Codex, AGY, and Cursor share manifest-shape and invocation-contract checks
- **THEN** one discovered suite iterates Host rows and fails the specific Host and capability that drifted

#### Scenario: A new Host is added to a shared invariant

- **WHEN** a fifth Host Adapter must obey an existing shared invariant
- **THEN** the change adds a table row (and per-row assertions) rather than a new parallel `tests/*-<host>*.test.js` stack for that invariant

### Requirement: Host-unique isolation stays in dedicated files

Installer copy/hash/reconciliation suites and any suite with a distinct timeout or worker-weight isolation requirement SHALL remain dedicated `tests/*.test.js` files. Shared-table collapse SHALL NOT merge those isolation splits.

#### Scenario: Codex installer isolation is preserved

- **WHEN** `install-codex-skills*.test.js` files exist as separate isolation and timeout splits
- **THEN** they remain separate discovered files and are not folded into the shared Host capability table

#### Scenario: A Host-unique sentinel or migration behavior is not forced into the shared table

- **WHEN** a Host Adapter has sentinel, migration, or review-gate behavior that other Hosts do not share
- **THEN** that behavior stays in a dedicated suite until it can be expressed as a table row without dropping Host-unique assertions

### Requirement: The Darwin installer subset is one explicit list

The macOS CI job that re-runs installer tests SHALL read the same explicit file list as the documentation of that subset. Adding or removing an installer file from the Ubuntu aggregate runner SHALL NOT silently drop Darwin coverage; the list is updated in one place.

#### Scenario: The Darwin job names the same installer files as the list

- **WHEN** the macOS installer job runs
- **THEN** it executes exactly the files in the shared installer subset list

#### Scenario: A new isolated installer file is added

- **WHEN** a new Host-unique installer suite is required on Darwin
- **THEN** the file is added to the subset list in the same change; the job already executes that list
