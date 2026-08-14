# fast-worker-selection-policy Specification

## Purpose
TBD - created by archiving change refine-opsx-orchestration-governance. Update Purpose after archive.
## Requirements
### Requirement: Fast-worker backend selection is explicit and deterministic
The orchestration layer SHALL resolve a mechanical fast-worker through `fast_worker_backend` (`claude`, `codex`, `agy`, or `auto`) and, for `auto`, a configured `fast_worker_backend_order`. The shipped default SHALL remain `claude`, which maps to `dhpk:fast-worker`.

#### Scenario: Default selection
- **WHEN** no backend preference is configured
- **THEN** a mechanical batch is dispatched to `dhpk:fast-worker`

#### Scenario: Explicit backend selection
- **WHEN** `fast_worker_backend=codex` and the Codex CLI is available
- **THEN** the batch is dispatched to `dhpk:codex-fast-worker` with the same task specification

### Requirement: Auto selection checks availability before dispatch
For `auto`, the selector SHALL evaluate backends in the configured order and choose the first backend whose required CLI and runtime prerequisites are available. It SHALL record the selected backend and the rejected candidates with concise reasons.

#### Scenario: Ordered availability selection
- **WHEN** the order is `agy,codex,claude`, agy is unavailable, and Codex is available
- **THEN** the selector chooses `codex-fast-worker` and records agy as unavailable

### Requirement: Backend failure does not silently change execution semantics
An explicitly selected backend that fails authentication, authorization, model validation, or execution SHALL return `RESULT: BLOCKED` with the backend and exact failure. An optional fallback SHALL be allowed only when configured and only for a missing backend executable; the result SHALL identify the fallback. No fallback SHALL occur for authorization, authentication, model, or task failures.

#### Scenario: Explicit unavailable backend
- **WHEN** `fast_worker_backend=agy` but the agy executable is absent
- **THEN** dispatch returns `RESULT: BLOCKED` and does not silently run `dhpk:fast-worker`

#### Scenario: Configured missing-executable fallback
- **WHEN** fallback is configured as `claude` and the explicitly preferred CLI executable is absent
- **THEN** the batch runs on `dhpk:fast-worker` and the report identifies the requested and selected backends

### Requirement: Worker reports expose backend identity

Every selected fast-worker SHALL report the requested backend, selected backend, model or effort override when applicable, availability result, verification result, and a complete edited-file report. In parallel mode, the report SHALL distinguish files changed within the assigned list from out-of-scope observations; it SHALL NOT claim sibling edits as worker-owned edits.

The parallel report SHALL contain separate fields for assigned-scope edited files, out-of-scope observations, out-of-scope writes, verification scope/result, and any report-only or blocked reason.

#### Scenario: Backend identity is auditable
- **WHEN** a CLI-backed worker completes a mechanical batch
- **THEN** its report contains the backend identity and an independently verified assigned-scope edited-file list

#### Scenario: Parallel report separates sibling edits
- **WHEN** a CLI-backed worker runs while sibling workers modify the same checkout
- **THEN** its report lists assigned-scope edits separately from out-of-scope observations and does not include sibling files in the worker-owned list

#### Scenario: Verification failure remains visible
- **WHEN** a worker cannot run the dispatcher-provided scoped verification command
- **THEN** the report returns `RESULT: BLOCKED` or the declared report-only outcome with the exact missing command and does not silently run a global shared-state validator

### Requirement: Goal generation embeds the fast-worker clause only when an eligible batch exists
`opsx-apply-goal` SHALL classify every unchecked top-level checkbox before a heading whose normalized text is `Verification` as an implementation task. Each SHALL use one exact, immediately-following metadata line: `  - **Mechanical:** yes|no; **Files:** path/a, path/b|none`. Only `Mechanical: yes` tasks are fast-worker candidates. The scanner SHALL normalize and count distinct repository-relative file paths, with `none` counting as zero. `goal-context.js` SHALL own `MAX_INLINE_FILES = 2` as the generator-side SSOT and derive eligibility as `count > MAX_INLINE_FILES`, without a separate `3` literal. The generator SHALL omit the FAST_WORKER_CLAUSE and skip backend selection only when every implementation task has conclusive metadata and every mechanical task is within the inline limit. Missing or malformed metadata, invalid mechanical values, globs, directories, and placeholders are inconclusive: the generator SHALL fail open, embed the clause, and log the offending task id.

