# install-manifest-integrity Specification

## Purpose

Keep the common installation selection, required core set, module presets, and distribution inventory consistent with shipped skills, commands, and modules.

## Requirements

### Requirement: Every shipped module is catalog-selectable

Every module shipped under `modules/<id>/module.yaml` SHALL appear as a selectable entry (stack/version) in `manifests/module-catalog.json`, the interactive installer's single source of truth. The manifest-integrity check SHALL fail when a shipped module is absent from the catalog.

#### Scenario: A shipped module is missing from the catalog

- **WHEN** `modules/library-author/module.yaml` exists but `module-catalog.json` has no selectable entry for `library-author`
- **THEN** the manifest-integrity check reports the missing catalog entry and exits non-zero

#### Scenario: Catalog and modules directory agree

- **WHEN** every `modules/<id>` has a catalog entry and every catalog module id has a `module.yaml`
- **THEN** the manifest-integrity check passes

### Requirement: The common selection and module presets are complete

The `common` selection in `manifests/install-profiles.json` SHALL contain the
15 public entry IDs declared by `manifests/marketplace-selection.json` and SHALL
include every unchanged `required_core_ids` value as a required subset. The core
invariant SHALL NOT replace or shrink the common selection. Existing module
presets SHALL retain their declared module sets and conflict exclusions. The
manifest-integrity check SHALL fail when the common selection is missing,
duplicated, retired, unknown, or surface-incompatible, or when a declared
module preset no longer matches its module catalog. Historical profile
definitions MAY remain only as receipt-read metadata; they SHALL NOT become
generated or published installation choices.

#### Scenario: Common selection covers its declared catalog

- **WHEN** the common selection contains every public entry ID from the marketplace selection and includes all required core IDs
- **THEN** manifest-integrity validation passes without treating the core subset as a separate default selection

#### Scenario: Common selection or core invariant drifts

- **WHEN** a public entry ID or required core ID is missing, duplicated, retired, unknown, or surface-incompatible
- **THEN** manifest-integrity validation reports the affected ID and exits non-zero before installation

#### Scenario: A conflicting module is intentionally excluded

- **WHEN** a module is excluded by the existing machine-readable conflict rule
- **THEN** validation preserves the exclusion and does not require that module in the preset

#### Scenario: Historical profiles are used only to read receipts

- **WHEN** a manifest retains a retired profile definition for an existing receipt
- **THEN** it remains available for receipt metadata interpretation and is not emitted as an install or publication choice

### Requirement: Manifest integrity is wired into the test suite

The manifest-integrity checks SHALL run as part of the repository's standard test entry point (`node tests/run-all.js`), so CI fails on install-manifest drift.

#### Scenario: CI catches selection or module-preset drift

- **WHEN** a pull request changes the common selection or makes a declared module preset inconsistent with its catalog and CI runs the test suite
- **THEN** the suite fails with the manifest-integrity finding

### Requirement: Version-pin write guidance resolves symlinks

Everywhere the plugin instructs a session to Write `.claude/dhpk-versions.json` or a consumer `CLAUDE.md` (version-diff draft entry, check-plugin-version advisory, claude-health plugin-sync fix delegation, install-rules, project-setup, and harness-fill), the guidance SHALL state that if the target is a symlink the session must resolve and Write the realpath, because the Write tool refuses symlinked targets.

#### Scenario: Pin file is a symlink

- **WHEN** a session follows the version-diff draft-entry instruction and `.claude/dhpk-versions.json` is a symlink
- **THEN** the instruction directs it to Write to `realpath .claude/dhpk-versions.json`, avoiding the "Refusing to write through symlink" error

### Requirement: Installed-plugin resolvability of policy and goal scripts is tested

The plugin validation suite SHALL assert that the packaged plugin layout resolves (a) `rules/execution-policy.md` at the path the goal orientation instruction references, and (b) every statically analyzable repository-relative `require()` or shell source edge reachable from scripts under `skills/opsx-apply-goal/scripts/`. Validation SHALL recurse through static local dependencies. `node:` built-ins require no packaged file. Bare external packages and dynamic paths SHALL be explicitly allow-listed by policy or fail with a diagnostic naming the owner file and unresolved reference. A missing or relocated local file SHALL fail validation before release, preventing consumer-side `Cannot find module` errors and POLICY-UNRESOLVED fallbacks.

#### Scenario: Missing script dependency fails validation

- **WHEN** a script under `skills/opsx-apply-goal/scripts/` references a module path absent from the packaged layout
- **THEN** plugin validation fails with the unresolved path named

#### Scenario: Execution-policy path resolves in the packaged layout

- **WHEN** the packaged plugin is validated
- **THEN** the orientation-referenced `rules/execution-policy.md` path resolves inside the package

### Requirement: Distribution inventory and publication manifests reconcile

The manifest-integrity validation SHALL reconcile the distribution inventory with canonical skill/module packages, Claude profile registrations, Codex publication inputs, module catalogs, install profiles, and compatibility receipts. Missing, duplicate, lifecycle-ineligible, retired, or undeclared consumer-reachable entries SHALL fail validation, and every profile/receipt row SHALL expose its normalized profile ID, selected stable IDs, and selection fingerprint.

#### Scenario: Deprecated skill remains promoted

- **WHEN** the distribution inventory marks a skill `deprecated` but a generated promoted manifest still registers it
- **THEN** manifest-integrity validation fails and names both the lifecycle entry and manifest location

#### Scenario: Optional module is absent from its catalog

- **WHEN** a module is classified as optional but lacks the catalog/profile metadata required to select it
- **THEN** manifest-integrity validation fails before release

#### Scenario: Receipt selection drifts from its profile

