# rust-build-resolver Specification

## Purpose

Historical capability record. The former role was retired by the
`build-resolver` migration; the public contract now lives in
`openspec/specs/build-resolver/spec.md`.

## Requirements

### Requirement: Retired Rust role has no compatibility alias

The retired `rust-build-resolver` name SHALL NOT be registered or exposed as an
alias. Cargo failures covered by this historical capability SHALL be handled
by `build-resolver` without requiring a Rust module.

#### Scenario: Cargo project has no Rust module

- **WHEN** Cargo output contains a build failure after the migration
- **THEN** `build-resolver` is eligible and the old name has no alias
