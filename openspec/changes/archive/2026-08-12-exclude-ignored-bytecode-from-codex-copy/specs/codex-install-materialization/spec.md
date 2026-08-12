## MODIFIED Requirements

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
