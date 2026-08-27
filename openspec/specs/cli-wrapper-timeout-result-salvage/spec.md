# cli-wrapper-timeout-result-salvage Specification

## Purpose

Define bounded, redacted timeout evidence after the legacy shell-envelope path
was superseded by the contained CLI transport runner.

## Requirements

### Requirement: Timeout evidence is a contained terminal receipt

When the portable runner reaches an attested deadline, it SHALL terminate the
provider process group, return exit `124`, and atomically create the
dispatcher-selected `0600` `dhpk.cli.receipt.v1` with terminal status
`TIMEOUT`. The receipt SHALL be directly contained by the pinned private
artifact root and SHALL never use `PARTIAL` as a launch status. A missing,
replaced, non-private, or pre-existing receipt target SHALL be `BLOCKED`.

#### Scenario: Timeout has a final report

- **WHEN** a provider is terminated after writing a report
- **THEN** the receipt records only redacted bounded report evidence and the
  process exits `124`

#### Scenario: Timeout has no final report

- **WHEN** a provider is terminated before writing a report
- **THEN** the receipt records `report_present=false` and terminal `TIMEOUT`

### Requirement: Captures are redacted and bounded before receipt persistence

The runner SHALL redact credential-shaped values and private paths before it
stores a digest or prints a report. It SHALL bound stdout, stderr, metadata,
and report capture without imposing a process-wide file-size resource limit;
an oversized capture SHALL be marked as truncated without exposing a suffix.

#### Scenario: Timed-out provider emits a secret

- **WHEN** a timed-out provider writes a token or password to stderr
- **THEN** neither the persisted receipt nor runner output contains the secret

### Requirement: Salvage never proves completion

Callers SHALL read the contained terminal receipt before interpreting exit
`124`, use independently verified path-scoped diff evidence for any salvage,
and never treat a report as `DONE`. They SHALL not retry inline, alter scope,
or choose a fallback backend because of timeout evidence alone.

#### Scenario: Salvaged report has attributable edits

- **WHEN** an independently verified assigned-path diff confirms edits
- **THEN** the caller may report `TIMEOUT_SALVAGED` and requests reconciliation

#### Scenario: Receipt is missing or uncontained

- **WHEN** a timeout exit lacks a valid contained receipt
- **THEN** the caller reports `BLOCKED`
