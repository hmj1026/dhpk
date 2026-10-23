# script-test-coverage Specification

## Purpose

Protect meaningful, caller-visible script behavior with tests proportionate to
its risk, without requiring a test file for every script or helper.

## Requirements

### Requirement: Script tests protect meaningful behavior proportionately

Automated tests SHOULD cover script behavior that makes a safety decision,
exposes a caller-visible contract, or performs a high-impact side effect when
that behavior can be exercised reliably. Tests SHALL assert outcomes through
an existing CLI, hook, installer, or package entry point. Thin wrappers MAY be
covered through their real entry point, and helpers without independent
behavior or low-impact scripts MAY have no dedicated test. Packaged Skill
scripts under `skills/*/scripts` MUST be covered by the Skill-script
operability smoke (REQ-1). Plugin install and package scripts on the keep-list
MUST keep routine tests (REQ-2).

#### Scenario: A meaningful CLI contract is tested

- **WHEN** a script's public contract affects callers or makes a safety decision
- **THEN** a focused test exercises the existing entry point and asserts its
  observable result

#### Scenario: A thin wrapper is covered through its entry point

- **WHEN** a wrapper only forwards arguments to an existing command
- **THEN** a test MAY exercise the forwarding through the real command without
  adding a dedicated wrapper test

#### Scenario: A low-impact helper has no dedicated test

- **WHEN** a helper has no independent behavior or a low-impact script is
  difficult to exercise reliably
- **THEN** the absence of a dedicated test does not fail catalog validation

#### Scenario: Packaged public CLI scripts have an operability oracle

- **WHEN** a packaged Skill script under `skills/*/scripts` is classified as a
  public CLI entry
- **THEN** the operability smoke suite exercises that entry through its public
  invocation and asserts exit code and output shape

### Requirement: Suites are organized around observable behavior

Tests SHALL use the existing aggregate runner and MAY cover related scripts in
one suite. Test organization SHALL NOT require a script-to-test mapping, a
stem-based filename, or a flat one-to-one relationship between production
files and test files. Smoke checks MAY be used where operational risk warrants
them; a smoke check SHALL NOT be presented as proof of full behavior coverage.
Packaged Skill scripts SHALL share one data-driven operability suite (REQ-1).
Historical per-family isolation suites SHALL NOT be required once that suite
invokes those entries.

#### Scenario: Related behavior shares one suite

- **WHEN** multiple scripts contribute to one caller-visible behavior
- **THEN** one focused suite may assert that behavior through its public entry
  point

#### Scenario: New script lacks a dedicated test

- **WHEN** a script is added without a stem-named test or coverage-map entry
- **THEN** `node scripts/ci/catalog.js --check` does not fail because of that
  missing association

#### Scenario: A new packaged Skill script is discovered

- **WHEN** a new executable-extension file is added under `skills/*/scripts`
- **THEN** the operability smoke suite requires its classification and invokes
  it when classified as a public CLI, without a stem-named isolation test

### Requirement: Test policy has no project-wide coverage target

The repository SHALL NOT require a fixed project-wide coverage percentage or
test-count target. Markdown skill and guidance bodies SHALL be reviewed by
people; automated tests MAY verify shared machine-readable parsing and
resource-integrity behavior, but SHALL NOT assert individual documents'
wording, headings, examples, section order, or body length.

#### Scenario: Skill prose changes without a test update

- **WHEN** a skill's prose changes while its machine-readable metadata and
  referenced resources remain valid
- **THEN** no prose-specific test or test-count update is required

### Requirement: Daily CI may select existing owner suites conservatively

Daily pull-request CI MAY select the union of existing coarse owner suites for
known hooks, installer lifecycle, skill resources, explicitly recognized
Skill-script CLI entries, and manifest or adapter package changes. Internal
Skill-script modules and new or unrecognized entries SHALL use the full plan;
the presence of a `skills/*/scripts` path SHALL NOT establish CLI ownership.
Shared CLI-dispatch adapter, transport, and dispatch-runtime owners under
`scripts/cli-dispatch/` SHALL retain their separate behavior suites. Flow Drive
owns no script entry or runtime suite. The selection SHALL use the existing
positional-file runner, one shard with four workers, and a plan-recorded
test-file list. Full fallback SHALL retain four shards with four workers.
Shared core, runner, CI, unknown or unmapped paths, missing owner suites, and
unavailable diffs SHALL use the full plan. Installer-owner changes SHALL
include macOS installer validation. REQ-4: Each owner-suite test filename
SHALL exist in the discovered test set; a mapped file that is missing SHALL
fail closed to the full plan. Canonical `scripts/lib/ci-plan.js` SHALL be the
mapping source, and the Claude marketplace package copy SHALL be regenerated
from that source rather than hand-edited. The Darwin installer file list SHALL
be updated in the same change only when a Host-unique installer suite is added
or removed from the Ubuntu aggregate.

