# python-build-resolver Specification

## Purpose

Historical capability record. The former role was retired by the
`build-resolver` migration; the public contract now lives in
`openspec/specs/build-resolver/spec.md`.

## Requirements

### Requirement: Retired Python role has no compatibility alias

The retired `python-build-resolver` name SHALL NOT be registered or exposed as
an alias. Python build failures covered by this historical capability SHALL be
handled by `build-resolver` when the Python-compatible module is active.

#### Scenario: Legacy name is requested

- **WHEN** an installation is inspected after the migration
- **THEN** only `build-resolver` is listed and the old name has no alias
