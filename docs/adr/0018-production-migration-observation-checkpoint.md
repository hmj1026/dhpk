# Production Migration Observation Checkpoint

Status: accepted

Implementation status: target design accepted; the checkpoint is opt-in and
does not change Sentinel authority until an ADR-0016 phase transition.

## Context

The Review Gate core and Claude adapter can validate migration evidence, but a
consumer needs an explicit production composition boundary that connects a
canonical Work Request, the risk-routed review plan, reviewer output, and the
existing lifecycle evidence. Wiring that boundary into deterministic hooks
would give migration telemetry an unintended authority over Sentinel. Asking
the adapter to dispatch reviewers would also blur the ownership boundary
between the [Application Session](../../CONTEXT.md#application-session) and a Platform Adapter.

Migration evidence must therefore be collected at a deliberate checkpoint
after the review lifecycle has produced durable evidence. The checkpoint must
remain useful when telemetry is incomplete, while preventing partial samples
from satisfying the ADR-0016 retirement gate.

## Decision

Provide one dependency-free Node CLI, `scripts/review-gate-runtime.js`, as the
production composition boundary. It has four explicit operations:

- `init` is the setup operation. `/dhpk:setup --review-gate` opts a consumer
  into local migration observation and creates
  `.dhpk/review-gate/v1/integrity.key` with private permissions. Setup creates
  the key exactly once, never overwrites an existing regular key, and never
  creates it lazily from `prepare`, `observe`, or `status`.
- `prepare` consumes the canonical Work Request JSON, creates the Work Record,
  runs the Risk Router, registers the resulting Review Plan, and returns one
  Review Request per applicable obligation and lane. It does not dispatch a
  reviewer.
- `observe` is invoked explicitly by the Application Session after the
  reviewer batch has completed and lifecycle/readiness/cost evidence is
  durable. It validates the structured companion result, invokes the existing
  Claude Platform Adapter once per obligation/lane in deterministic order, and
  records the migration observation through Migration Coordinator. Reviewer
  dispatch stays with the Application Session; the adapter only translates
  observations.
- `status` reports the configured phase, plan/checkpoint identities, and
  bounded diagnostic state. It never promotes a phase or clears a Sentinel.

Every JSON result uses the `dhpk.review-gate.runtime.v1` envelope and carries
the command, a bounded status, and only redacted references to durable state.
The `prepare` result exposes the registered plan identity and the immutable
per-obligation Review Requests. The `observe` result exposes the selected
obligation, comparison/effect, migration observation identity, telemetry
state, and any named failure codes; it does not expose prompts, raw logs, or
credentials. Missing, foreign, stale, or malformed identities are rejected
closed rather than repaired by inference.

The reviewer batch writes a Markdown artifact for humans and a structured
companion JSON with the same artifact stem. The companion uses schema
`dhpk.claude-review-result.v1` and contains only:

```json
{
  "schema": "dhpk.claude-review-result.v1",
  "requestDigest": "sha256:<hex>",
  "reviewResult": { "<dhpk.reviewer-contract.v2 fields>": "..." },
  "artifact": {
    "sha256": "sha256:<hex>",
    "identity": {
      "taskId": "task-example",
      "attemptId": "attempt-example",
      "attempt": 1,
      "sessionId": "session-example",
      "dispatchId": "dispatch-example",
      "scopeId": "scope-example",
      "diffId": "diff-example"
    }
  },
  "command": {
    "sha256": "sha256:<hex>",
    "outcome": "<bounded command outcome>"
  }
}
```

`reviewResult` is validated as the unchanged Reviewer Contract v2 object; the
companion cannot redefine its verdict axes or findings. The artifact digest
and identity bind the companion to the durable readiness evidence. The command
digest and outcome prove only the bounded command observation. `command.outcome`
is exactly one of `PASS`, `FAIL`, `NOT_RUN`, `NOT_CONFIGURED`,
`SKIP_INCOMPATIBLE`, `BLOCKED`, or `UNAVAILABLE`. `CHANGES_REQUIRED` remains a
Reviewer Contract v2 `reviewResult.semanticVerdict`; command execution state
must not be translated into that semantic verdict. Markdown is not parsed into
a verdict, and a post-hoc model translation is not accepted. All seven
configured Sentinel reviewer lanes may produce this companion shape; the lanes
remain parallel at dispatch time and observations remain at the current
per-obligation/lane grain.

The migration phase and trust policy are versioned configuration inputs. A
caller cannot override them to enter `DUAL_ENFORCE` or `CUTOVER`, and the CLI
never promotes a phase automatically. The companion and migration observation
are diagnostic and do not clear, arm, or otherwise alter Sentinel. If a CLI
operation fails, it exits nonzero and writes a redacted diagnostic sidecar;
the Application Session continues the Sentinel lifecycle. A later enforcing
phase treats an absent, foreign, stale, malformed, or failed observation as
unresolved and fails closed.

Telemetry preserves the existing Accepted-Outcome Cost shape. Missing or
unavailable counters are represented as `null` with named failure reasons;
partial and failed observations remain visible for diagnosis but set
`retirementEligible: false`. This change records one observation per
obligation/lane. Wave-level aggregation and retirement deduplication are
deferred to #375 rather than being silently introduced here.

### Local store budget and filesystem boundary

The package-local receipt store applies these exact immutable ceilings before
allocating or persisting another record:

- `revisions`: 10,000 sequence records per work;
- `receiptsPerSequence`: 200 receipt references in one sequence;
- `receiptsPerWork`: 10,000 receipt references across one work, counting
  repeated content digests as separate dereferences;
- `replayBytesPerWork`: 16 MiB across sequence bytes and every event/receipt
  object dereference during one replay;
- `leaseClaims` and `leaseReleases`: 20,000 journal entries each; and
- `leaseRecordBytes`: 4 KiB for every encoded lease record.

Each persisted store JSON entry is also bounded to 1 MiB. A prospective append
is accounted after duplicate detection, so an exact duplicate at the 10,000th
revision remains idempotent while a new 10,001st revision fails closed. Lease
enumeration is bounded before decoding and retains only the current generation,
current claim, and release state rather than an unbounded claims array. Budget
failures use stable redacted error codes and never echo record payloads.

The store trusts a local filesystem namespace that is not continuously mutated
by a hostile same-UID actor. Standard Node filesystem operations capture and
revalidate root and ancestor identities, require numeric non-zero
`O_NOFOLLOW` and `O_NONBLOCK` flags for bounded reads, bind opened descriptors
to `lstat`/`fstat` device and inode identities, and use exclusive private
temporary files for immutable writes. This blocks static, persistent, and
deterministic symlink/FIFO/ancestor swaps without `/proc`, a daemon, a native
addon, or a shell helper. No portable package-local API can guarantee safety
against a hostile actor that wins every continuous same-UID race; such a
namespace is outside this boundary and must be treated as untrusted.

Oversized or otherwise invalid legacy histories fail closed and are not
silently truncated. Orphaned content-addressed objects left after a failed
append are retained; garbage collection is deferred to a separately
authorized change.

## Consequences

- Sentinel remains the sole authority while the checkpoint is enabled in
  `BASELINE` or `OBSERVE`, so telemetry can be deployed without an implicit
  cutover.
- Application Session ownership keeps dispatch policy, batching, retries, and
  lifecycle completion outside the adapter; the adapter remains a translation
  boundary.
- Structured companions make review evidence machine-validatable without
  parsing prose, while bounded hashes and identities prevent raw prompts,
  logs, source, secrets, or absolute paths from becoming runtime state.
- Explicit setup and a non-overwritten local integrity key make activation
  auditable, but require an operator to opt in before any observation exists.
- Partial telemetry is honest and non-blocking for the current Sentinel path,
  but cannot contribute to Sentinel retirement until the required sample is
  complete.

## Alternatives considered

- Wire observation into the deterministic hooks: rejected because hook-owned
  Sentinel lifecycle and migration telemetry would become one authority.
- Let the Platform Adapter dispatch reviewers: rejected because Application
  Session owns reviewer selection, parallel batching, retries, and completion.
- Parse Markdown or ask a model to translate Markdown after the run: rejected
  because prose is not a stable machine contract and can hide identity drift.
- Generate the integrity key lazily: rejected because an accidental first
  observation would silently opt a consumer into migration state.
- Aggregate and retire observations at wave level in this change: rejected;
  #375 owns wave-level aggregation and deduplication.

## Related decisions

- [ADR-0014 — Standardize the reviewer contract](0014-standardize-the-reviewer-contract.md)
- [ADR-0015 — Derive workflow state from typed receipts](0015-derive-workflow-state-from-typed-receipts.md)
- [ADR-0016 — Phase and roll back Review Gate migration](0016-phase-and-roll-back-review-gate-migration.md)
- [ADR-0017 — Implement Review Gate as a local event module](0017-implement-review-gate-as-a-local-event-module.md)
