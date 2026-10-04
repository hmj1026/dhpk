# opsx-goal-stop-conditions Specification

## Purpose

Define truthful goal stop, resume, and blocked-handoff conditions for bounded
implementation sessions.

## Requirements

### Requirement: Blocked-on-human tasks satisfy the stop condition

The goal template's exit-condition list SHALL include a clause allowing the session to stop when
every remaining unchecked task is blocked on an action only a human can take (e.g. a PR awaiting
human merge, credentials, deploy approval), provided each such task is annotated
`[blocked: <reason>]` in the resolved task artifact and a change-root
`.resume-note.md` is written.

#### Scenario: All remaining work awaits a human PR merge

- **WHEN** the session has completed every task it can and the only unchecked tasks depend on a human merging an open PR
- **THEN** the session annotates those tasks as blocked, writes .resume-note.md, and ends the turn legally — the /goal evaluator accepts the stop instead of blocking it

#### Scenario: A remaining task is actionable

- **WHEN** at least one unchecked task is still actionable within the session
- **THEN** the blocked-on-human clause does not apply and the session continues working

### Requirement: The turn budget is a hard checkpoint

The goal template SHALL state that reaching the turn budget obliges the session to stop after finishing the current resolved task artifact work item — leaving no half-edited file — write the resolved change root's `.resume-note.md` (state, next step, remaining tasks), and end the session — not treat the budget as advisory prose.

#### Scenario: Session reaches its turn budget mid-change

- **WHEN** the session's executed turns reach the budget stated in the goal string
- **THEN** the session finishes the current resolved artifact item, checkpoints (writes the change-root `.resume-note.md`), and ends instead of continuing past the budget, and the /goal evaluator can verify the checkpoint artifact exists

### Requirement: Blocked handoff is not completion

A blocked report SHALL stop the current work and provide a resumable handoff; it
SHALL NOT mark the original task complete, satisfy implementation or verification
evidence, or authorize archive, commit, PR, release, or deployment. The handoff
SHALL preserve the resolved change and artifact paths and the exact missing
authority, resource, or outcome.

#### Scenario: Missing required policy

- **WHEN** a required policy cannot be resolved
- **THEN** the goal fails closed with the missing policy and stops with a handoff, without silently substituting a writer, provider, or scope

#### Scenario: Optional skill unavailable

- **WHEN** an optional skill is unavailable
- **THEN** the handoff names the missing capability and continues only with an authorized route that supplies the required outcome

### Requirement: Dirty work remains protected during baseline checks

The goal SHALL preserve dirty WIP and SHALL NOT use stash, reset, or cleanup as
baseline proof. When a clean comparison is necessary, it SHALL use an isolated,
source-identifiable baseline and report that evidence separately.

#### Scenario: Existing local edits are present

- **WHEN** verification needs a clean comparison while the worktree is dirty
- **THEN** the session leaves the WIP intact and uses an isolated baseline or reports the comparison as unavailable

### Requirement: Verification evidence clauses name concrete pasteable fields

The goal template's Part 3 verification clauses SHALL state their evidence in transcript-checkable terms: the pre-existing-failure (and pre-existing-warning) rule SHALL rest on reproduction against an isolated, source-identifiable clean baseline, plus the requirement that each such failure is named in the completion summary, with no separate "unrelated to the change" judgment clause; the smoke-gate clause SHALL require pasting the smoke report's `Verdict:` line plus at least one observed output line (the asserted log line, API response, or exit code) into the conversation, replacing the unmeasured "key observed value" phrasing.

#### Scenario: Pre-existing failure is proven mechanically

- **WHEN** a test failure is claimed pre-existing at the Part 3 gate
- **THEN** the transcript shows the failure reproducing identically against an isolated, source-identifiable clean baseline and the failure named in the completion summary — no clause asks the evaluator to judge "relatedness"

#### Scenario: Smoke evidence is a named field, not a judgment

- **WHEN** the smoke gate passes
- **THEN** the conversation contains the smoke report's `Verdict: PASS` line and at least one observed output line from the probe (log line / API response / exit code), satisfying the clause without qualitative interpretation
