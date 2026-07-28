# Make CLI worker mid-batch timeouts recoverable without self-edit fallback

Status: accepted

## Context

The `codex` and `agy` fast-worker wrappers can run a multi-file implementation batch in a
shared checkout. A process timeout can leave some assigned files complete, some changed but
not proven complete, and some untouched. A global working-tree snapshot cannot safely answer
which worker-owned files are complete when sibling workers and pre-existing changes are also
present. The previous contract also differed by backend: agy had a wrapper backstop while
Codex did not.

The recovery path must preserve the worker boundary, avoid inventing completion evidence, and
leave an explicit reconciliation obligation when the batch cannot finish safely.

## Decision

- Both wrappers use a guarded 360-second backstop, with an environment override. Exit 124
  counts as a wrapper timeout only when `timeout` or `gtimeout` actually wrapped the CLI and
  emitted evidence; a backend-native 124 remains an ordinary backend result.
- If timeout tooling is unavailable, the worker fails closed as `BLOCKED` and does not
  fabricate a timeout or switch backends.
- The policy applies only to a started multi-file batch. Single-file work and ordinary
  backend, authentication, model, missing-CLI, and verification failures keep their existing
  handling.
- Each dispatch records an exact assigned product-file list and path-scoped baseline. Its
  completion ledger partitions files into disjoint `confirmed`, `unconfirmed`, and `remaining`
  sets. Confirmation requires both an explicit backend report and scoped diff evidence.
- The first verified wrapper timeout permits exactly one fresh retry on the same backend with
  the same model, effort, intent, verifier, and scope, targeting only `remaining` and
  `unconfirmed` files. Workers do not inline-edit, expand scope, clean siblings, or substitute
  a backend.
- A second verified wrapper timeout is terminal: `PARTIAL` when any file is confirmed,
  otherwise `BLOCKED`. The report must preserve both timeout observations and the complete
  ledger.
- Before `PARTIAL`, the worker writes a durable marker at a predeclared safe control-plane
  path named `.partial-cli-batch-<backend>-<session-id>-<dispatch-id>.json`. It is separate
  from product edited-file accounting and `.pending-*` reviewer sentinels, is not auto-cleared,
  and requires explicit orchestrator or human reconciliation.
- Batches with more than six assigned product files are split by default. The threshold is a
  tunable starting guideline; an override records its reason and never expands worker scope.
- Shared state is reconciled once, sequentially, by the orchestrator after all workers and
  retries return.

## Considered options

- **Rerun the whole batch** — rejected because it repeats confirmed work and can overwrite or
  conflict with sibling edits.
- **Let the orchestrator finish files inline** — rejected because it obscures backend identity,
  weakens the worker's scope boundary, and makes completion evidence non-uniform.
- **Retry indefinitely or switch backends after timeout** — rejected because it can duplicate
  edits, hide a persistent environment failure, and change the approved execution intent.
- **Reuse reviewer `.pending-*` sentinels for partial work** — rejected because a partial batch
  is reconciliation state, not proof that a reviewer obligation was created or cleared.
- **Infer completion from global `git status`** — rejected because shared checkout state and
  pre-existing changes are not worker-owned evidence.

## Consequences

Workers can make one bounded recovery attempt while preserving backend and scope identity.
Operators receive an explicit `PARTIAL` or `BLOCKED` result and a durable reconciliation
record instead of an ambiguous timeout. The wrapper contracts, reports, marker writer, and
focused tests must be kept symmetric; implementation-task completion now waits for unresolved
partial markers to be reconciled.
