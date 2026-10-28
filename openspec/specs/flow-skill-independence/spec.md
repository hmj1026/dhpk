# flow-skill-independence Specification

## Purpose

Define independent Flow Guide and Flow Drive entry points, with shared policy
owned outside either skill and explicit execution and acceptance boundaries.

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

`flow-drive` SHALL accept one bounded task as text, a task file, or a confirmed
specification/change and execute it with the current Host and Model without
loading, invoking, or requiring `flow-guide`. Unclear or incomplete input
SHALL produce an explicit blocker before dependent edits.

#### Scenario: Drive is installed alone

- **WHEN** `flow-drive` receives a confirmed change in a package where
  `flow-guide` is absent
- **THEN** it performs its own implementation and verification workflow

#### Scenario: Missing confirmation blocks drive

- **WHEN** `flow-drive` receives an unconfirmed proposal without the required
  implementation boundary
- **THEN** it returns an explicit blocker without delegating to `flow-guide`

### Requirement: Shared policy does not create a skill dependency

Any shared contract consumed by `flow-guide` SHALL be resolved through
resources owned by its own distribution. This includes shared route, policy,
Domain, dispatch, flow-handoff, and skill-next-map contracts. `flow-guide` MAY
consume these shared contracts, and
`flow-drive` SHALL NOT require them to perform a task. Neither skill MAY load
the other's instructions or implementation files, and shared data SHALL NOT
grant execution authority to `flow-guide`.

The skill-next-map contract remains available for skills that declare it.
`flow-guide` MAY parse that frontmatter as data through a bounded reader bundled
locally with the Skill. The relocated reader SHALL NOT depend on repository
manifests or import the CI parser; the CI nested parser/allowlist SSOT remains
`scripts/ci/_lib/frontmatter.js`. It SHALL NOT load peer skill procedure
bodies, references, or implementation files in order to choose a next route
(SHF-REQ-004, SHF-REQ-008). Flow Drive's native task completion is terminal and
does not declare a required `dhpk-next` route.

Typed `next` and `route` handoffs SHALL reuse schema `dhpk.flow.handoff.v1`
(`handoff_id`, `owner`, `host`, `disposition`, `next_action`,
`execution: not-started`, evidence states
`available|unavailable|not-run|blocked|not-configured`). This change SHALL NOT
introduce a second handoff schema.

#### Scenario: Shared route data is portable

- **WHEN** Flow Guide consumes shared typed handoff data
- **THEN** each interprets only the fields within its own authority and no skill
  dependency is created

#### Scenario: Guide cannot execute a target

- **WHEN** `flow-guide route --go` produces a bounded handoff
- **THEN** the result identifies the next owner and evidence boundary but does
  not claim SubAgent or implementation execution

#### Scenario: Guide reads peer frontmatter as data

- **WHEN** `flow-guide next` resolves a declared next skill from another
  skill's `metadata.dhpk-next`
- **THEN** it uses only parsed frontmatter fields and the shared handoff
  contract, does not load that peer's procedure body, and still reports
  `execution: not-started`

#### Scenario: Next handoff keeps the existing schema

- **WHEN** `flow-guide next` emits a typed handoff
- **THEN** the object validates as `dhpk.flow.handoff.v1` with a non-empty
  `next_action` and does not declare a new schema id

### Requirement: Shared selection reports remain Host-neutral

Whenever Flow Guide reports execution selection, its public contract SHALL use
Host, Provider, Model, Role, Effort, and handoff terminology. It SHALL not
require Claude-specific names to operate on Cursor, Codex CLI, or AGY Hosts.
Flow Drive does not expose execution-selection options.

#### Scenario: Cursor route reports a Provider target

- **WHEN** a Cursor Host requests guidance for a Claude Code or Codex target
- **THEN** the result identifies the Provider and Model without relabeling the
  Role as a provider-bound agent

#### Scenario: Codex Host uses the same guide contract

- **WHEN** Codex CLI invokes the same guide action as Claude Code
- **THEN** the action and result schema remain equivalent except for Host data

### Requirement: Flow Drive is a self-contained native task entry

A copied Flow Drive directory SHALL contain only its skill entry, supported
Host metadata, distribution declaration, and migration reference. It SHALL
perform one bounded task with the current Host and Model without a sibling
skill, canonical checkout, resource synchronization, invocation parser,
external runner, or Flow Drive-specific execution receipt. The Host instructions
SHALL preserve task scope, authorization, consumer Project Convention, observed
verification, and blocker reporting.

Shared CLI-dispatch support required by delegated native agents or Flow Guide
SHALL remain owned and distributed outside Flow Drive. Those consumers MAY
receive a generated closure of the shared support resources they need; this
closure SHALL NOT make Flow Drive a runtime owner or require task-only Flow
Drive acquisition to include the shared engine.

#### Scenario: The copied task entry has no runtime closure

- **WHEN** a consumer copies only the complete canonical Flow Drive directory
- **THEN** the task instructions and migration reference remain available without a runtime script, sibling skill, or canonical checkout

#### Scenario: Shared delegated support remains outside Flow Drive

- **WHEN** a projected native agent or Flow Guide uses shared CLI-dispatch support
- **THEN** its package closure resolves that support from the shared canonical owner without copying it into Flow Drive

#### Scenario: Native task completion is terminal

- **WHEN** Flow Drive completes or reports a blocker for its bounded task
- **THEN** it does not require a `flow-guide` follow-on route to finish the public workflow
