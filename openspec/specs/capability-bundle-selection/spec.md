# capability-bundle-selection Specification

## Purpose

Define one explicit, inventory-owned capability-selection contract that can
produce deterministic pre-discovery bundles for every supported publication
surface while preserving compatibility and safe rollback.

## Requirements

### Requirement: Profiles expose a closed stable-ID selection

Every selectable profile SHALL declare a normalized profile ID, a stable skill-ID allowlist, and the module/dependency closure that supplements that allowlist. With no explicit `--skill` overlay, `minimal` SHALL resolve to exactly its ten required core IDs after predecessor-to-family replacement. A repeated `--skill` option SHALL be an explicit additive overlay to the chosen profile, MUST NOT mutate the profile definition or remove required core IDs, and the normalized selection SHALL record that overlay mode. The resolver MUST reject unknown, duplicate, retired, missing, external-package-lifecycle-conflicting, or surface-incompatible IDs before returning a selection plan.

#### Scenario: Minimal profile resolves

- **WHEN** a new installation selects `minimal` against the consolidated inventory
- **THEN** the resolver returns exactly ten IDs, including `flow-guide`, `flow-drive`, `change-verdict`, and `code-trace`, plus no module entry not explicitly selected by the profile closure

#### Scenario: Explicit skill is outside the profile

- **WHEN** an operator adds a stable ID that is unknown, retired, absent from the target surface, conflicts with external-package ownership, or is excluded by a profile conflict
- **THEN** resolution fails closed with the ID, failure class, and an available profile or successor guidance, and produces no materialization intent

#### Scenario: Explicit skill overlay is valid

- **WHEN** an operator selects `minimal` with repeatable `--skill` values that are live, inventory-owned, and permitted on the target surface
- **THEN** resolution retains the ten required core IDs, adds the validated overlay IDs, marks the selection as explicit-overlay mode, and leaves the `minimal` profile definition unchanged

### Requirement: Compatibility profiles have distinct meanings

The selection contract SHALL reserve `minimal` for the default nine-capability workflow bundle, SHALL preserve `full` as the existing conflict-aware module closure, and SHALL define `compat-v1` as an explicit legacy bundle containing every non-retired stable ID accepted by the predecessor release. A profile name MUST NOT silently change meaning between surfaces.

#### Scenario: Full profile retains module semantics

- **WHEN** a stack profile resolves `full` with mutually exclusive modules
- **THEN** the result preserves the existing explicit conflict exclusions and does not claim that `full` contains every stable skill ID

#### Scenario: Compatibility bundle is requested

- **WHEN** an existing installation or rollback path selects `compat-v1`
- **THEN** all non-retired predecessor IDs are selected in deterministic order and the result identifies the bundle as compatibility mode

### Requirement: Selection identity is shared across surfaces

Every generated surface selection SHALL carry the same canonical normalized profile ID, ordered canonical stable-ID set, selection-policy version, source/profile/inventory inputs, and canonical selection fingerprint. A surface artifact MAY expose a separate `emittedStableIds` set only when it is the declared result of a surface transform; native Codex SHALL use the intersection of canonical IDs and its existing supported allowlist and SHALL record a surface selection fingerprint for that emitted set. A surface adapter MUST NOT change canonical membership or emit an undeclared ID.

#### Scenario: Equivalent surfaces compile the same selection

- **WHEN** Claude, Cursor, Agent Plugin, AGY, and Codex receive equivalent inventory and profile inputs
- **THEN** each plan records the same canonical selection identity; Codex additionally records its declared emitted intersection and surface selection fingerprint, while consumer-native transforms do not change membership

#### Scenario: Surface adapter changes membership

- **WHEN** an adapter emits an entry not present in the compiler-owned selection or omits a required selected ID
- **THEN** validation rejects the artifact and reports the surface, stable ID, and selection-fingerprint mismatch

### Requirement: New and existing installations migrate explicitly

New installations SHALL default to `minimal`. An existing receipt without an explicit migration record SHALL remain on `compat-v1`; an installer MUST NOT silently shrink an existing bundle. A user-requested profile migration SHALL record the old and new selection identities before activation.

#### Scenario: New installation uses the default

- **WHEN** a clean installation omits `--profile` and `--skill`
- **THEN** it materializes `minimal` and records its selection identity in the receipt

#### Scenario: Existing receipt is upgraded

- **WHEN** an existing receipt has no profile identity or migration marker
- **THEN** planning selects `compat-v1`, reports the preserved compatibility state, and does not remove optional entries solely because the new default is smaller

### Requirement: Bundle activation is atomic and rollback-safe

Profile generation, materialization, and every required consumer verification SHALL stage a complete candidate bundle before activation. A generation failure or any non-pass result for a required runtime surface MUST leave the previously active bundle and receipt unchanged and MUST report the failed stage and candidate identity. Optional or unavailable non-required surfaces remain separate evidence rows and follow the declared activation policy.

#### Scenario: Candidate generation fails

- **WHEN** compilation, staging, fingerprinting, or validation fails for a candidate profile
- **THEN** no candidate replaces the active bundle and the prior active selection remains addressable

#### Scenario: Required consumer verification is unavailable

- **WHEN** structural generation succeeds but a required consumer is absent or unavailable
- **THEN** activation is blocked, the result records `UNAVAILABLE` or `NOT_CONFIGURED`, and the previous active bundle and receipt remain unchanged

#### Scenario: Optional consumer verification is unavailable

- **WHEN** structural generation succeeds but a non-required consumer is absent or unavailable
- **THEN** activation follows the declared policy, the result retains `UNAVAILABLE` or `NOT_CONFIGURED`, and the report does not claim runtime support for that surface

### Requirement: Selection evidence is stage-honest

Selection reports SHALL distinguish profile resolution, structural/package generation, rollback, and consumer-runtime stages. Static counts, selected IDs, and token estimates MUST NOT be presented as live runtime savings; unavailable stages SHALL use `NOT_RUN`, `NOT_CONFIGURED`, `BLOCKED`, or `UNAVAILABLE` as applicable.

#### Scenario: Structural selection passes

- **WHEN** a candidate plan and artifact match the inventory, profile, and selection fingerprints
- **THEN** the structural result is `PASS` and remains separate from consumer-runtime support

#### Scenario: Runtime probe cannot run

- **WHEN** no exact configured consumer can load the candidate artifact
- **THEN** the report retains the structural result, records the closed non-pass runtime state, and includes a bounded resume instruction

### Requirement: Consolidated profiles replace predecessors atomically

Profile definitions SHALL replace every selected predecessor with its successor family once, preserve protected external-package IDs, and produce `full=64` and `compat-v1=71` stable IDs for this inventory revision.

#### Scenario: One profile retains both identities
- **WHEN** a profile contains a retired predecessor and its successor family or drops a protected GitNexus identity
- **THEN** selection validation fails and reports the duplicate migration or protected omission
