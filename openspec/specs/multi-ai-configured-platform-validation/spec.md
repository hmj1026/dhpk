# multi-ai-configured-platform-validation Specification

## Purpose
TBD - created by archiving change scope-multi-ai-sync-validation-to-configured-platforms. Update Purpose after archive.

## Requirements

### Requirement: Validation derives the configured target set before checking parity

`multi-ai-sync validate` SHALL validate the canonical Claude source first and
then derive the configured target set from documented platform markers using
one shared resolver. For Cursor, the marker set SHALL include the supported
project-local `.cursor/.dhpk-installed.json` receipt in addition to the
documented package markers. Marker presence establishes applicability even when
the marker is malformed; the subsequent target validator SHALL report the
malformed configuration as `FAIL` rather than treating it as absent.

#### Scenario: Consumer has a Cursor project-local receipt

- **WHEN** a consumer root contains `.cursor/.dhpk-installed.json`
- **THEN** Cursor is included as configured and validation proceeds to the
  project-local receipt/projection checks without requiring a package root

#### Scenario: Repository configures only Codex

- **WHEN** the Claude source is valid, Codex markers are present, and Gemini
  and Antigravity markers are absent
- **THEN** Codex participates in parity checks while Gemini and Antigravity
  are reported as `NOT_CONFIGURED`

#### Scenario: Canonical Claude source is missing

- **WHEN** the required Claude source is absent or invalid
- **THEN** the run reports `FAIL` rather than treating the source as an
  optional unconfigured platform

#### Scenario: Project-local receipt is malformed

- **WHEN** the Cursor receipt marker exists but is invalid JSON or violates the
  schema-v3 contract
- **THEN** Cursor remains applicable and the result is `FAIL` with a bounded
  diagnostic rather than `BLOCKED` for an absent marker

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
`.cursor-plugin/plugin.json` projection, the portable/package markers, and a
project-local `.cursor/.dhpk-installed.json` receipt. Cursor validation SHALL
distinguish the `cursor-sync` project-local structure from the portable and
Cursor-native package routes and SHALL retain independent evidence for each
route when more than one is present.

#### Scenario: Current project-local Cursor projection is configured

- **WHEN** a consumer root has a schema-v3 receipt with current provenance and
  complete receipt-owned `.cursor/` managed entries
- **THEN** project-local structural evidence can be `PASS` without a
  consumer-local package root, while package and runtime evidence remain
  separate rows

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

#### Scenario: Project-local projection is incomplete or stale

- **WHEN** the receipt is stale, malformed, missing required managed entries, or
  disagrees with the observed `.cursor/` projection
- **THEN** the project-local capability is `FAIL` with a bounded reason and is
  not downgraded to `NOT_CONFIGURED` or `SKIP_INCOMPATIBLE`

#### Scenario: Package and project-local routes coexist

- **WHEN** both a supported package root and a project-local receipt/projection
  are present
- **THEN** each route retains its own paths, fingerprints, and structural
  verdict; one route cannot satisfy or overwrite the evidence of the other

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

The configured-platform gate SHALL keep project-local `cursor-sync`, portable
Agent Plugin, Cursor-native package, and runtime rows separate. A structural or
receipt `PASS` SHALL NOT be promoted to launch/runtime `PASS`; existing
`FAIL`/`BLOCKED` precedence and policy-backed `SKIP_INCOMPATIBLE` semantics
remain unchanged.

#### Scenario: Project-local structure passes but runtime is not run

- **WHEN** the receipt/projection validates structurally and no Cursor launch
  probe was executed
- **THEN** structural evidence is `PASS`, runtime remains `NOT_RUN` (or its
  existing independent result), and the report does not claim runtime support

#### Scenario: Portable package passes but Cursor-native is unconfigured

- **WHEN** Agent Plugins structural checks pass and no Cursor-native package is
  requested
- **THEN** the portable row may be `PASS`, Cursor-native is `NOT_CONFIGURED`,
  and the report does not claim full Cursor Plugin parity

#### Scenario: Explicit Cursor request is absent

- **WHEN** `--targets cursor` is supplied and neither package nor project-local
  Cursor markers exist
- **THEN** the Cursor row remains `BLOCKED`, the final gate is non-zero, and
  other platform rows remain visible

### Requirement: AGY discovery and runtime evidence remain separate

The shared resolver SHALL recognize an inventory-owned `agy-plugin` package or
installed `~/.gemini/config/plugins/dhpk/plugin.json` marker. An explicit
`--targets agy` request without a marker SHALL be `BLOCKED`; an unrequested
absence SHALL be `NOT_CONFIGURED`. Structural package validation,
`agy plugins list`, `agy agents`, and a bounded read-only Subagent invocation
MUST be separate report capabilities. Missing `agy` tooling SHALL be
`UNAVAILABLE`, and discovery SHALL NOT upgrade runtime support.

When the bounded runtime probe is requested, the selected session home SHALL be
explicit, absolute, and allowlist-based. Missing session selection SHALL be
`BLOCKED` with a non-sensitive session reason code. Runtime authentication
failures SHALL remain `BLOCKED`, while DNS, transport, or timeout failures SHALL
be `UNAVAILABLE`; each status SHALL include a bounded redacted reason code and
MUST NOT expose session contents.

#### Scenario: AGY package is configured without a client

- **WHEN** `plugins/dhpk-agy/plugin.json` and adapted agents are valid but `agy` is not on `PATH`
- **THEN** package evidence is `PASS`, consumer discovery is `UNAVAILABLE`, and runtime remains `NOT_RUN`

#### Scenario: AGY runtime probe is explicitly requested

- **WHEN** `--targets agy --agy-runtime-probe` runs with a configured client and the bounded read-only smoke prompt returns its sentinel
- **THEN** the runtime capability is `PASS` independently of package and discovery rows

#### Scenario: AGY runtime session is not selected

- **WHEN** the runtime probe is requested without an absolute `DHPK_AGY_HOST_HOME` that contains an allowlisted session file
- **THEN** the runtime capability is `BLOCKED` with a redacted session-unavailable reason code and no credential content is persisted

#### Scenario: AGY runtime authentication fails

- **WHEN** an allowlisted session is cloned but the bounded Subagent invocation reports authentication or authorization failure
- **THEN** the runtime capability is `BLOCKED` with an authentication reason code and discovery/package rows remain independent

#### Scenario: AGY runtime connectivity fails

- **WHEN** an allowlisted session is cloned but the bounded Subagent invocation reports DNS, transport, or timeout failure inside the controlled shared-network sandbox
- **THEN** the runtime capability is `UNAVAILABLE` with a connectivity reason code and the release remains non-complete
