# capability-bundle-selection Specification

## Purpose

Define one explicit, inventory-owned capability-selection contract that can
produce deterministic pre-discovery bundles for every supported publication
surface while preserving compatibility and safe rollback.

## Requirements

### Requirement: Common selection is closed and inventory-owned

The internal `common` collection SHALL resolve the fifteen public stable IDs declared by the shared marketplace catalog and MUST include the four `required_core_ids`: `change-verdict`, `code-trace`, `flow-drive`, and `flow-guide`. A validated repeatable `--skill` overlay SHALL be additive, preserve required core IDs, and record explicit-overlay mode without changing the collection. Module presets and standalone selection SHALL retain their existing closure rules. Public publication `--profile` flags MUST be rejected before materialization.

#### Scenario: Default common selection resolves

- **WHEN** a new installation omits an explicit selection
- **THEN** the resolver returns the catalog's fifteen common IDs deterministically, includes all four structural core IDs, and records the common selection identity

#### Scenario: Explicit overlay is valid

- **WHEN** an operator requests live inventory-owned overlay IDs supported by the target surface
- **THEN** resolution retains the common selection and required core, adds the validated IDs, and records overlay mode without changing its definition

#### Scenario: A selection or publication flag is invalid

- **WHEN** an ID is unknown, duplicate, retired, missing, conflicting, or surface-incompatible, or a publication command receives `--profile`
- **THEN** resolution fails closed before any materialization or filesystem mutation

### Requirement: Retired profile identities remain historical metadata

`minimal`, `full`, and `compat-v1` SHALL remain recognizable historical receipt identities and MUST NOT be selectable publication profiles or regenerated tracked artifacts. Their stored selection MUST NOT be recompiled against today's inventory or narrowed by retirement filtering. Module preset names, hook profiles, and the project-agent `portable-core` profile SHALL retain their separate contracts.

#### Scenario: An old named profile is requested for publication

- **WHEN** a publication request selects a retired profile
- **THEN** it fails before output mutation and identifies the current common, module, or standalone route

#### Scenario: A historical receipt is inspected

- **WHEN** read, plan, uninstall, or recovery loads a named historical receipt
- **THEN** its exact stored scope, including retired IDs, remains available for ownership-safe handling

### Requirement: Profile selection identity is shared across its surfaces

Every selection produced from this capability-profile contract SHALL carry the same canonical normalized profile ID, ordered canonical stable-ID set, selection-policy version, source/profile/inventory inputs, and canonical selection fingerprint across its declared surfaces. A surface artifact MAY expose a separate `emittedStableIds` set only when it is the declared result of a surface transform; native Codex SHALL use the intersection of canonical IDs and its existing supported allowlist and SHALL record a surface selection fingerprint for that emitted set. A surface adapter MUST NOT change canonical membership or emit an undeclared ID. This profile identity contract does not select or constrain the separately compiled OpenAI marketplace catalog.

#### Scenario: Equivalent surfaces compile the same selection

- **WHEN** Claude, Cursor, Agent Plugin, AGY, and Codex receive equivalent inventory and profile inputs
- **THEN** each plan records the same canonical selection identity; Codex additionally records its declared emitted intersection and surface selection fingerprint, while consumer-native transforms do not change membership

#### Scenario: Surface adapter changes membership

- **WHEN** an adapter emits an entry not present in the compiler-owned selection or omits a required selected ID
- **THEN** validation rejects the artifact and reports the surface, stable ID, and selection-fingerprint mismatch

### Requirement: Current and historical receipt operations remain distinct

New installations SHALL default to `common`. Current receipts SHALL retain ordinary receipt-owned updates. Historical named-profile receipt updates MUST return `BLOCKED` before any mutation, lock, or recovery write; read, plan, uninstall, and recovery SHALL preserve the exact stored selection and existing ownership protections. Unannotated older receipts SHALL retain the existing structural migration route. This requirement MUST NOT introduce a generic live migration writer or change the independent OpenAI submission catalog contract.

#### Scenario: New installation uses the default

- **WHEN** a clean installation omits explicit selection
- **THEN** it materializes common and records its canonical selection identity

#### Scenario: Historical update is requested

- **WHEN** update loads a minimal, full, or compat-v1 receipt
- **THEN** it returns BLOCKED before any filesystem side effect and preserves the receipt and installed content

#### Scenario: Unannotated older receipt is handled

- **WHEN** a receipt has no named selection metadata
- **THEN** the existing structural migration and ownership route remains applicable without pretending it is a selectable retired publication profile

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
