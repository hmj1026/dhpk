# provider-neutral-dispatch Specification

## Purpose

Define Provider-neutral target resolution, current bound capabilities, role and authority validation, observable receipts, and safe scheduling and recovery across Host runtimes.

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
  `anthropic`, Target-Agent `claude-code`, Model `claude-opus-5-5`, and Effort `high`
- **THEN** the engine resolves a Claude Code Execution Target and preserves
  `reasoner` as the Role

#### Scenario: Cursor requests Codex Sol5.6

- **WHEN** the current Host is Cursor and a reasoner request names Provider
  `openai`, Target-Agent `codex-cli`, Model `gpt-5.6-sol`, and Effort `high`
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
allows it, or matching stopped and scope/diff reconciliation evidence permits
a same-Provider repair or resume.

#### Scenario: Timeout does not silently switch Provider

- **WHEN** a selected Provider times out after launch state is observed
- **THEN** the receipt records `TIMEOUT` and the engine does not dispatch the
  same task to another Provider without reconciliation

#### Scenario: Pre-launch unavailability may fallback

- **WHEN** a selected target is proven unavailable before launch and fallback is
  allowed
- **THEN** the engine records the unavailable attempt and may use the contextual
  Host-native target

### Requirement: Bound capabilities authorize only the current selected execution tuple

Current Host capability evidence SHALL retain source, state, observation time,
session, executor binding, Host, Provider, Target-Agent, role, authority,
Model, Effort, route, and transport. The engine SHALL validate it independently
of static catalog support. Explicit Host refusal SHALL override executable
evidence. Scoped refresh SHALL supersede only older matching authorized
execution tuples; a contradictory fresh batch, stale binding, or mismatched
requested transport/effort SHALL remain blocked. A current native fixed role or
default MAY retain null Model/Effort; strict concrete and external CLI targets
SHALL NOT silently substitute. Exposed selectors SHALL NOT become observed
Model/Effort; explicit `observed_model` and `observed_effort` capability fields
SHALL describe independently observed identity only in observed evidence states,
and runtime observed identity SHALL come from actual outcome evidence.

#### Scenario: Current model absent from a stale catalog

- **WHEN** an authorized selected target has matching current bound executable Host evidence but no shipped catalog row
- **THEN** the engine may resolve it while catalog support remains independently unsupported

#### Scenario: Native role exposes no model identity

- **WHEN** the current Provider has matching current native Host role/authority evidence with unknown Model and Effort
- **THEN** the target and receipt retain explicit null identity fields and the native adapter emits no fabricated model argument

#### Scenario: Explicit Host refusal and fresh contradiction

- **WHEN** the Host refuses a Provider or one fresh batch contradicts itself for the same execution tuple
- **THEN** the engine blocks that target without external execution or policy bypass

### Requirement: Flow Drive recovery preserves exclusive writer lifecycle and attempt evidence

Flow Drive SHALL serialize every workspace writer, including scratch output,
across solo and coordinated invocations. Readers MAY continue independently.
An invocation-wide retry budget SHALL count only admitted replacements, and
prior immutable attempt receipts SHALL retain actual IDs, failure class,
side effects, verification, capability provenance, and reconciliation state.
Availability substitution SHALL require confirmed no effects, authorization,
non-strict selection, and remaining budget. Semantic repair SHALL stay on the
same Provider with actual diff reconciliation. Safety/user denial and affected
quota failure SHALL stop. Timeout, interruption, thrown execution, or malformed
launched outcomes SHALL require positive matching stop and physical scope/diff
reconciliation; missing proof SHALL suspend writers. This Flow Drive policy
SHALL preserve generic legacy scheduler parallelism and configuration semantics.

#### Scenario: Interrupted writer cannot overlap its replacement

- **WHEN** a launched writer is interrupted with incomplete stop or reconciliation proof
- **THEN** queued and new writers remain blocked while independent readers may progress

#### Scenario: Verified dependency recovery invalidates stale downstream reuse

- **WHEN** an affected prerequisite executes freshly or recovers
- **THEN** dependent acceptance evidence is verified freshly while unrelated validated reuse may remain
