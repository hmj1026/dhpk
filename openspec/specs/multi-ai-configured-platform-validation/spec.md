# multi-ai-configured-platform-validation Specification

## Purpose
TBD - created by archiving change scope-multi-ai-sync-validation-to-configured-platforms. Update Purpose after archive.
## Requirements
### Requirement: Validation derives the configured target set before checking parity
`multi-ai-sync validate` SHALL validate the canonical Claude source first and then derive the configured Codex, Gemini, and Antigravity target set from documented platform markers, using one shared resolver. The resolver SHALL be implemented as a reusable function so `plan`/`apply`/discovery can adopt it in a later change; this requirement binds `validate` only.

#### Scenario: Repository configures only Codex
- **WHEN** the Claude source is valid, Codex markers are present, and Gemini and Antigravity markers are absent
- **THEN** Codex participates in parity checks while Gemini and Antigravity are reported as `NOT_CONFIGURED`

#### Scenario: Canonical Claude source is missing
- **WHEN** the required Claude source is absent or invalid
- **THEN** the run reports `FAIL` rather than treating the source as an optional unconfigured platform

### Requirement: Per-check results use explicit applicability statuses
Every platform check SHALL return one of `PASS`, `FAIL`, `NOT_CONFIGURED`, or `SKIP_INCOMPATIBLE`. `SKIP_INCOMPATIBLE` SHALL identify the source capability and a reason from an explicit compatibility policy; an unknown exception or unsupported assertion SHALL remain `FAIL`.

#### Scenario: Configured platform lacks a documented capability
- **WHEN** a configured target cannot represent a source feature listed as incompatible in the capability matrix
- **THEN** that check reports `SKIP_INCOMPATIBLE` with the capability and reason

#### Scenario: Unexpected target validation error
- **WHEN** a configured applicable check raises an error not covered by the compatibility policy
- **THEN** the check reports `FAIL` and does not downgrade itself to a skip

