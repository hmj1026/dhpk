# Remove the Review Gate

Status: accepted

Supersedes: [0017](0017-implement-review-gate-as-a-local-event-module.md),
[0018](0018-production-migration-observation-checkpoint.md)

## Context

The Review Gate grew into a runtime of its own: a local event module, receipt
store, host attestation, adapters for Claude, Codex, CI, and Git providers, a
workflow coordinator, a risk router, and a reviewer contract with lanes,
liveness, and confirm-only rounds. Its test surface reached roughly a quarter of
the repository suite, and every policy-wording change rippled through fixtures,
validators, and vendored Skill copies. The marketplace workflow change stalled
on this machinery instead of on shippable package work.

## Decision

Remove the Review Gate completely:

- Delete the runtime, its adapters, the workflow coordinator, the risk router,
  the reviewer contract, the review lifecycle contract, and their tests.
- Delete the Skill-local copies vendored into `harness-setup` and
  `dhpk-opsx-apply-goal`, and the `--review-gate` setup option.
- Delete the retirement-closure, skill-purpose-decision, and
  command-disposition validators, which only locked historical decisions.
- Keep the reviewer agents. Dispatching them after an implementation wave is
  recommended, not enforced; CRITICAL findings should be fixed before reporting
  done. No receipts, lanes, sentinels, or verdict sidecars remain.
- Keep the harness facade's operation receipts (`harness-receipt`,
  `receipt-primitives`, `receipt-json-primitives`); they are unrelated to
  review. The lease budget helper they need is renamed to
  `receipt-store-budget`.

## Consequences

- Tests now concentrate on installation, package generation, Skill scripts,
  shipped hooks, and release tooling.
- Review quality relies on the orchestrator following advisory policy; nothing
  blocks a reply when a reviewer was skipped.
- ADR 0025 on the marketplace workflow branch is superseded when that branch is
  rebased onto this change.
