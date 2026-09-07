# Evidence-backed review lifecycle

The Claude review chain keeps its durable lifecycle state in the current
project's `.claude/artifacts/sessions/` directory. These files are session
evidence, not tracked deliverables:

| File | Purpose |
| --- | --- |
| `.lifecycle-events.jsonl` | One versioned transition record per task identity |
| `.producer-ready.jsonl` | Producer marker written after a report is durable |
| `.review-telemetry.jsonl` | Monotonic attempts, starts, verdicts, artifacts, retries, and unresolved-obligation counters |
| `.accepted-outcome-cost.jsonl` | Observe-only, redacted cost observations emitted after a semantic verdict |
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

The Accepted-Outcome Cost collector observes the already-appended lifecycle
event stream after a `verdicted` transition. It records derived dispatch,
semantic-review, remediation, and elapsed counters plus optional model-token,
human-turn, false-block, and receipt-reuse measurements. Unavailable counters
remain `null`; malformed or unavailable telemetry is explicit, and partial or
failed observations are excluded from retirement decisions. Collection is
best-effort and cannot clear a Sentinel, change a verdict, or block the existing
lifecycle path.

## Claude Review Gate observation

During the canonical `BASELINE` and `OBSERVE` paths, Claude review evidence is
translated only after the existing hook-owned lifecycle has completed. The
caller explicitly invokes the Claude Review Gate adapter with its canonical
Review Plan, Review Request, structured Review Result, durable
lifecycle/readiness events, and the legacy Sentinel outcome. The adapter is not
wired into the deterministic hooks and cannot create a plan, select a lane,
clear or arm a Sentinel, or promote a migration phase.

For compatibility with the prior adapter contract, `BASELINE` alone may also
record an old bounded Sentinel snapshot that has no lifecycle/readiness events
and carries the legacy numeric `cost` view. The adapter records no lifecycle ID
for that snapshot and derives a canonical Accepted-Outcome Cost record with
unavailable metrics left `null`, `PARTIAL` telemetry, and retirement eligibility
disabled. This compatibility path is diagnostic only; `OBSERVE` continues to
require complete durable evidence and never accepts the empty-evidence shape.

The adapter requires the same `task_id`, `attempt_id`, attempt number,
`session_id`, dispatch ID, `scope_id`, and `diff_id` across the supplied
identity and durable evidence. Missing or foreign readiness fails closed.
The Sentinel summary must name the unique same-identity terminal lifecycle
event, and its verdict must match that event. Accepted-Outcome Cost uses the
canonical `dhpk.accepted-outcome-cost.v1` record, whose observation ID is
derived from the same task and whose accepted outcome matches the terminal
verdict. All eight canonical metrics, including unavailable `null` values, are
preserved.
Process IDs, active markers, and heartbeat state are compatibility-only
liveness signals and never satisfy target evidence continuity.

`BASELINE` records a bounded, redacted Sentinel observation without invoking
Review Gate. `OBSERVE` also evaluates the caller-supplied structured result
through Review Gate, which may persist a typed `review` receipt for diagnostic
target computation, then records the comparison as a `migration-observation`
receipt. Its stable Review Gate event ID is bound into that observation; during
`OBSERVE`, the persisted review receipt itself is marked `OBSERVE_ONLY`, so an
interrupted comparison write cannot leave an enforceable orphan. Workflow
Coordinator ignores only receipts carrying that Review Gate-validated effect;
a migration observation cannot suppress a normal review. The phase control and
exact identity binding keep Sentinel authoritative. In
both phases the Migration Coordinator fixes authority to `SENTINEL`, fixes
target progress and all clearance/blocking effects to false, and provides no
automatic phase-promotion operation. An agreement or disagreement is
diagnostic only.

Persisted observation provenance is limited to stable identities, enum values,
digests, bounded symbolic references, timestamps, and counters. Absolute
artifact paths, artifact bodies, prompts, raw commands, shell output, logs,
credentials, and session transcripts are excluded. A migration observation is
never converted into synthetic Sentinel clearance and cannot itself satisfy a
required review or change-control gate.

## Codex Review Gate submission

Codex has no legacy Sentinel, hook-based dispatch, or pending-file/SubagentStop
mechanism to observe or compare against, so the Codex Review Gate adapter
(`scripts/lib/codex-review-gate-adapter.js`) is not a migration-observation
bridge. It shares the same `ReviewGate.handle()`/`ReceiptStore` write path and
`review` receipt kind that the Claude adapter's OBSERVE-phase diagnostic
evaluation also uses, but it produces no `migration-observation` receipt, no
`sentinelOutcome`, no `comparison` (`AGREE`/`DISAGREE`/`INDETERMINATE`), and
has no `MigrationCoordinator` involvement: Codex has nothing legacy to
reconcile against, so none of that comparison vocabulary applies. Given an
already-registered plan (the `PLAN_REGISTERED` event `scripts/lib/review-gate.js`
projects before any `REVIEW_RESULT_RECORDED` event for the same wave is
accepted), a reviewer-contract v2
Review Request and Review Result, and durable lifecycle/readiness events for the
exact same identity, it submits the same `REVIEW_RESULT_RECORDED` event shape
the Claude adapter uses directly to that shared
`ReviewGate.handle()`/`ReceiptStore`. For a `COMPLETE` + `REQUIRED` result, the
adapter additionally requires an `artifact-sha256:` reference bound to the
readiness digest; incomplete or `NOT_APPLICABLE` results keep their contract
axes without manufacturing that artifact binding.

