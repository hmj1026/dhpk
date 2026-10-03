# capability-bundle-selection Specification

## Purpose

Define one explicit, inventory-owned capability-selection contract that can
produce deterministic pre-discovery bundles for every supported publication
surface while preserving compatibility and safe rollback.

## Requirements

### Requirement: Profiles expose a closed stable-ID selection

Every selectable profile SHALL declare a normalized profile ID, a stable skill-ID allowlist, and the module/dependency closure that supplements that allowlist. With no explicit `--skill` overlay, `minimal` SHALL resolve to exactly these four canonical IDs: `change-verdict`, `code-trace`, `flow-drive`, and `flow-guide`. A repeated `--skill` option SHALL be an explicit additive overlay to the chosen profile, MUST NOT mutate the profile definition or remove required core IDs, and the normalized selection SHALL record that overlay mode. The resolver MUST reject unknown, duplicate, retired, missing, external-package-lifecycle-conflicting, or surface-incompatible IDs before returning a selection plan.

#### Scenario: Minimal profile resolves

- **WHEN** a new installation selects `minimal` against the consolidated inventory without an explicit overlay
- **THEN** the resolver returns exactly the four declared core IDs in deterministic order: `change-verdict`, `code-trace`, `flow-drive`, and `flow-guide`, and returns no retired predecessor

#### Scenario: Explicit skill is outside the profile

- **WHEN** an operator adds a stable ID that is unknown, retired, absent from the target surface, conflicts with external-package ownership, or is excluded by a profile conflict
- **THEN** resolution fails closed with the ID, failure class, and an available profile or successor guidance, and produces no materialization intent

#### Scenario: Explicit skill overlay is valid

- **WHEN** an operator selects `minimal` with repeatable `--skill` values that are live, inventory-owned, and permitted on the target surface
- **THEN** resolution retains the four required core IDs, adds the validated overlay IDs, marks the selection as explicit-overlay mode, and leaves the `minimal` profile definition unchanged

### Requirement: Compatibility profiles have distinct meanings

The selection contract SHALL reserve `minimal` for the default four-capability workflow bundle, SHALL preserve `full` as the conflict-aware module closure derived from the live module and conflict catalogs, and SHALL define `compat-v1` as the explicit predecessor-compatible set of live stable IDs. Membership SHALL be derived from the catalogs and inventory rather than a fixed per-revision count. A profile name MUST NOT silently change meaning between surfaces.

#### Scenario: Full profile retains module semantics

- **WHEN** a stack profile resolves `full` with mutually exclusive modules
- **THEN** the result contains the deterministic module closure after the declared conflict exclusions, and does not claim that `full` contains every live stable skill ID

#### Scenario: Compatibility bundle is requested

- **WHEN** an existing installation or rollback path selects `compat-v1`
- **THEN** the non-retired stable IDs declared by the compatibility profile are selected in deterministic order and the result identifies the bundle as compatibility mode

### Requirement: Profile selection identity is shared across its surfaces

Every selection produced from this capability-profile contract SHALL carry the same canonical normalized profile ID, ordered canonical stable-ID set, selection-policy version, source/profile/inventory inputs, and canonical selection fingerprint across its declared surfaces. A surface artifact MAY expose a separate `emittedStableIds` set only when it is the declared result of a surface transform; native Codex SHALL use the intersection of canonical IDs and its existing supported allowlist and SHALL record a surface selection fingerprint for that emitted set. A surface adapter MUST NOT change canonical membership or emit an undeclared ID. This profile identity contract does not select or constrain the separately compiled OpenAI marketplace catalog.

#### Scenario: Equivalent surfaces compile the same selection

- **WHEN** Claude, Cursor, Agent Plugin, AGY, and Codex receive equivalent inventory and profile inputs
- **THEN** each plan records the same canonical selection identity; Codex additionally records its declared emitted intersection and surface selection fingerprint, while consumer-native transforms do not change membership

#### Scenario: Surface adapter changes membership

