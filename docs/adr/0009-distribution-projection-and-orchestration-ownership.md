# Distribution projection and orchestration ownership

Status: accepted

## Context

dhpk has several consumer publication surfaces. Their historical generators
mixed inventory selection, consumer adaptation, filesystem writes, rollback,
and verification. Review orchestration also coordinates workers and handoffs
while Sentinel hooks enforce review debt. Without an explicit boundary, a new
surface could become a second selection source, a second writer, or an unsafe
clearance path.

## Decision

Use one compiler-centered projection contract:

```text
Interface CLI
  -> DistributionCompiler: compile / materialize / verify
      -> surface ProjectionAdapter + ProjectionArtifactStore
          -> filesystem and consumer observations
```

`compileDistribution` returns a pure, immutable plan. The distribution
inventory, including its `projection_contract`, is the selection, ownership,
transform, destination, verification-stage, and symlink-policy SSOT. Adapters
render planned consumer-native output and observe verification results; they do
not select entries, write files, re-own artifacts, or upgrade support tiers.

`ProjectionArtifactStore` is the sole writer for managed projection trees. It
stages, validates, fingerprints, and atomically publishes the planned output.
Failed staging preserves the previously accepted artifact. Symlink policy is a
closed vocabulary (`forbid`, `contained-relative`,
`declared-source-relative`), with the last mode limited to the retained
`codex-sync` compatibility route and its plan-bound canonical source root.

`verifyDistribution` returns stage-bound evidence. Its verdict vocabulary is
closed to `PASS`, `FAIL`, `NOT_RUN`, `NOT_CONFIGURED`, `SKIP_INCOMPATIBLE`,
`BLOCKED`, and `UNAVAILABLE`; structural/package success never implies a
consumer-runtime claim or experimental-tier graduation.

Orchestration owns worker selection, dispatch, handoff, retry linkage, and
lifecycle result collection. Sentinel remains the exclusive owner of review
debt, slot/evidence eligibility, and clearance. A terminal orchestration state
with an armed Sentinel is incomplete. Projection evidence consumed by
orchestration is bound to task/session/obligation identity, stage, adapter,
plan/artifact fingerprints, scope, timestamp, and verdict.

## Consequences

- Existing CLIs remain the one public interface while surfaces migrate one at a
  time behind characterization and rollback tests.
- Generated output is attributable to one inventory plan and one physical
  writer, with deterministic evidence and no partial publish.
- Runtime support remains honest: a structural or package `PASS` is not a
  runtime probe and does not clear review debt.
- Compatibility wrappers may remain temporarily, but no second public v2 CLI
  or second Sentinel-clear implementation is introduced.

## Alternatives considered

- Sharing only utility functions while leaving selection and writes in each
  adapter: rejected because ownership and safety would continue to drift.
- Letting adapters select entries or write directly: rejected because it would
  bypass the inventory SSOT and atomic store boundary.
- A generic service owning compilation, filesystem, consumer probes, and
  reporting: rejected as a god object with unclear ports.
- Letting orchestration clear Sentinel debt: rejected because coordination and
  enforcement need independent, fail-closed ownership.

## Related decisions

- [ADR-0003 — Curate dhpk distribution surfaces](0003-curate-dhpk-distribution-surfaces.md)
- [ADR-0005 — Separate resumed-review lifecycle clearance from approval](0005-resumed-review-lifecycle-clearance.md)
- [ADR-0006 — Codex native publication artifact](0006-codex-native-publication-artifact.md)
