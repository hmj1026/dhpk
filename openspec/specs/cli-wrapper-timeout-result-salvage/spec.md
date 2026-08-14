# cli-wrapper-timeout-result-salvage Specification

## Purpose
TBD - created by archiving change issue-121-codex-timeout-report-salvage. Update Purpose after archive.
## Requirements
### Requirement: Verified Codex timeouts emit a durable report envelope
When the Codex wrapper detects its own verified timeout, it SHALL emit one versioned `dhpk.codex.timeout.v1` JSON envelope before cleanup and SHALL retain exit code `124`. The envelope SHALL contain the stable keys `schema`, `status`, `verified_wrapper_timeout`, `exit_code`, `budget_secs`, `elapsed_secs`, `report_present`, `report_encoding`, `report_b64`, `stderr_tail_encoding`, `stderr_tail_b64`, `stdout_tail_encoding`, `stdout_tail_b64`, and `redaction`. A non-empty report SHALL not change the non-success status.

#### Scenario: Timeout leaves a final report
- **WHEN** the selected timeout command kills Codex after it has written a non-empty final report
- **THEN** stdout contains a parseable `dhpk.codex.timeout.v1` envelope with `report_present=true`
- **AND** the process exits `124`

#### Scenario: Timeout has no final report
- **WHEN** the selected timeout command kills Codex before the output file contains a report
- **THEN** stdout contains the same envelope with `report_present=false`
- **AND** the process exits `124` with timeout evidence

#### Scenario: Envelope schema is stable
- **WHEN** a caller parses a verified timeout envelope
- **THEN** all stable keys are present with `report_present=false` represented by an empty `report_b64`
- **AND** diagnostic payloads use the declared base64 encoding fields

#### Scenario: Sanitizer is unavailable
- **WHEN** the Node sanitizer is unavailable or cannot produce a valid payload
- **THEN** stdout still contains a parseable envelope with `redaction=unavailable`, `report_present=false`, and empty report/diagnostic payloads
- **AND** stderr records `report salvage is BLOCKED`, the process exits `124`, and callers classify the timeout as `BLOCKED`

### Requirement: Timeout envelope payloads are redacted and safely framed
The timeout envelope SHALL redact common secret-bearing values before encoding report and diagnostic payloads. Multiline payloads SHALL use the documented base64 representation so they cannot corrupt JSON framing. The report payload SHALL be bounded to 256 KiB after redaction; an oversized raw report SHALL be represented by `[TRUNCATED_REPORT_OMITTED]` before redaction, and a post-redaction cap SHALL use `[TRUNCATED]` when necessary. Oversized stderr/stdout captures SHALL use `[TRUNCATED_DIAGNOSTIC_OMITTED]` before redaction, and diagnostics SHALL remain bounded.

#### Scenario: Report contains a credential-shaped value
- **WHEN** a salvaged report contains an API key, token, password, or equivalent credential-shaped value
- **THEN** the emitted envelope contains the redacted representation only
- **AND** neither stdout nor stderr contains the original secret

#### Scenario: Report contains multiline Markdown
- **WHEN** the final report is at most 256 KiB, its redacted payload remains within 256 KiB, and it contains newlines, quotes, or non-ASCII text
- **THEN** the envelope remains valid JSON and the caller can decode the exact redacted report

#### Scenario: Report exceeds the safe capture bound
- **WHEN** the raw report exceeds 256 KiB before redaction
- **THEN** the envelope contains `[TRUNCATED_REPORT_OMITTED]` instead of an unredacted suffix
- **AND** the caller treats the marker as evidence that salvage is bounded, not as independent verification

### Requirement: Codex callers consume salvage without claiming success
Codex fast-worker, deep-reasoner, bridge, and single-file callers SHALL parse the timeout envelope before interpreting exit `124`. They SHALL use independently verified path-scoped diff evidence to classify the result, SHALL never treat the envelope as `DONE` by itself, and SHALL not perform inline edits or backend fallback as part of salvage.

#### Scenario: Salvaged report has attributable edits
- **WHEN** the envelope contains a report and scoped diff evidence confirms assigned edits
- **THEN** the caller reports `TIMEOUT_SALVAGED` or the governing terminal partial state
- **AND** it records that reconciliation is still required

#### Scenario: Timeout has no confirmed edits
- **WHEN** the envelope contains no report or scoped evidence confirms no assigned completion
- **THEN** the caller reports `BLOCKED`
- **AND** it does not claim that the task was applied

#### Scenario: First multi-file timeout
- **WHEN** a fast-worker batch receives its first verified timeout envelope
- **THEN** it records the envelope before executing the existing one same-backend retry
- **AND** the retry remains limited to the original unresolved assigned scope

### Requirement: Successful Codex output remains backward compatible
When Codex exits successfully with a non-empty final report, the wrapper SHALL continue to emit the raw final report and exit `0`; the timeout envelope SHALL be reserved for verified wrapper timeouts.

#### Scenario: Normal successful run
- **WHEN** Codex exits `0` and writes a non-empty final report
- **THEN** stdout is byte-compatible with the pre-salvage success path
- **AND** no timeout envelope is emitted
