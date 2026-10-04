# harness-facade-contract Specification

## Applicability policy (#848/#854)

The applicable installation, structural, and package contract is the default
acceptance boundary. Native workflow, rendered discovery, context measurement,
and full Host observation are required only for an affected integration,
activation defect, or explicit native request. Required failures remain
blocking; excluded or historical `NOT_RUN`, `UNAVAILABLE`, and `BLOCKED` results
remain visible and are never synthesized as `PASS`. Ownership, compatibility,
coexistence, rollback, publication, and manual authorization requirements remain
in force.

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

Every phase result SHALL expose a machine-readable outcome separate from the receipt lifecycle phase. The outcome vocabulary SHALL be `PASS`, `FAIL`, `BLOCKED`, `NOT_RUN`, `NOT_CONFIGURED`, `SKIP_INCOMPATIBLE`, `UNAVAILABLE`, `NO_SHIP`, `PARTIAL`, `PUBLISHED_PENDING`, `PUBLISHED_UNHEALTHY`, `OVERRIDDEN`, or aggregate `COMPLETE`. The receipt lifecycle phase SHALL be one of `PLANNED`, `RED`, `GREEN`, `REFACTOR`, `VERIFIED`, or terminal `COMPLETE`; `RED`, `GREEN`, `REFACTOR`, and `VERIFIED` SHALL never be emitted as result outcomes. A result without schema-v2 CONSUMER acceptance SHALL preserve the characterized legacy mapping: `PASS` and aggregate `COMPLETE` exit `0`, deterministic `FAIL` exits `1`, and other non-pass outcomes exit `2`. A current schema-v2 CONSUMER gate child result SHALL map acceptance `PASS` to exit `0` and acceptance `FAIL` or `BLOCKED` to exit `1`; the facade SHALL preserve the acceptance envelope and validate the child exit against its JSON result. For a current schema-v2 release result, the outer workflow outcome is separate from the child gate verdict and SHALL exit `0` only when the aggregate outcome is `COMPLETE`; every other current non-completion outcome, including `PUBLISHED_PENDING`, SHALL exit `1`. Invalid usage SHALL exit `64`, and an unexpected harness failure SHALL exit `70`. A non-pass outcome MUST NOT be represented as a successful exit.

#### Scenario: Current consumer acceptance is blocked

- **WHEN** a schema-v2 CONSUMER result has `acceptance.verdict: "BLOCKED"`
- **THEN** the facade preserves the acceptance and raw observations and exits `1`

#### Scenario: Historical blocked result keeps its exit convention

- **WHEN** a result without schema-v2 CONSUMER acceptance is `BLOCKED`
- **THEN** the facade preserves the characterized legacy outcome and exit `2`

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

The release-capable workflow SHALL use the ordered phases `preflight -> plan -> generate -> validate -> test -> probe -> verify -> release`. Each phase result SHALL retain identity-bound evidence so a composing caller can validate a preceding handoff when one is supplied. The public CLI SHALL validate `--previous-receipt` and `--retry-of` against the current exact checkout before executing a phase, SHALL require a clean exact-checkout predecessor with an eligible PASS/COMPLETE outcome for cross-phase handoff, SHALL enforce predecessor phase order and surface scope, and SHALL require a plan fingerprint when the receiving phase consumes a generated plan (including `generate`). It SHALL resolve a terminal `--operation-key` replay (with `--idempotency-key` as its alias) only when phase, surface, and operation intent match, without running the phase again. It SHALL not silently skip required phase evidence or replace a missing runtime probe with structural package evidence.

#### Scenario: Generation follows a valid plan

- **WHEN** `generate` receives a plan produced by the current `plan` phase
- **THEN** it uses that plan identity and produces evidence that can be consumed by validation without reselecting surface membership

#### Scenario: Runtime probe is unavailable

- **WHEN** package validation passes but a required consumer runtime probe is unavailable
- **THEN** the workflow preserves package PASS separately and records the consumer outcome as `UNAVAILABLE`, `NOT_RUN`, or another applicable non-pass state

#### Scenario: Idempotency key is replayed for another phase

- **WHEN** a caller reuses an operation or idempotency key with a phase different from the receipt's original phase
- **THEN** the harness returns `BLOCKED` with the prior phase identity and does not execute the requested phase

### Requirement: Projection and test execution retain their canonical owners

The harness SHALL delegate projection selection/materialization to the canonical distribution contract and its artifact writer, and SHALL delegate repository tests to the bounded test gate. The facade MUST NOT create a second inventory, projection selection policy, or unbounded test path.

#### Scenario: Generated package is requested

- **WHEN** `generate` runs for a distribution surface
- **THEN** the result is bound to the canonical inventory/plan and generated through the approved artifact-writing boundary, with no direct projection edit accepted as a successful generation

#### Scenario: Test gate is requested

- **WHEN** `test` runs the repository suite
- **THEN** it uses the bounded test contract and propagates its characterized child, timeout, or configuration outcome into the harness result

### Requirement: Release aggregation requires required consumer evidence

