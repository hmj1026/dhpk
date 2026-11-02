# fast-worker-selection-policy Specification

## Purpose

Define explicit deterministic worker backend selection, bounded fallback and auditable execution reports while rejecting retired worker identities before dispatch.

## Requirements

### Requirement: Fast-worker backend selection is explicit and deterministic

The orchestration layer SHALL resolve a mechanical `worker` through a
Provider-neutral target request containing optional Provider, Model, and Effort
constraints. Automatic resolution SHALL use the current Host profile and
Capability Matrix, with the Host Native Provider as the default preference and
fallback. The selector command-line interface SHALL detect the current Host,
load that Host's profile, and obtain every selected Target Agent, Model, Effort,
and Invocation Route from the Dispatch Engine; it SHALL NOT keep a separate
backend-to-subagent selection path. Executable presence for `codex` or `agy`
SHALL be supplied to the engine as capability evidence and SHALL NOT itself
select a target. When the current Host cannot be detected unambiguously, the
selector SHALL report `BLOCKED` with the signals it checked and SHALL NOT
default to Claude Code. The selected Provider, Model, Effort, Transport, Role,
and fallback decision SHALL be recorded separately.

#### Scenario: Host-native default

- **WHEN** no target preference is configured
- **THEN** a mechanical batch resolves to the current Host's Native Provider,
  not to a globally hard-coded Claude target

#### Scenario: Selector CLI honors the Codex CLI Host default

- **WHEN** the selector CLI runs on a detected `codex-cli` Host with no target
  argument
- **THEN** it reports the `codex-cli` profile's `worker` Role Default, and its
  output records `resolution_source` `dispatch-engine`

#### Scenario: Explicit Claude Code target from Cursor

- **WHEN** Cursor explicitly requests Claude Code Model `opus5`
- **THEN** the batch resolves to Claude Code with Role `worker` and records
  Cursor native as the fallback target when allowed

#### Scenario: Explicit Codex target

- **WHEN** a Host explicitly requests Codex CLI Model `sol5.6`
- **THEN** the batch uses Provider `codex-cli`, Role `worker`, and its selected
  Effort/Transport without becoming `codex-worker`

#### Scenario: Missing executable is evidence, not a rule

- **WHEN** an explicit `codex-cli` target is requested and `codex` is not on
  `PATH`
- **THEN** the engine reports the target `UNAVAILABLE` with that evidence and
  no other Target Agent is selected unless fallback was explicitly permitted

#### Scenario: Undetectable Host

- **WHEN** no Host signal matches, or signals for two Hosts match at once, and
  no explicit Host override is set
- **THEN** the selector exits non-zero with status `BLOCKED` naming the signals
  checked, and selects no target

#### Scenario: Legacy backend flag is rejected

- **WHEN** the selector receives `--backend`, `--order`, `--fallback`,
  `--failure`, or `--cross-provider`
- **THEN** it reports `BLOCKED` naming the removed argument and its
  replacement, and does not translate the value

### Requirement: Auto selection checks availability before dispatch

For automatic resolution, the selector SHALL evaluate only Providers allowed by
the current Host Access Policy and Capability Matrix. It SHALL choose the first
eligible target in the configured preference order, record rejected candidates
with concise reasons, and SHALL not launch or authenticate an undeclared
external Provider merely to discover availability.

#### Scenario: Ordered availability selection

- **WHEN** the Host policy orders AGY before Codex, AGY is unavailable, and
  Codex is available for the requested Role/Model/Effort
- **THEN** the selector chooses Codex and records AGY as unavailable

#### Scenario: Automatic selection preserves native preference

- **WHEN** the current Host's native target is eligible
- **THEN** automatic selection may choose it without probing undeclared external
  Providers

### Requirement: Backend failure does not silently change execution semantics

The selector SHALL ensure that an explicitly selected target that fails
authentication, authorization, Model validation, or execution SHALL return
`RESULT: BLOCKED` or the canonical
terminal failure with the Provider, Model, and exact evidence. Fallback SHALL be
allowed only when the request policy permits it and the failure is confirmed
unavailability before side effects. No fallback SHALL occur after a write,
safety denial, semantic failure, or timeout without the required reconciliation
path.

#### Scenario: Explicit unavailable target with fallback permission

- **WHEN** an explicitly requested Codex CLI is absent before execution and the
  request allows fallback
- **THEN** the engine records Codex as unavailable and uses the current Host's
  native target

#### Scenario: Explicit target failure is visible

- **WHEN** a selected Provider rejects authentication or the requested Model
- **THEN** dispatch reports the exact failure and does not silently substitute a
  different target unless policy explicitly permits that failure class

### Requirement: Worker reports expose backend and canonical role identity

Every selected fast-worker SHALL report Host, requested and selected Provider,
requested and effective Model, normalized Effort, Transport, requested Role,
effective canonical Role, fallback history, availability, verification, and a
complete assigned-scope edited-file report. A Role label or alias SHALL not
substitute for process or verification evidence. A request for retired names
`codex-fast-worker` or `agy-fast-worker` SHALL NOT produce a dispatched worker
report; it SHALL fail closed with retirement guidance naming `codex-worker` or
`agy-worker`. REQ-7.

#### Scenario: Legacy request is auditable

- **WHEN** a caller requests `codex-fast-worker`
- **THEN** the report is not a successful worker dispatch; it preserves the
  requested name, records `BLOCKED` with successor `codex-worker`, and includes
  no fabricated verification evidence

#### Scenario: Parallel report separates sibling edits

- **WHEN** a Provider-backed worker runs while sibling workers modify the same
  checkout
- **THEN** its report lists assigned-scope edits separately from out-of-scope
  observations and does not include sibling files in the worker-owned list

