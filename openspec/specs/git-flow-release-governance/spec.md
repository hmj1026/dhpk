# git-flow-release-governance Specification

## Purpose
TBD - created by archiving change harden-dhpk-release-contracts. Update Purpose after archive.
## Requirements
### Requirement: Standard releases preserve develop-to-main git-flow
A standard release SHALL be prepared on a release branch cut from `develop`, reviewed through a PR to `main`, tagged only after the authorized merge, and back-merged from `main` to `develop` after publication.

#### Scenario: Release preparation starts from main
- **WHEN** an operator attempts a standard release preparation directly on `main`
- **THEN** the release tool refuses or reports the branch violation and does not prepare publication state

### Requirement: Human authorization boundaries remain intact
Release tooling SHALL NOT automatically approve or merge the release PR, create or push the release tag, or bypass protected-branch policy. Those actions require the existing explicit human authorization or authorized CI trigger.

#### Scenario: Preparation completes successfully
- **WHEN** SOURCE and PACKAGE gates pass on the release branch
- **THEN** the tool reports the exact next authorized actions without merging or tagging on its own

### Requirement: Tag workflow publishes and back-merges
An authorized `vX.Y.Z` tag workflow SHALL validate version and notes, create the GitHub release, run consumer verification, and merge `main` back into `develop` without force-pushing.

#### Scenario: Back-merge succeeds
- **WHEN** the post-release merge from `main` to `develop` is conflict-free
- **THEN** the workflow pushes the merge result and records the back-merge PASS

### Requirement: Back-merge failure is loud and recoverable
If automatic back-merge fails, the workflow SHALL fail, preserve both branches, record the conflicting refs, and print a manual recovery procedure. It SHALL NOT reset, force-push, or report lifecycle completion.

#### Scenario: Develop conflicts with released main
- **WHEN** the automated back-merge encounters conflicts
- **THEN** the job exits non-zero and directs an operator to merge `main` into a new recovery branch, resolve, test, and PR the result to `develop`

### Requirement: Published tags remain immutable
A consumer-validation failure after publication SHALL NOT move, replace, or delete the published tag. Recovery SHALL use a diagnosed patch or hotfix release.

#### Scenario: Consumer verification fails after tag publication
- **WHEN** the installed plugin cannot load the released surface
- **THEN** the release is marked unhealthy and remediation proceeds through a new version rather than rewriting the tag
