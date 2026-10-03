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
behavior or low-impact scripts MAY have no dedicated test.

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

### Requirement: Suites are organized around observable behavior

Tests SHALL use the existing aggregate runner and MAY cover related scripts in
one suite. Test organization SHALL NOT require a script-to-test mapping, a
stem-based filename, or a flat one-to-one relationship between production
files and test files. Smoke checks MAY be used where operational risk warrants
them; a smoke check SHALL NOT be presented as proof of full behavior coverage.

#### Scenario: Related behavior shares one suite

- **WHEN** multiple scripts contribute to one caller-visible behavior
- **THEN** one focused suite may assert that behavior through its public entry
  point

#### Scenario: New script lacks a dedicated test

- **WHEN** a script is added without a stem-named test or coverage-map entry
- **THEN** `node scripts/ci/catalog.js --check` does not fail because of that
  missing association

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
