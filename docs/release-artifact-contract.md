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

The canonical contract remains seven identity rows and six required-runtime
rows. `cursor-sync` stays an identity/health row outside the required-runtime
list. On the authorized ephemeral release runner, the coordinator starts
surface-scoped child processes with a maximum concurrency of two. Each child
gets a task/attempt/surface namespace and receipt root under a private
temporary directory. Existing probe implementations retain their own private
HOME/cache/project/sandbox behavior; host credentials are never copied, and
network or client availability remains `UNAVAILABLE`, `BLOCKED`, or `NOT_RUN`
according to the existing adapter contract.

The coordinator keeps canonical surface order in the aggregate, records
per-probe namespace and measured wall time, and fails closed for missing, duplicate,
foreign, malformed, conflicting, cancelled, or timed-out results. Local and
custom test executors remain sequential by default; only the release workflow
opts into concurrency two.

## Publication and rollback

Package generation and deterministic regeneration remain owned by the SOURCE
and PACKAGE gates. Tags and releases are immutable. Manual merge, sync-develop
lease guards, and PUBLISHED_PENDING/PUBLISHED_UNHEALTHY outcomes remain
separate from consumer probe results. Publication, deployment, login, and retry
require their own authorization. Rollback is a new release from a new target
identity; an old manifest cannot authorize it.
