## MODIFIED Requirements

### Requirement: Native publication contains only physical package content

The retained Codex-native package SHALL remain generated from the explicit
`codex-native` inventory surface and contain real files for every selected
skill. In addition, the new `agent-plugin` package SHALL be generated as a
separate Agent Plugins artifact with a root `plugin.json`; neither artifact
may rely on parent-relative paths or symlinks that escape its own package root.
The legacy `.codex-plugin/plugin.json` format SHALL not be counted as proof of
Agent Plugins conformance.

#### Scenario: Legacy Codex package remains structurally valid

- **WHEN** the existing native generator runs for the selected Codex-native
  inventory entries
- **THEN** `plugins/dhpk/.codex-plugin/plugin.json` resolves its physical
  `skills/` tree, contains zero symlinks in the publication package, and passes
  the existing legacy Codex gate

#### Scenario: Standard package is structurally valid

- **WHEN** the Agent Plugins generator runs for the selected `agent-plugin`
  entries
- **THEN** `plugins/dhpk-agent/plugin.json` uses the canonical schema, fixed
  `skills/` discovery, contained paths, and zero source-checkout dependencies

#### Scenario: Legacy manifest is mistaken for the standard package

- **WHEN** a release has only `.codex-plugin/plugin.json` and no valid root
  `plugin.json` for the `agent-plugin` surface
- **THEN** the standard package gate fails while the legacy Codex result remains
  separately classified

### Requirement: Publication versions and provenance are coherent

The generated Claude, Codex-native, Agent Plugins, and Cursor-native artifacts MUST
use the release version assigned to their selected surface. Each generated
artifact SHALL record its source version, source commit or tag, inventory
digest, generator version, selected stable IDs, public names, and per-surface
fingerprints without secrets. A mismatch or missing owner SHALL block only the
affected publication surface and SHALL identify the exact artifact.

#### Scenario: Standard and legacy versions are intentionally checked

- **WHEN** the release contains both `plugins/dhpk-agent/` and the retained
  `plugins/dhpk/` package
- **THEN** release parity checks both manifests and both provenance files against
  the same release version while preserving their distinct surface IDs

#### Scenario: Cursor projection drifts from canonical content

- **WHEN** a Cursor skill or agent fingerprint differs from the inventory-owned
  source without an approved adaptation rule
- **THEN** the Cursor package gate fails and reports the source ID, destination,
  and adaptation/provenance gap

## ADDED Requirements

### Requirement: Legacy Codex support remains an explicit compatibility tier

The project SHALL retain the current project-local `codex-sync` installer as
the Supported Codex path and the current `codex-native` marketplace artifact as
Experimental until separate consumer evidence and a graduation decision exist.
Adding an Agent Plugins artifact SHALL not silently change either tier.

#### Scenario: Standard package generation passes without Codex consumer proof

- **WHEN** the generated Agent Plugins package is schema-valid but the real
  Codex CLI consumer gate is absent or unavailable
- **THEN** the report records structural PASS plus consumer `UNAVAILABLE` or
  `BLOCKED`, retains the legacy support labels, and does not graduate native
  Codex support

#### Scenario: Project-local sync remains usable during migration

- **WHEN** a consumer cannot install either marketplace artifact
- **THEN** documentation continues to provide
  `install-codex-skills.sh` with its receipt, collision, copy/symlink, update,
  and rollback semantics
