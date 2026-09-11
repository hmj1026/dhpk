# provider-adapter-transport Specification

## Purpose
TBD - created by archiving change provider-neutral-subagent-orchestration. Update Purpose after archive.
## Requirements
### Requirement: Every supported Provider fills one execution Adapter contract

Each supported Provider SHALL expose an Adapter that accepts a resolved
Execution Target and Provider-neutral SubAgent request and returns one terminal
execution outcome. The Adapter SHALL translate Provider-specific model, Effort,
authority, prompt, and Transport details without selecting another Provider.

#### Scenario: Claude Code Adapter executes a resolved target

- **WHEN** the engine resolves Claude Code with Model `opus5` and Effort `high`
- **THEN** the Claude Code Adapter translates and executes that target and
  returns its terminal outcome

#### Scenario: Codex and AGY use the same lifecycle contract

- **WHEN** equivalent worker requests are sent to Codex CLI and AGY Adapters
- **THEN** both return the same outcome fields while retaining their own command
  and confirmation shapes

### Requirement: Adapters do not own selection or fallback policy

An Adapter SHALL execute only the target it receives. It SHALL not choose a
Provider, change a Model or Effort, widen authority, retry after side effects,
or apply fallback. Selection and fallback decisions SHALL remain in the
Dispatch Engine.

#### Scenario: Provider failure is returned unchanged

- **WHEN** an Adapter receives an authentication, model, or command failure
- **THEN** it returns the canonical failure evidence and does not invoke another
  Adapter

#### Scenario: Adapter cannot widen authority

- **WHEN** a read-only target is passed to a write-capable Provider Adapter
- **THEN** the Adapter blocks before launch and reports the authority mismatch

### Requirement: Capability probing is separate from execution

Capability probing SHALL be a read-only contract separate from
`ExecutionAdapter.execute`. A probe MAY verify an explicitly requested or
Host-allow-listed target using bounded installation, authentication, Model,
Effort, Transport, and authority evidence. It SHALL not launch a SubAgent,
perform a write, select another Provider, or convert `NOT_RUN` into success.

#### Scenario: Explicit target receives bounded preflight

- **WHEN** Cursor explicitly requests Claude Code `opus5` through the CLI
  Transport
- **THEN** the Claude Code capability probe returns bounded evidence before the
  Adapter executes the resolved target

#### Scenario: Automatic request does not probe undeclared Provider

- **WHEN** automatic selection encounters a Provider absent from the Host Access
  Policy
- **THEN** no probe or launch is performed and the Provider remains unavailable
  for that request

### Requirement: Transport is independent from Provider identity

The execution contract SHALL represent Transport separately from Provider. A
Provider MAY have native, local CLI, or app-server Transports, and the same
Provider MAY be native under one Host and external under another.

#### Scenario: Same Provider has contextual native status

- **WHEN** Claude Code is the current Host in one session and an external target
  in a Cursor session
- **THEN** the Provider identity remains Claude Code while native/external status
  is resolved from the current Host and Transport

#### Scenario: Unsupported Transport is explicit

- **WHEN** a Host cannot reach a Provider through the requested Transport
- **THEN** target resolution returns `UNAVAILABLE` or `BLOCKED` with Transport
  evidence and does not emulate the Transport through another Provider

### Requirement: Shared execution evidence is preserved across Adapters

All Adapters SHALL preserve the attested authority, mode, assigned scope,
prompt evidence, restricted runtime, task identity, attempt identity, timeout,
and terminal receipt rules defined by the shared execution contract.

#### Scenario: CLI argv is provider-specific but evidence is shared

- **WHEN** Codex and AGY use different command argv
- **THEN** both requests retain the same authority, scope, timeout, and receipt
  evidence fields

#### Scenario: Missing attestation blocks every external Adapter

- **WHEN** an external Adapter receives a request without valid context and
  scope attestation
- **THEN** it returns `BLOCKED` before Provider launch

### Requirement: Native Adapters use the current Host runtime

Each Host SHALL expose an explicit Native Adapter or equivalent native execution
contract. Native execution SHALL be the default fallback target and SHALL return
the same SubAgent receipt shape as external execution.

#### Scenario: Cursor native fallback is equivalent

- **WHEN** Cursor native execution is selected as fallback
- **THEN** its receipt contains the same Role, Model, Effort, authority, scope,
  and terminal status fields as a CLI Adapter receipt

#### Scenario: Native capability is unavailable

- **WHEN** the current Host cannot expose its native execution contract
- **THEN** the engine reports the fallback as unavailable instead of assuming a
  Claude-native implementation
