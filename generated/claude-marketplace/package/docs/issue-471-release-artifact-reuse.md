# Issue #471 release artifact reuse and consumer probe cost

## Data flow

The release workflow now follows one explicit identity chain:

`tag checkout → SOURCE/PACKAGE gates → trusted artifact manifest → immutable GitHub Release → manifest download → exact target/provenance/bytes/modes verification → consumer evidence`

The manifest is produced after `verify-platform-packages.js` and is uploaded as
a workflow-scoped artifact. It contains the target commit/tree, generated-input
commit/tree, public selection and dependency identity, generator/inventory
inputs, producer identity, content fingerprint, executable-mode fingerprint,
and a composite binding fingerprint for each of the four tracked package
surfaces. The consumer job refuses to probe when the manifest is missing,
foreign, stale, malformed, or no longer matches the checked-out tag.

This is identity-bound reuse, not a generic PASS cache. A change to source,
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

The batch keeps canonical surface order in the aggregate, records per-probe
namespace and measured wall time, and fails closed for missing, duplicate,
foreign, malformed, conflicting, cancelled, or timed-out results. Local and
custom test executors remain sequential by default; only the release workflow
opts into concurrency two.

## Cost and rollout evidence

The #467 baseline measured the release path as separate SOURCE/PACKAGE gates,
tag publication, and post-publish consumer verification. The material
improvement in this change is limited to the independent post-publish probes:
the prior harness loop waited for all seven surface processes serially; the
release runner now uses at most two isolated processes at once. The coordinator
reports `wallTimeMs`, `concurrency`, timeout, and namespaces so a tag run can
compare probe wall time without conflating package generation, deterministic
regeneration, full regression, publication, or develop reconciliation.

Package generation and deterministic regeneration remain owned by the SOURCE
and PACKAGE gates. Immutable tags/releases, manual merge, sync-develop lease
guards, and PUBLISHED_PENDING/PUBLISHED_UNHEALTHY outcomes are unchanged.
There is no automatic tag, deployment, login, or retry side effect in this
change. Rollback is a new release from a new target identity; an old manifest
cannot authorize it.
