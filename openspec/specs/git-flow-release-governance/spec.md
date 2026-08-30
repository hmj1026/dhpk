# git-flow-release-governance Specification

## Purpose

Governs how dhpk cuts a standard release from `develop` to `main`, publishes an
immutable `vX.Y.Z` tag, and reconciles `develop` with released `main` without
dropping post-release work or rewriting published tags.

## Requirements
### Requirement: Standard releases preserve develop-to-main git-flow
A standard release SHALL be prepared from `develop`, reviewed through a direct
PR to `main`, merged with GitHub's **Create a merge commit** method, tagged only
after the authorized merge, and reconciled with released `main` after
publication. Squash and rebase merges SHALL be rejected before tagging because
they can sever generated-input provenance.

#### Scenario: Release preparation starts from main
- **WHEN** an operator attempts a standard release preparation directly on `main`
- **THEN** the release tool refuses or reports the branch violation and does not prepare publication state

### Requirement: Human authorization boundaries remain intact
Release tooling SHALL NOT automatically approve or merge the release PR, create or push the release tag, or bypass protected-branch policy. Those actions require the existing explicit human authorization or authorized CI trigger.

#### Scenario: Preparation completes successfully
- **WHEN** SOURCE and PACKAGE gates pass on the release branch
- **THEN** the tool reports the exact next authorized actions without merging or tagging on its own

### Requirement: Tag workflow publishes and guardedly reconciles develop

An authorized `vX.Y.Z` tag workflow SHALL validate version and notes, create
the GitHub release, run consumer verification, and then reconcile `develop`
with released `main`. The workflow SHALL resolve the merged release PR head
SHA, confirm that `origin/develop` still points at that exact SHA, confirm
that `origin/main` and `origin/develop` have identical trees, and only then
align `develop` onto `main` with `--force-with-lease` pinned to that unchanged
SHA. A moved develop or differing tree SHALL fail closed and require an
explicit recovery PR.

#### Scenario: Idle develop aligns to released main

- **WHEN** the `release` job succeeded, `origin/develop` still equals the
  merged release PR head, and `git diff` between `origin/main` and
  `origin/develop` is empty
- **THEN** the workflow force-with-lease-updates `develop` to the `main` SHA
  and records an idle-align PASS

#### Scenario: Develop advances after the release PR

- **WHEN** the `release` job succeeded but `origin/develop` no longer equals
  the merged release PR head
- **THEN** the workflow exits non-zero, preserves both branch refs, and does
  not attempt an alignment

#### Scenario: Develop tree differs from released main

- **WHEN** the release PR head is unchanged but `origin/develop` has tree
  content that `origin/main` does not
- **THEN** the workflow exits non-zero, preserves both branch refs, and
  directs the operator to an explicit recovery PR

### Requirement: Reconciliation failure is loud and recoverable

If automatic reconciliation fails (expected-head mismatch, lease rejection,
or push rejection), the workflow SHALL fail, preserve both branches, record
the conflicting refs, and print a manual recovery procedure. It SHALL NOT
`reset --hard`, SHALL NOT push with bare `--force` or `-f`, SHALL NOT
force-with-lease when the trees differ, and SHALL NOT report lifecycle
completion.

#### Scenario: Develop tree recovery is required

- **WHEN** automatic reconciliation reports a moved develop or tree difference
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
