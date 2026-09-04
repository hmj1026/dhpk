## MODIFIED Requirements

### Requirement: Profiles expose a closed stable-ID selection

Every selectable profile SHALL declare a normalized profile ID, a stable skill-ID allowlist, and the module/dependency closure that supplements that allowlist. With no explicit `--skill` overlay, `minimal` SHALL resolve to exactly these eight canonical IDs: `change-verdict`, `code-trace`, `flow-drive`, `flow-guide`, `git-smart-commit`, `project-audit`, `prompt-optimize`, and `tdd`. A repeated `--skill` option SHALL be an explicit additive overlay to the chosen profile, MUST NOT mutate the profile definition or remove required core IDs, and the normalized selection SHALL record that overlay mode. The resolver MUST reject unknown, duplicate, retired, missing, external-package-lifecycle-conflicting, or surface-incompatible IDs before returning a selection plan.

#### Scenario: Minimal profile resolves

- **WHEN** a new installation selects `minimal` against the consolidated inventory without an explicit overlay
- **THEN** the resolver returns exactly the eight declared core IDs in deterministic order, including `flow-guide`, `flow-drive`, `git-smart-commit`, `change-verdict`, and `code-trace`, and returns no retired predecessor

#### Scenario: Explicit skill is outside the profile

- **WHEN** an operator adds a stable ID that is unknown, retired, absent from the target surface, conflicts with external-package ownership, or is excluded by a profile conflict
- **THEN** resolution fails closed with the ID, failure class, and an available profile or successor guidance, and produces no materialization intent

#### Scenario: Explicit skill overlay is valid

- **WHEN** an operator selects `minimal` with repeatable `--skill` values that are live, inventory-owned, and permitted on the target surface
- **THEN** resolution retains the eight required core IDs, adds the validated overlay IDs, marks the selection as explicit-overlay mode, and leaves the `minimal` profile definition unchanged

### Requirement: Compatibility profiles have distinct meanings

The selection contract SHALL reserve `minimal` for the default eight-capability workflow bundle, SHALL preserve `full` as the conflict-aware module closure with exactly 55 selected canonical stable IDs for this inventory revision, and SHALL define `compat-v1` as an explicit legacy bundle containing exactly 62 non-retired stable IDs accepted by the predecessor release. A profile name MUST NOT silently change meaning between surfaces.

#### Scenario: Full profile retains module semantics

- **WHEN** a stack profile resolves `full` with mutually exclusive modules
- **THEN** the result contains exactly 55 canonical stable IDs, preserves the existing explicit conflict exclusions, and does not claim that `full` contains every stable skill ID

#### Scenario: Compatibility bundle is requested

- **WHEN** an existing installation or rollback path selects `compat-v1`
- **THEN** all 62 non-retired predecessor-compatible stable IDs are selected in deterministic order and the result identifies the bundle as compatibility mode

### Requirement: Consolidated profiles replace predecessors atomically

Profile definitions SHALL replace every selected predecessor with its successor family at most once, preserve all six protected GitNexus stable IDs, and reject retired IDs in every profile. For this inventory revision, the canonical catalog SHALL contain exactly 65 skills, exactly 9 live `portable-family` entries, and exactly 56 live entries whose public name retains the `dhpk-` prefix. The normalized profile counts SHALL be `minimal=8`, `full=55`, and `compat-v1=62` before any explicit overlay.

#### Scenario: Consolidated topology is exact

- **WHEN** inventory and profile validation run against the target revision
- **THEN** the report records `canonical=65`, `portable-family=9`, `dhpk-prefixed=56`, `minimal=8`, `full=55`, and `compat-v1=62`, and identifies any unexpected entry by stable ID

#### Scenario: One profile retains both identities

- **WHEN** a profile contains a retired predecessor and its successor family, contains a duplicate successor, or drops a protected GitNexus identity
- **THEN** selection validation fails and reports the duplicate migration or protected omission before materialization
