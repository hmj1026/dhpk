# Reviewer Contract v2

Contract version: `dhpk.reviewer-contract.v2`

This is the platform-neutral contract for reviewer requests, findings, and
results. It can be exercised during the Review Gate migration, but it does not
change current runtime authority: Sentinel remains authoritative until the
approved migration phase changes it. Compatibility translation is an
observation of existing evidence, never a new approval or lifecycle clearance.

The executable definitions live in `scripts/lib/reviewer-contract.js`, and the
shared conformance example lives in
`tests/fixtures/review-gate/reviewer-contract-v2.json`.

## Review Request

A Review Request is immutable and binds these fields:

- `decisionId`, `waveId`, and `obligationId` identify the decision, implementation
  wave, and review debt;
- `lane` identifies the applicable specialist responsibility;
- `scope` binds the exact changed paths and its digest;
- `baseIdentity` and `headIdentity` bind commit and tree identity;
- `diff` binds a digest and a read-only reference instead of repeating the patch;
- `materialRisks` records the named routing inputs;
- `governingInputs` binds applicable specifications, decisions, and policies;
- `exclusions` states deliberately excluded scope and the reason;
- `priorFindings` carries the findings that a remediation review must revisit;
  and
- `contractVersion` must be `dhpk.reviewer-contract.v2`.

A reviewer may inspect additional dependencies read-only, but may not silently
expand the obligation. Missing material scope produces a completed `BLOCKED`
result rather than a guess.

## Review Result

Review Results keep three axes independent:

- `executionStatus`: `COMPLETE`, `NOT_RUN`, `INTERRUPTED`, or `UNAVAILABLE`;
- `applicability`: `REQUIRED` or `NOT_APPLICABLE`; and
- `semanticVerdict`: `PASS`, `CHANGES_REQUIRED`, or `BLOCKED`.

`semanticVerdict` is required only when execution is `COMPLETE` and applicability
is `REQUIRED`. It is absent when execution did not complete or applicability is
`NOT_APPLICABLE`; those states must not manufacture a `PASS`. A completed
`BLOCKED` result means that no reliable semantic judgment could be formed. A
defect that requires remediation is `CHANGES_REQUIRED`; `FAIL` is not a v2
semantic verdict.

Every result also binds `contractVersion`, `obligationId`, and `lane`, and records
`findings`, `inspectedScope`, and `evidenceReferences`. A `PASS` result cannot
contain a `MUST_FIX` finding.

## Findings

Severity and disposition are separate fields:

- severity: `CRITICAL`, `HIGH`, `MEDIUM`, `LOW`, or `INFO`;
- disposition: `MUST_FIX`, `FOLLOW_UP`, or `NOTE`.

`CRITICAL` and `HIGH` findings are always `MUST_FIX`. `MEDIUM` defaults to
`MUST_FIX`; changing it to `FOLLOW_UP` requires a Judgment Owner Decision Receipt
(the durable record naming the accountable owner and downgrade decision), and it
cannot be a `NOTE`. The producer materializes that default explicitly in the
`disposition` field. `LOW` and `INFO` may use any disposition. Each finding records
an id, summary, and bounded evidence references; evidence references do not embed
full source or logs.

## Reviewer behavior and output

Reviewers are read-only: the Implementation Owner remediates findings. A
remediation review covers both prior findings and the complete updated scope.
Output is findings-first. A passing result stays compact and records inspected
scope, evidence references, and the verdict. Do not emit chain-of-thought,
repeat full inputs, restate the full diff, or copy complete test logs and generic
checklists.

## Legacy verdict compatibility

The compatibility adapter translates the same completed legacy judgment; it
does not invoke a reviewer, issue an approval receipt, create a new approval, or
clear Sentinel.

| Legacy verdict | v2 semantic candidate | Constraint |
|---|---|---|
| `APPROVE` | `PASS` | Only the original passing evidence can support this candidate. |
| `PASS` | `PASS` | Only the original passing evidence can support this candidate. |
| `WARNING` | `PASS` or `CHANGES_REQUIRED` | Any `MUST_FIX`, missing disposition, or invalid finding fails closed to `CHANGES_REQUIRED`; otherwise non-blocking findings may remain `PASS`. |
| `BLOCK` | `CHANGES_REQUIRED` | A reported defect is not execution failure. |
| `FAIL` | `CHANGES_REQUIRED` | `FAIL` is normalized; it is never a v2 verdict. |

