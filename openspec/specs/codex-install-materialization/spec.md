# codex-install-materialization Specification

## Purpose

Define deterministic, reversible Codex projection materialization, including
receipt reconciliation, managed-target safety, and source filtering.

## Requirements

### Requirement: Legacy receipts and projections reconcile explicitly

The supported Codex installer SHALL compare receipt schema/version, source
fingerprint, canonical managed names, and destination entries before declaring
a project up to date. A pre-consolidation receipt or legacy fallback name set
SHALL produce an explicit migration/update state with an actionable command and
SHALL not be silently treated as current. A mismatch between either recorded
`plugin_version` or recorded `source_fingerprint` and the current source SHALL
also produce an explicit stale/migration-required state, even when the
historical reconciliation state is `current` and no destination path delta is
present.

#### Scenario: Receipt version drifts without path changes

- **WHEN** a schema-v3 receipt has the prior plugin version but all managed
  destination paths and the historical reconciliation state are current
- **THEN** `--update --plan --json` reports a non-current stale state, identifies
  the version drift, and provides the explicit `--migrate --update` action

#### Scenario: Receipt reports an old release

- **WHEN** the project receipt contains a pre-consolidation version and legacy
  skill names
- **THEN** the installer reports that migration/update is required, identifies
  the affected managed entries, and leaves the project unchanged until the
  requested mode is supplied

#### Scenario: Receipt fingerprint drifts without path changes

- **WHEN** a schema-v3 receipt has the prior source fingerprint but all managed
  destination paths and the historical reconciliation state are current
- **THEN** `--update --plan --json` reports a non-current stale state, identifies
  the fingerprint drift, and provides the explicit `--migrate --update` action

#### Scenario: Receipt version matches but content is stale

- **WHEN** the recorded version matches the source but the source fingerprint
  differs
- **THEN** the installer does not report up to date and schedules only
  dhpk-managed targets for update

#### Scenario: Both provenance fields drift

- **WHEN** both top-level provenance fields differ from the current source
- **THEN** the plan remains non-current and retains both bounded mismatch
  reasons rather than trusting the historical reconciliation state

#### Scenario: Explicit update repairs provenance

- **WHEN** an operator runs explicit `--migrate --update` after a provenance
  drift plan and the existing ownership/collision checks pass
- **THEN** the receipt records the current version and fingerprint, the normal
  projection mode and ownership remain unchanged, and a subsequent read-only
  plan reports current with no spurious path deltas

### Requirement: Reconciliation preserves unowned collisions
Update and migration SHALL classify destination collisions by ownership and exact source match. Only proven dhpk-managed targets may be replaced or pruned; an unowned same-name file, directory, or link SHALL receive a safe collision diagnostic and SHALL remain recoverable. The installer SHALL additionally provide a read-only JSON planning mode and an explicit path-scoped adoption mode. Planning SHALL not mutate the projection; adoption SHALL require an exact reported path, matching source and destination preflight fingerprints, and a rollback-addressable backup before ownership is changed. When no mode is explicitly supplied for adoption, the receipt's recorded mode SHALL be preserved. When a receipt entry matches an inventory retirement record, plan and update evidence SHALL annotate the retired path with its retirement release, reason, replacement kind, and replacement identity or mode when present.

#### Scenario: Unowned legacy file collides with a canonical name
- **WHEN** migration encounters a same-name destination that is not proven dhpk-managed
- **THEN** the installer reports the collision, does not overwrite or delete it implicitly, and records the blocked entry for an explicit owner decision

#### Scenario: Owner explicitly adopts a collision
- **WHEN** an owner supplies an exact collision path and both fingerprints from a fresh planning report and they remain unchanged
- **THEN** the installer creates a rollback-addressable backup, reconciles only that path into receipt ownership, and records the adoption evidence

#### Scenario: Adoption preflight is stale
- **WHEN** the selected collision or its source differs from the planning fingerprints before adoption
- **THEN** the installer exits before mutation and requires a new plan and explicit confirmation

#### Scenario: Managed entry is retired
- **WHEN** update finds a retired entry recorded as dhpk-managed, absent from active inventory, and unchanged from its receipt fingerprint
- **THEN** the installer removes or archives only that managed entry and reports the reconciliation count plus ledger-backed successor/reason evidence

#### Scenario: Retired entry is modified or unowned
- **WHEN** a retired destination is modified, retargeted, unsafe, or not proven dhpk-managed
- **THEN** plan and update preserve it, classify it as an orphan or collision, and report ledger-backed retirement guidance without claiming it was pruned

#### Scenario: Retirement planning is read-only
- **WHEN** an operator requests a JSON plan containing retired receipt entries
- **THEN** the plan includes ownership, source/destination fingerprints, and retirement guidance while projection and receipt hashes remain unchanged

### Requirement: Projection evidence is deterministic and reversible

Every reconciliation SHALL report source/destination paths, ownership
classification, version/schema, fingerprints, and counts for updated, skipped,
collided, and retired entries. Planning reports SHALL be JSON-serializable and
SHALL not write receipt or projection state. Provenance drift SHALL be part of
that evidence and SHALL not be hidden by a historical `current` reconciliation
record. Any explicit repair SHALL retain the existing rollback-addressable
transaction behavior and SHALL not claim success after an incomplete update.

#### Scenario: Metadata-only provenance plan preserves all state

- **WHEN** an operator requests a JSON plan for a receipt with only version or
  fingerprint drift
- **THEN** the report exposes the current and recorded provenance needed for
  remediation, adds no path delta solely for metadata drift, and the receipt,
  projection, and transaction metadata remain byte-identical

#### Scenario: Existing collision behavior is preserved

- **WHEN** provenance drift is present together with an unowned or changed
  destination collision
- **THEN** the plan remains non-current, preserves the collision, and requires
  the existing fingerprint-bound adoption flow rather than overwriting it

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

#### Scenario: Destination ownership detects legacy bytecode

- **WHEN** a pre-remediation receipt records a managed copy whose destination
  contains ignored Python bytecode
- **THEN** ownership validation accepts the complete legacy destination
  fingerprint
- **AND** update replaces the managed destination with a clean projection
- **AND** consumer validation uses complete destination integrity so stale or
  changed bytecode cannot be treated as an equivalent projection

#### Scenario: Migration completes with collisions

- **WHEN** a migration updates managed entries but skips two unowned collisions
- **THEN** the receipt/evidence records both counts, the skipped paths, and the
  exact follow-up command

#### Scenario: Reconciliation fails midway

- **WHEN** a required source or receipt check fails before all managed entries
  are processed
- **THEN** the installer exits non-zero, reports the incomplete state, and does
  not mark the receipt as fully current

#### Scenario: Planning is read-only

- **WHEN** an operator requests a JSON plan for a stale projection
- **THEN** the report includes the complete evidence needed for an owner
  decision and the projection and receipt hashes remain unchanged
