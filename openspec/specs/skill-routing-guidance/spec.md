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

Wayfinder and OpenSpec planning guidance SHALL use explicit completion language: a destination map, proposal, design, task list, version-router/alias plan, or projection parity plan is not an applied implementation. Implementation, verification, and archive remain separate handoffs with their own evidence. A concise compatibility alias or deterministic projection plan SHALL not be reported as a renamed, applied, or verified skill until the corresponding implementation and checks have run.

#### Scenario: Proposal is complete but code is untouched

- **WHEN** the umbrella proposal, router design, and tasks are ready for execution
- **THEN** guidance reports planning complete, identifies the apply entry, and does not claim descriptions, aliases, or projections are fixed

#### Scenario: Applied change is verified

- **WHEN** implementation and required tests pass but archive has not run
- **THEN** guidance reports implementation verified and keeps lifecycle completion pending until archive evidence exists

### Requirement: Router guidance uses a consistent information architecture

User-facing routing guidance SHALL organize distributed workflows as a main flow, situational on-ramps, and standalone tools. Versioned Laravel and PHPUnit entries SHALL use the shared family router and conditional references while retaining stable legacy IDs as compatible aliases. Audit, judge, stocktake, GitNexus, investigation, and review roles SHALL remain distinct.

#### Scenario: Legacy version ID is used

- **WHEN** a user invokes a retained Laravel or PHPUnit legacy ID
- **THEN** guidance resolves it to the shared router and matching conditional reference without requiring a breaking rename or duplicating full version detail in discovery metadata

#### Scenario: Specialist roles are displayed

- **WHEN** audit, judge, stocktake, GitNexus, investigation, and review routes are listed
- **THEN** each route states its distinct scope and handoff boundary and none is silently merged

### Requirement: Discovery guidance separates always-visible cues from conditional detail

Routing guidance SHALL keep stable purpose, positive trigger, boundary, and output cues in initial metadata. Detailed version mechanics, migration traps, examples, and extended policy SHALL be linked as conditional references loaded after route selection.

#### Scenario: Initial discovery is rendered

- **WHEN** a host publishes skill descriptions before activation or user selection
- **THEN** each description remains within its lifecycle/surface budget and points to conditional detail rather than embedding the full reference body
