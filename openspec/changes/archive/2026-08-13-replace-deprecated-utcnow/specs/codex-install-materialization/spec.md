## MODIFIED Requirements

### Requirement: Projection evidence is deterministic and reversible

Every reconciliation SHALL report source/destination paths, ownership
classification, version/schema, fingerprints, and counts for updated, skipped,
collided, and retired entries. The distributable source tree used for
fingerprints and copy mode SHALL exclude `__pycache__/` directories and files
ending in `.pyc`, and the same exclusion SHALL apply to normal and atomic
materialization. Backup-run and receipt timestamps SHALL be generated as
timezone-aware UTC values without deprecated Python datetime API warnings while
preserving the existing second-precision UTC wire format and trailing `Z`.
Any migration backup SHALL be addressable for rollback, and a failed
reconciliation SHALL not claim success.

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

#### Scenario: Timestamp creation is warning-free and wire-compatible

- **WHEN** a supported installer sync runs with Python deprecation warnings
  treated as errors
- **THEN** the sync succeeds without a `DeprecationWarning`
- **AND** `installed_at` remains a second-precision UTC timestamp ending in `Z`
- **AND** any migration backup directory retains the existing UTC timestamp
  naming shape

#### Scenario: Migration completes with collisions

- **WHEN** a migration updates managed entries but skips two unowned collisions
- **THEN** the receipt/evidence records both counts, the skipped paths, and the
  exact follow-up command

#### Scenario: Reconciliation fails midway

- **WHEN** a required source or receipt check fails before all managed entries
  are processed
- **THEN** the installer exits non-zero, reports the incomplete state, and does
  not mark the receipt as fully current
