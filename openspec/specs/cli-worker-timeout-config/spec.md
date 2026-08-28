# cli-worker-timeout-config Specification

## Purpose
Define dispatcher-resolved deadline configuration for the contained CLI runner.

## Requirements

### Requirement: Codex timeout budgets are first-class layered configuration
The plugin SHALL expose `codex_timeout_secs` with default `360`, plus role-specific `codex_worker_timeout_secs`, `codex_reasoner_timeout_secs`, and `codex_reviewer_timeout_secs` (legacy aliases `codex_fast_worker_timeout_secs`, `codex_deep_reasoner_timeout_secs`, and `codex_bridge_timeout_secs`). Effective configuration SHALL resolve scope first: project pluginConfigs (role-specific over shared) over global pluginConfigs (role-specific over shared) over shipped defaults. An absent role-specific key SHALL inherit the shared value in its selected scope.

#### Scenario: Shared timeout override
- **WHEN** the project config sets `codex_timeout_secs=900` and no role-specific value exists
- **THEN** every Codex role receives an effective budget of `900` seconds

#### Scenario: Role-specific timeout override
- **WHEN** the shared value is `900` and `codex_fast_worker_timeout_secs=1800`
- **THEN** `codex-worker` receives `1800` and other roles retain `900`

#### Scenario: Project value overrides global value
- **WHEN** global config sets `codex_timeout_secs=900` and project config sets `codex_timeout_secs=1200`
- **THEN** the effective shared value is `1200`

#### Scenario: Project shared value overrides global role value
- **WHEN** global config sets `codex_fast_worker_timeout_secs=1800` and project config sets only `codex_timeout_secs=900`
- **THEN** `codex-worker` receives `900` because project scope is selected before role specificity

#### Scenario: Project role value overrides global shared value
- **WHEN** global config sets `codex_timeout_secs=900` and project config sets `codex_fast_worker_timeout_secs=1800`
- **THEN** `codex-worker` receives `1800`

#### Scenario: Absent role value inherits shared value
- **WHEN** a selected scope has `codex_timeout_secs=900` and no role-specific key
- **THEN** every role without a more specific value receives `900`

### Requirement: Timeout values are validated before dispatch
The configuration seam SHALL accept only integer seconds greater than or equal to zero. The integer `0` SHALL explicitly disable the portable runner deadline. Empty, fractional, negative, non-integer, or malformed values SHALL emit a clear configuration error and prevent the affected Codex dispatch; they SHALL never silently become an unbounded or guessed budget.

#### Scenario: Zero disables the backstop
- **WHEN** a role timeout is configured as `0`
- **THEN** the immutable context records an intentional no-deadline invocation
- **AND** diagnostics identify the intentional disabled state

#### Scenario: Invalid timeout is rejected
- **WHEN** a role timeout is `abc`, negative, fractional, or otherwise malformed
- **THEN** configuration validation fails before Codex starts
- **AND** the error names the key, value, and accepted form

### Requirement: Legacy environment override remains dispatcher-only and validated
`CODEX_WRAP_TIMEOUT_SECS` MAY remain an explicit test/operation input to the
dispatcher resolver. Its value SHALL pass the same validation as userConfig
values; adapters and runners SHALL never read it directly.

#### Scenario: Valid environment override
- **WHEN** userConfig resolves to `900` and `CODEX_WRAP_TIMEOUT_SECS=30` is explicitly supplied
- **THEN** the effective budget is `30`
- **AND** diagnostics identify the environment override as the source

#### Scenario: Invalid environment override
- **WHEN** `CODEX_WRAP_TIMEOUT_SECS=abc`
- **THEN** dispatch context construction fails before invoking Codex

### Requirement: Role and effective budget bind into immutable transport context
Codex `codex-worker`, `codex-reasoner`, and `codex-reviewer` dispatches SHALL bind a validated
role marker and effective budget into `dhpk.cli.context.v1` before invoking the
compatibility wrapper. The existing three-argument bridge invocation remains
callable only when that attested context is supplied.

#### Scenario: Fast-worker receives role budget
- **WHEN** `codex-worker` resolves a role-specific budget
- **THEN** the context carries the fast-worker role and that budget

#### Scenario: Bridge retains legacy shape
- **WHEN** codex-bridge is invoked with its original three arguments and no override
- **THEN** it remains callable only with dispatcher-created context carrying the resolved default

### Requirement: Effective timeout diagnostics disclose alignment limits
Session-start and worker diagnostics SHALL disclose a non-default effective budget and its source without secrets. When a trusted outer wait budget is available, diagnostics SHALL compare it with the inner budget and warn if the outer wait is shorter or equal. When no outer budget is available, diagnostics SHALL state `outer_budget=unknown` rather than claiming alignment.

#### Scenario: Non-default budget is surfaced
- **WHEN** a role-specific budget differs from the shipped default
- **THEN** session-start or the worker report identifies the role, effective seconds, and source

#### Scenario: Outer budget is shorter
- **WHEN** a trusted outer wait budget is available and is less than or equal to the effective wrapper budget
- **THEN** diagnostics emit an alignment warning

#### Scenario: Outer budget is unavailable
- **WHEN** no trusted outer wait budget is exposed
- **THEN** diagnostics state `outer_budget=unknown`
- **AND** they do not claim that the budgets are aligned

### Requirement: Timeout configuration documentation stays lockstep
The plugin manifest, English and Traditional Chinese configuration docs, loader comments, session-start defaults, and catalog count SHALL describe the same four timeout keys, defaults, validation, precedence, and disabled semantics.

#### Scenario: Configuration documentation is checked
- **WHEN** the timeout keys are added
- **THEN** the catalog and configuration tests verify exact key coverage and count parity

### Requirement: Resolved timeout is runner-observed evidence
The resolved timeout SHALL enter the normalized request and be
observed/classified by the shared runner. `0` remains an explicit disabled backstop.

#### Scenario: Backend-native 124 is not a timeout

- **WHEN** a provider exits 124 before the runner deadline
- **THEN** the receipt status is `FAILED`, not `TIMEOUT`
