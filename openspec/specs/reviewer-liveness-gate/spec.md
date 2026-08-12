# reviewer-liveness-gate Specification

## Purpose
TBD - created by archiving change dhpk-advice-20260707-fixes. Update Purpose after archive.
## Requirements
### Requirement: A no-op reviewer return is a failed gate, not a satisfied one

When the orchestrator dispatches a reviewer agent (e.g. `doc-reviewer`, `code-reviewer`) to satisfy a review gate and the agent returns having performed no review work — no `Read`/`Grep`/`Bash` tool calls (`tool_uses = 0`), or a body that merely echoes injected `<system-reminder>` / agent-roster content instead of a findings-plus-verdict report — the orchestrator SHALL treat the gate as FAILED, not satisfied. It SHALL NOT mark the review complete, and SHALL NOT clear or accept a cleared sentinel, on such a return. It SHALL re-dispatch the review to a reviewer able to actually run it — substituting a stronger reviewer (e.g. `code-reviewer`, chartered for `.claude/`-style agents/rules/skills markdown) for a misfiring Haiku `doc-reviewer` — rather than retrying the same agent a third identical time (anti-loop), and SHALL record the substitution and its reason in the conversation.

#### Scenario: doc-reviewer returns with zero tool uses
- **WHEN** a dispatched `doc-reviewer` returns with `tool_uses = 0` (it read no file), or a body that only echoes an injected system-reminder / agent roster
- **THEN** the orchestrator treats the doc-review gate as unmet and re-dispatches to `code-reviewer` (chartered to review the same markdown), rather than accepting the empty return as a pass

#### Scenario: No third identical retry of a misfiring reviewer
- **WHEN** the same reviewer agent has returned a no-op (`tool_uses = 0`) twice in a row
- **THEN** the orchestrator does not dispatch it a third identical time; it substitutes a stronger reviewer and records the substitution and reason

#### Scenario: A real review with findings satisfies the gate normally
- **WHEN** a dispatched reviewer performs `Read`/`Grep` and returns a findings list plus an explicit gate verdict
- **THEN** the gate is evaluated on that verdict as usual, with no substitution

### Requirement: Reviewer notifications must contain a final verdict before satisfying the gate

When an agent-spawned reviewer notification or result payload contains only an intermediate progress message rather than a findings list or explicit no-findings statement plus an explicit final verdict, the orchestrator SHALL treat the review gate as still pending. It SHALL resume or fetch the reviewer final result before marking the gate complete. When the reviewer was resumed through `SendMessage`, a final result SHALL additionally pass through the resumed-review sentinel reconcile contract before the corresponding sentinel is considered cleared.

#### Scenario: Intermediate reviewer message is not accepted as final
- **WHEN** a reviewer notification result says only that the reviewer will inspect something and contains no final approve/block verdict
- **THEN** the orchestrator resumes or fetches the reviewer final result and leaves the review gate pending

#### Scenario: Fresh reviewer final verdict satisfies normal liveness rules
- **WHEN** the reviewer result contains actual review work, findings or an explicit no-findings statement, a final gate verdict, and a fresh canonical review artifact
- **THEN** the orchestrator evaluates the gate on that final verdict and accepts native sentinel auto-clear if it ran

#### Scenario: Resumed final verdict without SubagentStop uses the reconcile path
- **WHEN** a reviewer resumed through `SendMessage` returns a final verdict but no matching `SubagentStop` event clears its sentinel
- **THEN** the orchestrator reconciles the recorded resumed-review obligation against the fresh canonical artifact and exact sentinel basename before accepting completion

#### Scenario: Final BLOCK remains an unresolved gate
- **WHEN** a resumed reviewer produces a fresh artifact with a final `BLOCK` or `FAIL` verdict or actionable critical/high/medium findings
- **THEN** the sentinel lifecycle may be reconciled, but `.unresolved-verdict` remains recorded and the review gate is not treated as approved

#### Scenario: Malformed verdict cannot become approval
- **WHEN** a conclusive resumed response is paired with a fresh canonical artifact whose verdict is malformed or conflicts with the response
- **THEN** lifecycle reconciliation may be idempotently completed, but the result is recorded as unresolved/quality-invalid and the completion gate remains unsatisfied

