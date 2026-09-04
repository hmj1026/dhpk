# skill-routing-guidance Specification

## Purpose

TBD - created by archiving change repair-open-issues-and-agent-guidance. Update Purpose after archive.

## Requirements

### Requirement: Unclear multi-session work enters a wayfinder checkpoint

When the destination or owning workflow is unclear and the work is expected to span more than one agent session, routing guidance SHALL establish the destination, current frontier, and next decision before implementation. Clear single-session work SHALL continue through the normal skill/OpenSpec route without creating a decision map.

#### Scenario: Route is unclear and work spans sessions

- **WHEN** an issue has several plausible owners and cannot be completed in one session
- **THEN** guidance creates or updates a shared decision map, identifies the unblocked next question, and does not start implementation

#### Scenario: Route is clear

- **WHEN** the destination skill and owning OpenSpec change are already known
- **THEN** routing skips the wayfinder checkpoint and presents the normal plan or apply entry

### Requirement: Wayfinder tickets resolve decisions and hand off to a spec

Each wayfinder decision ticket SHALL ask one bounded question, record the decision and evidence, and point to the next destination. A resolved map SHALL hand off to an OpenSpec proposal/specification entry, not directly to code or a pull request.

#### Scenario: One decision is unresolved

- **WHEN** a map contains competing choices about validator placement
- **THEN** the active ticket asks only which gate owns the check and records the evidence needed for that decision

#### Scenario: Decision is resolved

- **WHEN** the owner confirms the destination and acceptance boundary
- **THEN** the next instruction points to the matching `/opsx:new` or `$dhpk:openspec-new-change` entry and preserves the decision record

### Requirement: Planning remains distinct from doing

Wayfinder and OpenSpec planning guidance SHALL use explicit completion language:
`flow-guide` produces a route, rules report, next-action report, closeout
report, or usage card; it does not implement a change. `$flow-drive` is the
explicit implementation handoff only after a confirmed specification or
OpenSpec change exists. OpenSpec proposal and artifact authoring SHALL use the
`$openspec-propose` owner plus the project authoring policy, not a hidden
`flow-drive` author mode. Implementation, verification, and archive remain
separate handoffs with their own evidence.

#### Scenario: Route is complete but no specification exists

- **WHEN** `$flow-guide route` identifies an OpenSpec authoring destination but
  no confirmed specification exists
- **THEN** guidance points to `$openspec-propose`, reports planning as pending,
  and does not invoke `$flow-drive`

#### Scenario: Specification is complete

- **WHEN** an OpenSpec change has a confirmed specification and ordered tasks
- **THEN** guidance points to `$flow-drive <change-id>` as the implementation
  handoff and does not claim implementation or verification has happened

#### Scenario: Implementation is verified but not archived

- **WHEN** implementation and required tests pass while archive evidence is
  absent
- **THEN** guidance reports implementation verified and keeps lifecycle
  completion pending until archive evidence exists

#### Scenario: Proposal is complete but code is untouched

- **WHEN** the OpenSpec proposal, design, and tasks are ready for execution
- **THEN** guidance reports planning complete, identifies `$flow-drive` as the
  apply entry, and does not claim descriptions, projections, or code are
  implemented

#### Scenario: Applied change is verified

- **WHEN** implementation and required tests pass but archive has not run
- **THEN** guidance reports implementation verified and keeps lifecycle completion pending until archive evidence exists

### Requirement: Router guidance uses a consistent information architecture

`flow-guide` SHALL be the advisory owner of deterministic routing, policy
lookup, progression advice, closeout guidance, and usage discovery. Its public
actions SHALL be exactly `help`, `route`, `rules`, `next`, and `close`:

- `help` lists the Codex usage catalog or returns one usage card;
- `route` classifies a task and returns one deterministic route result, with
  optional `--go` subject to invocation policy;
- `rules` returns the applicable execution-policy guidance for a phase or
  question;
- `next` inspects the supplied change or worktree and returns one next action;
- `close` performs the final edit-boundary checklist and reports open gates.

`help`, `rules`, `next`, `close`, and `route` without `--go` SHALL be
read-only. `route --go` MAY produce only one bounded delegation handoff to an
implicit-eligible target. The guide SHALL NOT execute that target, dispatch an
explicit-only target, or inherit the target's workspace, Git, or external-write
authority.

The former `classify`, `policy`, and `checklist` names SHALL not remain live
actions. Routing SHALL not be implemented by `flow-drive`; `flow-drive` SHALL
accept only a confirmed specification or OpenSpec change for implementation.
Audit, judge, stocktake, GitNexus, investigation, review, and implementation
roles SHALL remain distinct and SHALL be represented as handoffs rather than
silently merged into the guide.

#### Scenario: User asks for a route

- **WHEN** a user invokes `$flow-guide route <task>`
- **THEN** the guide returns one typed route result with target, availability,
  invocation disposition, required evidence, and next action without starting
  implementation; the result conforms to the closed `dhpk.route-result.v3`
  object defined by the change design

#### Scenario: User asks for execution policy

- **WHEN** a user invokes `$flow-guide rules <phase-or-question>`
- **THEN** the guide returns the applicable policy source and actionable gates
  without invoking a downstream workflow

#### Scenario: User asks what to do next

- **WHEN** a user invokes `$flow-guide next <change-or-worktree>`
- **THEN** the guide records current evidence, required/skipped/unavailable
  gates, and exactly one recommended next route

#### Scenario: User asks for closeout

- **WHEN** a user invokes `$flow-guide close <change-or-worktree>`
- **THEN** the guide accounts for changed files, applicable reviews, tests,
  unresolved risks, and the handoff state without claiming commit, merge,
  release, or deployment

#### Scenario: User requests usage help

- **WHEN** a user invokes `$flow-guide help` or `$flow-guide help <skill>`
- **THEN** the guide returns the generated catalog or one usage card and does
  not load target procedures or execute the target

#### Scenario: A removed action is requested

- **WHEN** a user supplies `--mode classify`, `--mode policy`, or
  `--mode checklist` to `flow-guide`
- **THEN** parsing fails closed and identifies the corresponding action
  `route`, `rules`, or `close`

#### Scenario: A specialist route is selected

- **WHEN** routing identifies an audit, judge, stocktake, GitNexus,
  investigation, review, or implementation owner
- **THEN** the result names that distinct owner and its handoff boundary rather
  than absorbing its procedures into `flow-guide`

#### Scenario: Legacy version ID is used

- **WHEN** a user invokes a retired Laravel or PHPUnit version identity
- **THEN** guidance reports the alias-free retirement and points to the shared
  `laravel` or `phpunit` selector without resolving a legacy package

#### Scenario: Specialist roles are displayed

- **WHEN** audit, judge, stocktake, GitNexus, investigation, and review routes are listed
- **THEN** each route states its distinct scope and handoff boundary and none is silently merged

### Requirement: Discovery guidance separates always-visible cues from conditional detail

Routing guidance SHALL keep stable purpose, positive trigger, boundary, and output cues in initial metadata. Detailed version mechanics, migration traps, examples, and extended policy SHALL be linked as conditional references loaded after route selection.

#### Scenario: Initial discovery is rendered

- **WHEN** a host publishes skill descriptions before activation or user selection
- **THEN** each description remains within its lifecycle/surface budget and points to conditional detail rather than embedding the full reference body