- **WHEN** an adapter emits an entry not present in the compiler-owned selection or omits a required selected ID
- **THEN** validation rejects the artifact and reports the surface, stable ID, and selection-fingerprint mismatch

### Requirement: New and existing profile installations migrate explicitly

New installations using this profile-based installation contract SHALL default to `minimal`. An existing profile receipt without an explicit migration record SHALL remain on `compat-v1`; an installer MUST NOT silently shrink an existing bundle. A user-requested profile migration SHALL record the old and new selection identities before activation. This requirement does not define the independent OpenAI marketplace catalog selection.

#### Scenario: New installation uses the default

- **WHEN** a clean installation omits `--profile` and `--skill`
- **THEN** it materializes `minimal` and records its selection identity in the receipt

#### Scenario: Existing receipt is upgraded

- **WHEN** an existing receipt has no profile identity or migration marker
- **THEN** planning selects `compat-v1`, reports the preserved compatibility state, and does not remove optional entries solely because the new default is smaller

### Requirement: Bundle activation is atomic and rollback-safe

Profile generation, materialization, and every required consumer verification for a profile-based installation SHALL stage a complete candidate bundle before activation. A generation failure or any non-pass result for a required runtime surface MUST leave the previously active bundle and receipt unchanged and MUST report the failed stage and candidate identity. Optional or unavailable non-required surfaces remain separate evidence rows and follow the declared activation policy. OpenAI marketplace package generation is structural and does not activate a consumer bundle.

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

Profile-selection reports SHALL distinguish profile resolution, structural/package generation, rollback, and consumer-runtime stages. Static counts, selected IDs, and token estimates MUST NOT be presented as live runtime savings; unavailable stages SHALL use `NOT_RUN`, `NOT_CONFIGURED`, `BLOCKED`, or `UNAVAILABLE` as applicable. The separate marketplace selection and package receipt follow the marketplace evidence requirements below.

#### Scenario: Structural selection passes

- **WHEN** a candidate plan and artifact match the inventory, profile, and selection fingerprints
- **THEN** the structural result is `PASS` and remains separate from consumer-runtime support

#### Scenario: Runtime probe cannot run

- **WHEN** no exact configured consumer can load the candidate artifact
- **THEN** the report retains the structural result, records the closed non-pass runtime state, and includes a bounded resume instruction

### Requirement: Marketplace catalog selection is independent of platform profiles

The OpenAI portable marketplace publication view SHALL compile the explicit
`manifests/marketplace-selection.json` rows against
`manifests/distribution-inventory.json`. It SHALL NOT derive marketplace
membership from `minimal`, `full`, `compat-v1`, or a native surface allowlist.
The selection SHALL cover each inventory stable ID once, use the inventory's
public name and canonical metadata, and fail closed for missing, duplicate,
unknown, or invalid rows, invalid child ownership, runtime-alias names, or
selected-name collisions. Common public entries and their bundled children
SHALL be derived from the declared selection and grouped by owner. Host-only
entries SHALL remain distinct and be included only when a supported host
surface is explicitly supplied; withdrawn entries SHALL be excluded from
publication. The view SHALL carry a SHA-256 digest of the canonicalized
selection document. Counts and names SHALL describe the current selection and
inventory rather than impose quotas or rename entries.

#### Scenario: Marketplace selection compiles

- **WHEN** the current marketplace selection is compiled against a valid
  distribution inventory
- **THEN** the view returns inventory-owned names and metadata for common
  entries, groups selected common children under their declared owners, keeps
  host-only rows separate, omits withdrawn rows, and includes the canonical
  selection digest

#### Scenario: A profile or surface has different membership

- **WHEN** a marketplace selection is compiled while legacy profiles or native
  surface selections have different membership
- **THEN** the marketplace view follows its explicit selection document and
  does not mutate or claim parity with those other selections

#### Scenario: Marketplace selection is incomplete or ambiguous

- **WHEN** a selection omits an inventory ID, repeats an ID, names an unknown
  ID, has an invalid owner, or collides on a selected public name
- **THEN** compilation returns errors without a publication view
