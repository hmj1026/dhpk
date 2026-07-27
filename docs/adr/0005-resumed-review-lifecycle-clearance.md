# Separate resumed-review lifecycle clearance from approval

Status: accepted

## Context

`subagent-stop-verify.sh` auto-clears a reviewer's sentinel on a native
`SubagentStop` event when a fresh canonical review doc exists. The
`stop-review-reconcile.sh` Stop-time sweep (issue #76/#77) extends that to a
background reviewer whose `SubagentStop` never fires, gated on a lingering
active-liveness marker proving this session dispatched it. Neither mechanism
reaches a reviewer **resumed** through `SendMessage` (issue #92): it is not a
fresh dispatch, and its active marker may already have been removed by the
ORIGINAL dispatch's `SubagentStop` before the resume happened. A resumed
reviewer that returns a genuinely conclusive result can therefore leave its
sentinel armed indefinitely, with no documented path to clear it other than an
operator noticing a stale `.pending-*` file.

## Decision

Sentinel clearance and verdict approval are two separate boundaries:

1. **Lifecycle clearance** — a reviewer has demonstrably finished. Proven only
   by a fresh canonical review doc (`.claude/artifacts/reviews/<agent>-*.md`)
   that postdates the sentinel; never inferred from a `SendMessage` reply's
   wording alone. For the resumed case specifically, the doc must ALSO
   postdate a **resumed-review obligation**'s recorded pre-resume baseline —
   an identical, unchanged doc proves no new review ran during the resume.
2. **Verdict approval** — whether the review passed. Tracked independently in
   `.unresolved-verdict`, refreshed identically regardless of which clearance
   path fired. A resumed BLOCK, FAIL, malformed, or nonzero
   critical/high/medium result stays recorded as unresolved even after its
   sentinel clears.

Lifecycle clearance for a resumed reviewer requires an explicit,
session-scoped obligation recorded BEFORE the resume (`.resumed-review-obligations`,
newline-delimited JSON, one active record per sentinel/session) and reconciled
only when the artifact-baseline freshness proof above holds — via an explicit
orchestrator-invoked script (`reconcile-resumed-review.sh`) or a Stop-time
safety-net sweep. Ownership fails closed: a reconcile call only ever matches
an obligation whose recorded session identity equals the caller's.

## Considered Options

- Clear on a final-looking message: rejected because messages are transient
  and can be detached from the canonical artifact.
- Let the reviewer self-clear: rejected because it collapses review execution
  and gate ownership.
- Keep the broad sentinel sweep as the resumed path: rejected because it
  cannot distinguish an intermediate response, a stale artifact, or a
  concurrent session.
- **Infer resumed completion from the next fresh artifact alone**, with no
  recorded obligation. Rejected: concurrent sessions share the artifacts
  directory, so an artifact without an explicit obligation could clear the
  wrong session's sentinel.
- **A second, independent sentinel-removal implementation** for the resumed
  case. Rejected: separate removal logic would drift from `clear-sentinel.sh`
  in validation, logging, and concurrency behavior over time.

## Consequences

- A resumed reviewer's sentinel can now clear without a native `SubagentStop`,
  closing the issue #92 gap, without weakening the existing no-self-clear
  reviewer contract or the fresh-artifact requirement.
- The `.resumed-review-obligations` sidecar is additional lifecycle state to
  reason about, but it reuses the existing sentinel whitelist, `clear-sentinel.sh`
  SSOT, and `.unresolved-verdict` refresh logic rather than introducing a
  parallel clearance mechanism.
- Because lifecycle clearance never implies approval, a resumed BLOCK/FAIL
  result cannot be mistaken for a passed review by anything that checks
  sentinel presence alone — `.unresolved-verdict` remains the completion-gate
  source of truth.
- A BLOCK, FAIL, malformed verdict, or actionable severity may finish the
  lifecycle transition but remains a completion blocker through the existing
  `.unresolved-verdict` and quality gates.
- **Known risk**: the explicit `record-resumed-obligation.sh` /
  `reconcile-resumed-review.sh` CLI pair keys an obligation on the
  orchestrator's `CLAUDE_CODE_SESSION_ID` Bash env var, while the automatic
  Stop-time sweep and the `[WARN] RESUMED` reminder key on the Stop hook
  payload's `session_id` field instead. Their equivalence is asserted in
  `_lib/session-env.sh`'s `dhpk_current_session_id()` comment and was
  empirically confirmed live during this change's own review (matching
  `.review-reminder-backoff` values), but is not proven by a committed test
  that exercises real divergence between the two sources. This fails closed
  by construction — a mismatch leaves the sentinel armed rather than
  producing an unsafe or false clear — so the risk is a possibly-dead
  automatic safety net, never an unsafe clear.

See `openspec/changes/archive/2026-07-27-fix-resumed-review-sentinel-clearance/design.md`
(local-only; `openspec/` is gitignored in this repo) for the full decision record and
`skills/dhpk-execution-policy/references/review-gate-mechanics.md`
§Resumed reviewer reconcile contract for operational detail.