#### Scenario: No eligible batch omits the clause
- **WHEN** every implementation task has valid metadata and every `Mechanical: yes` task names 2 or fewer distinct files
- **THEN** the emitted goal string contains no FAST_WORKER_CLAUSE and no fast-worker backend selection text

#### Scenario: Eligible batch embeds the clause
- **WHEN** at least one conclusively annotated `Mechanical: yes` implementation task names 3 or more distinct files
- **THEN** the emitted goal string carries the FAST_WORKER_CLAUSE with the selected backend

#### Scenario: Unparseable tasks.md fails open
- **WHEN** the scanner encounters an implementation task with absent or invalid `Mechanical`/`Files` metadata
- **THEN** the generator embeds the clause and logs that the footprint scan was inconclusive

#### Scenario: Non-mechanical and verification tasks do not create eligibility
- **WHEN** a conclusively annotated task has `Mechanical: no`, or a checkbox occurs under the `## Verification` heading
- **THEN** that task does not cause the FAST_WORKER_CLAUSE to be embedded

#### Scenario: No eligible work does not probe or block on the backend
- **WHEN** all implement steps are conclusively within the inline limit and the configured fast-worker backend is unavailable
- **THEN** backend selection is skipped, the clause is omitted, and goal generation is not blocked by that unavailable backend

### Requirement: Per-session backend override via --worker flag
`/dhpk:do` and `dhpk:opsx-apply-goal` SHALL accept a `--worker=<claude|codex|agy|auto>` flag, parsed and stripped before route matching (the same strip-before-match contract as `--codex` / `--plan` / `--openspec`). The legacy `--fast-worker` spelling SHALL be removed outright with no alias. For that invocation the flag SHALL override the `fast_worker_backend` userConfig; precedence is flag > userConfig > shipped default (`claude`). An invalid flag value SHALL warn and fall back to the configured resolution rather than failing the route. The preserved invocation context SHALL be named `WORKER_OVERRIDE`; userConfig key names and the selector engine interface are unchanged.

#### Scenario: Flag overrides userConfig for one session
- **WHEN** userConfig sets `fast_worker_backend=claude` and the user invokes `/dhpk:do --worker=agy ...`
- **THEN** this invocation resolves the agy backend (subject to availability rules), and later sessions without the flag return to `claude`

#### Scenario: Goal generator embeds the override
- **WHEN** `dhpk:opsx-apply-goal` runs with `--worker=codex`
- **THEN** the emitted goal string carries the resolved backend clause so the unattended executing session dispatches `dhpk:codex-fast-worker` without reading userConfig

#### Scenario: Invalid flag value
- **WHEN** the flag value is not one of `claude|codex|agy|auto`
- **THEN** a one-line warning is printed and resolution falls back to userConfig/default; the route proceeds

#### Scenario: Legacy spelling flows through as task text
- **WHEN** an invocation contains `--fast-worker=codex`
- **THEN** it is not parsed as a backend override and no deprecation shim intervenes

### Requirement: Backend workers preserve assigned-file boundaries in a shared checkout

The fast-worker backend selector and its in-process and CLI-backed worker contracts SHALL pass the exact assigned file list and parallel-dispatch marker without changing backend selection semantics. A worker backend SHALL use the assigned list as the boundary for before/after accounting and shall never perform repository-wide cleanup based on sibling changes.

#### Scenario: In-process backend receives parallel scope
- **WHEN** the selector resolves a parallel batch to `dhpk:fast-worker`
- **THEN** the worker receives the marker and exact assigned files and reports path-scoped verification

#### Scenario: Codex backend receives parallel scope
- **WHEN** the selector resolves a parallel batch to `dhpk:codex-fast-worker`
- **THEN** the wrapper passes the marker and assigned files to the CLI prompt and derives worker-owned changes only from assigned paths

#### Scenario: Backend selection remains unchanged
- **WHEN** a parallel task requests `claude`, `codex`, `agy`, or `auto`
- **THEN** the existing selector precedence, availability checks, and missing-executable fallback remain unchanged; only scope and verification accounting are hardened
