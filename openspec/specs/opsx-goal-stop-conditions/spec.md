# opsx-goal-stop-conditions Specification

## Purpose
TBD - created by archiving change harvest-advice-20260711. Update Purpose after archive.
## Requirements
### Requirement: Blocked-on-human tasks satisfy the stop condition
The goal template's exit-condition list SHALL include a clause allowing the session to stop when
every remaining unchecked task is blocked on an action only a human can take (e.g. a PR awaiting
human merge, credentials, deploy approval), provided each such task is annotated
`[blocked: <reason>]` in tasks.md and a `.resume-note.md` is written.

#### Scenario: All remaining work awaits a human PR merge
- **WHEN** the session has completed every task it can and the only unchecked tasks depend on a human merging an open PR
- **THEN** the session annotates those tasks as blocked, writes .resume-note.md, and ends the turn legally — the /goal evaluator accepts the stop instead of blocking it

#### Scenario: A remaining task is actionable
- **WHEN** at least one unchecked task is still actionable within the session
- **THEN** the blocked-on-human clause does not apply and the session continues working

### Requirement: The turn budget is a hard checkpoint

The goal template SHALL state that reaching the turn budget obliges the session to stop after finishing the current tasks.md work item — leaving no half-edited file — write `.resume-note.md` (state, next step, remaining tasks), and end the session — not treat the budget as advisory prose.

#### Scenario: Session reaches its turn budget mid-change

- **WHEN** the session's executed turns reach the budget stated in the goal string
- **THEN** the session finishes the current tasks.md item, checkpoints (writes .resume-note.md), and ends instead of continuing past the budget, and the /goal evaluator can verify the checkpoint artifact exists

### Requirement: Verification evidence clauses name concrete pasteable fields

The goal template's Part 3 verification clauses SHALL state their evidence in transcript-checkable terms: the pre-existing-failure (and pre-existing-warning) rule SHALL rest on the mechanical test — the failure reproduces identically on a `git stash`-ed clean HEAD — plus the requirement that each such failure is named in the completion summary, with no separate "unrelated to the change" judgment clause; the smoke-gate clause SHALL require pasting the smoke report's `Verdict:` line plus at least one observed output line (the asserted log line, API response, or exit code) into the conversation, replacing the unmeasured "key observed value" phrasing.

#### Scenario: Pre-existing failure is proven mechanically

- **WHEN** a test failure is claimed pre-existing at the Part 3 gate
- **THEN** the transcript shows the failure reproducing identically under `git stash` of the change's edits and the failure named in the completion summary — no clause asks the evaluator to judge "relatedness"

#### Scenario: Smoke evidence is a named field, not a judgment

- **WHEN** the smoke gate passes
- **THEN** the conversation contains the smoke report's `Verdict: PASS` line and at least one observed output line from the probe (log line / API response / exit code), satisfying the clause without qualitative interpretation