### Requirement: Stop reminders must not treat observable in-flight reviewers as idle pending work
When a reviewer sentinel is pending and the harness can observe that the matching reviewer is still in flight, Stop-time guidance SHALL identify the reviewer as in flight and direct the orchestrator to await its completion notification. It SHALL not recommend a duplicate dispatch. For unchanged pending state, the reminder SHALL be emitted at most once per bounded per-session backoff window; a new reminder requires a state change, a completed reviewer, or expiry of that window.

#### Scenario: Pending sentinel with in-flight reviewer
- **WHEN** a pending reviewer sentinel has an active matching reviewer marker
- **THEN** the Stop reminder says to await the existing result and does not spawn a duplicate reviewer

#### Scenario: Repeated Stop events are debounced
- **WHEN** the same pending sentinel causes repeated Stop events without state change
- **THEN** only one actionable reminder is emitted during the configured backoff window

#### Scenario: Pending sentinel without an active reviewer
- **WHEN** a reviewer sentinel exists without a matching active marker
- **THEN** the reminder names the reviewer or exact legitimate clear path, subject to the same debounce rule

### Requirement: Lightweight follow-up edits can be triaged without full duplicate review

The reviewer liveness guidance SHALL allow the orchestrator to triage pure bookkeeping, comment-only, or tiny test-hardening follow-up edits when the substantive logic was already reviewed and no new behavior was introduced. Such triage SHALL record a one-line reason and clear only the relevant sentinel; substantive code, SQL, security, or behavior changes SHALL still run the matching reviewer. Additionally: (a) when responding to a set of already-flagged findings from the same review round (Codex findings, reviewer-flagged issues, a `design.md` append recording one) with a series of small fixes, the orchestrator SHALL apply all of that round's known small fixes first and dispatch the re-review ONCE for the batch — never edit→re-review→edit→re-review serially, one finding-fix at a time. A genuinely new finding discovered mid-batch still gets its own cycle. (b) A delta of roughly ≤3 net changed lines that maps 1:1 to a finding already flagged in the current review round (not new/uninspected work) MAY be dispatched to the required reviewer at a reduced tier (e.g. `haiku`) via the same `model` param used for HIGH-risk tier escalation — reused symmetrically for a LOW-risk case — rather than the reviewer's frontmatter-default tier. This is never permitted for a security/db-sensitive file or a CRITICAL-severity target finding, which stay at the reviewer's default tier; it does not replace the reviewer dispatch itself — the gate still runs, just at lower cost.

#### Scenario: Comment-only follow-up after approved logic
- **WHEN** a follow-up edit only adjusts a comment or docblock on code whose logic was already reviewed in the same change
- **THEN** the orchestrator may record a lightweight triage reason and clear the relevant sentinel without a duplicate full review

#### Scenario: Substantive follow-up still requires review
- **WHEN** a follow-up edit changes executable logic, SQL shape, security behavior, or user-visible behavior
- **THEN** the matching reviewer gate remains required even if a prior review already approved an earlier diff

#### Scenario: A review round's known-finding fixes are batched into one re-review
- **WHEN** the orchestrator applies a series of small fixes that each map to a finding already flagged in the current review round (e.g. 2 Codex findings and a design.md append)
- **THEN** it applies all of them first and dispatches the required re-review once for the whole batch, rather than re-dispatching after each individual fix

#### Scenario: A known-finding-mapped tiny delta is eligible for reduced-tier dispatch
- **WHEN** a delta of roughly ≤3 net changed lines maps 1:1 to a finding already flagged this review round, and the target file is not security/db-sensitive and the finding is not CRITICAL
- **THEN** the orchestrator may dispatch the required reviewer at a reduced tier (e.g. `haiku`) via the `model` param instead of the reviewer's default tier

#### Scenario: A new mid-batch finding is not folded into the batch
- **WHEN** a genuinely new finding is discovered while applying a batch of known-finding fixes
- **THEN** it is not silently folded into the same batched re-review; it gets its own review cycle

