# cli-backed-fast-workers Specification

## Purpose

Define the Codex and AGY mechanical-worker contracts while routing all external
CLI execution through one immutable, contained transport boundary.
## Requirements
### Requirement: CLI-backed fast-worker agents preserve the mechanical contract

The plugin SHALL expose a mechanically equivalent `worker` contract for every
supported Provider Adapter. Existing Codex and AGY worker definitions and their
compatibility aliases remain during migration; Claude Code and Host-native
workers use the same Provider-neutral Role contract. Each worker SHALL require
a precise task spec, make surgical edits only, independently run verification,
derive its edited-file list from the working tree, and escalate after three
failed verification attempts instead of guessing.

#### Scenario: Ambiguous spec escalates

- **WHEN** change intent, scope, authority, or verification is underspecified
- **THEN** the worker returns `BLOCKED` before invoking any external Provider

#### Scenario: Provider does not redefine the Role

- **WHEN** the same mechanical task is assigned to Claude Code, Codex CLI, AGY,
  or a Host-native Adapter
- **THEN** every worker reports canonical Role `worker` and records Provider
  separately

### Requirement: Provider invocation is immutable and transport-owned

The dispatcher SHALL resolve maximum Role authority, mode, assigned scope,
Provider-scoped Model, normalized Effort, deadline, prompt evidence, and a
named restricted runtime into a private normalized context. Compatibility
wrappers SHALL require that context and translate only legacy positional
arguments; they SHALL not fabricate authority, inherit ambient `PATH`, or add
mutable argv/options. The shared runner SHALL independently reconstruct the
named runtime evidence and exact Provider invocation before launch.

Each Provider Adapter SHALL retain its documented command, prompt, confirmation,
and Transport rules. Neither the worker nor Adapter SHALL use a different
Provider to simulate a missing target or retry after a side effect.

#### Scenario: Direct legacy call is blocked

- **WHEN** a caller invokes a compatibility wrapper without attested context
- **THEN** it returns `BLOCKED` before Provider execution

#### Scenario: Provider argv is altered

- **WHEN** a request contains an additional Provider flag or different runtime
- **THEN** the shared runner returns `BLOCKED` before Provider execution

#### Scenario: Model and Effort remain attested

- **WHEN** an Adapter receives a resolved Provider-scoped Model and normalized
  Effort
- **THEN** its translated invocation matches the attested values or returns
  `BLOCKED` without silently changing them

### Requirement: Timeout and receipt evidence are shared

The portable runner SHALL enforce the attested deadline, terminate its provider
process group when needed, and create one terminal `dhpk.cli.receipt.v1` with
status `SUCCEEDED`, `FAILED`, `BLOCKED`, or `TIMEOUT`. A `TIMEOUT` receipt is
the only accepted timeout evidence; a provider report is never independent
verification and no receipt uses `PARTIAL` as launch status.

#### Scenario: Runner timeout is contained

- **WHEN** either provider exceeds the attested deadline
- **THEN** the wrapper returns `124` and a contained `0600` terminal `TIMEOUT`
  receipt exists without a shell timeout binary

### Requirement: Backend failure cannot silently widen or substitute work

Missing executable, authentication, authorization, rejected model, context, or verification errors SHALL be reported as `BLOCKED`; configured fallback may
apply only to a deterministic missing executable before a provider starts. The
agents SHALL never self-edit to simulate a provider or choose another provider
after an auth, model, execution, or timeout failure.

#### Scenario: Provider report claims success

- **WHEN** a provider exits successfully with a non-empty report
- **THEN** the worker still verifies the assigned scope independently before it
  reports completion