#### Scenario: Verification failure remains visible

- **WHEN** a worker cannot run dispatcher-provided scoped verification
- **THEN** the report returns `RESULT: BLOCKED` or the declared report-only
  outcome with the exact missing command and does not silently run a global
  shared-state validator

### Requirement: Goal generation embeds the fast-worker clause only when an eligible batch exists

`opsx-apply-goal` SHALL classify every unchecked top-level checkbox before a heading whose normalized text is `Verification` as an implementation task. Each SHALL use one exact, immediately-following metadata line:

```text
  - **Mechanical:** yes|no; **Files:** path/a, path/b|none
```

Only `Mechanical: yes` tasks are fast-worker candidates. The scanner SHALL normalize and count distinct repository-relative file paths, with `none` counting as zero. `goal-context.js` SHALL own `MAX_INLINE_FILES = 2` as the generator-side SSOT and derive eligibility as `count > MAX_INLINE_FILES`, without a separate `3` literal. The generator SHALL omit the FAST_WORKER_CLAUSE and skip worker-target resolution only when every implementation task has conclusive metadata and every mechanical task is within the inline limit. Missing or malformed metadata, invalid mechanical values, globs, directories, and placeholders are inconclusive: the generator SHALL fail open, embed the clause, and log the offending task id.

#### Scenario: No eligible batch omits the clause

- **WHEN** every implementation task has valid metadata and every `Mechanical: yes` task names 2 or fewer distinct files
- **THEN** the emitted goal string contains no FAST_WORKER_CLAUSE and no Provider-neutral worker-target selection text

#### Scenario: Eligible batch embeds the clause

- **WHEN** at least one conclusively annotated `Mechanical: yes` implementation task names 3 or more distinct files
- **THEN** the emitted goal string carries the FAST_WORKER_CLAUSE with the selected Provider-neutral worker target

#### Scenario: Unparseable tasks.md fails open

- **WHEN** the scanner encounters an implementation task with absent or invalid `Mechanical`/`Files` metadata
- **THEN** the generator embeds the clause and logs that the footprint scan was inconclusive

#### Scenario: Non-mechanical and verification tasks do not create eligibility

- **WHEN** a conclusively annotated task has `Mechanical: no`, or a checkbox occurs under the `## Verification` heading
- **THEN** that task does not cause the FAST_WORKER_CLAUSE to be embedded

#### Scenario: No eligible work does not probe or block on a worker target

- **WHEN** all implement steps are conclusively within the inline limit and configured worker-target evidence is unavailable
- **THEN** worker-target resolution is skipped, the clause is omitted, and goal generation is not blocked by that unavailable target

### Requirement: Legacy backend override is compatibility-only at the dispatch edge

The compatibility edge SHALL accept the `--worker=<claude|codex|agy|auto>`
input for `/dhpk:do` and `dhpk:opsx-apply-goal`, parsed and stripped before
route matching. The edge SHALL translate it to an explicit
`<target-agent>/<model>[:<effort>]` target for the selector (`claude` to
`claude-code`, `codex` to `codex-cli`, `agy`; `auto` to the current Host's Role
Default) and SHALL NOT select a Provider-bound Role or define a Host-independent
default. The removed `fast_worker_backend` userConfig key SHALL NOT be read; its
presence is reported by the dispatch configuration diagnostic. Invalid flag
values SHALL warn and fall back to canonical Host-aware resolution rather than
failing the route. The preserved invocation context SHALL be named
`WORKER_OVERRIDE`.

#### Scenario: Flag overrides userConfig for one session

- **WHEN** a canonical `worker_target` is configured and the user invokes
  `/dhpk:do --worker=agy ...`
- **THEN** this invocation records an AGY target constraint subject to Host
  policy and availability, while later sessions without the flag use the
  canonical configured or Host-aware resolution

#### Scenario: Goal generator embeds the override

- **WHEN** `dhpk:opsx-apply-goal` runs with `--worker=codex`
- **THEN** the emitted goal string carries the resolved explicit target so the
  unattended session invokes the selector without reading userConfig

#### Scenario: Invalid flag value

- **WHEN** the flag value is not one of `claude|codex|agy|auto`
- **THEN** a one-line warning is printed and resolution falls back to canonical
  Host-aware configuration; the route proceeds

#### Scenario: Legacy spelling flows through as task text

- **WHEN** an invocation contains `--fast-worker=codex`
- **THEN** it is not parsed as a backend override and no deprecation shim
  intervenes

### Requirement: Provider-neutral workers preserve assigned-file boundaries in a shared checkout

The Provider-neutral worker contract and any compatibility adapter SHALL pass
the exact assigned file list and parallel-dispatch marker without changing
Dispatch Engine target semantics. A worker SHALL use the assigned list as the
boundary for before/after accounting and SHALL never perform repository-wide
cleanup based on sibling changes.

#### Scenario: In-process worker receives parallel scope

- **WHEN** the Dispatch Engine resolves a parallel batch to the provider-neutral in-process worker tier
- **THEN** the worker receives the marker and exact assigned files and reports path-scoped verification

#### Scenario: Legacy CLI adapter receives parallel scope

- **WHEN** a compatibility alias resolves a parallel batch to the Codex CLI Adapter
- **THEN** the wrapper passes the marker and assigned files to the CLI prompt and derives worker-owned changes only from assigned paths

#### Scenario: Compatibility target remains observable

- **WHEN** a parallel task carries a legacy `claude`, `codex`, `agy`, or `auto` override
- **THEN** the compatibility edge records the requested alias while the Dispatch Engine applies current Host policy, capability checks, fallback, scope, and verification accounting