### Requirement: A file-state defect conclusion is re-verified live before being reported

Before concluding that a file was reverted, a regression exists, or the working tree is in some broken/inconsistent state, a reviewer or the orchestrator SHALL re-verify live — `git status --porcelain` plus a direct Read of the target file's current content — rather than treating a single injected file-snapshot (e.g. a system-reminder) as proof. A snapshot captured mid-operation (e.g. mid branch-switch) can transiently show a stale or reverted-looking state that is not a real defect; the live re-check, not the snapshot, is the tie-breaker before a defect is reported.

#### Scenario: A stale mid-operation snapshot is not reported as a defect
- **WHEN** an injected file-snapshot suggests a file was reverted or a view/controller pair is now inconsistent
- **THEN** the reviewer or orchestrator runs `git status --porcelain` and a direct Read of the target file before concluding a defect exists, and does not report the snapshot alone as proof

#### Scenario: A live-confirmed defect is still reported
- **WHEN** the live `git status --porcelain` check and a direct Read confirm the file genuinely is in the reverted/broken state the snapshot suggested
- **THEN** the defect is reported as usual — the live re-check confirms it, it does not suppress genuine defects

### Requirement: Sentinel auto-clear requires a fresh review artifact
The subagent-stop auto-clear path for reviewer sentinels SHALL clear a review sentinel only when a review artifact matching that reviewer's artifact glob exists, is fresh within the current dispatch window, matches the current review-wave scope or diff identity, and contains a parseable verdict. A reviewer subagent that stops with exit 0 but no matching review artifact SHALL leave the sentinel in place, log the event (e.g. `agent-failures.log` `no review doc`), and thereby keep the review gate unmet so the orchestrator re-dispatches per the existing no-op-reviewer rules. The artifact glob SHALL stay aligned with the reviewer Closing-hook artifact naming convention. Misplaced-artifact diagnostics SHALL be freshness-, session-, and wave-aware, deterministic, and diagnostic-only; stale historical files SHALL never be attributed to the current stop or used for auto-clear.

#### Scenario: Reviewer exits cleanly with no artifact
- **WHEN** a dispatched `doc-reviewer` stops with exit 0 having written no review document
- **THEN** `.pending-doc-review` is NOT auto-cleared, the failure is logged, and the gate remains unmet

#### Scenario: Reviewer produces a fresh artifact
- **WHEN** a dispatched reviewer stops after writing a review artifact matching the expected glob within the dispatch window and matching the current wave
- **THEN** the sentinel auto-clears as today and the matching verdict is recorded

#### Scenario: Stale artifact from a prior round does not satisfy the clear
- **WHEN** the only matching artifact predates the current reviewer dispatch or carries another wave identity
- **THEN** the auto-clear does not fire on that stale artifact

#### Scenario: Stale misplaced artifact is not attributed to a new stop
- **WHEN** a reviewer stops cleanly, the canonical artifact is absent, and the only non-canonical matching files predate the current sentinel/session
- **THEN** the hook logs `no fresh review doc` or an equivalent stale-diagnostic outcome, leaves the sentinel armed, and does not name an old file as the current reviewer output

#### Scenario: Fresh misplaced artifact is diagnosed without clearing
- **WHEN** a matching non-canonical artifact is created at or after the current dispatch-attempt baseline and either belongs to the current session or has no session metadata
- **THEN** the hook logs its relative path as misplaced with a current-session or `current-unknown-session` reason, leaves the sentinel armed, and requires relocation or a new canonical review before clearance

#### Scenario: Explicitly foreign misplaced artifact is ignored
- **WHEN** a matching non-canonical artifact carries provenance for another session or dispatch attempt
- **THEN** the hook ignores it for current diagnostics, leaves the sentinel armed when no current artifact exists, and does not attribute the foreign path to the current reviewer

#### Scenario: Verbal approval without fresh evidence does not close the gate
- **WHEN** a reviewer returns `APPROVE` but no fresh canonical artifact matches the current wave
- **THEN** the sentinel remains armed and the coordinator records incomplete review evidence