The adapter is inert until explicitly activated. Its `activation` constructor
option defaults to `INACTIVE`, in which state `record()` refuses to run and
`capabilities()` reports `effect: 'DISABLED'`. Constructing it with
`activation: 'ACTIVE'` reports `effect: 'OBSERVE_ONLY'` and allows submission;
the persisted `REVIEW_RESULT_RECORDED` event itself carries that same
`effect: 'OBSERVE_ONLY'`, so Workflow Coordinator ignores it exactly as it
ignores the Claude adapter's `OBSERVE_ONLY` events. The returned receipt
likewise always fixes `authority: 'SENTINEL'`,
`authorizesApproval: false`, `clearsSentinel: false`, `blocksSentinel: false`,
and `allowsTargetProgress: false` regardless of the Review Gate outcome —
Sentinel remains authoritative until a separately approved, measured cutover
changes it. The adapter never registers a plan, selects a lane, or chooses an
obligation; it binds to the `obligationId`/`lane` the caller's Review Result
already names, exactly as the Claude adapter does. Normal `PASS`,
`CHANGES_REQUIRED`, `UNAVAILABLE`, and receipt-reuse submissions therefore
reach the caller with the same `{executionStatus, applicability,
semanticVerdict}` triple the shared Review Gate produced. Canonical
`NOT_APPLICABLE` is the empty-plan registration path: `ReviewGate` accepts that
plan with `EMPTY_DIFF`, no obligation, no review request, and no receipt, so it
does not enter `record()` as a synthetic obligation/result. Both adapters
delegate applicable submissions to the identical injected `ReviewGate` rather
than re-deriving its judgment.

## Receipt Bundle transport and post-merge delivery evidence

Runtime receipts are never committed. `scripts/lib/review-gate-receipt-bundle.js`
exports a provider-neutral, redacted, content-addressed Receipt Bundle from an
already-validated evidence set: every receipt is redacted with the shared
`redactEvidence` primitive, and the bundle carries the evidence's bound source
commit/tree, policy/contract versions, and a `sha256` digest over the redacted
receipts. Importing a bundle re-validates every receipt through the same
`evaluateReceipts` trust and schema checks, rejects an unsupported major
schema, recomputes and compares the digest before trusting bundle contents,
and — when the caller supplies an `expectedIdentity` — rejects a bundle bound
to a foreign commit or tree. A bundle is never trusted before all three checks
pass; without a configured transport, there is simply nothing to import, and
delivery evidence stays absent rather than assumed.

CI and Git-provider observations translate only into `verification` receipts,
never `review`: `scripts/lib/ci-review-gate-adapter.js` emits a `LOCAL_GATE`
verification for a CI run, bound to whatever commit its caller names (a
pull-request head commit or, reused unchanged, a post-merge commit). Because
review and verification are independent lanes in `WorkflowCoordinator`, a
CI-emitted verification receipt can satisfy only its own verification lane
and can never substitute for semantic review. `scripts/lib/git-provider-review-gate-adapter.js`
emits a `PROVIDER_MERGE` verification observing that a commit was merged;
this is deliberately not an `authority` receipt, whose fixed shape
(`reason`/`risk`/`approver`/`skippedGate`/`remediation`) is reserved for a
scope-bound Override Authority Receipt and does not fit a routine merge
observation.

A merge commit is a different Git identity from the reviewed head commit that
`WorkflowCoordinator.reduce()` evaluates, and `evaluateReceipts` fails closed
(`STALE_EVIDENCE`) on any receipt set spanning two source commits. Post-merge
delivery evidence is therefore evaluated as a second, independent receipt set
through `WorkflowCoordinator.reduceDelivery()`, never folded into `reduce()`.
Given a `PROVIDER_MERGE` verification and a post-merge `LOCAL_GATE`
verification bound to the same merge commit, both observed as `PASS` or
`COMPLETE`, `reduceDelivery()` reports `ARCHIVE_READY` with
`completion.delivery: 'COMPLETE'`; either missing or unobserved keeps
`POST_MERGE_PENDING` with a `MERGE_UNOBSERVED` or `POST_MERGE_CI_UNOBSERVED`
reason code. `reduce()`'s own `completion.implementation` is unaffected by
`reduceDelivery()` running at all, so a missing transport can never overstate
local Implementation Complete as Delivery Complete.

Separately, `reduce()` now also derives `authorizesPullRequest`: once a
decision reaches `MERGE_READY`, this projection field reflects the decision's
existing `deliveryAuthorized` flag. This changes no enforcement effect —
`control.authority` stays `SENTINEL` and `control.allowsTargetProgress` stays
`false` in every case, exactly as the Claude and Codex OBSERVE-phase
adapters do; it is a derived read of already-validated decision evidence, not
a new authority.

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
[ADR-0005](../adr/0005-resumed-review-lifecycle-clearance.md),
[ADR-0009](../adr/0009-distribution-projection-and-orchestration-ownership.md),
[ADR-0016](../adr/0016-phase-and-roll-back-review-gate-migration.md) for the
`BASELINE`/`OBSERVE`/`MigrationCoordinator` phase vocabulary the Claude
section above uses, and
[ADR-0017](../adr/0017-implement-review-gate-as-a-local-event-module.md) for
the `ReviewGate`/`ReceiptStore` event module both adapter sections describe.

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
