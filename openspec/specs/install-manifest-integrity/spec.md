# install-manifest-integrity Specification

## Purpose
TBD - created by archiving change harness-consistency-audit. Update Purpose after archive.
## Requirements
### Requirement: Every shipped module is catalog-selectable

Every module shipped under `modules/<id>/module.yaml` SHALL appear as a selectable entry (stack/version) in `manifests/module-catalog.json`, the interactive installer's single source of truth. The manifest-integrity check SHALL fail when a shipped module is absent from the catalog.

#### Scenario: A shipped module is missing from the catalog

- **WHEN** `modules/library-author/module.yaml` exists but `module-catalog.json` has no selectable entry for `library-author`
- **THEN** the manifest-integrity check reports the missing catalog entry and exits non-zero

#### Scenario: Catalog and modules directory agree

- **WHEN** every `modules/<id>` has a catalog entry and every catalog module id has a `module.yaml`
- **THEN** the manifest-integrity check passes

### Requirement: The full profile is complete

The `full` profile in `manifests/install-profiles.json` SHALL contain every shipped module id except those excluded by an explicit, machine-readable conflict-exclusion list (for mutually exclusive modules such as `php-5.6` vs `php-7.4`/`php-8.x`, one representative is chosen and the others listed as excluded). The manifest-integrity check SHALL fail when a shipped, non-excluded module is missing from the `full` profile.

#### Scenario: A new module is shipped without updating the full profile

- **WHEN** a new `modules/<id>` is added and `full.modules` does not include it and it is not on the conflict-exclusion list
- **THEN** the manifest-integrity check reports the omission and exits non-zero

#### Scenario: A conflicting module is intentionally excluded

- **WHEN** `php-7.4` is on the conflict-exclusion list because `full` includes `php-5.6`
- **THEN** the manifest-integrity check passes without requiring `php-7.4` in the profile

### Requirement: Manifest integrity is wired into the test suite

The manifest-integrity checks SHALL run as part of the repository's standard test entry point (`node tests/run-all.js`), so CI fails on install-manifest drift.

#### Scenario: CI catches profile drift

- **WHEN** a pull request adds a module without updating the catalog or full profile and CI runs the test suite
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
The manifest-integrity validation SHALL reconcile the distribution inventory with canonical skill/module packages, Claude plugin registrations, Codex publication inputs, module catalogs, and install profiles. Missing, duplicate, lifecycle-ineligible, or undeclared consumer-reachable entries SHALL fail validation.

#### Scenario: Deprecated skill remains promoted
- **WHEN** the distribution inventory marks a skill `deprecated` but a generated promoted manifest still registers it
- **THEN** manifest-integrity validation fails and names both the lifecycle entry and manifest location

#### Scenario: Optional module is absent from its catalog
- **WHEN** a module is classified as optional but lacks the catalog/profile metadata required to select it
- **THEN** manifest-integrity validation fails before release

### Requirement: Generated distribution artifacts are drift-checked
The standard test entry point SHALL regenerate publication metadata in check mode and fail when checked-in or release-staged output differs from deterministic generation.

#### Scenario: Manual manifest edit bypasses the inventory
- **WHEN** a contributor manually adds a skill registration without updating the distribution inventory
- **THEN** the generation drift check exits non-zero and reports the unexpected registration

### Requirement: Static and installed validations have distinct verdicts
Plugin validation SHALL report repository path/manifest consistency separately from installed-package materialization. A static PASS SHALL NOT be emitted or documented as an installed-runtime PASS.

#### Scenario: Repository paths resolve but installed cache is empty
- **WHEN** static manifest validation passes and installed-cache discovery fails
- **THEN** the combined report records static PASS, installed FAIL, and an overall native-support FAIL
