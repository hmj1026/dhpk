## ADDED Requirements

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
Wayfinder and OpenSpec planning guidance SHALL use explicit completion language: a destination map, proposal, design, or task list is not an applied implementation. Implementation, verification, and archive remain separate handoffs with their own evidence.

#### Scenario: Proposal is complete but code is untouched
- **WHEN** the umbrella proposal and tasks are ready for execution
- **THEN** guidance reports planning complete, identifies the apply entry, and does not claim the issues are fixed

#### Scenario: Applied change is verified
- **WHEN** implementation and required tests pass but archive has not run
- **THEN** guidance reports implementation verified and keeps lifecycle completion pending until archive evidence exists
