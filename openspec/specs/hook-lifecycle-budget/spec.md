# hook-lifecycle-budget Specification

## Purpose
TBD - created by archiving change refine-opsx-orchestration-governance. Update Purpose after archive.
## Requirements
### Requirement: Hook triggers are classified by safety purpose
Hook configuration SHALL classify each hook as a blocking safety gate, sentinel/liveness gate, lifecycle bookkeeping, or opt-in advisory. Blocking and sentinel gates SHALL remain enabled for their scoped events; expensive transcript scans and duplicate completion advisories SHALL remain disabled unless explicitly enabled. The subagent quality gate SHALL default to off globally and SHALL apply to reviewer-sentinel subagents, bounded by the no-op recovery rule owned by `reviewer-wave-economy`.

#### Scenario: Edit and reviewer lifecycle
- **WHEN** an in-scope file is edited and its reviewer subagent stops
- **THEN** the edit arms the relevant sentinel and the stop verifier can clear it only with a fresh matching artifact

### Requirement: Stop reminders are debounced and aware of active reviewers
The Stop review reminder SHALL follow the reminder-frequency contract owned by `reviewer-liveness-gate`: for unchanged pending state, at most one actionable reminder per pending reviewer per bounded per-session backoff window, and no duplicate-dispatch instruction while the matching reviewer is observable in flight. This capability adds no separate quantifier; `reviewer-liveness-gate` is the single authority for reminder frequency.

#### Scenario: Repeated Stop events
- **WHEN** the same pending sentinel causes repeated Stop events without state change
- **THEN** the user receives one actionable reminder per bounded backoff window rather than repeated identical reminders

#### Scenario: Active reviewer exists
- **WHEN** a matching reviewer active marker is present
- **THEN** the reminder says to await the existing result and does not recommend a duplicate dispatch

### Requirement: Hook outcomes remain observable without causing loops
Hook scripts SHALL log blocked, no-op, auto-cleared, and advisory-skipped outcomes with session and sentinel identity, SHALL preserve non-zero blocking semantics where required, and SHALL ensure a hook's own reminder or artifact write cannot recursively create an unbounded hook loop. Diagnostic records SHALL identify only current, qualifying artifacts and SHALL not replay stale historical paths as current events.

#### Scenario: No-op reviewer
- **WHEN** a reviewer exits without a fresh artifact
- **THEN** the event is logged, the sentinel remains armed, and subsequent handling is bounded by the no-op recovery rule owned by `reviewer-wave-economy` (exactly one corrected retry) and the Stop reminder rule owned by `reviewer-liveness-gate`

#### Scenario: Stale misplaced document is present
- **WHEN** a reviewer exits cleanly and the artifacts tree contains only a prior-cycle misplaced document
- **THEN** the hook logs a no-fresh-artifact outcome with the current sentinel/session, does not attribute the prior document to this stop, and does not create a new retry loop solely because the stale file exists

#### Scenario: Fresh misplaced document is present
- **WHEN** a reviewer writes a current-session document outside the canonical directory
- **THEN** the hook emits one actionable misplaced diagnostic, keeps the sentinel armed, and remains bounded by the existing recovery policy

### Requirement: Hook behavior has a measurable verification matrix
The plugin SHALL provide tests or harness checks covering trigger count, active-reviewer suppression, stale-artifact rejection, opt-in advisory defaults, timeout behavior, and no-loop behavior for the touched hooks.

#### Scenario: Hook validation
- **WHEN** the plugin validation gates run
- **THEN** they verify the lifecycle matrix and report failures with the event, hook, and sentinel involved

### Requirement: Post-edit reviewer advisory is de-duplicated per sentinel state
The post-edit hook SHALL emit the "run the pending reviewer BEFORE attempting commit/push" advisory only when the armed-sentinel set changes (signature of existing `.pending-*` basenames stored in a session sidecar), not on every triggering edit.

#### Scenario: Consecutive edits under an unchanged sentinel set
- **WHEN** two consecutive edits both trigger the same already-armed sentinel set
- **THEN** the advisory line is emitted for the first edit only

#### Scenario: Sentinel cleared and re-armed
- **WHEN** a reviewer clears a sentinel and a later edit re-arms it
- **THEN** the advisory is emitted again (new signature)

### Requirement: Non-trigger skip echoes are debug-gated
The post-edit hook's `skipped (no trigger matched)` echo SHALL be suppressed by default and emitted only when `DHPK_DEBUG=1`.

#### Scenario: Doc/test edit with debug off
- **WHEN** an edit matches no reviewer trigger and `DHPK_DEBUG` is unset
- **THEN** no skip echo is emitted

### Requirement: Skill-hint hook ignores system-notification inputs
The UserPromptSubmit skill-hint hook SHALL exit without emitting any hint when the submitted input contains a system-notification marker (`[SYSTEM NOTIFICATION]` or `<task-notification>`), so machine-generated turns never trigger workflow-routing hints such as "bug workflow" or "security review".

#### Scenario: Task notification produces no hint
- **WHEN** a prompt containing `<task-notification>` is submitted
- **THEN** the skill-hint hook exits 0 with no hint output

#### Scenario: Ordinary user prompt still gets hints
- **WHEN** a normal user prompt matching a route pattern is submitted
- **THEN** the skill-hint hook emits its hint as before

### Requirement: Pending review badges are generated from the sentinel contract
The statusline SHALL consume the generated short-name array from the sentinel slot single source of truth rather than maintaining a shorter local label list.

#### Scenario: Code review sentinel is pending
- **WHEN** `.pending-review` exists
- **THEN** the statusline includes `⚠ code` in its prefix output

#### Scenario: Migration review sentinel is pending
- **WHEN** `.pending-migration-review` exists
- **THEN** the statusline includes `⚠ mig` in its prefix output

#### Scenario: No sentinel is pending
- **WHEN** no configured sentinel exists
- **THEN** the statusline omits the warning suffix and preserves the existing branch/profile/docker/module output