### Requirement: An explicitly requested but absent target is BLOCKED, not NOT_CONFIGURED
`multi-ai-sync validate` SHALL accept an explicit `--targets` list or `--all-targets` flag (this requirement does not extend `plan`'s narrower pre-existing `--targets`-only flag, and `apply`/discovery have no such flag yet). A target named by `--targets` or implied by `--all-targets` that has no configuration marker SHALL report `BLOCKED`. A target absent from an unqualified (no-flag) auto-discovery run SHALL report `NOT_CONFIGURED`. Both remain visible report rows; `NOT_CONFIGURED` and `SKIP_INCOMPATIBLE` never move the gate off `PASS`, while `BLOCKED` does.

#### Scenario: Explicit request names an absent platform
- **WHEN** `--targets gemini` is passed and no Gemini configuration marker exists
- **THEN** the Gemini row reports `BLOCKED` and the final gate is `BLOCKED` (or `FAIL` if any applicable check also fails)

#### Scenario: Default auto-discovery omits an absent platform
- **WHEN** no `--targets`/`--all-targets` flag is passed and Antigravity has no configuration marker
- **THEN** the Antigravity row reports `NOT_CONFIGURED` and does not affect the final gate

### Requirement: Final gate aggregates configured applicable checks only
The final validation gate SHALL be `FAIL` when any applicable check for a configured target fails, SHALL be `BLOCKED` when no check fails but at least one explicitly requested target is entirely absent, and SHALL otherwise be `PASS`. `FAIL` takes precedence over `BLOCKED` when both conditions hold. `NOT_CONFIGURED` and `SKIP_INCOMPATIBLE` rows SHALL remain visible in the report but SHALL NOT independently downgrade the final gate. The exit code SHALL be `0` for `PASS` and non-zero for `FAIL` or `BLOCKED`.

#### Scenario: Only non-applicable rows accompany passing checks
- **WHEN** every applicable configured check passes and other rows are only `NOT_CONFIGURED` or policy-backed `SKIP_INCOMPATIBLE`
- **THEN** the final gate is `PASS` and the report retains the non-applicable rows and reasons

#### Scenario: One configured target fails
- **WHEN** any applicable check for a configured target reports `FAIL`
- **THEN** the final gate is `FAIL` regardless of results from other targets

#### Scenario: Explicit request absent, nothing else fails
- **WHEN** an explicitly requested target is entirely absent and every other applicable check passes
- **THEN** the final gate is `BLOCKED` and the process exits non-zero

### Requirement: Report exposes a deprecated PARTIAL-compatible field for one release
The validation report SHALL include a `legacy_gate` field alongside `gate`, valued `FAIL` when `gate` is `FAIL` or `BLOCKED`, `PARTIAL` when `gate` is `PASS` and at least one applicable row is `SKIP_INCOMPATIBLE`, and `PASS` otherwise. `legacy_gate` SHALL be documented as removal-pending; canonical and mirrored consumers SHALL read `gate`, not `legacy_gate`.

#### Scenario: Skip-incompatible row with an otherwise-passing run
- **WHEN** `gate` is `PASS` and one applicable row is `SKIP_INCOMPATIBLE`
- **THEN** `legacy_gate` reports `PARTIAL`

#### Scenario: Blocked run reported to a legacy consumer
- **WHEN** `gate` is `BLOCKED`
- **THEN** `legacy_gate` reports `FAIL`

### Requirement: Cursor is a first-class configured validation target

The shared platform resolver SHALL recognize Cursor markers, including a
`.cursor-plugin/plugin.json` projection or an explicit Cursor target flag, and
shall distinguish the portable Agent Plugins check from Cursor-native component
checks. An absent unrequested Cursor marker is `NOT_CONFIGURED`; an explicitly
requested but absent Cursor target is `BLOCKED`.

#### Scenario: Repository configures the standard package for Cursor

- **WHEN** a valid `plugins/dhpk-agent/plugin.json` exists and Cursor is
  explicitly selected without a native Cursor projection
- **THEN** the report runs the portable skills/MCP checks and records the
  Cursor-native component row as `SKIP_INCOMPATIBLE` or `NOT_CONFIGURED`, not
  as a missing standard package

#### Scenario: Repository configures Cursor-native extras

- **WHEN** `.cursor-plugin/plugin.json` and its selected component roots exist
- **THEN** Cursor participates in both portable and native checks, each with
  independent evidence and failure boundaries

### Requirement: Cursor capability gaps are explicit policy-backed skips

The validation report SHALL use `SKIP_INCOMPATIBLE` only for a capability named
in the platform matrix with a reason and fallback. An unknown Cursor parsing,
hook, variable, or consumer error SHALL remain `FAIL` or `BLOCKED` rather than
being silently treated as incompatible.

#### Scenario: Claude hook has no Cursor equivalent

- **WHEN** a canonical hook cannot be represented by the documented Cursor
  hook events
- **THEN** the report names the hook, emits `SKIP_INCOMPATIBLE`, and points to
  the manual or portable fallback

#### Scenario: Unexpected Cursor validator error

- **WHEN** a configured Cursor check raises an error not covered by the matrix
- **THEN** the check reports `FAIL` and the final gate is non-passing

### Requirement: Final gate aggregates platform rows without conflation

The configured-platform gate SHALL keep portable Agent Plugin, legacy Codex,
Codex-native, and Cursor-native rows separate. `FAIL` takes precedence over
`BLOCKED`; `NOT_CONFIGURED`, policy-backed `SKIP_INCOMPATIBLE`, and structural
only results do not become runtime PASS. The exit code and report SHALL retain
all rows and their evidence.

#### Scenario: Portable package passes but Cursor-native is unconfigured

- **WHEN** Agent Plugins structural checks pass and no Cursor-native package is
  requested
- **THEN** the portable row may be `PASS`, Cursor-native is `NOT_CONFIGURED`,
  and the report does not claim full Cursor Plugin parity

#### Scenario: Explicit Cursor request is absent

- **WHEN** `--targets cursor` is supplied without a configured Cursor marker
- **THEN** the Cursor row is `BLOCKED`, the final gate is non-zero, and other
  platform rows remain visible

