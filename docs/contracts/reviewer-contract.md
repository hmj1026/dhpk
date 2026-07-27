# Shared reviewer dispatch contract

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

## Resumed reviewer result

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

## Single-run verdict

The final verdict MUST be emitted within the same run that performed the review. Stopping for advisory or intermediary input before the final verdict is written is forbidden; advisory work is folded into the same run, and post-verdict escalation is permitted. A run that stops without a parseable verdict is a quality-contract defect routed to `.unresolved-verdict` / subagent-quality enforcement, not a valid intermediate state. Sentinel liveness is separate from verdict correctness: a fresh artifact may still auto-clear its sentinel even though the verdict itself is treated as unresolved.

No reviewer agent definition issues a self-run `clear-sentinel.sh`; that remains hook-owned (`subagent-stop-verify.sh`) or orchestrator-invoked, including for a reviewer resumed through `SendMessage` (§Resumed reviewer result above).