- **WHEN** a receipt's selected stable IDs or selection fingerprint does not match its declared profile and inventory
- **THEN** reconciliation fails closed and does not activate or prune the destination

### Requirement: Generated distribution artifacts are drift-checked

The standard test entry point SHALL regenerate publication metadata in check
mode for each declared profile and fail when checked-in or release-staged
output differs from deterministic generation. The check SHALL compare profile
IDs, selected stable IDs, compatibility mode, provenance, and output
fingerprints in addition to bytes and paths.

REQ-2, REQ-3, REQ-6: The same entry point SHALL also drift-check generated
per-skill aggregates compiled from Skill directories (inventory per-skill
fields, skill-resources, skill-directory-coverage, command-skill-dispositions,
and generated `commands/*.md` once that phase is active). A manual edit of a
generated per-skill field or front-door file SHALL fail without updating
publication surfaces. Hand-editing `generated/` outputs remains forbidden.

#### Scenario: Manual manifest edit bypasses the inventory

- **WHEN** a contributor manually adds a skill registration without updating
  the distribution inventory or selected profile
- **THEN** the generation drift check exits non-zero and reports the
  unexpected registration and selection identity

#### Scenario: Profile generation is repeatable

- **WHEN** the same profile, inventory, and canonical sources are generated
  twice
- **THEN** the check observes identical selected IDs, provenance,
  fingerprints, and output bytes

#### Scenario: Manual per-skill aggregate edit bypasses the Skill directory

- **WHEN** a contributor edits a generated per-skill inventory, coverage,
  resource, or disposition row, or a generated `commands/*.md` file, without
  changing the owning Skill directory
- **THEN** the corresponding `--check` exits non-zero and names the Skill or
  command identity

### Requirement: Static and installed validations have distinct verdicts

Plugin validation SHALL report repository path/manifest consistency separately from installed-package materialization. A static PASS SHALL NOT be emitted or documented as an installed-runtime PASS.

#### Scenario: Repository paths resolve but installed cache is empty

- **WHEN** static manifest validation passes and installed-cache discovery fails
- **THEN** the combined report records static PASS, installed FAIL, and an overall native-support FAIL

### Requirement: Per-skill inventory fields are compiled from Skill directories

REQ-2: A generator SHALL compile each Skill's per-skill inventory fields from
that Skill's directory: `path`, `name` / `id`, `capability_id`,
`invocation_class`, `usage`, and `standalone_dependencies`. `--write` SHALL
update those generated fields; `--check` SHALL fail when checked-in generated
fields differ from the directory declaration. Editorial overlays SHALL remain
manifest-owned and SHALL be preserved across `--write`: `lifecycle`,
`surfaces`, `tier`, profile membership in `install-profiles.json`, and
marketplace curation in `marketplace-selection.json`. Default classification
MAY seed lifecycle and surfaces for a newly discovered Skill; a subsequent
editorial overlay SHALL survive regeneration.

#### Scenario: Generated per-skill fields drift from the directory

- **WHEN** a contributor edits an inventory `usage`, `invocation_class`, or
  `standalone_dependencies` value without changing the owning Skill directory
- **THEN** the inventory per-skill drift check exits non-zero and names the
  Skill identity and field

#### Scenario: An editorial lifecycle overlay is preserved

- **WHEN** `--write` regenerates per-skill inventory fields after a Skill
  directory change, and that Skill already has a non-default `lifecycle` or
  `surfaces` overlay
- **THEN** the overlay remains and only directory-owned fields change

#### Scenario: Profile membership is not inferred from the Skill directory

- **WHEN** a Skill directory is added or removed
- **THEN** `install-profiles.json` and `marketplace-selection.json` are
  unchanged by the per-skill generator

### Requirement: Directory-owned coverage aggregates are drift-checked

REQ-3: `manifests/skill-directory-coverage.json` SHALL be generated from each
Skill's `distribution.yaml` coverage declaration (`entry`, `references`,
`executable_entries`, `fixture_ids`, `internal_helpers`, and
`host_capabilities`). `--write` / `--check` SHALL fail closed on missing,
extra, or stale rows. Coverage remains an authoring completeness record;
fixture execution and Host probes stay separate evidence states.

#### Scenario: Coverage is edited only in the aggregate

- **WHEN** a coverage row is added to `manifests/skill-directory-coverage.json`
  without a matching Skill-directory declaration
- **THEN** the coverage drift check fails and names the Skill identity

#### Scenario: A Skill removes a declared reference

- **WHEN** `distribution.yaml` drops a required `references` path and `--check`
  runs
- **THEN** the check fails until `--write` updates the aggregate, and the
  completeness validator still fails if the file is required and missing

### Requirement: Per-skill manifest migration is phased and reversible

REQ-6: Generators SHALL migrate one aggregate at a time (coverage, resource
map, inventory per-skill fields, command dispositions, then command front-door
files). After each phase, `--check` for already-migrated aggregates AND
existing checks for not-yet-migrated aggregates SHALL pass. Rollback of a
phase SHALL restore the prior checked-in bytes of that aggregate without
requiring Skill-directory rewrites or hand-edits of `generated/` outputs. Host
publication surfaces and install behaviour SHALL remain unchanged by the
migration.

#### Scenario: One aggregate is migrated

- **WHEN** only the coverage aggregate has been switched to directory
  generation
- **THEN** coverage `--check` passes against Skill directories, and the
  remaining inventory, resource, disposition, and command-file checks that
  still use their prior sources also pass

#### Scenario: A phase is rolled back

- **WHEN** a migrated aggregate's prior checked-in bytes are restored and
  `--check` runs in the pre-phase mode
- **THEN** that aggregate's check passes and other aggregates are unaffected