#### Scenario: Selected evidence covers exactly the planned suites

- **WHEN** a selected plan is verified after its positional-file run
- **THEN** shard evidence has the same run and checkout identities and exactly
  the plan's test-file union, with no missing, extra, or duplicate file

#### Scenario: Classification cannot establish a safe owner

- **WHEN** a changed path is shared core, runner, CI, unknown, unmapped, or
  the diff is unavailable
- **THEN** the plan requires the full four-shard validation and does not claim
  selected coverage

#### Scenario: Installer owner list names a missing test

- **WHEN** a selected plan maps installer changes to a test file that is not in
  the discovered test set
- **THEN** the plan is full with an owner-mapping or owner-suite unavailable
  reason and does not claim selected coverage

#### Scenario: Skill-script helper has no CLI owner

- **WHEN** a change includes an internal Skill-script module, an unrecognized
  entry, or a mixture of a recognized CLI and an unowned module
- **THEN** the plan requires full validation instead of assigning those changes
  solely to the operability smoke suite

### Requirement: Routine CI proves Skill-script operability

REQ-1: The routine aggregate runner SHALL include one data-driven operability
smoke suite for packaged Skill scripts. That suite SHALL discover every file
under `skills/*/scripts` with a supported executable extension and classify it
as a public CLI entry or an internal module. Every recognized public CLI entry
SHALL be invoked in an isolated empty project with a start fixture or `--help`,
asserting its exit code and output shape. Internal modules SHALL remain
classified as non-CLI and retain their applicable existing behavior coverage;
classification SHALL NOT be reported as CLI execution. Unclassified files
SHALL fail the classification check. The smoke suite SHALL NOT be presented as
full behavior coverage. Adding a packaged Skill script SHALL require its
classification and, when classified as a public CLI entry, its invocation
without requiring a stem-named isolation test.

#### Scenario: Packaged Skill scripts are classified and public CLIs invoked

- **WHEN** the routine aggregate runner executes the Skill-script operability
  smoke suite
- **THEN** every discovered executable-extension file is classified, every
  recognized public CLI entry is invoked in an isolated empty project with
  exit-code and output-shape assertions, and internal modules remain classified
  as non-CLI without claiming CLI execution

#### Scenario: Remaining public entries stay executed after isolation removal

- **WHEN** the remaining-entry isolation suite is removed
- **THEN** previously isolation-only entries (including code-trace, deploy-list,
  feature-verify, change-verdict, and ios helpers) are still invoked by the
  operability smoke suite

### Requirement: Routine CI keeps install and package script suites

REQ-2: The routine aggregate runner SHALL retain focused tests for plugin
install and package scripts, including installer lifecycle, Host installers,
shared Skill install, consumer-gate CLI, native install smoke, package-json
script wiring, and `validate-*.test.js` owner suites. Removing a migration-only
or isolation suite SHALL NOT remove those keep-list suites.

#### Scenario: Installer keep-list remains in the aggregate

- **WHEN** migration-only or isolation suites are deleted from `tests/`
- **THEN** the installer and package keep-list files are still discovered by
  the aggregate runner and still execute their public install/package oracles

### Requirement: Non-operability suites leave the routine runner

REQ-3: Migration-only isolation, issue-numbered leftovers, live
measurement/budget/benchmark gates, and CI-meta workflow-wiring suites SHALL
NOT remain in the routine aggregate discovery set once their covering
operability or keep-list suite exists. REQ-7: Agents-skills retirement
scenarios SHALL continue to execute as part of the gen-agents-skills suite
rather than as a separate retirement test file.

#### Scenario: Deleted isolation files are absent from discovery

- **WHEN** `tests/run-all.js` discovers `*.test.js` files
- **THEN** the deleted isolation, issue-numbered, and CI-meta files are absent
  and retirement scenarios still run from `tests/gen-agents-skills.test.js`

### Requirement: Research measurements stay on-demand

REQ-5: Live context, catalog-quota, worker-benchmark, subagent-budget, and
historical skill-baseline measurements SHALL NOT be routine CI gates. Research
CLIs for those measurements SHALL remain invocable on demand. Stable fixture
tests of production receipt-store budget accounting, and independent-literal
tests of discovery-budget calculations, SHALL remain in the routine suite.

#### Scenario: Research CLI is requested on demand

- **WHEN** a caller invokes the documented on-demand research npm script or CLI
- **THEN** the budget or benchmark tool still runs, and the routine aggregate
  runner does not require that live measurement to pass

### Requirement: Assertion-evidence and shard verification stay routine

REQ-8: Local assertion-evidence validation and trusted shard verification
SHALL remain part of the routine test and CI evidence path. This change SHALL
NOT weaken or replace those contracts.

#### Scenario: Assertion-evidence path is unchanged

- **WHEN** the aggregate runner and shard verifier run after this trim
- **THEN** they still validate assertion summaries and trusted shard unions
  through the existing assertion-evidence and verify-test-shards seams
