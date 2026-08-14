## ADDED Requirements

### Requirement: Distribution inventory is the projection selection SSOT

`manifests/distribution-inventory.json` SHALL be the sole source of component selection, lifecycle, permitted surfaces, canonical source identity, physical ownership, transforms, and symlink policy supplied to `compileDistribution`. Generators, adapters, manifests, directory layouts, README lists, and installed artifacts MUST NOT independently add, remove, promote, or re-own a distribution entry.

#### Scenario: Surface adapter discovers an extra component

- **WHEN** a surface-specific adapter finds a package in a conventional directory that is not selected for that surface by the inventory
- **THEN** compilation or no-drift validation reports the extra component and excludes it from the accepted plan

#### Scenario: Inventory declares a shared physical owner

- **WHEN** two consumer surfaces select one portable entry and the inventory assigns one shared owner
- **THEN** both projections reference that ownership decision and no adapter creates a second implicit physical copy

#### Scenario: Projection rule has no inventory owner

- **WHEN** a generator-local default would choose a transform, output ownership, or symlink behavior not declared by the inventory
- **THEN** distribution validation fails instead of treating the local default as policy

### Requirement: Every migrated generated surface uses the shared projection pipeline

After its characterization gate and cutover, each Agent Plugin, Codex native, Cursor, and Claude generated surface SHALL be planned through `compileDistribution`, materialized through `materializeDistribution` and `ProjectionArtifactStore`, and assessed through `verifyDistribution` for each supported verification stage. Before that per-surface cutover, the characterized legacy implementation remains authoritative as the rollback path. Surface adapters MAY render consumer-native syntax but MUST NOT bypass the shared selection, ownership, provenance, or evidence contracts after cutover.

#### Scenario: Consumer requires a native manifest format

- **WHEN** a surface adapter renders consumer-specific metadata from a valid plan
- **THEN** the output retains the plan's stable IDs, ownership, transforms, and fingerprints while using the consumer-native syntax

#### Scenario: Legacy generator bypasses the compiler

- **WHEN** a surface that has completed its characterized cutover attempts to derive its membership directly from directories or its existing manifest
- **THEN** the distribution gate fails and identifies the bypassed projection stage

### Requirement: Surface migration preserves the current distribution contract

Migration to the shared projection pipeline SHALL proceed surface by surface behind characterization evidence. The repository MUST maintain one public version of each generator/verifier contract; it MUST NOT expose parallel legacy and v2 CLIs to consumers. Until a surface passes equivalence and rollback tests, the existing implementation remains authoritative for that surface.

#### Scenario: First surface is ready independently

- **WHEN** one surface passes its characterization, projection, validation, and rollback tests while another surface has not migrated
- **THEN** the ready surface can ship through the existing CLI contract without requiring the unfinished surface

#### Scenario: Migration changes an observable CLI behavior

- **WHEN** the new pipeline changes output bytes, ordering, diagnostics, or exit status for characterized inputs
- **THEN** validation blocks cutover and the existing surface implementation remains active
