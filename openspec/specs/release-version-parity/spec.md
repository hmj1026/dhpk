# release-version-parity Specification

## Purpose
TBD - created by archiving change harden-dhpk-release-contracts. Update Purpose after archive.
## Requirements
### Requirement: One target version governs every release surface
Release preparation SHALL establish one SemVer target `X.Y.Z`. The Claude plugin manifest, root Codex manifest, Codex wrapper manifest, Codex marketplace descriptor, changelog release heading, staged package metadata, and release documentation SHALL agree with that target.

#### Scenario: One manifest drifts
- **WHEN** any version-bearing manifest differs from the target version
- **THEN** the SOURCE or PACKAGE gate fails with every mismatched file and observed value

### Requirement: Branch and tag versions match the target
A standard release branch SHALL use the repository's documented release naming convention for the target version, and the published tag SHALL be exactly `vX.Y.Z` on the authorized `main` commit.

#### Scenario: Tag version disagrees with manifests
- **WHEN** the workflow receives tag `v0.31.1` but staged manifests declare `0.31.0`
- **THEN** publication fails before creating or updating the GitHub release

#### Scenario: Tag commit is not on authorized main
- **WHEN** a release tag points to a commit that is not the approved release commit on `main`
- **THEN** release governance fails and no complete release verdict is emitted

### Requirement: Version validation has check and write modes
The release preparation tool SHALL provide a non-mutating check mode and a deterministic write mode. Write mode SHALL update only declared release metadata and changelog outputs; it SHALL report every changed file.

#### Scenario: Operator runs check mode
- **WHEN** release metadata drifts and check mode runs
- **THEN** it exits non-zero with a proposed correction list and does not modify files

### Requirement: Release parity is part of standard CI
The standard validation stack SHALL verify current manifest parity continuously, while the release workflow SHALL additionally verify branch, changelog, staged package, and tag parity for the target version.

#### Scenario: Pull request introduces manifest mismatch
- **WHEN** a PR changes one release manifest version without the other declared version surfaces
- **THEN** CI fails before the release workflow is reached
