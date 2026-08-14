## ADDED Requirements

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
