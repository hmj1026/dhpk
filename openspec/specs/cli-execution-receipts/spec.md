# cli-execution-receipts Specification

## Purpose
Define one fail-closed transport boundary for Codex and AGY CLI dispatches,
including immutable caller authority, restricted named runtimes, exact provider
argv/stdin shapes, and contained terminal evidence.
## Requirements
### Requirement: External CLI dispatch uses one attested normalized request

Every supported external Provider execution SHALL enter a provider-neutral
runner through a validated normalized request bound to a private, regular,
non-symlink context from the caller. The request SHALL identify Host, Provider,
requested/effective Role, authority mode, Transport, Provider-scoped Model,
normalized Effort, restricted named runtime path, workdir, immutable prompt
evidence, assigned repository-relative files, report-only mode, timeout, task
identity, attempt identity, receipt path, and an immutable caller-resolved Role
contract. Compatibility wrappers MAY translate old arguments, but SHALL not
bypass validation or alter attested fields. Direct runner or wrapper calls
without context binding SHALL return `BLOCKED` before Provider launch.

#### Scenario: Complete request is accepted

- **WHEN** a caller supplies a valid Host, Provider, Role, authority, bounded
  scope, prompt, Model/Effort when applicable, timeout, task/attempt identity,
  receipt path, and matching Role contract
- **THEN** the runner normalizes one immutable request before launching the
  Provider

#### Scenario: Invalid authority or target is blocked

- **WHEN** Role, authority, scope, identity, Model, Effort, Transport, or
  attestation validation fails
- **THEN** the runner returns `BLOCKED` before starting the external Provider

### Requirement: Provider adapters do not own shared lifecycle policy

Claude Code, Codex CLI, AGY, and future external Adapters SHALL translate only
the fixed, attested Provider shape into an execution request. The runner SHALL
independently reconstruct and compare restricted runtime evidence and exact
Provider invocation details before launch. Adapters SHALL not add mutable argv,
structured-output, timeout, or environment overrides. Temporary files,
redaction, timeout enforcement, output capture, status classification, receipt
writing, and cleanup SHALL be owned by the shared runner.

#### Scenario: All Providers share lifecycle evidence

- **WHEN** equivalent requests are launched through Claude Code, Codex CLI, and
  AGY Adapters
- **THEN** all produce the same receipt shape and timeout/status semantics while
  retaining Provider-specific command details

#### Scenario: Provider failure is not silently substituted

- **WHEN** an Adapter reports authentication, authorization, Model, or command
  failure
- **THEN** the runner records the exact failure and leaves any fallback decision
  to the Dispatch Engine

### Requirement: Every launch emits an auditable receipt

The runner SHALL emit one receipt with terminal status `SUCCEEDED`, `FAILED`,
`BLOCKED`, or `TIMEOUT`, never `PARTIAL`; requested and effective Host,
Provider, Role, Transport, Provider-scoped Model, normalized Effort; task,
attempt, and launch identities; process exit code; configured/enforced timeout;
report presence and bounded digest; assigned-scope digest; the complete Role
contract; fallback history; and independent verification status. Unknown
effective runtime values SHALL be represented as unknown rather than inferred.
The receipt SHALL also record catalog version, Host Profile version, Adapter
version, capability evidence, and the source of requested/effective target
resolution.

#### Scenario: Explicit Model is evidenced

- **WHEN** a caller requests a Model and the Provider confirms the effective
  Model
- **THEN** the receipt records requested and effective Model with the
  confirmation source

#### Scenario: Inherited Model is not overclaimed

- **WHEN** a Provider inherits a Model from external configuration and no runtime
  evidence exposes it
- **THEN** the receipt records `effective_model=unknown` and
  `model_evidence=unavailable`

#### Scenario: Receipt is redacted and atomic

- **WHEN** a launch completes or is blocked before launch
- **THEN** the receipt is written atomically without prompt content, secrets,
  raw output, or unredacted private paths

#### Scenario: Target evidence is reproducible

- **WHEN** a dispatch completes, is blocked, or reaches a lifecycle failure
- **THEN** the receipt identifies the catalog, Host Profile, and Adapter
  versions used, the requested and effective targets, rejected or fallback
  targets, and the evidence status without exposing secrets or raw output

### Requirement: Timeout status remains truthful

The shared runner SHALL own deadline enforcement and distinguish its observed
process-group timeout from a backend-native exit code. A runner-observed kill
is `TIMEOUT`; a native provider exit 124 remains `FAILED`. The adapters SHALL
not depend on `timeout` or `gtimeout`, and any logging pipeline SHALL preserve
the provider status.

#### Scenario: `tee` cannot mask a timeout

- **WHEN** a provider exceeds the attested runner deadline and its output is
  logged through `tee`
- **THEN** the runner returns non-zero, records `TIMEOUT`, and retains runner
  timeout evidence rather than reporting the `tee` success code

#### Scenario: Salvaged output is not verification

- **WHEN** a timeout leaves a non-empty backend report
- **THEN** the receipt records the report as timeout evidence and independent
  verification remains required

### Requirement: Execution mode and verification boundary are explicit

The request SHALL declare `read-only` or `workspace-write` authority. Role
contracts SHALL not receive a wider mode than their maximum authority; workers
remain bounded by their assigned file list. Canonical Roles and compatibility
aliases SHALL be resolved outside the runner. The runner SHALL never treat a
Provider report, Role label, installer receipt, or valid JSON shape as proof
that work was performed or verified.

#### Scenario: Review is read-only

- **WHEN** a reviewer request is dispatched through any Provider
- **THEN** the runner launches it in read-only mode and the receipt records that
  mode

#### Scenario: Worker verification is independent

- **WHEN** a write-capable worker returns a successful self-report
- **THEN** its caller still derives assigned-file changes and runs the declared
  verification independently before accepting the task

### Requirement: Maximum authority and runner containment are enforced

The runner SHALL interpret Role authority as maximum capability and SHALL use
the resolved Role contract rather than Provider-specific Role names. Requests
may narrow but cannot widen authority. The runner SHALL own timeout observation
and use realpath/no-follow/atomic artifact-root containment with pinned
descriptors, private temporary and receipt files, redaction before bounded
capture, and fail-closed out-of-scope-write detection.

#### Scenario: Read-only authority cannot be widened

- **WHEN** a `reasoner` or `reviewer` request asks for workspace-write
- **THEN** the runner returns `BLOCKED` before Provider launch

### Requirement: AGY prompt and confirmation transport are explicit

Codex SHALL use its supported non-argv stdin prompt transport. AGY's supported
stream prompt mode consumes stdin and therefore cannot carry the separate plan
confirmation. The AGY adapter SHALL retain its attested `-p` prompt argument
and provide only the exact bounded `Y\n` confirmation on stdin; it SHALL not
retry or silently select another transport.

#### Scenario: AGY confirmation stays bounded

- **WHEN** an AGY request is launched
- **THEN** its provider argv contains the attested prompt and its stdin contains
  exactly `Y\n`
