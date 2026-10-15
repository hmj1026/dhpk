# flow-skill-independence Specification

## Purpose

Define independent, portable Flow Guide and Flow Drive workflows with shared neutral contracts, optional peer evidence, and explicit execution and acceptance boundaries.

## Requirements

### Requirement: Flow Guide operates without Flow Drive

`flow-guide` SHALL provide its read-only help, route, rules, next, and close
actions without loading, invoking, or requiring the `flow-drive` skill. A route
may identify an implementation owner, but route generation SHALL remain
advisory and shall not execute the owner.

#### Scenario: Guide is installed alone

- **WHEN** `flow-guide` is invoked in a package where `flow-drive` is absent
- **THEN** its requested read-only action returns its normal typed result

#### Scenario: Guide names an unavailable implementation owner

- **WHEN** a route points to `flow-drive` but that skill is not installed
- **THEN** the guide reports an unavailable handoff and still completes its own
  route contract

### Requirement: Flow Drive operates without Flow Guide

`flow-drive` SHALL accept settled task text, a task file, or a confirmed specification/change and execute its
implementation workflow without loading, invoking, or requiring `flow-guide`.
Unclear or incomplete input SHALL produce an explicit blocker or use the
implementation contract's own validation path.

#### Scenario: Drive is installed alone

- **WHEN** `flow-drive` receives a confirmed change in a package where
  `flow-guide` is absent
- **THEN** it performs its own implementation and verification workflow

#### Scenario: Missing confirmation blocks drive

- **WHEN** `flow-drive` receives an unconfirmed proposal without the required
  implementation boundary
- **THEN** it returns an explicit blocker without delegating to `flow-guide`

### Requirement: The two skills share neutral contracts only

Each skill SHALL consume shared route, policy, Domain, and dispatch contracts
without importing or loading the other's
skill instructions, references, or
implementation files. A shared contract SHALL not grant execution authority to
`flow-guide`.

#### Scenario: Shared route data is portable

- **WHEN** both skills consume the same typed handoff data
- **THEN** each interprets only the fields within its own authority and no skill
  dependency is created

#### Scenario: Guide cannot execute a target

- **WHEN** `flow-guide route --go` produces a bounded handoff
- **THEN** the result identifies the next owner and evidence boundary but does
  not claim SubAgent or implementation execution

### Requirement: Both skills expose Host-neutral invocation semantics

The public contracts of both skills SHALL use the same Host, Provider, Model,
Role, Effort, and handoff terminology wherever execution selection is reported.
They SHALL not require Claude-specific names to operate on Cursor, Codex CLI, or
AGY Hosts.

#### Scenario: Cursor route reports a Provider target

- **WHEN** a Cursor Host requests guidance for a Claude Code or Codex target
- **THEN** the result identifies the Provider and Model without relabeling the
  Role as a provider-bound agent

#### Scenario: Codex Host uses the same guide contract

- **WHEN** Codex CLI invokes the same guide action as Claude Code
- **THEN** the action and result schema remain equivalent except for Host data

### Requirement: Flow Drive owns portable execution resources and completion gates

A copied complete Flow Drive Skill directory SHALL resolve necessary execution
contracts within its own scripts and references without a sibling skill or
canonical checkout fallback. Injected Host executors and explicitly selected
external tools MAY remain environment dependencies. Missing optional peers
SHALL NOT alone block work; reusable evidence SHALL require current task,
prompt, baseline, and dependency validation. Necessary independent review
SHALL require distinct observed executor evidence.

The installed raw Flow Drive Skill SHALL contain the transport, dispatch-context,
Codex adapter, and AGY adapter resources formerly owned by
`skills/dhpk-cli-transport`, `skills/dhpk-cli-dispatch-context`,
`skills/dhpk-codex-bridge`, and `skills/dhpk-agy-fast-worker`, including transitive
runtime helpers, before those source directories and registrations are deleted.
It SHALL run from an arbitrary installation location and working directory
without reading a sibling Skill or source checkout root. Authoring-time
deterministic resource generation remains permitted and SHALL NOT create an
installed fallback. The existing common engine SHALL remain the sole selection
and authority policy owner. This consolidation obligation is tracked as
`REQ-FDR-001` without renaming the existing requirement.

#### Scenario: Native coordination in a blank consumer

- **WHEN** a complete copied Skill runs a confirmed task with only an injected native Host and no canonical checkout visibility
- **THEN** it diagnoses, serializes all assigned writers, verifies each item, and reports parent acceptance through its local resources

#### Scenario: Optional evidence and necessary independent review

- **WHEN** sufficient validated diagnosis is reusable but no distinct observed reviewer can satisfy a necessary review gate
- **THEN** diagnosis may be reused while that review gate remains explicitly blocked

#### Scenario: Partial task has an unknown cause

- **WHEN** one cause is insufficient and a separate defect has sufficient diagnosis
- **THEN** the first writer never launches and the independent defect retains its implementation, tests, and review evidence without claiming aggregate PASS

#### Scenario: Four-source removal follows verified closure

- **WHEN** the four predecessor dependencies and all transitive helpers are locally materialized and relocated raw Skill closure is proven without sibling or source checkout access
- **THEN** atomic removal of their sources and registrations is permitted, while any missing required resource keeps deletion blocked
