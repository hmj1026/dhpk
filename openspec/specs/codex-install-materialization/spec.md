# codex-install-materialization Specification

## Purpose

Define deterministic, reversible Codex projection materialization, including
receipt reconciliation, managed-target safety, and source filtering.
## Requirements
### Requirement: Legacy receipts and projections reconcile explicitly

The supported Codex installer SHALL compare the receipt schema/version, source fingerprint, canonical managed names, and destination entries before declaring a project up to date. A pre-consolidation receipt or legacy fallback name set SHALL produce an explicit migration/update state with an actionable command and SHALL not be silently treated as current.

#### Scenario: Receipt reports an old release

- **WHEN** the project receipt contains a pre-consolidation version and legacy skill names
- **THEN** the installer reports that migration/update is required, identifies the affected managed entries, and leaves the project unchanged until the requested mode is supplied

#### Scenario: Receipt version matches but content is stale

- **WHEN** the recorded version matches the source but the source fingerprint differs
- **THEN** the installer does not report up to date and schedules only dhpk-managed targets for update

### Requirement: Reconciliation preserves unowned collisions

Update and migration SHALL classify destination collisions by ownership and exact source match. Only proven dhpk-managed targets may be replaced or pruned; an unowned same-name file, directory, or link SHALL receive a safe collision diagnostic and SHALL remain recoverable.

#### Scenario: Unowned legacy file collides with a canonical name

- **WHEN** migration encounters a same-name destination that is not proven dhpk-managed
- **THEN** the installer reports the collision, does not overwrite or delete it implicitly, and records the blocked entry for an explicit owner decision

#### Scenario: Managed entry is retired

- **WHEN** update finds a retired entry recorded as dhpk-managed and no longer present in the canonical inventory
- **THEN** the installer may remove or archive only that managed entry and reports the reconciliation count

### Requirement: Projection evidence is deterministic and reversible

Every reconciliation SHALL report source/destination paths, ownership
classification, version/schema, fingerprints, and counts for updated, skipped,
collided, and retired entries. The distributable source tree used for
fingerprints and copy mode SHALL exclude `__pycache__/` directories and files
ending in `.pyc`, and the same exclusion SHALL apply to normal and atomic
materialization. Any migration backup SHALL be addressable for rollback, and a
failed reconciliation SHALL not claim success.

#### Scenario: Ignored Python bytecode is not materialized

- **WHEN** a source skill contains an ignored `__pycache__/` directory or `.pyc`
  file and the installer runs in `--copy` mode
- **THEN** no corresponding bytecode path exists in the consumer projection
- **AND** ordinary distributable files in that skill are still copied

#### Scenario: Ignored bytecode does not alter source evidence

- **WHEN** ignored bytecode is added, changed, or removed without changing
  distributable source files
- **THEN** the receipt source fingerprint remains stable
- **AND** update reconciliation does not report a source change caused only by
  that bytecode

#### Scenario: Migration completes with collisions

- **WHEN** a migration updates managed entries but skips two unowned collisions
- **THEN** the receipt/evidence records both counts, the skipped paths, and the
  exact follow-up command

#### Scenario: Reconciliation fails midway

- **WHEN** a required source or receipt check fails before all managed entries
  are processed
- **THEN** the installer exits non-zero, reports the incomplete state, and does
  not mark the receipt as fully current
