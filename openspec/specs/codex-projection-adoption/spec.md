# codex-projection-adoption Specification

## Purpose

Define safe inspection and owner-confirmed adoption of stale or unowned project-local Codex projections.

## Requirements

### Requirement: Operators can preview an unowned Codex projection collision

The Codex installer SHALL provide a read-only planning mode that emits a machine-readable report containing the receipt state, source and destination fingerprints, ownership classification, collision paths, and an exact owner-confirmed next action. Planning SHALL not modify the projection or receipt.

#### Scenario: Planning finds the reported stale collision

- **WHEN** planning inspects a schema-v3 receipt whose `skills/dhpk-cross-agent-sync` destination differs from the current source and is not receipt-owned
- **THEN** the report identifies the destination as an unowned collision, includes both fingerprints, and exits with a non-success diagnostic status without changing either path

#### Scenario: Planning finds no collision

- **WHEN** planning inspects a current receipt and matching projection
- **THEN** the report states that the projection is current and contains no adoption action

### Requirement: Adoption is explicit, path-scoped, and reversible

The Codex installer SHALL accept an explicit adoption request naming one or more reported relative collision paths and binding each path to the reported destination and source fingerprints. Before changing an adopted path, it MUST create a rollback-addressable backup, validate containment and regular-file/directory safety, and record the adoption and backup in the receipt. Without the adoption request, foreign or changed paths SHALL remain untouched.

#### Scenario: Owner adopts one collision

- **WHEN** the owner supplies an exact relative path and both fingerprints from the planning report still match
- **THEN** the installer backs up that path, materializes the current source, records ownership and backup evidence, and reports success

#### Scenario: Adoption preserves the recorded projection mode

- **WHEN** the owner omits an explicit mode while adopting a collision
- **THEN** the installer uses the receipt's recorded mode for the selected path and leaves unrelated managed entries unchanged

#### Scenario: Adoption target changed after planning

- **WHEN** the selected path or source fingerprint no longer matches the planning report
- **THEN** the installer aborts before mutation and reports that a fresh plan and owner confirmation are required

#### Scenario: Source changes after planning

- **WHEN** the source fingerprint no longer matches the adoption request
- **THEN** the installer aborts before mutation and requires a fresh plan

#### Scenario: Adoption path escapes the projection root

- **WHEN** an adoption request contains an absolute, traversal, symlinked, or otherwise unsafe path
- **THEN** the installer rejects it without writing a backup, projection file, or receipt
