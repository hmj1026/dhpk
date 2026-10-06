# Release artifact contract

This page owns release-manifest identity and consumer probe scheduling.
Development cost comparisons and rollout observations belong in local
`docs/evidence/` records.

## Data flow

The release workflow follows one explicit identity chain:

`tag checkout → SOURCE/PACKAGE gates → trusted artifact manifest → immutable GitHub Release → manifest download → exact target/provenance/bytes/modes verification → consumer evidence`

The manifest is produced after `verify-platform-packages.js` and is uploaded as
a workflow-scoped artifact. It contains the target commit/tree, generated-input
commit/tree, public selection and dependency identity, generator/inventory
inputs, producer identity, content fingerprint, executable-mode fingerprint,
and a composite binding fingerprint for each of the four tracked package
surfaces. The consumer job refuses to probe when the manifest is missing,
foreign, stale, malformed, or no longer matches the checked-out tag.

Reuse is bound to the verified release identity. A change to source,
target, selection/profile, compiler/adapter inputs, supporting assets, bytes,
modes, producer, or version invalidates the manifest. The consumer job uses
the already verified tracked package tree; it does not regenerate package
bytes or rewrite maintainer provenance.

## Consumer probe scheduling

The supported consumer IDs are `claude-core`, `codex-sync`, `codex-native`,
`cursor-sync`, `cursor-plugin`, `agent-plugin`, and `agy-plugin`. A release
attempt records the selected acceptance scope and the independent observation
for each selected surface. Selection comes from the explicit requirements
declaration, an explicit surface option, or deterministic repository
configuration, in that order. The coordinator must not silently expand the
scope because a client CLI is present.

An explicit requirements declaration is passed unchanged to one atomic gate
invocation. Without that declaration, the coordinator may start surface-scoped
child processes with a maximum concurrency of two. Each child gets a
task/attempt/surface namespace and receipt root under a private temporary
directory. Existing probe implementations retain their own private
HOME/cache/project/sandbox behavior; host credentials are never copied.

The coordinator retains canonical selected-surface order and every validated
installation check, requirement, exclusion, raw observation, and evidence
reference, along with each child's namespace and measured wall time. Local and
custom test executors remain sequential by default; only the release workflow
opts into concurrency two. It fails closed for missing or duplicate selected observations,
foreign surfaces, malformed or conflicting checks, inconsistent child exits,
cancelled work, or timeouts. Acceptance is derived from required checks:
`FAIL` dominates, then `BLOCKED`, otherwise `PASS`. A current acceptance
`PASS` can coexist with a raw native-runtime `NOT_RUN` observation when no
native obligation was selected; it does not claim that the runtime ran. A
required native obligation that remains unavailable or unexecuted stays
`BLOCKED`.

For schema-v2 CONSUMER results, `PASS` requires process exit 0 and `FAIL` or
`BLOCKED` requires exit 1. Legacy reports without acceptance keep their
historical outcome and exit behavior, including the seven identity rows and
six required-runtime rows; `cursor-sync` remains an identity row whose `FAIL`
is unhealthy even though it is outside that legacy runtime subset. Release
summaries name the selected acceptance scope and show raw observations
separately; they do not summarize unselected surfaces as runtime `PASS`.
Publication and deployment remain independent authorized steps.

## Publication and rollback

Package generation and deterministic regeneration remain owned by the SOURCE
and PACKAGE gates. Tags and releases are immutable. Manual merge, sync-develop
lease guards, and PUBLISHED_PENDING/PUBLISHED_UNHEALTHY outcomes remain
separate from consumer probe results. Publication, deployment, login, and retry
require their own authorization. Rollback is a new release from a new target
identity; an old manifest cannot authorize it.
