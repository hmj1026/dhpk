# tdd-e2e-role-boundaries Specification

## Purpose
TBD - created by archiving change refine-opsx-orchestration-governance. Update Purpose after archive.
## Requirements
### Requirement: TDD and E2E roles retain distinct responsibilities
The plugin SHALL retain the `tdd-guide` name for test-first PHPUnit or live-DB test work and SHALL retain `e2e-runner` for Playwright live-journey execution. `tdd-guide` SHALL provide RED/GREEN/REFACTOR guidance and run the relevant verification; it SHALL not be presented as a generic test-suite runner.

#### Scenario: PHPUnit feature change
- **WHEN** a change needs a RED PHPUnit unit or integration test against a live DB
- **THEN** the dispatch target is `dhpk:tdd-guide`, not `e2e-runner`

#### Scenario: Playwright live journey
- **WHEN** a change needs a browser journey or E2E smoke test
- **THEN** the dispatch target is `dhpk:e2e-runner`, not `tdd-guide`

### Requirement: TDD results expose phase and verdict metadata
The `tdd-guide` report SHALL contain `Phase: RED|GREEN|REFACTOR`, `Verdict: PASS|WARNING|FAIL`, a numeric `coverage_pct` when coverage is available, the verification command, and the changed-test file list.

#### Scenario: TDD report is machine-readable
- **WHEN** `tdd-guide` completes a test-first cycle
- **THEN** its report contains a parseable phase, verdict, coverage value or explicit unavailable marker, and command result

### Requirement: E2E results use project thresholds and bounded retries
The `e2e-runner` SHALL use the repository's configured pass-rate and critical-journey thresholds, SHALL avoid fixed sleep polling, and SHALL report `PASS|WARNING|FAIL`, pass rate, critical-journey result, retry count, and artifact paths. Retry caps and verdict semantics SHALL stay consistent with the existing `e2e-flaky-cap` and `e2e-verdict-integrity` capabilities, which remain the authorities for stabilization-attempt limits and verdict integrity.

#### Scenario: E2E warning is distinguishable from failure
- **WHEN** a non-critical journey flakes within the configured retry cap while critical journeys pass
- **THEN** the report returns `WARNING` with pass rate and retry evidence instead of claiming an unconditional pass

### Requirement: TDD REFACTOR phase may short-circuit on a minimal GREEN diff
The tdd-guide agent SHALL be permitted to skip the REFACTOR pass when the GREEN implementation diff is minimal (no duplication introduced, no structure worth extracting), reporting an explicit `REFACTOR: skipped (minimal diff)` line instead of running a no-op pass.

#### Scenario: Minimal GREEN implementation
- **WHEN** the GREEN phase lands a small diff with no duplication
- **THEN** the report contains `REFACTOR: skipped (minimal diff)` and no refactor edits are attempted

### Requirement: TDD loop runs are scoped; full suite once at phase exit
During the RED→GREEN loop the tdd-guide SHALL invoke the test runner scoped to the affected test (`--filter <TestClass::method>` or a single testsuite) and SHALL run the full applicable suite at most once, at phase exit.

#### Scenario: Iterating on one failing test
- **WHEN** the guide iterates RED→GREEN on a single test method
- **THEN** each iteration runs only the scoped invocation, and the full suite runs once after GREEN

### Requirement: TDD GREEN implementation is threshold-gated between inline and fast-worker handback
tdd-guide SHALL implement the GREEN phase itself only when the whole GREEN footprint fits the inline bound (≤2 files). When the GREEN implementation exceeds that bound, tdd-guide SHALL NOT implement it; it SHALL return the RED tests plus a fast-worker-ready fix-spec (target files, exact change intent, scoped verification command) for the orchestrator to dispatch to the selector-resolved fast-worker, and acceptance SHALL be verified by re-running the scoped tests (by tdd-guide re-invocation or the orchestrator running the stated verification command).

#### Scenario: Small GREEN stays inline
- **WHEN** the failing test can be made green with edits to at most two files
- **THEN** tdd-guide implements GREEN itself, as today

#### Scenario: Large GREEN hands back a fix-spec
- **WHEN** making the test green requires edits across more than two files
- **THEN** tdd-guide returns the RED tests and a fix-spec without implementing, the orchestrator dispatches the fast-worker tier, and the scoped tests are re-run as acceptance

### Requirement: e2e-runner does not implement business code
When a live E2E journey fails because application code needs changing, e2e-runner SHALL NOT edit business code; it SHALL report a fast-worker-ready fix-spec (observed failure, target files, expected observable outcome) to the orchestrator and re-run the journey as acceptance after the fix lands. e2e-runner's own write scope remains test specs, helpers, and test artifacts.

#### Scenario: Journey fails on an application bug
- **WHEN** an E2E run fails due to application behavior rather than a broken spec
- **THEN** e2e-runner reports the fix-spec to the orchestrator (which dispatches the fast-worker tier) and re-runs the journey to verify, instead of editing controllers/models itself

### Requirement: E2E seeds against a shared database are self-cleaning
The e2e-runner SHALL make any data it seeds into a shared database self-cleaning — transaction rollback where the stack allows, otherwise explicit teardown deletion of the seeded rows — leaving no synthetic residue for subsequent runs.

#### Scenario: Seeded synthetic rows
- **WHEN** a live run seeds synthetic rows into a shared dev database
- **THEN** the run removes those rows (or rolls back the transaction) before reporting its verdict

### Requirement: E2E specs reuse shared helpers
When authoring specs, the e2e-runner SHALL check the project's shared spec-helper modules first and consume existing helpers (e.g. a `collectPageErrors` utility) instead of re-inlining equivalent per-spec code.

#### Scenario: New spec needs page-error collection
- **WHEN** a new spec requires page-error collection and a shared helper exists
- **THEN** the spec imports the shared helper rather than duplicating the pattern inline
