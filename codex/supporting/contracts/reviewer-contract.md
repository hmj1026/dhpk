# Codex Reviewer Contract v2

Contract version: `dhpk.reviewer-contract.v2`

This is the Codex projection of the platform-neutral Reviewer Contract. It can
be exercised beside current host behavior, but does not change runtime
authority. Compatibility translation observes existing evidence; it is never a
new approval or lifecycle clearance.

The shared conformance example is
`tests/fixtures/review-gate/reviewer-contract-v2.json` in the source repository.

## Review Request

An immutable request binds `decisionId`, `waveId`, `obligationId`, `lane`,
`scope`, `baseIdentity`, `headIdentity`, `diff`, `materialRisks`,
`governingInputs`, `exclusions`, `priorFindings`, and `contractVersion`. The
version must be `dhpk.reviewer-contract.v2`. Scope and diff carry digests and
read-only references so prompts do not repeat full inputs.

A reviewer may inspect additional dependencies read-only, but may not silently
expand the obligation. Missing material scope produces a completed `BLOCKED`
result.

## Review Result

Results keep these axes independent:

- `executionStatus`: `COMPLETE`, `NOT_RUN`, `INTERRUPTED`, or `UNAVAILABLE`;
- `applicability`: `REQUIRED` or `NOT_APPLICABLE`;
- `semanticVerdict`: `PASS`, `CHANGES_REQUIRED`, or `BLOCKED`.

`semanticVerdict` is required only for `COMPLETE` plus `REQUIRED`. It is absent
for incomplete execution or `NOT_APPLICABLE`, so neither state manufactures a
`PASS`. A completed `BLOCKED` result means no reliable judgment could be formed;
a defect is `CHANGES_REQUIRED`, and `FAIL` is not a v2 semantic verdict.

Each result also binds `contractVersion`, `obligationId`, and `lane`, and records
`findings`, `inspectedScope`, and `evidenceReferences`. A `PASS` cannot contain a
`MUST_FIX` finding.

For the public filesystem-backed `review-gate-runtime observe` boundary, the
caller must supply a separate host-issued cross-trust attestation envelope in
addition to the Review Gate result. The host verifies the envelope with its
configured key; it binds the prepared plan and the four evidence-file digests.
`evidenceReferences` may reference those evidence digests but is not a
substitute for the envelope. Programmatic ReviewGate, adapter, and
WorkflowCoordinator calls are trusted in-process ports and do not require this
filesystem transport attestation. Reviewers and local receipt writers cannot
self-issue or substitute the envelope; malformed, foreign, or mismatched
envelope evidence cannot authorize target progress.

## Findings

Severity is independent from disposition. Severity is `CRITICAL`, `HIGH`,
`MEDIUM`, `LOW`, or `INFO`; disposition is `MUST_FIX`, `FOLLOW_UP`, or `NOTE`.
`CRITICAL` and `HIGH` are always `MUST_FIX`. `MEDIUM` defaults to `MUST_FIX` and
requires a Judgment Owner Decision Receipt (the durable record naming the
accountable owner and downgrade decision) to become `FOLLOW_UP`; it cannot be
`NOTE`. The producer materializes that default explicitly in the `disposition`
field. `LOW` and `INFO` may use any disposition.

## Reviewer behavior and output

Reviewers are read-only and the Implementation Owner remediates findings. A
remediation review checks prior findings and the complete updated scope. Output
is findings-first; passing output is compact and contains inspected scope,
evidence references, and the verdict. Do not emit chain-of-thought, repeat full
inputs, restate the full diff, or copy complete logs.

## Legacy verdict compatibility

| Legacy verdict | v2 semantic candidate | Constraint |
|---|---|---|
| `APPROVE` | `PASS` | Reuses only the original passing evidence. |
| `PASS` | `PASS` | Reuses only the original passing evidence. |
| `WARNING` | `PASS` or `CHANGES_REQUIRED` | Any `MUST_FIX`, missing disposition, or invalid finding fails closed to `CHANGES_REQUIRED`; otherwise non-blocking findings may remain `PASS`. |
| `BLOCK` | `CHANGES_REQUIRED` | A defect is not execution failure. |
| `FAIL` | `CHANGES_REQUIRED` | Normalized only; never emitted as a v2 verdict. |

Missing, interrupted, unavailable, or malformed non-`WARNING` legacy output
records its execution status without a semantic verdict. A parseable `WARNING`
with an invalid or missing finding disposition is the explicit exception: it
fails closed to `CHANGES_REQUIRED`. A mapping is a `MIGRATION_OBSERVATION` with
`authorizesApproval: false` and `clearsSentinel: false`; it cannot issue a receipt,
create a new approval, or clear host state. Empty diffs are `NOT_APPLICABLE`,
never synthetic `PASS`.

## Legacy Codex dispatch compatibility

The remainder preserves the currently deployed Codex artifact and manual
lifecycle behavior while v2 is introduced.

### Shared reviewer dispatch fields

Every reviewer prompt is composed from these fields, in order:

1. **Scope** — the implementation wave and exact changed paths.
2. **Specialist charter** — the lane-specific checks owned by this reviewer.
3. **Evidence commands** — commands run, or a clear note when unavailable.
4. **Artifact path** — the fresh report location under `.codex/artifacts/`.
5. **Verdict** — the role's existing `APPROVE|WARNING|BLOCK` or `PASS|WARNING|FAIL` vocabulary.
6. **Confirm-only** — named findings to confirm for a bounded re-review; omit for a new wave.

For a dispatched wave, the report should also carry `scope_id` and `diff_id`
from the dispatch record. When either identity is present, both must match the
current obligation; a foreign wave remains unresolved.

### Single-run verdict

The final verdict MUST be emitted in the same run that performed the review.
Do not stop for an advisory response before writing it. A fresh report must
contain concrete file/line evidence, the verdict, and any bounded next steps;
a reply without that evidence is not a completed review.

### Misplaced review evidence

The parent flow scopes reports to the current dispatch obligation rather than
trusting a filename or directory alone. It records the exact dispatch
baseline, session, attempt, and dispatch identity; reports older than the
baseline or carrying foreign provenance remain unresolved. If several fresh
reports qualify, choose the newest report and use its relative path as the
deterministic tie-breaker. A background reconciliation may consume an artifact
only when its session/attempt/dispatch tuple matches the recorded obligation;
a legacy report without that tuple remains unresolved, and diagnostics expose
relative paths only.

### Manual resume

Codex has no Claude sentinel or automatic reviewer lifecycle. When a parent
flow asks a reviewer to resume, the parent supplies the exact scope and prior
finding; the reviewer confirms only that finding or reports a new one. A stale,
missing, or misplaced artifact leaves the review unresolved until the parent
dispatches a fresh run.

### Verdict semantics

- `APPROVE` / `PASS`: no blocking findings remain.
- `WARNING`: findings are recorded but do not meet the role's blocking threshold.
- `BLOCK` / `FAIL`: a critical or otherwise blocking finding remains.

The parent flow owns orchestration and lifecycle. Reviewers write the report,
return the final verdict, and never invoke host-specific sentinel helpers.
