# codex-native-publication Specification

## Purpose
TBD - created by archiving change make-codex-plugin-distribution-install-safe. Update Purpose after archive.
## Requirements
### Requirement: Native publication uses an explicit inventory surface

The native Codex package SHALL contain exactly the non-deprecated entries whose
distribution-inventory `surfaces` include `codex-native`. Native membership
MUST NOT be inferred from `lifecycle=promoted`, directory placement, or README
prose.

#### Scenario: Initial native allowlist is materialized

- **WHEN** the generator runs against the accepted initial inventory
- **THEN** the package contains exactly the entries explicitly marked
  `codex-native`, including the approved optional module exceptions, and no
  other promoted or optional skill

#### Scenario: Promoted but non-native skill is present in a candidate

- **WHEN** a candidate contains a promoted skill whose inventory surfaces do
  not include `codex-native`
- **THEN** PACKAGE validation rejects the candidate and names the extra skill

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

### Requirement: Native publication is deterministic and derived

The native package generator SHALL derive package membership and content from
the checked-in distribution inventory and canonical packages. Generated output
SHALL be tracked as publication material but SHALL NOT be treated as an
independently authored source of skill behavior.

#### Scenario: Unchanged sources are generated twice

- **WHEN** the generator runs twice against the same inventory, canonical
  sources, and release version
- **THEN** package membership, manifest metadata, provenance, and per-skill
  fingerprints are identical

#### Scenario: Generated output diverges from canonical sources

- **WHEN** tracked publication content or fingerprints do not match a fresh
  inventory-controlled generation
- **THEN** the release/package gate fails and requires regeneration in the
  release PR

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

### Requirement: Consumer proof validates the exact publication artifact

The CONSUMER gate SHALL install the exact `plugins/dhpk/` publication artifact
in a clean Codex environment, remove the source checkout, and verify that the
installed cache contains exactly the expected native skill IDs as physical,
discoverable files. A staged candidate generated separately from the
publication artifact SHALL NOT satisfy this requirement.

#### Scenario: Published package installs and discovers all native skills

- **WHEN** the exact publication package is installed in a clean environment
  and the source checkout is removed
- **THEN** the installed cache contains exactly the allowlisted native skills,
  zero symlinks, and non-empty skill entry files, and CONSUMER is PASS

#### Scenario: Package management succeeds but cache discovery fails

- **WHEN** Codex reports the plugin installed but one or more expected skills
  are absent, dangling, or symlink-dependent in the installed cache
- **THEN** CONSUMER is FAIL, native support is not graduated, and the supported
  project-local installer remains documented

#### Scenario: Codex consumer tooling is unavailable

- **WHEN** the required Codex CLI or clean-install environment is unavailable
- **THEN** CONSUMER is BLOCKED or UNAVAILABLE, never PASS, and native support
  remains Experimental

### Requirement: Native support graduation is explicit

Native Codex marketplace support SHALL remain Experimental for this change.
Consumer PASS is necessary evidence for a future graduation review but SHALL
NOT automatically change the public support tier. `install-codex-skills.sh`
SHALL remain the Supported Codex delivery path.

#### Scenario: Consumer PASS is available

- **WHEN** the exact publication artifact passes the clean consumer gate
- **THEN** evidence records native CONSUMER PASS and the surface becomes
  eligible for a separately approved support-graduation decision

#### Scenario: Consumer evidence is unresolved

- **WHEN** consumer proof is unavailable or fails
- **THEN** native documentation remains Experimental and directs production
  users to `install-codex-skills.sh`

### Requirement: Publication retention and update semantics are explicit

The current generated native package SHALL be retained at `plugins/dhpk/` on
the default branch, while immutable release tags retain historical package
states. The public contract SHALL NOT promise arbitrary historical version
selection until a separately verified Codex pinning route exists.

#### Scenario: A release updates native content

- **WHEN** a release changes canonical native sources or inventory membership
- **THEN** the release PR regenerates the current `plugins/dhpk/` package,
  updates version/provenance, and the package gate validates the resulting
  tracked artifact

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
