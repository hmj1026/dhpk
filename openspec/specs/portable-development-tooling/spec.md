# portable-development-tooling Specification

## Purpose

Preserve current development-tooling safeguards recovered from historical
Superpowers designs while leaving implementation plans and run records local.
Canonical metadata and projection requirements remain owned by
`codex-skill-metadata-parity` and `distribution-projection-parity`; TDD role
and guidance requirements remain owned by `tdd-e2e-role-boundaries`.

## Requirements

### Requirement: Handoff timestamps and edits are portable

The handoff phase detector SHALL interpret ISO-8601 `saved_at` timestamps
ending in `Z` as UTC with both GNU and BSD date implementations. The handoff
state editor SHALL use the shared portable in-place editing helper to update
frontmatter on Linux and macOS.

#### Scenario: BSD date parses a saved UTC timestamp

- **WHEN** the GNU date parser is unavailable and the handoff contains a timestamp ending in `Z`
- **THEN** the BSD fallback parses it explicitly as UTC rather than the local timezone

#### Scenario: Handoff state is updated on either platform

- **WHEN** the selected handoff file is updated on Linux or macOS
- **THEN** the portable editing helper changes the intended state field and reports editing failures

### Requirement: TypeScript fallback uses an installed compiler

The precommit runner SHALL use `npx --no-install tsc --noEmit` when no package
typecheck script exists and the project provides `tsconfig.json`. A missing
local compiler SHALL fail without installing a package from the network.

#### Scenario: Project supplies a local compiler and no typecheck script

- **WHEN** the runner selects the tsconfig fallback
- **THEN** it invokes the local compiler with the no-install flag and preserves the compiler result

### Requirement: API transport failure produces no successful evidence

The API execution harness SHALL preserve a failing curl transport exit status,
emit its diagnostic to stderr, and emit no completed request evidence.

#### Scenario: Connection fails before an HTTP response

- **WHEN** curl exits with a transport failure
- **THEN** the harness returns that non-zero exit status and leaves stdout empty

### Requirement: Markdown validation blocks CI failures

The repository CI Markdown lint job SHALL use a pinned markdownlint-cli2
action, cover its declared asset globs, and block CI on lint violations.
Markdown table-column validation (`MD056`) SHALL remain enabled.

#### Scenario: Markdown table has inconsistent columns

- **WHEN** a declared Markdown asset violates the table-column rule
- **THEN** Markdown validation fails and the CI lint job does not continue as a successful advisory job

#### Scenario: CI wiring is weakened

- **WHEN** the lint job is made non-blocking or a required asset glob is removed
- **THEN** the focused Markdown workflow regression check fails
