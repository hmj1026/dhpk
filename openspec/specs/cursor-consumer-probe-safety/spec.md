# Cursor Consumer Probe Safety Specification

## Purpose

Define finite, diagnosable, read-only execution for the optional Cursor CLI
consumer probe without confusing runtime evidence with package validation.

## Requirements

### Requirement: Cursor consumer probes are finite and bounded

The configured Cursor consumer probe SHALL validate a positive safe-integer
timeout below a fixed hard maximum, use a finite default when none is supplied,
and cap captured child output below a fixed hard maximum. A timeout with
captured output or an output-limit event MUST return a machine-readable
`BLOCKED` result with `exit_code`, `signal`, and `PASS`-ineligible evidence.
A timeout with no stdout or stderr MUST return `SKIP_INCOMPATIBLE` with
`no_stdout: true` and MUST NOT claim discovery `PASS`. The probe MUST NOT
mutate package or Cursor state. On POSIX, ordinary descendants SHALL be
terminated with the probe process group; deliberately detached descendants
are outside the guarantee.

#### Scenario: Hung Cursor client is blocked after the deadline

- **WHEN** an explicitly configured Cursor probe does not exit before its
  finite timeout and has already emitted captured output
- **THEN** the result is `BLOCKED`, includes `timed_out: true` and the timeout
  duration plus exit/signal evidence, and does not claim consumer discovery
  `PASS`

#### Scenario: Silent hung Cursor client is CLI-incompatible

- **WHEN** an explicitly configured Cursor probe does not exit before its
  finite timeout and emits no stdout or stderr
- **THEN** the result is `SKIP_INCOMPATIBLE`, includes `timed_out: true` and
  `no_stdout: true`, names that the CLI has no non-LLM plugin list, and does
  not claim consumer discovery `PASS`

#### Scenario: Invalid timeout fails closed

- **WHEN** a caller supplies zero, a negative value, or a non-safe integer as
  the probe timeout
- **THEN** the probe rejects the configuration before invoking the client

#### Scenario: Probe output is bounded and redacted

- **WHEN** the client emits output during a probe
- **THEN** returned diagnostics are capped and redacted, and an output-limit
  result is `BLOCKED` rather than an unbounded successful capture

### Requirement: Probe outcomes remain separate from package validation

The Cursor generator and validator SHALL preserve structural/provenance results
separately from the bounded consumer result. A silent timeout MUST remain
`SKIP_INCOMPATIBLE`; a timeout with captured output, unavailable client, or
unexecuted route MUST remain `BLOCKED`, `UNAVAILABLE`, or `NOT_RUN`
respectively and SHALL NOT be promoted to runtime discovery support. The documented wrapper
MUST resolve a Cursor executable from `PATH` and require a non-empty valid JSON
response containing positive evidence for the requested dhpk skills, commands,
agents, and rules before returning consumer `PASS`; clear negative/no-result
responses SHALL remain `BLOCKED`. The probe child SHALL receive an allowlisted
environment and MUST NOT inherit arbitrary credential variables. The documented
launch-scoped wrapper MUST pass `--trust` so the client does not wait for an
interactive workspace-confirmation prompt, and POSIX probes MUST ignore stdin.

#### Scenario: Launch-scoped probe skips workspace confirmation

- **WHEN** a POSIX launch-scoped probe runs through the documented wrapper
- **THEN** the child is spawned with stdin ignored and `--trust` so it does
  not wait on a workspace-confirmation prompt or inherit the caller TTY

#### Scenario: Structural package is valid but the client hangs

- **WHEN** Cursor package validation passes and the configured consumer probe
  times out with no stdout or stderr
- **THEN** structural evidence remains `PASS` while the consumer evidence is
  `SKIP_INCOMPATIBLE` with `no_stdout: true`

#### Scenario: Successful process without a response is blocked

- **WHEN** the configured process exits zero but emits no valid JSON response
- **THEN** the wrapper returns `BLOCKED` and does not claim Cursor discovery
  `PASS`

#### Scenario: Negative capability response is blocked

- **WHEN** the client returns valid JSON explicitly saying that the requested
  dhpk skills, commands, agents, or rules were not discovered
- **THEN** the wrapper returns `BLOCKED` rather than treating keyword presence
  as positive discovery evidence
