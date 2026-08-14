# release-changelog-fragment-integrity Specification

## Purpose
TBD - created by archiving change harden-dhpk-release-contracts. Update Purpose after archive.
## Requirements
### Requirement: User-visible changes carry release fragments
Every user-visible feature, fix, deprecation, or breaking change merged after policy activation SHALL include one uniquely named release fragment with a valid category and non-empty note. Internal-only changes SHALL use the documented no-fragment classification rather than an empty fragment.

#### Scenario: User-visible change lacks a fragment
- **WHEN** release preparation includes a user-visible change with no valid fragment
- **THEN** the SOURCE release gate fails and identifies the uncovered change

#### Scenario: Internal-only change is classified
- **WHEN** a change affects only tests, refactoring, or internal tooling and declares the accepted no-fragment classification
- **THEN** fragment validation passes without adding an empty changelog entry

### Requirement: Fragment promotion is deterministic
Release preparation SHALL sort valid fragments deterministically, render them into the existing `CHANGELOG.md` release format, and consume exactly the fragments included in that release. Running preparation twice against unchanged inputs SHALL produce identical output.

#### Scenario: Same fragments are prepared twice
- **WHEN** release preparation runs twice with the same target version, date, and fragments
- **THEN** the generated changelog section is byte-identical and contains no duplicate notes

### Requirement: Release notes are non-empty and extractable
The target changelog section SHALL use the release workflow's supported heading format and SHALL contain at least one rendered note or an explicit approved no-user-visible-change statement. CI extraction of release notes SHALL fail when it returns empty content.

#### Scenario: Changelog heading exists but body is empty
- **WHEN** the target version heading has no extractable release-note body
- **THEN** release preparation and release CI fail before publishing

### Requirement: Orphan fragments block release completion
After changelog promotion, no fragment selected for the release SHALL remain unconsumed, and no fragment assigned to an earlier version SHALL remain in the pending fragment directory.

#### Scenario: Fragment was omitted from the changelog
- **WHEN** a pending fragment is in release scope but absent from the rendered section
- **THEN** fragment-integrity validation fails with its filename