### Requirement: Resumed reviewer completion is artifact-backed and session-scoped

When the orchestrator reuses a pending reviewer through `SendMessage`, it SHALL record one session-scoped obligation in `.resumed-review-obligations` containing the slot, reviewer identity, exact `.pending-*` sentinel basename, originating dispatch/session identity, resume timestamp, artifact baseline, attempt, and state. A resumed final response SHALL clear or reconcile that obligation only when the canonical review artifact is fresh relative to the obligation/current sentinel, ownership matches, and the response contains a parseable final verdict plus actual review work. A missing, stale, malformed final response, foreign artifact, or session-mismatched artifact SHALL leave the sentinel armed and the gate pending. A malformed verdict field in an otherwise fresh canonical artifact may complete lifecycle reconciliation but SHALL remain unresolved and SHALL not satisfy approval.

#### Scenario: Resumed APPROVE reconciles one sentinel
- **WHEN** the resumed reviewer returns `APPROVE`, a fresh canonical artifact exists, and the obligation matches the current session and sentinel
- **THEN** the reconcile path clears only that reviewer sentinel and consumes only that resumed obligation

#### Scenario: Resumed BLOCK does not become approval
- **WHEN** the resumed reviewer returns `BLOCK` with a fresh canonical artifact
- **THEN** the reconcile path records the unresolved verdict, keeps the completion gate unsatisfied, and does not dispatch a duplicate reviewer solely because the sentinel lifecycle completed

#### Scenario: No fresh artifact keeps the sentinel armed
- **WHEN** a resumed reviewer returns a final-looking message but no fresh canonical artifact exists
- **THEN** the sentinel remains armed and the orchestrator reports the review as incomplete

#### Scenario: Concurrent session artifact cannot satisfy the obligation
- **WHEN** a fresh artifact belongs to another session or has no matching resumed-review obligation
- **THEN** the reconcile path does not clear the current session's sentinel

#### Scenario: Repeated reconcile is idempotent
- **WHEN** native auto-clear and resumed fallback both process the same completed obligation, or the fallback is invoked repeatedly
- **THEN** the exact sentinel is removed at most once, the matching obligation is consumed at most once, and no error or duplicate reviewer dispatch is produced

### Requirement: Misplaced review diagnostics select candidates deterministically
The misplaced-artifact finder SHALL ignore the canonical reviews directory, filter candidates by the current dispatch-attempt baseline and session boundary, and select the newest qualifying candidate. It SHALL record a stable relative path and diagnostic reason without exposing absolute host paths.

#### Scenario: Multiple misplaced candidates exist
- **WHEN** several matching non-canonical artifacts exist, including stale, current-session, and current-unknown-session files
- **THEN** only the newest qualifying candidate (known or unknown session) is reported and stale/foreign files do not affect the learning-db key or log attribution

#### Scenario: Known and unknown current candidates tie
- **WHEN** a known-current and a current-unknown-session candidate have the same qualifying timestamp
- **THEN** the finder applies the stable relative-path tie-breaker and reports exactly one candidate

#### Scenario: No qualifying misplaced candidate exists
- **WHEN** all non-canonical matches are stale or belong to another session
- **THEN** the hook emits the normal no-fresh-artifact outcome rather than an arbitrary historical path

### Requirement: Reviewer liveness and review approval are separate contracts
Reviewer liveness SHALL record whether a dispatch is still running independently from whether a fresh artifact proves an approved review. Clearing an in-flight marker SHALL never clear a pending review obligation without fresh scope-bound evidence.

#### Scenario: Reviewer stops successfully without an artifact
- **WHEN** a known reviewer stops with success but no fresh matching artifact exists
- **THEN** its in-flight marker is cleared while the review sentinel remains armed

#### Scenario: Reviewer fails with an artifact from an older wave
- **WHEN** a reviewer reports failure and only an older artifact exists
- **THEN** liveness is reconciled but the current review obligation remains pending

#### Scenario: Reviewer has fresh actionable findings
- **WHEN** a fresh artifact has a clean transport result but actionable findings
- **THEN** liveness may close while unresolved-verdict evidence remains visible
