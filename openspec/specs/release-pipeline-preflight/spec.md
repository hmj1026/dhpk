# release-pipeline-preflight Specification

## Purpose

Governs how dhpk exercises the tag-only release path before merge. The release
PR runs the tag job's own verification script (`release-verify.sh`) in
dry-run mode together with the consumer gate. CI and the tag release share one
test-environment definition. The release runner derives its file scope from
release parity. Together these catch publication-shaped failures while no
immutable tag exists yet. The three proofs of ADR-0021 are unchanged.

## Requirements

### Requirement: CI and release share one test environment definition

The repository SHALL define the test-runner environment in one composite
action at `.github/actions/setup-dhpk-test-env/action.yml`. Every workflow job
that runs `tests/run-all.js` SHALL set up that environment through the action
and SHALL NOT duplicate its setup steps inline. The environment covers the
Node runtime baseline and the ripgrep binary.

#### Scenario: Release job uses the shared environment

- **WHEN** `release.yml` and `ci.yml` are inspected
- **THEN** both the `release` job and the `validate` job reference `./.github/actions/setup-dhpk-test-env`, and neither declares its own ripgrep install step

#### Scenario: A new dependency is added to the test environment

- **WHEN** a maintainer adds a tool to the composite action
- **THEN** CI and the tag release job both receive it without any workflow edit

### Requirement: Workflow policy governs composite actions

`scripts/ci/validate-workflow-policy.js` SHALL apply its immutable-SHA,
version-comment, and Node-baseline rules to every
`.github/actions/**/action.yml` file as well as to workflow files. Local
references beginning with `./` SHALL be accepted without a commit SHA.

#### Scenario: Composite action pins the wrong Node version

- **WHEN** a composite action's `actions/setup-node` step declares a Node version other than the baseline
- **THEN** the policy check fails and names the action file

#### Scenario: Composite action uses a mutable remote reference

- **WHEN** a composite action step uses a remote action without a full commit SHA
- **THEN** the policy check fails

#### Scenario: Workflow references a local composite action

- **WHEN** a workflow step uses `./.github/actions/setup-dhpk-test-env`
- **THEN** the policy check accepts the reference

### Requirement: Release verification runs from one script in tag and dry-run modes

The pre-publish verification of the tag release SHALL be implemented once in
`scripts/release/release-verify.sh`. The script covers release parity, harness
facade preflight classification, distribution package validation,
platform-package determinism, the trusted artifact manifest, release-note
extraction, the publication bundle, and verifier binding. The tag workflow
SHALL invoke the script in `tag` mode. The script SHALL write its outputs
(target commit, target tree, notes digest, verifier digest) to
`$GITHUB_OUTPUT` when that variable is set.

#### Scenario: Tag mode feeds the publish job

- **WHEN** the `release` job runs the script in `tag` mode for `vX.Y.Z`
- **THEN** the job exposes the same outputs and uploads the same run-bound artifacts that the `publish` and `consumer-verify` jobs consume today

#### Scenario: Tag mode rejects a tag outside main

- **WHEN** the script runs in `tag` mode and the tag commit is not contained in `origin/main`
- **THEN** it exits non-zero before any package or publication step

### Requirement: The release PR rehearses the tag-only path before merge

`ci.yml` SHALL run a `release-rehearsal` job only for pull requests whose base
ref is `main`. The job SHALL run `release-verify.sh` in `dry-run` mode against
the version declared in `.claude-plugin/plugin.json` and the checked-out HEAD.
Dry-run mode SHALL additionally validate the produced publication bundle with
the standalone `verify-publication-bundle.js`, as the no-checkout `publish`
job would. It SHALL then run the consumer gate against the produced artifact
manifest. The rehearsal SHALL NOT run the full test suite, SHALL NOT create a
tag or GitHub Release, and SHALL hold only `contents: read`.

#### Scenario: Feature PR into develop

- **WHEN** a pull request targets `develop`
- **THEN** the `release-rehearsal` job is skipped

#### Scenario: Release PR with a broken publication bundle

- **WHEN** a pull request targets `main` and the publication bundle fails standalone verification
- **THEN** the `release-rehearsal` job fails before the PR can be merged, and no tag exists yet

#### Scenario: Rehearsal cannot publish

- **WHEN** the `release-rehearsal` job definition is inspected
- **THEN** its permissions are exactly `contents: read`, and neither it nor dry-run mode invokes `gh release create` or `git tag`

#### Scenario: Consumer evidence is pending on the rehearsal runner

- **WHEN** the consumer gate reports `PUBLISHED_PENDING` during rehearsal
- **THEN** the job stays green and records the outcome in the step summary, while `PUBLISHED_UNHEALTHY`, `BLOCKED`, or an unexpected outcome fails the job

### Requirement: Release runner derives release file scope from release parity

`release-runner.sh prepare` SHALL, when it receives no explicit file arguments,
derive the permitted release file set from the release-parity path set.
That set is the parity manifests, the regenerated package directories, the
version-pinned docs, `CHANGELOG.md`, and deleted `changelog.d/` fragments. The
runner SHALL still refuse any changed path outside that set. Explicit file
arguments SHALL keep their existing exact-list behavior.

#### Scenario: Standard bump without file arguments

- **WHEN** `prepare-release.js write` has produced the standard version bump and the runner is invoked without files
- **THEN** the runner stages exactly the changed parity paths and proceeds

#### Scenario: Unrelated source change is present

- **WHEN** the worktree also contains a change outside the parity path set and no files are passed
- **THEN** the runner refuses and names the unrelated path

### Requirement: Local release procedure has no proof-less full-suite run

RELEASE.md and RELEASE.zh-TW.md SHALL NOT require a manual full test-suite run
between release preparation and opening the release PR. The pre-PR local step
SHALL be `prepare-release.js check`. Full-suite proofs remain the three
ADR-0021 authorities: pull-request CI, the local pre-tag publish gate, and
the tag release job.

#### Scenario: Maintainer follows the documented procedure

- **WHEN** a maintainer follows RELEASE.md from preparation to tag
- **THEN** the full suite runs exactly once locally (inside the pre-tag publish gate) and the documented runner command matches the files the bump actually changes
