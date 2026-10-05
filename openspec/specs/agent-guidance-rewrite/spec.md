# Agent Guidance Rewrite Specification

## Purpose

Define the stable role, routing, and stack-safety behavior of the reviewed agent and trap guidance while its wording and organization are independently rewritten.

## Requirements

### Requirement: REQ-1 Agent rewrites retain public role and dispatch contracts

Each reviewed agent SHALL retain its established trigger, role boundary, invocation and tool/model declarations, routing targets, output contract, and write permissions unless a separately specified behavior change authorizes a change. A rewritten description SHALL continue to distinguish the role from its neighboring agents.

#### Scenario: Existing agent route is invoked

- **WHEN** a caller selects one of the reviewed agents for the same class of request as before
- **THEN** the route, role boundary, tools/model, output, and write permissions remain consistent with the pre-rewrite contract

#### Scenario: A rewrite would alter registered semantics

- **WHEN** a proposed wording change would alter a frontmatter field, route target, tool/model boundary, or permission
- **THEN** the rewrite is held for a separately specified behavior change instead of silently changing the agent contract

### Requirement: REQ-2 Retained trap guidance is unique and actionable

Each reviewed stack trap SHALL describe only behavior needed by its agent-stack pair, point to an existing canonical owner for shared rules, and state an observable trigger with the required action and a non-apply bound where the pattern commonly produces false positives. The selected trap sheets SHALL preserve their existing safety boundaries and stack-selection behavior.

#### Scenario: A shared rule already has a canonical owner

- **WHEN** a reviewed trap contains a rule owned by an existing common file, skill, or module reference
- **THEN** the trap points to that owner and does not keep a second full copy

#### Scenario: A retained trap is applied

- **WHEN** the documented stack-specific risk is present
- **THEN** the trap identifies the evidence to inspect, the action to take, and a concrete case where the rule does not apply when that boundary is needed

#### Scenario: A Postgres overlay is selected

- **WHEN** the database-reviewer selects its Postgres trap for a project using a supported Postgres signal
- **THEN** the Postgres-specific review remains available through the existing agent route and does not change the agent's stack-selection contract

### Requirement: REQ-3 Attribution accompanies retained sourced guidance

Any third-party-authored material or externally sourced technical claim retained in a reviewed agent or trap file SHALL carry its required attribution adjacent to the relevant content. The change SHALL NOT create a separate documentation provenance report.

#### Scenario: Sourced material remains in an agent or trap

- **WHEN** a reviewed file retains an attributed example, adapted passage, or sourced technical claim
- **THEN** its applicable source attribution remains in or immediately adjacent to that file content

#### Scenario: Content is independently rewritten

- **WHEN** the rewrite expresses only DHPK-owned behavior and verified facts in independent wording
- **THEN** it does not carry a misleading attribution to an upstream passage that is no longer retained
