# cli-execution-receipts Specification

## Purpose
Define one fail-closed transport boundary for Codex and AGY CLI dispatches,
including immutable caller authority, restricted named runtimes, exact provider
argv/stdin shapes, and contained terminal evidence.

## Requirements

### Requirement: External CLI dispatch uses one attested normalized request

Every Codex or AGY external execution SHALL enter a provider-neutral runner
through a validated `dhpk.cli.request.v1` request bound to a private,
regular, non-symlink `dhpk.cli.context.v1` from the caller. The request SHALL identify
provider, requested/effective role, mode, exact transport, model/effort,
restricted named runtime path, workdir, immutable prompt path/device/inode/digest,
assigned repository-relative files, explicit report-only mode, requested
model/effort when supplied, timeout, task identity,
attempt identity, a receipt path contained by an approved artifact root, and an
immutable caller-resolved `dhpk.role-contract.v1`. That role envelope SHALL
contain authority (`read-only` or `workspace-write`), source ID, and lowercase
SHA-256 over canonical JSON for requested role, effective role, authority, and
source ID. Positional compatibility wrappers MAY translate old arguments, but
they SHALL not bypass validation or alter any attested field after validation. Direct
runner or legacy wrapper calls without this context binding SHALL return
`BLOCKED` before provider launch.

#### Scenario: Complete request is accepted

- **WHEN** a caller supplies a valid provider, role, mode, bounded assigned
  scope, prompt, timeout, task id, attempt id, receipt path, and matching role
  contract
- **THEN** the runner normalizes one immutable request before launching the
  provider

#### Scenario: Invalid write request is blocked

- **WHEN** a read-only role is given workspace-write mode, or timeout/scope/
  identity/role-contract validation fails
- **THEN** the runner returns `BLOCKED` before starting the external CLI

### Requirement: Provider adapters do not own shared lifecycle policy

Codex and AGY adapters SHALL translate only the fixed, attested provider shape
into a request. The runner SHALL independently reconstruct and compare the
restricted named runtime evidence and exact provider argv before launch;
adapters SHALL not add mutable argv, structured-output, timeout, or environment
overrides. Temporary files, redaction, timeout enforcement, output capture,
status classification, receipt writing, and cleanup SHALL be owned by the
shared runner. Existing wrapper scripts SHALL remain callable only as thin
compatibility translators during migration.

#### Scenario: Both providers share lifecycle evidence

- **WHEN** equivalent Codex and AGY requests are launched
- **THEN** both produce the same receipt shape and timeout/status semantics
  while retaining provider-specific command flags

#### Scenario: Provider failure is not silently substituted

- **WHEN** a provider rejects authentication, authorization, model, or command
  execution
- **THEN** the adapter returns the exact failure as `FAILED` or `BLOCKED` and
  does not select another provider

### Requirement: Every launch emits an auditable receipt

The runner SHALL emit a `dhpk.cli.receipt.v1` receipt with terminal status
`SUCCEEDED`, `FAILED`, `BLOCKED`, or `TIMEOUT`, never `PARTIAL`; requested and
effective provider, role, transport, model, and effort; task, attempt, and
launch identities; process exit code; configured/enforced timeout and verified
runner-timeout evidence; report presence and bounded digest; assigned-scope
digest; the complete validated `dhpk.role-contract.v1`; and independent
verification status. Unknown effective runtime values SHALL be represented as
unknown rather than inferred from a request.

#### Scenario: Explicit model is evidenced

- **WHEN** a caller requests a model and the provider confirms the effective
  model
- **THEN** the receipt records both requested and effective model with the
  confirmation source

#### Scenario: Inherited model is not overclaimed

- **WHEN** a provider inherits a model from external configuration and no
  runtime evidence exposes it
- **THEN** the receipt records `effective_model=unknown` and
  `model_evidence=unavailable`

#### Scenario: Receipt is redacted and atomic

- **WHEN** a launch completes or is blocked before launch
- **THEN** the receipt is written atomically without prompt content, secrets,
  raw output, or unredacted private paths

#### Scenario: Follow-up state is not a terminal receipt status

- **WHEN** a launch needs later task or ledger work
- **THEN** the receipt contains an immutable follow-up record atomically
- **AND** neither receipt nor follow-up uses `PARTIAL` as launch status

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

The request SHALL declare `read-only` or `workspace-write` mode. Read-only
role contracts SHALL not receive write mode; write-capable workers remain
bounded by their assigned file list. Canonical role IDs and aliases SHALL be
resolved outside the runner. The runner SHALL never treat a backend report,
role label, installer receipt, or valid JSON shape as proof that the work was
performed or verified.

#### Scenario: Review is read-only

- **WHEN** a reviewer request is dispatched
- **THEN** the runner launches it in read-only mode and the receipt records that
  mode

#### Scenario: Worker verification is independent

- **WHEN** a write-capable worker returns a successful self-report
- **THEN** its caller still derives assigned-file changes and runs the declared
  verification command independently before accepting the task

### Requirement: Maximum authority and runner containment are enforced

The runner SHALL interpret authority as maximum capability:
`codex-reasoner` is read-only; `codex-worker` and `agy-worker` are
workspace-write (`codex-reviewer` is also read-only; `codex-bridge` is a
mode-qualified alias). Requests may narrow but cannot widen it.
The runner SHALL own timeout observation and use realpath/no-follow/atomic
artifact-root containment with a pinned directory descriptor, `0600` temporary
and receipt files, redaction before bounded capture, and fail-closed
out-of-scope-write detection. Any workspace or transport temporary symlink,
hardlink, or artifact-root replacement SHALL block normal receipt publication.

#### Scenario: Read-only authority cannot be widened

- **WHEN** `codex-reasoner` requests workspace-write
- **THEN** the runner returns `BLOCKED` before provider launch

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
