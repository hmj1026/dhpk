# skill-routing-guidance Specification

## Purpose

Defines how routing guidance selects a workflow owner, communicates policy and next steps, and preserves implementation, verification, and archive as separate evidence-backed handoffs.

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
- `next` inspects the supplied change or worktree, determines the current
  skill and result state from that evidence, and returns one next action
  resolved from the current skill's declared frontmatter next map when that
  map applies (SHF-REQ-004);
- `close` performs the final edit-boundary checklist and reports open gates.

`help`, `rules`, `next`, `close`, and `route` without `--go` SHALL be
read-only. `route --go` MAY produce only one bounded delegation handoff to an
implicit-eligible target. The guide SHALL NOT execute that target, dispatch an
explicit-only target, or inherit the target's workspace, Git, or external-write
authority.

The former `classify`, `policy`, and `checklist` names SHALL not remain live
actions. Routing SHALL not be implemented by `flow-drive`; `flow-drive` SHALL
accept one bounded task, task-file, or confirmed specification/change input
for implementation and SHALL use the current Host and Model.
Audit, judge, stocktake, GitNexus, investigation, review, and implementation
roles SHALL remain distinct and SHALL be represented as handoffs rather than
silently merged into the guide.

Progression advice and the `next` result SHALL store canonical skill `name`
values from the declaration map and SHALL format Host-facing invocation at
render time (SHF-REQ-006). They SHALL NOT emit a retired or unmatched slash
command as the next route when a declaration applies. A typed handoff from
`next` SHALL reuse `dhpk.flow.handoff.v1` and SHALL keep `execution` as
`not-started`.

Git status, review-state, and phase detection remain inputs to choosing the
current skill and result state. They SHALL NOT be a second source of next-skill
identity.

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
  gates, and exactly one recommended next route whose skill identity comes from
  the applicable declared next map, formatted for the current Host, and whose
  typed handoff uses `dhpk.flow.handoff.v1`

#### Scenario: Next follows a declared PASS mapping

- **WHEN** worktree evidence selects a workflow-chain skill whose `dhpk-next`
  maps `PASS` to canonical skill `repo-verify`
- **THEN** `next` names `repo-verify` as the next route and does not name
  `/verify` or another unmatched slash command as that route

#### Scenario: Next does not revive a retired command string

- **WHEN** phase detection would previously have suggested the retired
  `/req-analyze` command
- **THEN** `next` either names a declared canonical skill from the applicable
  map or reports no skill route; it does not emit `/req-analyze`

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

### Requirement: Workflow-chain skills declare host-neutral next maps

SHF-REQ-001, SHF-REQ-002, SHF-REQ-006, SHF-REQ-007: Each skill in the closed
first-wave workflow-chain set SHALL declare a nested `metadata` mapping
`dhpk-next` in canonical `SKILL.md`. Keys SHALL be a closed result state
(`PASS`, `FAIL`, `BLOCKED`, `NOT_RUN`, `UNAVAILABLE`) or `mode:STATE` where
`STATE` is in that set. Values SHALL be the terminal marker `none`, a
canonical skill `name`, or `name:mode`. Stored values SHALL be Host-neutral
skill identities, not `/command` or `$command` strings.

The keys SHALL live under nested `metadata:` beside `dhpk-invocation-class`.
A dotted top-level substitute (`metadata.dhpk-next`) SHALL fail validation.
Optional `dhpk-modes` MAY list modes the skill exposes; a `name:mode` target
SHALL name a mode from that list when the target skill declares it.

Skills outside the first-wave set MAY omit `dhpk-next`. If they declare it,
the same shape and closed sets SHALL apply. Invocation class metadata SHALL
remain required and unchanged by this mapping. The closed first-wave set SHALL
be `code-trace`, `tdd-workflow`, `repo-verify`, `change-verdict`, `precommit`,
`code-simplify`, `doc-maintain`, `git-smart-commit`, `create-pr`, and
`opsx-apply-resume`. Every declared target SHALL exist before enforcement.
Flow Drive is outside the workflow-chain set: its native task completion is
terminal and SHALL NOT require a sibling follow-on skill.

`precommit` `PASS` SHALL target `doc-maintain:update`. `doc-maintain` SHALL
declare modes `update`, `codemap`, and `refactor`, set all five unprefixed
states to `none`, and declare only `update:PASS` as the handoff to
`git-smart-commit`. Mode outputs and documentation authority SHALL remain
intact. An explicit-only target SHALL be presented with a wait boundary;
metadata SHALL NOT authorize its execution.

#### Scenario: First-wave skill omits the next map

- **WHEN** a skill in the closed workflow-chain set has no nested `dhpk-next`
  after enforcement
- **THEN** validation fails with that skill's canonical path

#### Scenario: Next map stores a slash command

- **WHEN** a `dhpk-next` value is `/verify`, `/precommit`, or another slash or
  `$` invocation string
- **THEN** validation fails and names the illegal value

#### Scenario: Dotted metadata key is substituted

- **WHEN** frontmatter declares `metadata.dhpk-next` as a dotted top-level key
- **THEN** validation fails with the expected nested YAML shape

#### Scenario: Skill outside the chain omits the map

- **WHEN** a distributed skill is not in the first-wave workflow-chain set and
  has no `dhpk-next`
- **THEN** validation does not require the map and still enforces
  `dhpk-invocation-class`

#### Scenario: Documentation update has its own handoff

- **WHEN** the current skill is `doc-maintain`, mode `update`, with state `PASS`
- **THEN** advice names `git-smart-commit` and presents its explicit-only wait
  boundary without executing it

#### Scenario: Other documentation modes do not inherit update handoff

- **WHEN** `doc-maintain` reports `PASS` for `codemap`, `refactor`, or an unknown mode
- **THEN** lookup returns unprefixed `none`, preserves the selected mode's output
  and authority, and does not select the `update:PASS` handoff

### Requirement: Progression advice is generated from declared next maps

SHF-REQ-005: Agent-facing progression tables SHALL be derived from declared
`dhpk-next` maps and SHALL NOT be an independently edited source of next-skill
identity. A checked-in table MAY exist only as a generated fallback. Manual
edits to that fallback SHALL NOT be accepted as the chain SSOT; regeneration
or removal SHALL restore declaration ownership. `flow-guide next` SHALL read
declarations, not the table, to choose the next skill.

#### Scenario: Table disagrees with declarations

- **WHEN** a checked-in progression table names a next step that is absent
  from the producing skill's `dhpk-next` map
- **THEN** the table is nonconforming until regenerated or removed, and
  `next` still follows the declaration

#### Scenario: Generated fallback is current

- **WHEN** progression tables are regenerated from valid `dhpk-next` maps
- **THEN** every next-step skill identity in the table matches a declared
  canonical `name` or `none`