Missing, interrupted, unavailable, or malformed non-`WARNING` legacy output
records its execution status and no semantic verdict. A parseable `WARNING` with
an invalid or missing finding disposition is the explicit exception: it fails
closed to `CHANGES_REQUIRED`. Compatibility output is a `MIGRATION_OBSERVATION`
with `authorizesApproval: false` and `clearsSentinel: false`. Empty diffs are
`NOT_APPLICABLE`; unchanged valid evidence is reused as lifecycle evidence without
inventing another `PASS`.

## Legacy Sentinel dispatch compatibility

The remainder of this document preserves the currently deployed dispatch and
artifact behavior. These rules remain authoritative during BASELINE (the phase
in which Sentinel alone remains authoritative) and are not redefined by the v2
contract above.

### Shared reviewer dispatch fields

Every reviewer prompt is composed from these fields, in this order:

1. **Scope** — the implementation wave and exact changed paths.
2. **Specialist charter** — the lane-specific checks only this reviewer owns.
3. **Evidence commands** — commands the reviewer must run or explain as unavailable.
4. **Artifact path** — the review document location and fresh-artifact requirement.
5. **Verdict** — the role's existing `APPROVE|WARNING|BLOCK` or `PASS|WARNING|FAIL` vocabulary.
6. **Confirm-only** — named findings to confirm when this is a bounded re-review; omit for a new wave.

The orchestrator batches one applicable reviewer dispatch per implementation
wave. A no-op or missing artifact fails the gate, receives exactly one corrected retry,
then is replaced or left pending with a recorded reason. A third
identical retry is prohibited. Specialist prompts reference this contract once;
they retain only their unique checks and output vocabulary.

### Resumed reviewer result

When an existing sentinel-backed reviewer is reused through `SendMessage`, the
orchestrator records one session-scoped `.resumed-review-obligations` record
before sending the message. An intermediate response is not a result. A final
response must contain actual review work, findings or an explicit no-findings
statement, and the reviewer's existing parseable verdict vocabulary. The
orchestrator may reconcile only the exact recorded sentinel when the canonical
review artifact is fresh relative to the sentinel and resume baseline and its
session/agent identity matches. A foreign, missing, stale, misplaced, malformed,
or conflicting artifact leaves approval unresolved; lifecycle clearance, when
otherwise permitted, never changes that outcome.

The native stop-time gate requires a canonical filename
`<agent>-YYYYMMDD-HHMMSS-<slug>.md`, leading delimited frontmatter containing
`agent`, `generated_at`, `commit`, `scope`, `severity_summary`, and `verdict`,
plus an `APPROVE or PASS` verdict before it clears a sentinel. A dispatched
wave should additionally include `scope_id` and `diff_id` from the lifecycle
dispatch record; when either field is present, both must match the current
obligation and a foreign wave remains unresolved. The
gate applies the same freshness and ownership discipline to non-canonical
review files. `pre-agent-liveness-mark.sh` records the dispatch
baseline, session, attempt, and dispatch identifier (when available) in the
session-scoped `.review-dispatch-attempts` sidecar. `subagent-stop-verify.sh`
ignores files older than that baseline or carrying foreign session/dispatch
provenance, then selects the newest qualified file with a deterministic relative
path tie-breaker. A fresh misplaced file leaves the sentinel armed but is
reported with a relative path; stale or foreign candidates are reported as
"no fresh review doc" without leaking an absolute path. Missing provenance is
accepted only for a file that is fresh in the current native stop session and
is marked `current-unknown-session` in diagnostics. The background Stop-time
reconciliation safety net is stricter: it must first find the exact
session-scoped `.review-dispatch-attempts` row and then require matching
artifact `session_id`, `dispatch_attempt`, and `dispatch_id` fields; legacy
artifacts without that tuple remain armed.

### Single-run verdict

The final verdict MUST be emitted within the same run that performed the review. Stopping for advisory or intermediary input before the final verdict is written is forbidden; advisory work is folded into the same run, and post-verdict escalation is permitted. A run that stops without valid delimited frontmatter and a parseable verdict is not a valid intermediate state and leaves the sentinel armed. A warning, failure, unparseable verdict, noncanonical filename, or malformed artifact likewise leaves the sentinel armed; only `APPROVE` or `PASS` evidence satisfies hook-owned clearance.

No reviewer agent definition issues a self-run `clear-sentinel.sh`; that remains hook-owned (`subagent-stop-verify.sh`) or orchestrator-invoked, including for a reviewer resumed through `SendMessage` (§Resumed reviewer result above).
