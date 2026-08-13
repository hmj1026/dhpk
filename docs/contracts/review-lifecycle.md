# Evidence-backed review lifecycle

The Claude review chain keeps its durable lifecycle state in the current
project's `.claude/artifacts/sessions/` directory. These files are session
evidence, not tracked deliverables:

| File | Purpose |
| --- | --- |
| `.lifecycle-events.jsonl` | One versioned transition record per task identity |
| `.producer-ready.jsonl` | Producer marker written after a report is durable |
| `.review-telemetry.jsonl` | Monotonic attempts, starts, verdicts, artifacts, retries, and unresolved-obligation counters |
| `.review-retry.jsonl` | Keyed one-corrected-retry budget (`max_retries: 1`) |
| `.quota-resume.jsonl` | Quota-blocked task identity and its explicit resume transition |

## Event schema

Each lifecycle event has `schema_version: 1`, a unique `event_id`,
`occurred_at`, `state`, `task_id`, `agent`, `session_id`, `attempt`,
`scope_id`, `diff_id`, `verdict`, and `artifact`. The permitted states are:

`planned → dispatched → started → artifact-ready → verdicted`

with terminal or exceptional states `failed-start`, `quota-blocked`,
`blocked`, and `incomplete`. A corrected retry is represented by `retrying`
and remains keyed to the same task/scope/diff identity. The transition library
rejects impossible edges rather than manufacturing a successful completion.

`scope_id` is a digest of the complete pending review set. `diff_id` is a
digest of the current worktree diff/status. When a report supplies
`scope_id` and `diff_id` frontmatter, both must match the dispatch identity;
missing, stale, foreign, or mismatched identity never closes that review.
The Stop-time background-reconcile fallback additionally requires the exact
session-scoped `.review-dispatch-attempts` row and matching artifact
`session_id`, `dispatch_attempt`, and `dispatch_id` provenance; a legacy report
without that tuple fails closed rather than satisfying a concurrent session's
shared canonical review glob.

## Producer and consumer boundary

The producer fsyncs the canonical review artifact and then appends an
`artifact-ready` marker containing its path and content digest. A consumer
must find that marker and the still-present artifact before consuming it. No
fixed sleep is a readiness proof. The Stop-time reconciliation safety net may
materialize a marker for a legacy/manual sentinel only after it has independently
proved that the canonical artifact is fresh.

Lifecycle clearance and approval remain separate: a `WARNING`, `BLOCK`,
`FAIL`, malformed verdict, or actionable severity can finish the lifecycle
event sequence but leaves the sentinel and/or `.unresolved-verdict` obligation
visible. Only the existing parseable `APPROVE`/`PASS` gate clears the sentinel.

## Orchestration and Sentinel ownership

Orchestration owns worker selection, dispatch, handoff, retry linkage, and
collection of lifecycle results. Sentinel hooks exclusively own review debt,
slot lookup, evidence eligibility, and sanctioned clearance through the
existing hook-owned path. A passing message or a terminal orchestration state
does not remove a sentinel. Terminal orchestration plus an armed Sentinel is
therefore **incomplete**, not delivery-ready.

Projection evidence follows the same identity discipline without changing the
reviewer verdict contract. A consumed `EvidenceResult` binds task and
dispatch/session identity, review obligation or wave, verification stage,
adapter identity/version, plan and artifact fingerprints when applicable,
timestamp, scope, and a parseable verdict. Missing, foreign, stale, or weaker
stage evidence remains unresolved.

Projection `EvidenceResult.verdict` is limited to `PASS`, `FAIL`, `NOT_RUN`,
`NOT_CONFIGURED`, `SKIP_INCOMPATIBLE`, `BLOCKED`, and `UNAVAILABLE`. Reviewer
artifact labels such as `APPROVE`, `WARNING`, `BLOCK`, or `PASS`/`FAIL` are a
separate lifecycle vocabulary; lifecycle summary codes must never be passed to
Sentinel clearance.

See the [reviewer contract](reviewer-contract.md),
[ADR-0005](../adr/0005-resumed-review-lifecycle-clearance.md), and
[ADR-0009](../adr/0009-distribution-projection-and-orchestration-ownership.md).

## Retry and quota behavior

`dhpk_lifecycle_retry_once` records one corrected retry for a keyed
`task_id/session_id/scope_id/diff_id`; a second identical attempt fails closed.
`quota-blocked` records the same task identity and `quota_resume` changes it to
`resumed` before emitting a resumed `started` event. A quota block is never
reported as completion, and an unknown or already-resumed task cannot be
silently retried.

Liveness cleanup only expires an active marker. It cannot clear a pending
review unless a fresh, canonical, identity-compatible artifact has first
produced the readiness evidence above.
