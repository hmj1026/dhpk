# cli-backed-fast-workers Specification

## Purpose

Define the Codex and AGY mechanical-worker contracts while routing all external
CLI execution through one immutable, contained transport boundary.

## Requirements

### Requirement: CLI-backed fast-worker agents preserve the mechanical contract

The plugin SHALL ship `agents/codex-worker.md` and
`agents/agy-worker.md` as write-capable mechanical implementers (legacy alias
files `agents/codex-fast-worker.md` and `agents/agy-fast-worker.md` remain for
the compatibility window). Each
SHALL require a precise task spec, make surgical edits only, independently run
verification, derive its edited-file list from the working tree, and escalate
after three failed verification attempts instead of guessing.

#### Scenario: Ambiguous spec escalates

- **WHEN** change intent or verification is underspecified
- **THEN** the agent returns `BLOCKED` before invoking an external provider

### Requirement: Provider invocation is immutable and transport-owned

The dispatcher SHALL resolve maximum role authority, mode, assigned scope,
model, effort, deadline, prompt evidence, and a named restricted runtime into
a private `dhpk.cli.context.v1`. Compatibility wrappers SHALL require that
context and translate only their legacy positional arguments; they SHALL not
fabricate authority, inherit an ambient `PATH`, or add mutable argv/options.
The shared runner SHALL independently reconstruct the named runtime evidence
and exact provider argv before launch.

Codex SHALL use `codex exec --skip-git-repo-check --sandbox <attested mode> -c
approval_policy=never --cd <workdir>` with optional attested model/effort,
`--output-last-message`, and the prompt on stdin. AGY SHALL use its attested
`--dangerously-skip-permissions --mode accept-edits --add-dir <workdir>
--model <model> --print-timeout <value> -p <prompt>` shape and only exact
`Y\n` confirmation on stdin. Neither adapter SHALL use `timeout`, `gtimeout`,
structured-output flags, version probing, or a provider retry.

#### Scenario: Direct legacy call is blocked

- **WHEN** a caller invokes either compatibility wrapper without attested context
- **THEN** it returns `BLOCKED` before provider execution

#### Scenario: Restricted named runtime includes Python

- **WHEN** the dispatcher includes its approved absolute `python3` in the
  named runtime allowlist
- **THEN** the wrapper may bootstrap the transport only when that entry matches
  the context evidence

#### Scenario: Provider argv is altered

- **WHEN** a request contains an additional provider flag or different runtime
- **THEN** the shared runner returns `BLOCKED` before provider execution

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

Missing executable, authentication, authorization, rejected model, context,
or verification errors SHALL be reported as `BLOCKED`; configured fallback may
apply only to a deterministic missing executable before a provider starts. The
agents SHALL never self-edit to simulate a provider or choose another provider
after an auth, model, execution, or timeout failure.

#### Scenario: Provider report claims success

- **WHEN** a provider exits successfully with a non-empty report
- **THEN** the worker still verifies the assigned scope independently before it
  reports completion
