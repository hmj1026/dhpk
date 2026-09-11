# provider-neutral-dispatch Specification

## Purpose

TBD - created by archiving change provider-neutral-subagent-orchestration. Update Purpose after archive.

## Requirements

### Requirement: Canonical dispatch schemas are versioned and Provider-scoped

The canonical Dispatch Engine Interface SHALL accept
`dhpk.dispatch.request.v2` and return `dhpk.dispatch.receipt.v2`. The request
and receipt SHALL identify Models by Provider-scoped identity; a bare display
name SHALL not resolve a target. Existing `dhpk.cli.context.v1`,
`dhpk.cli.request.v1`, and `dhpk.cli.receipt.v1` consumers MAY use an explicit
compatibility bridge, but v1 fields SHALL not be silently reinterpreted.

#### Scenario: Bare Model name is rejected

- **WHEN** a request names `opus5` without a Provider
- **THEN** the engine returns `BLOCKED` or `UNAVAILABLE` and does not infer a
  Provider from the current Host

#### Scenario: Legacy request is translated observably

- **WHEN** a v1 compatibility caller supplies a legacy backend or
  provider-bound Role alias
- **THEN** the bridge records the requested alias, resolves one canonical Role
  and Provider-scoped target, and preserves the translation in the receipt

### Requirement: Dispatch Engine accepts Provider-neutral SubAgent requests

The Dispatch Engine SHALL accept a SubAgent request containing a Role, task,
authority, scope, optional Provider/Model target constraints, normalized Effort,
Fallback Policy, and parallelism constraints. It SHALL resolve the request into
one Execution Target without requiring a Provider-bound Role name.

#### Scenario: Cursor requests Claude Code Opus5

- **WHEN** the current Host is Cursor and a reasoner request names Provider
  `claude-code`, Model `opus5`, and Effort `high`
- **THEN** the engine resolves a Claude Code Execution Target and preserves
  `reasoner` as the Role

#### Scenario: Cursor requests Codex Sol5.6

- **WHEN** the current Host is Cursor and a reasoner request names Provider
  `codex-cli`, Model `sol5.6`, and Effort `high`
- **THEN** the engine resolves a Codex CLI Execution Target without changing
  the Role to a provider-bound name

#### Scenario: Unknown provider-bound Role is rejected at the canonical seam

- **WHEN** a new request supplies `codex-reasoner` as its canonical Role
- **THEN** the engine either records it as a legacy compatibility input with
  Provider metadata or returns `BLOCKED`, and never treats it as a new Role

### Requirement: Role, authority, and Provider selection remain independent

The engine SHALL resolve Role semantics and maximum authority independently of
Provider selection. A Provider MAY support some Roles and not others, but that
support SHALL be decided by Capability data rather than by embedding Provider
identity in the Role.

#### Scenario: One Role uses two Providers

- **WHEN** two equivalent `reviewer` requests are resolved, one through Claude
  Code and one through Codex CLI
- **THEN** both retain the same Role and authority while their Execution Targets
  differ

#### Scenario: Unsupported Role is explicit

- **WHEN** a Provider lacks the requested Role or authority
- **THEN** resolution returns `UNAVAILABLE` or `BLOCKED` with the missing
  Capability and does not silently substitute another Role

### Requirement: Native fallback is contextual to the current Host

For automatic delegation, the engine SHALL prefer the current Host's declared
Native Provider as the default fallback. It SHALL derive native status from the
Host profile and SHALL never use Claude as a universal native default.

#### Scenario: Cursor falls back to Cursor native

- **WHEN** Cursor cannot launch an explicitly selected external Provider before
  any side effect
- **THEN** the default fallback target is Cursor's Native Provider

#### Scenario: Codex CLI falls back to Codex native

- **WHEN** Codex CLI is the current Host and an external target is unavailable
  without side effects
- **THEN** the fallback target is the Codex Host's Native Provider

### Requirement: Explicit target fallback obeys the request policy

An explicitly requested Provider or Model SHALL not silently change unless the
request allows fallback. Fallback SHALL be eligible only for confirmed
unavailability without side effects; safety denial, semantic failure, timeout,
and post-side-effect outcomes SHALL return their existing terminal or handoff
state.

#### Scenario: Explicit target fails before execution

- **WHEN** a request explicitly names Codex Sol5.6, the CLI is unavailable, and
  fallback is allowed
- **THEN** the engine records the unavailable target and dispatches the current
  Host's native fallback

#### Scenario: Explicit target fails after a write

- **WHEN** the selected Provider has produced a side effect before failing
- **THEN** the engine does not dispatch the same task to another Provider and
  returns reconciliation evidence

### Requirement: Parallel dispatch is independent of Provider identity

The engine SHALL schedule independent SubAgents concurrently across any
eligible Providers. Admission SHALL depend on task dependencies, assigned-scope
conflicts, Host resources, Provider quotas, and explicit concurrency limits,
not on a blanket Provider restriction.

#### Scenario: Mixed-provider parallel wave

- **WHEN** three independent worker requests resolve to Claude Code, Codex CLI,
  and AGY with non-overlapping scopes
- **THEN** the engine may dispatch them in one parallel wave and records each
  target and assigned scope separately

#### Scenario: Scope conflict prevents unsafe concurrency

- **WHEN** two otherwise eligible requests write the same assigned file
- **THEN** the engine serializes or blocks one request and records the scope
  conflict without blaming the Provider

### Requirement: Dispatch receipts identify the resolved target

Every completed or blocked dispatch SHALL return a SubAgent receipt containing
the request Role, Host, resolved Provider, Model, Effort, Transport, authority,
scope, status, failure class when applicable, and independent verification
state.

#### Scenario: Provider choice is auditable

- **WHEN** an external Provider completes a SubAgent request
- **THEN** the receipt identifies the requested target, resolved target, and any
  rejected or fallback targets

#### Scenario: Capability failure is auditable

- **WHEN** no eligible Execution Target exists
- **THEN** the receipt reports the missing capability or access evidence and
  does not claim that a SubAgent ran

### Requirement: Lifecycle uncertainty prevents duplicate fallback

The engine SHALL distinguish capability unavailability from lifecycle outcomes
including launch, timeout, cancellation, process crash, and unknown child
process state. A target with unknown launch or side-effect state SHALL enter
reconciliation and SHALL not be dispatched again for the same task unless the
engine has positive evidence that no launch occurred and the fallback policy
allows it.

#### Scenario: Timeout does not silently switch Provider

- **WHEN** a selected Provider times out after launch state is observed
- **THEN** the receipt records `TIMEOUT` and the engine does not dispatch the
  same task to another Provider without reconciliation

#### Scenario: Pre-launch unavailability may fallback

- **WHEN** a selected target is proven unavailable before launch and fallback is
  allowed
- **THEN** the engine records the unavailable attempt and may use the contextual
  Host-native target
