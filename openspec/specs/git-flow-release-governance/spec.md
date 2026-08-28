# git-flow-release-governance Specification

## Purpose

Governs how dhpk cuts a standard release from `develop` to `main`, publishes an
immutable `vX.Y.Z` tag, and reconciles `develop` with released `main` without
dropping unique develop work or rewriting published tags.

## Requirements
### Requirement: Standard releases preserve develop-to-main git-flow
A standard release SHALL be prepared on a release branch cut from `develop`, reviewed through a PR to `main`, tagged only after the authorized merge, and reconciled with released `main` after publication (idle-align when trees match, or `--no-ff` when they differ).

#### Scenario: Release preparation starts from main
- **WHEN** an operator attempts a standard release preparation directly on `main`
- **THEN** the release tool refuses or reports the branch violation and does not prepare publication state

### Requirement: Human authorization boundaries remain intact
Release tooling SHALL NOT automatically approve or merge the release PR, create or push the release tag, or bypass protected-branch policy. Those actions require the existing explicit human authorization or authorized CI trigger.

#### Scenario: Preparation completes successfully
- **WHEN** SOURCE and PACKAGE gates pass on the release branch
- **THEN** the tool reports the exact next authorized actions without merging or tagging on its own

### Requirement: Tag workflow publishes and reconciles develop

An authorized `vX.Y.Z` tag workflow SHALL validate version and notes, create
the GitHub release, run consumer verification, and then reconcile `develop`
with released `main`. When `origin/main` and `origin/develop` have identical
trees, the workflow SHALL align `develop` onto `main` with
`--force-with-lease` pinned to the fetched develop SHA. When the trees differ,
the workflow SHALL merge `main` into `develop` with `--no-ff` and push the
merge result without force.

#### Scenario: Idle develop aligns to released main

- **WHEN** the `release` job succeeded and `git diff` between `origin/main`
  and `origin/develop` is empty
- **THEN** the workflow force-with-lease-updates `develop` to the `main` SHA
  and records an idle-align PASS

#### Scenario: Unique develop work keeps a conflict-loud back-merge

- **WHEN** the `release` job succeeded and `origin/develop` has tree content
  that `origin/main` does not
- **THEN** the workflow performs a `--no-ff` merge of `main` into `develop`,
  pushes without force, and records the back-merge PASS

### Requirement: Back-merge failure is loud and recoverable

If automatic reconciliation fails (merge conflict, lease rejection, or push
rejection), the workflow SHALL fail, preserve both branches, record the
conflicting refs, and print a manual recovery procedure. It SHALL NOT
`reset --hard`, SHALL NOT push with bare `--force` or `-f`, SHALL NOT
force-with-lease when the trees differ, and SHALL NOT report lifecycle
completion.

#### Scenario: Develop conflicts with released main

- **WHEN** the automated `--no-ff` back-merge encounters conflicts
- **THEN** the job exits non-zero and directs an operator to merge `main`
  into a new recovery branch, resolve, test, and PR the result to `develop`

#### Scenario: Lease rejects a concurrent develop push

- **WHEN** `origin/develop` moved after the job fetched it and the idle-align
  `--force-with-lease` is rejected
- **THEN** the job exits non-zero, leaves both branches unchanged, and does
  not retry with a weaker force

### Requirement: Published tags remain immutable
A consumer-validation failure after publication SHALL NOT move, replace, or delete the published tag. Recovery SHALL use a diagnosed patch or hotfix release.

#### Scenario: Consumer verification fails after tag publication
- **WHEN** the installed plugin cannot load the released surface
- **THEN** the release is marked unhealthy and remediation proceeds through a new version rather than rewriting the tag
