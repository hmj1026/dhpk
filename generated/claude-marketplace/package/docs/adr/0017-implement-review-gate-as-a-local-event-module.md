# Implement Review Gate as a local event module

Status: accepted

Implementation status: target design accepted; no Review Gate runtime or
adapter migration is implemented by this ADR alone.

## Context

The replacement for hook-backed Sentinel state must work across Claude, Codex,
CI, and Git providers without becoming an always-on service or a second mutable
state machine. dhpk already has dependency-free Node receipt primitives for
canonical JSON, hashing, immutable writes, append locking, Git binding,
redaction, replay validation, and rollback ownership.

## Decision

Separate five physical boundaries:

- `RiskRouter.plan(workRecord, policy)` returns an immutable Review Plan;
- `ReviewGate.handle(reviewEvent)` validates the event and returns a Gate
  Decision plus Evidence Receipts;
- `ReviewGate.inspect(workId | waveId)` returns derived Review Gate status;
- `WorkflowCoordinator.reduce(receipts)` derives Workflow State; and
- `ReceiptStore` persists and replays events and receipts.

Risk Router selects applicable lanes. Review Gate owns Review Obligation and
receipt lifecycle only. Workflow Coordinator owns end-to-end state. Platform
Adapters translate observations and projections. None of these boundaries may
judge code quality, clear debt imperatively, or take another boundary's
authority. Do not expose `clearSentinel`, arbitrary `markPassed`, or evidence
deletion APIs.

Implement the core as dependency-free Node modules with immutable inputs and
outputs plus a thin CLI facade. Shell hooks become adapter wrappers. Do not add
a daemon, SQLite, or native dependency. Extract and generalize the proven
receipt primitives from `scripts/lib/harness-receipt.js` instead of creating a
parallel hashing, identity, locking, or redaction implementation.

Use a repository-local append-only content-addressed store rooted at
`.dhpk/review-gate/v1/`, with immutable objects, per-work sequenced events,
rebuildable heads, and per-work locks. Canonical JSON and SHA-256 identify
objects. Atomic exclusive claims, expected revisions, and leases make duplicate
or concurrent events idempotent and prevent foreign-session clearance. Receipts
and events are never edited; invalidation is a new event and the head is only a
rebuildable projection.

Content hashes provide integrity, not authority. Record producer, adapter,
session, commit and tree, and provider-run provenance. Trust policy decides
which configured adapter may contribute each receipt kind. Unknown producers
and unknown major schemas fail closed; compatible additional fields are
preserved. Policy and Reviewer Contract versions participate in freshness, and
schema migrations append conversion events rather than rewriting history.
For the public filesystem-backed `review-gate-runtime observe` boundary, require
a host-issued cross-trust attestation envelope before a direct `ENFORCE`
observation can authorize target progress. The envelope is verified using the
configured host key and binds the prepared plan plus the four evidence-file
digests. Programmatic `ReviewGate`, adapter, and `WorkflowCoordinator` calls
are trusted in-process ports and do not require this filesystem transport
attestation. The envelope is not a reviewer-issued approval or a replacement
for the Review Gate result.

Platform Adapters may translate only:

- Claude hooks to Review Events and temporary Sentinel projections;
- Codex orchestration and reviewer results to the same contract;
- CI results to verification receipts; and
- Git-provider merge and check observations to authority or verification
  receipts.

Adapters cannot select lanes, redefine verdicts, or clear obligations. They
report their supported schema and contract capabilities at startup.

Do not commit runtime receipts. Export a provider-neutral, redacted,
content-addressed Receipt Bundle through a configured check-run, CI artifact,
or provider attachment. A remote gate imports it only after verifying commit or
tree identity, hashes, and producer trust. Without a configured transport the
workflow may reach Implementation Complete, but cannot claim remote delivery
evidence.

Do not provide manual clearance. A hard-rule exception requires an expiring,
scope-bound Override Authority Receipt naming the obligation or wave, reason,
risk, approver, skipped gate, and remediation. It remains an exception and
never becomes a synthetic reviewer `PASS`.

Persist only structured state, hashes, timestamps, bounded command summaries,
verdicts, redacted evidence references, and cost counters. Do not persist
prompts, chain-of-thought, secrets, full source, or complete logs. External
artifact retention owns bulky logs; receipts contain only their digest and
reference. Calibrate retention from observed needs instead of selecting an
arbitrary duration before migration telemetry exists.

Implement in this order: characterize current Sentinel safety cases; extract
receipt primitives; build pure Risk Router, Review Gate, Receipt Store, and
Workflow Coordinator; implement Claude `OBSERVE` and Codex native adapters in
parallel after contracts stabilize; run differential conformance; advance the
ADR-0016 phases; retire reviewer lifecycle hooks; and remove compatibility
schemas only during `CLEANUP`.

The conformance suite covers every state transition and fail-closed invariant,
deterministic replay, duplicate and out-of-order events, concurrent sessions,
crash and stale-lease recovery, foreign receipts, schema behavior, redaction,
and adapter parity. Claude and Codex run the same suite. Preserve at least 80%
coverage, but require complete branch coverage for named safety invariants and
carry forward the current focused Sentinel cases into the differential corpus.

## Consequences

- Platform-specific hooks become replaceable transport and compatibility
  adapters instead of lifecycle authorities.
- The append-only store can explain every derived state and recover after a
  process or session interruption without a service dependency.
- Existing receipt mechanics are deepened into a shared capability rather than
  duplicated for Review Gate.
- Remote receipt reuse requires a configured trusted transport; local success
  cannot silently imply remote or provider evidence.

## Alternatives considered

- Put routing, review judgment, workflow state, and persistence into Review
  Gate: rejected as a god object with overlapping authority.
- Replace Sentinel files with a mutable JSON or SQLite status record: rejected
  because it hides transitions and adds concurrency or packaging complexity.
- Require signatures on every receipt immediately: rejected because the
  filesystem-backed `observe` boundary has its separate host attestation, while
  trusted in-process ports use configured producer trust; signing every local
  receipt would add a second key lifecycle without strengthening those paths.
- Commit receipts to the implementation branch: rejected because runtime state,
  logs, and provider evidence do not belong in source history.
- Keep a manual clear command: rejected because an unaudited bypass recreates
  the ambiguity Review Gate is intended to remove.

## Related decisions

- [ADR-0005 — Separate resumed-review lifecycle clearance from approval](0005-resumed-review-lifecycle-clearance.md)
- [ADR-0011 — Adopt one risk-adaptive workflow](0011-adopt-one-risk-adaptive-workflow.md)
- [ADR-0013 — Migrate Sentinel to evidence receipts](0013-migrate-sentinel-to-evidence-receipts.md)
- [ADR-0014 — Standardize the reviewer contract](0014-standardize-the-reviewer-contract.md)
- [ADR-0015 — Derive workflow state from typed receipts](0015-derive-workflow-state-from-typed-receipts.md)
- [ADR-0016 — Phase and roll back Review Gate migration](0016-phase-and-roll-back-review-gate-migration.md)
