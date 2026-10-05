# Technical Reference Rewrite Specification

## Purpose

Define how reviewed technical references retain useful, accurate DHPK guidance while their content is independently reorganized and checked against authoritative sources.

## Requirements

### Requirement: REQ-1 Technical claims are supported by authoritative sources

Every retained normative technical claim in a rewritten reference SHALL be supported by a relevant official or standards-owner source. The source citation SHALL appear in or immediately adjacent to the paragraph containing the claim, with applicable version or retrieval-date details included there when needed. An unresolved claim SHALL be marked `NOT VERIFIED` or omitted rather than presented as established guidance. The change SHALL NOT create a separate source table or provenance report.

#### Scenario: An official source confirms a claim

- **WHEN** a rewritten reference states a version-sensitive technical fact
- **THEN** the affected paragraph identifies the authoritative source and any version/date needed to support the fact

#### Scenario: No suitable source is available

- **WHEN** a claim cannot be verified against an authoritative source
- **THEN** the reference marks it `NOT VERIFIED` or omits it, without presenting it as normative fact or recording it in a detached report

### Requirement: REQ-2 References preserve relevant behavior and resolve from their package owner

Each retained reference SHALL explain the behavior needed by its DHPK caller, keep project-specific guidance distinct from upstream technical facts, and resolve from its canonical package owner. Resource copies SHALL match canonical sources after the declared owner generator runs.

#### Scenario: A skill loads a rewritten reference

- **WHEN** a consumer follows a reference from the canonical skill or module
- **THEN** the link resolves and the guidance states the behavior required for that caller without relying on sibling checkout files

#### Scenario: A supporting resource is generated

- **WHEN** the declared resource owner generates package copies from canonical sources
- **THEN** each selected copy matches its canonical source and no projection requires a hand edit

### Requirement: REQ-3 Verified references remain outside the rewrite scope

The four identified Yii references SHALL be checked against their existing accepted content and source notes without being rewritten as part of this wave. A concrete unresolved mismatch SHALL block this requirement's completion and be recorded for a separately scoped decision.

#### Scenario: The four Yii references pass verification

- **WHEN** the verifier checks `ddd-lite-for-yii1.md`, `php56-php7-safe-subset.md`, `tdd-workflow-and-test-strategy.md`, and `yii1-backend-patterns.md`
- **THEN** it records their current content as verified and makes no edits to those files

#### Scenario: A concrete Yii discrepancy is found

- **WHEN** a check identifies a specific unsupported or incorrect claim in one of the four files
- **THEN** the discrepancy is recorded as unresolved and the reference is not silently rewritten within this verify-only scope