The release phase SHALL support the seven canonical Q239 consumer surface IDs:
`claude-core`, `codex-sync`, `codex-native`, `cursor-sync`, `cursor-plugin`,
`agent-plugin`, and `agy-plugin`. For a current schema-v2 CONSUMER result, the
acceptance scope SHALL be derived from the unchanged requirements declaration,
an explicit surface selection, or the consumer gate's deterministic configured
scope, in that order. The harness MUST NOT add a surface because a client is on
`PATH`, split one requirements declaration into per-surface calls, or drop or
duplicate declared obligations. It SHALL retain one independently addressable
observation for each selected surface and preserve required checks, exclusions,
raw statuses, commands, reasons, and validated evidence references. The
consumer gate owns configured markers and selected installation checks as
specified in the [consumer acceptance contract](../../../docs/contracts/consumer-acceptance.md).

The inventory platform matrix SHALL retain an explicit `required_surfaces`
list containing all seven IDs above. A full distribution plan copies and
identity-checks that list; directory discovery and adapter defaults MUST NOT
add or remove entries. An absent, incomplete, duplicated, or unmapped list
blocks a full plan before it is emitted. A scoped non-full-release plan MAY
select a subset and SHALL identify that scope; `COMPLETE` describes only the
readiness of the selected scope and MUST NOT claim that unselected surfaces
passed. The full-plan artifact identity does not make every raw runtime
observation a required installation check in the selected CONSUMER scope.

Current release readiness SHALL require SOURCE and PACKAGE PASS plus schema-v2
CONSUMER acceptance PASS for every required check in the selected scope. It
MUST NOT infer acceptance from raw surface status, require an unselected
surface, or promote installation PASS to native-runtime PASS. A selected
surface may retain raw runtime `NOT_RUN` when no native obligation was selected;
an applicable required native obligation that is blocked, unavailable, or not
run prevents acceptance PASS. For historical CONSUMER results without
acceptance, the facade SHALL preserve the legacy aggregation and exit path.
`COMPLETE` records readiness only and SHALL NOT authorize publication or
deployment.

The legacy full-release path SHALL retain the characterized inventory
`required_runtime_surfaces` list as the ordered subset
`claude-core`, `codex-sync`, `codex-native`, `cursor-plugin`, `agent-plugin`,
and `agy-plugin`; it excludes `cursor-sync`. Legacy `COMPLETE` requires fresh
runtime PASS for that subset. A `cursor-sync` installer `NOT_RUN` alone does
not block legacy completion, while its `FAIL` remains unhealthy. These legacy
rules do not turn raw runtime observations into implicit obligations in the
current selected-scope acceptance path.

When consumer-runtime preflight is attached to a release plan, it SHALL remain
runner-readiness evidence with its existing attempt identity and MUST NOT
replace current selected-scope CONSUMER acceptance.

#### Scenario: Selected installation acceptance passes without a native run

- **WHEN** SOURCE and PACKAGE pass, every selected schema-v2 CONSUMER required check passes, and a selected surface's raw runtime is `NOT_RUN` with no required native check
- **THEN** readiness may be `COMPLETE`, the raw observation remains `NOT_RUN`, and no runtime support is claimed

#### Scenario: A required selected check is blocked

- **WHEN** SOURCE and PACKAGE pass but a selected schema-v2 CONSUMER required check is `BLOCKED` or `UNAVAILABLE`
- **THEN** readiness is non-complete, the facade preserves the check and observation, and its acceptance-aware result exits `1`

#### Scenario: Requirements input remains atomic

- **WHEN** a caller supplies `--requirements` to `release`
- **THEN** the complete declaration is forwarded unchanged to one gate invocation without per-surface partitioning

#### Scenario: A raw observation does not override acceptance

- **WHEN** a schema-v2 CONSUMER envelope has a `PASS` observation but a required acceptance check is `BLOCKED` or `FAIL`
- **THEN** release readiness follows the acceptance check and remains non-pass

#### Scenario: Legacy pending release retains its historical path

- **WHEN** a historical CONSUMER result has no acceptance field and reports `PUBLISHED_PENDING`
- **THEN** the legacy path preserves its characterized pending result and exit convention without synthesizing schema-v2 acceptance

#### Scenario: Legacy runtime matrix keeps the cursor-sync identity row

- **WHEN** a historical full-release result has fresh PASS for every listed required-runtime surface and the `cursor-sync` installer is `NOT_RUN`
- **THEN** it may preserve legacy `COMPLETE` while retaining the independent `cursor-sync` identity row

#### Scenario: Legacy cursor-sync installation FAIL remains unhealthy

- **WHEN** the historical full-release runtime subset passes but the `cursor-sync` installer reports `FAIL`
- **THEN** the legacy aggregate remains unhealthy and does not report `COMPLETE`

#### Scenario: Selected scope is invalid or incomplete

- **WHEN** the current configured or explicit scope is empty, duplicated, or has a missing selected-surface observation
- **THEN** the current release result is `BLOCKED` and does not infer the list from directory contents or adapter defaults

#### Scenario: Full plan surface identity is incomplete

- **WHEN** a full distribution plan omits a canonical surface, duplicates an ID, or names a surface without a projection contract
- **THEN** preflight returns `BLOCKED` and does not infer missing surfaces from directory contents or adapter defaults

#### Scenario: Selected cursor-sync installation fails

- **WHEN** `cursor-sync` is selected and its required installation check is `FAIL`
- **THEN** current acceptance is non-pass and release readiness cannot be `COMPLETE`

#### Scenario: Preflight identity does not replace current acceptance

- **WHEN** a release plan presents runner-readiness evidence with a different task, attempt, source/tree, target/tree, or surface identity
- **THEN** the plan is rejected as stale or `BLOCKED`, and a matching preflight still cannot replace current selected-scope CONSUMER acceptance
