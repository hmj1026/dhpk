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

## Single-run verdict

The final verdict MUST be emitted within the same run that performed the review. Stopping for advisory or intermediary input before the final verdict is written is forbidden; advisory work is folded into the same run, and post-verdict escalation is permitted. A run that stops without valid delimited frontmatter and a parseable verdict is not a valid intermediate state and leaves the sentinel armed. A warning, failure, unparseable verdict, noncanonical filename, or malformed artifact likewise leaves the sentinel armed; only `APPROVE` or `PASS` evidence satisfies hook-owned clearance.

No reviewer agent definition issues a self-run `clear-sentinel.sh`; that remains hook-owned (`subagent-stop-verify.sh`) or orchestrator-invoked, including for a reviewer resumed through `SendMessage` (§Resumed reviewer result above).
