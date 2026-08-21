# consumer-post-install-validation Specification

## Purpose

TBD - created by archiving change repair-open-issues-and-agent-guidance. Update Purpose after archive.
## Requirements
### Requirement: Official Claude strict validation is consumer evidence

The consumer validation stage SHALL run `claude plugin validate <manifest> --strict` against the staged or installed Claude plugin when the official CLI is available. The result, version, command, exit code, bounded diagnostics, and normalized surface evidence SHALL be retained, and an official validation failure SHALL block consumer completion.

#### Scenario: Strict validator accepts the staged plugin

- **WHEN** the official validator exits zero for the staged plugin manifest
- **THEN** the consumer evidence records an official PASS with its normalized command, version, exit code, and continues to installed-cache checks

#### Scenario: Strict validator rejects a skill description

- **WHEN** the official validator reports a YAML/frontmatter error for any shipped skill
- **THEN** the normalized consumer verdict is BLOCKED with the affected relative paths and does not report the release complete

#### Scenario: Official CLI is unavailable

- **WHEN** the consumer environment cannot run the official Claude validator
- **THEN** normalized evidence records `NOT RUN` or the applicable unavailable state with the reason and the release cannot claim an official-validation PASS

### Requirement: Consumer checks detect stale or duplicate Codex surfaces

Supported Codex consumer validation, as implemented by `scripts/release/consumer-gate.js` under the `consumer-post-install-validation` contract, SHALL compare the canonical source fingerprint, installed receipt/version, discovered project-local fallback entries, and native package entries. A stale receipt, duplicate dhpk surface with differing content, or legacy fallback set that shadows canonical names SHALL produce an actionable BLOCKED or legacy surface-matrix WARN according to that surface matrix and SHALL never be presented as a clean supported install. The result SHALL retain a normalized per-surface evidence record with the checked fingerprints, paths, commands, diagnostics, remediation reasons, and any compatibility `WARN` status separately from its canonical evidence verdict.

#### Scenario: Clean project has one current projection

- **WHEN** a clean project contains the expected canonical fallback entries, matching receipt fingerprint, and no conflicting native surface
- **THEN** the supported Codex consumer result is PASS and records the discovered names, fingerprint, and normalized evidence fields

#### Scenario: Existing project has a stale receipt and legacy mirrors

- **WHEN** the project receipt predates the current native naming scheme and legacy physical entries coexist with canonical entries
- **THEN** validation reports the exact stale receipt, duplicate paths, and required migration/update command in normalized evidence, and does not report PASS

#### Scenario: Native and fallback content differs

- **WHEN** a native package and project-local fallback expose the same skill name with different fingerprints
- **THEN** validation reports a deterministic conflict verdict and retains both paths and fingerprints for remediation

#### Scenario: Non-blocking surface warning is normalized

- **WHEN** the duplicate-surface matrix returns `WARN` because a receipt-owned project-local fallback takes precedence over experimental native content
- **THEN** the normalized result preserves `WARN` as compatibility surface status and warnings metadata, keeps the canonical evidence verdict vocabulary unchanged, and does not report a clean supported install
