# install-lifecycle Specification

## Purpose

Run every Codex and Cursor project install, update, uninstall, rollback, and recovery through JS Host adapters under one project install lock and one Projection Journal, with the installer scripts as thin entry points and no python3 requirement ([ADR-0036](../../../docs/adr/0036-js-projection-journal-replaces-two-phase-install.md)).

## Requirements

### Requirement: One install lock per project

Every install, update, uninstall, rollback, or recovery for any Host SHALL hold one project-level install lock for its whole duration, so runs for different Hosts on the same project are serialized. A run that cannot acquire the lock SHALL fail without changing files and SHALL name the lock and its owner.

#### Scenario: Codex and Cursor installs overlap

- **WHEN** a Cursor install starts while a Codex install on the same project holds the lock
- **THEN** the Cursor install fails before changing any file and names the lock held by the Codex run

#### Scenario: Rerun after a crash takes over the crashed run's lock

- **WHEN** an install crashed and left the lock and a Projection Journal recording the same dead pid, and the user reruns the installer
- **THEN** the run takes over the lock, recovers the journal, and continues

#### Scenario: Any other stale lock needs explicit recovery

- **WHEN** the lock's pid is not alive and no Projection Journal records that pid
- **THEN** an ordinary run fails without changing files and names `--recover`, and `--recover` removes the lock

### Requirement: Host adapters perform the install

The Codex and Cursor installs SHALL run through JS Host adapters under one Projection Journal. `dhpk-install` write actions for Codex and Cursor SHALL perform the install instead of reporting `NOT_IMPLEMENTED`. The adapters SHALL keep the existing behavior for provider checks, inventory and profile selection, adoption, Released Entries, legacy skill-name migration, and the 0.69.x version boundary.

#### Scenario: dhpk-install performs a Codex install

- **WHEN** the user runs a `dhpk-install` Codex install action on a project
- **THEN** the native assets and Shared Project Projection are installed and the receipts are written, with the same outcome as the installer script

#### Scenario: Version boundary is preserved

- **WHEN** a Host record lacks the tree-merkle-v1 fingerprint marker
- **THEN** the install fails closed with the same remediation message as before

### Requirement: Installer scripts are thin entry points

`scripts/hooks/install-codex-skills.sh` and `scripts/hooks/install-cursor-harness.sh` SHALL remain valid entry points with their existing options and exit codes, and SHALL delegate the whole lifecycle to the JS installer.

#### Scenario: Existing invocation keeps working

- **WHEN** a user runs `bash scripts/hooks/install-codex-skills.sh --copy --force` from a checkout
- **THEN** the install completes through the JS installer with the same result and exit code as before

### Requirement: Receipt formats are unchanged

The installer SHALL read and write the Projection Receipt (schemas v1 to v3) and Host receipts (schema v3) in their existing formats; replacing the lifecycle engine SHALL NOT require a receipt migration.

#### Scenario: Receipt from the previous release

- **WHEN** a project holds receipts written by the previous release
- **THEN** status, update, and uninstall work on them without rewriting them into a new schema

### Requirement: No python3 requirement

The Codex and Cursor installers SHALL NOT require `python3`, and the installation documentation SHALL NOT list it as an installer requirement.

#### Scenario: Install without python3 on PATH

- **WHEN** the installer runs with no `python3` on `PATH`
- **THEN** the install completes normally
