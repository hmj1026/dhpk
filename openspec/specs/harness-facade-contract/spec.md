# harness-facade-contract Specification

## Purpose

Provide one observable command contract for the dhpk workflow so routing, package generation, testing, consumer probing, and release decisions are deterministic, resumable, and consistent across supported host adapters.

## Requirements

### Requirement: Harness exposes one stable workflow command

The harness SHALL expose one public workflow command with phase subcommands for `preflight`, `plan`, `generate`, `validate`, `test`, `probe`, `verify`, and `release`. Each subcommand SHALL declare its required arguments, reject unknown arguments, and use the same invocation context for the complete attempt.

#### Scenario: Valid phase invocation

- **WHEN** a caller invokes a supported phase with all required arguments
- **THEN** the harness runs that phase using the declared context and returns a structured result for the same attempt

#### Scenario: Invalid phase invocation

- **WHEN** a caller supplies an unknown phase, missing required argument, or unknown option
- **THEN** the harness emits a bounded usage diagnostic and returns the usage exit code without running a workflow phase

### Requirement: Harness results have stable status and exit semantics

Every phase result SHALL expose a machine-readable outcome separate from the receipt lifecycle phase. The outcome vocabulary SHALL be `PASS`, `FAIL`, `BLOCKED`, `NOT_RUN`, `NOT_CONFIGURED`, `SKIP_INCOMPATIBLE`, `UNAVAILABLE`, `NO_SHIP`, `PARTIAL`, `PUBLISHED_PENDING`, `PUBLISHED_UNHEALTHY`, `OVERRIDDEN`, or aggregate `COMPLETE`. The receipt lifecycle phase SHALL be one of `PLANNED`, `RED`, `GREEN`, `REFACTOR`, `VERIFIED`, or terminal `COMPLETE`; `RED`, `GREEN`, `REFACTOR`, and `VERIFIED` SHALL never be emitted as result outcomes. `PASS` and aggregate `COMPLETE` SHALL exit `0`; deterministic `FAIL` SHALL exit `1`; every other non-pass outcome SHALL exit `2`; invalid usage SHALL exit `64`; and an unexpected harness failure SHALL exit `70`. A non-pass outcome MUST NOT be represented as a successful exit.

#### Scenario: Required evidence is absent

- **WHEN** a required phase cannot run or lacks required evidence
- **THEN** the result records the applicable non-pass status and exits `2`

#### Scenario: Phase fails deterministically

- **WHEN** a phase executes and a deterministic assertion or gate fails
- **THEN** the result records `FAIL`, includes bounded diagnostics, and exits `1`

#### Scenario: Lifecycle phase is not an outcome

- **WHEN** a behavior change is currently in `RED`, `GREEN`, `REFACTOR`, or `VERIFIED`
- **THEN** the receipt records that lifecycle phase separately while the command result uses its applicable evidence outcome and exit mapping

### Requirement: JSON output is compact, bounded, and redacted

The harness SHALL support `--json` and emit exactly one machine-readable result on stdout. Human-readable summaries MAY be emitted only through the documented human mode. Diagnostics, command details, environment values, and resume instructions SHALL be bounded and redacted so secrets are not emitted in stdout or persisted evidence.

#### Scenario: JSON result is consumed by automation

- **WHEN** a caller invokes a phase with `--json`
- **THEN** stdout contains one parseable result with status, phase, evidence references, and exit-compatible outcome

#### Scenario: Diagnostic contains a secret-like value

- **WHEN** a phase failure includes a credential, token, or sensitive path in a producer diagnostic
- **THEN** the harness redacts the value before returning or persisting the result

### Requirement: Workflow phases follow one deterministic delegation order

The release-capable workflow SHALL use the ordered phases `preflight -> plan -> generate -> validate -> test -> probe -> verify -> release`. Each phase result SHALL retain identity-bound evidence so a composing caller can validate a preceding handoff when one is supplied. The current public CLI executes one requested phase per invocation; it SHALL not silently skip required phase evidence or replace a missing runtime probe with structural package evidence. End-to-end receipt handoff across separate invocations remains a follow-up integration boundary.

#### Scenario: Generation follows a valid plan

- **WHEN** `generate` receives a plan produced by the current `plan` phase
- **THEN** it uses that plan identity and produces evidence that can be consumed by validation without reselecting surface membership

#### Scenario: Runtime probe is unavailable

- **WHEN** package validation passes but a required consumer runtime probe is unavailable
- **THEN** the workflow preserves package PASS separately and records the consumer outcome as `UNAVAILABLE`, `NOT_RUN`, or another applicable non-pass state

### Requirement: Projection and test execution retain their canonical owners

The harness SHALL delegate projection selection/materialization to the canonical distribution contract and its artifact writer, and SHALL delegate repository tests to the bounded test gate. The facade MUST NOT create a second inventory, projection selection policy, or unbounded test path.

#### Scenario: Generated package is requested

- **WHEN** `generate` runs for a distribution surface
- **THEN** the result is bound to the canonical inventory/plan and generated through the approved artifact-writing boundary, with no direct projection edit accepted as a successful generation

#### Scenario: Test gate is requested

- **WHEN** `test` runs the repository suite
- **THEN** it uses the bounded test contract and propagates its characterized child, timeout, or configuration outcome into the harness result

### Requirement: Release aggregation requires required consumer evidence

The release phase SHALL retain independent evidence rows for the seven canonical Q239 surface IDs: `claude-core`, `codex-sync`, `codex-native`, `cursor-sync`, `cursor-plugin`, `agent-plugin`, and `agy-plugin`. The inventory platform matrix SHALL expose an explicit `required_surfaces` list containing those IDs, and a full-release plan SHALL copy and identity-check that list; no implicit directory discovery or adapter default may add or remove a required row. If the inventory list is absent, incomplete, duplicated, or names a surface without a matching projection contract, preflight SHALL return `BLOCKED` and no full-release result may be emitted. A scoped non-full-release plan MAY select a subset, but its result SHALL identify the scope and MUST NOT claim full-platform `COMPLETE`. Structural/package PASS SHALL NOT promote a surface to runtime PASS. Required consumer `NOT_RUN` or `UNAVAILABLE` SHALL produce a non-complete release outcome, required consumer FAIL SHALL produce an unhealthy/non-ship outcome, and only all required consumer PASS results SHALL produce `COMPLETE`.

#### Scenario: One required surface is unavailable

- **WHEN** source and package gates pass but one required consumer probe returns `UNAVAILABLE`
- **THEN** the release result remains non-complete and records the affected surface and resume evidence

#### Scenario: All required surfaces pass

- **WHEN** source, package, and every required consumer row have fresh matching PASS evidence
- **THEN** the release result records `COMPLETE` and retains the independent per-surface evidence

#### Scenario: Required surface list is incomplete

- **WHEN** a full-release plan omits one of the seven canonical surface IDs or names an ID absent from the inventory platform matrix
- **THEN** preflight rejects the plan as invalid or `BLOCKED` and the release cannot claim `COMPLETE`

#### Scenario: Inventory required-surface SSOT is missing

- **WHEN** the inventory platform matrix does not expose the explicit `required_surfaces` list or a listed ID lacks a projection contract
- **THEN** preflight returns `BLOCKED` and does not infer the list from directory contents or adapter defaults
