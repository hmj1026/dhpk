## MODIFIED Requirements

### Requirement: Projection parity owns cross-surface equivalence

The projection-parity capability SHALL compare normalized selected stable IDs, public names, routing targets/selectors, invocation classes, canonical source identities, source digests, transforms, ownership, lifecycle/retirement state, normalized usage contracts, usage fingerprints, external-package-ledger fingerprints, and output fingerprints for declared consumer projections. It SHALL consume explicit compiler-owned plan/artifact inputs and MUST NOT select membership from directories, manifests, or ambient profile state. A count or byte match without matching usage and provenance is not equivalent.

#### Scenario: Equivalent projections match

- **WHEN** two declared projections are generated from equivalent canonical inputs, inventory policy, profile/artifact identity, and usage contract
- **THEN** parity returns a passing result with matching selected IDs, public names, usage metadata, provenance, ownership, and output fingerprints

#### Scenario: A projection contains an extra entry

- **WHEN** a generated surface contains an ID or public name absent from its compiler-selected plan
- **THEN** parity returns a structured failure naming the surface, entry, and ownership/provenance mismatch

#### Scenario: A projection changes without source intent

- **WHEN** a selector, invocation class, usage field, usage fingerprint, source fingerprint, transform, ownership, retirement state, or output fingerprint changes without a declared inventory/source change
- **THEN** parity fails closed and identifies the changed field

### Requirement: Parity evidence binds compiler and lifecycle identity

Every parity result SHALL bind target surface, profile or artifact identity when scoped, plan fingerprint, artifact fingerprint when materialized, inventory revision, external-package-ledger fingerprint, usage schema/fingerprint, parity checker identity and version, verification stage, checked fields, verdict, and diagnostics using the existing EvidenceResult and canonical lifecycle identity vocabulary. The capability MUST NOT introduce a competing verdict enum. A result SHALL describe only the requested stage; it MUST NOT promote a structural or package result to consumer-runtime support.

#### Scenario: A scoped artifact is checked

- **WHEN** parity evaluates a profile-scoped artifact
- **THEN** the result records the exact profile, plan, artifact, inventory, usage, external ownership ledger, checker, and stage identities

#### Scenario: Evidence uses stale identity

- **WHEN** the observed output, usage fingerprint, provenance, or external ownership ledger does not match the plan and artifact identity supplied to parity
- **THEN** parity returns a stale-identity failure and does not reuse an older passing result

#### Scenario: Runtime evidence is not available

- **WHEN** structural or package parity passes but the requested consumer-runtime adapter is absent, unconfigured, or not run
- **THEN** the structural or package result remains independently addressable while runtime evidence is `NOT_CONFIGURED`, `NOT_RUN`, `BLOCKED`, or `UNAVAILABLE`, and no combined report claims runtime support

### Requirement: Capability-family projection parity includes ownership identity

Every generated surface SHALL derive successor-family and external-package membership from the same inventory revision. Parity evidence SHALL compare stable ID, emitted public name, invocation class, source ownership, usage contract/fingerprint, content fingerprint, and retirement state before reporting equivalence. For this inventory revision the canonical catalog SHALL contain exactly 65 skills, exactly 9 live `portable-family` entries, and exactly 56 live entries whose public name retains the `dhpk-` prefix. The shared Agent Plugin, Cursor Plugin, AGY Plugin, and Cursor Sync surfaces SHALL each contain exactly 37 selected stable IDs and retain all six protected GitNexus stable IDs without content or identity changes.

#### Scenario: Shared surfaces project the consolidated inventory

- **WHEN** Agent Plugin, Cursor Plugin, AGY Plugin, and Cursor Sync compile the approved inventory
- **THEN** each contains exactly 37 selected stable IDs, reports the same inventory/usage/provenance fingerprints for equivalent entries, and retains the six GitNexus stable IDs unchanged

#### Scenario: One surface adapts an external skill

- **WHEN** a projection renames, rewrites, retires, substitutes, or changes the usage/provenance metadata of a protected external-package skill
- **THEN** parity validation fails even if the total entry count, output bytes, or output fingerprints remain equal

#### Scenario: A retired version alias is projected

- **WHEN** a generated surface includes a retired Laravel/PHPUnit version-specific ID, historical public name, old path, or discovery entry
- **THEN** parity fails with the retired-identity diagnostic and does not accept the surface as equivalent

## ADDED Requirements

### Requirement: Usage and provenance parity is independently checkable

The parity checker SHALL report usage and provenance as independently named checked fields while retaining one overall EvidenceResult verdict. Usage checks SHALL cover display name, summary, syntax, input kind, invocation class, maximum effect authority, actions, options, and examples. Provenance checks SHALL cover canonical source identity and digest, inventory revision, source owner, transform identity, lifecycle/retirement state, public name, invocation class, and external-package-ledger fingerprint. A combined report MAY aggregate these fields, but MUST preserve field-level diagnostics and stage identity.

#### Scenario: Usage contract differs across surfaces

- **WHEN** equivalent projections expose different usage syntax, action/option definitions, examples, invocation class, or effect authority
- **THEN** parity returns a usage-field failure naming the stable ID, field, both observed values' fingerprints, and the affected surfaces

#### Scenario: Provenance differs across surfaces

- **WHEN** equivalent projections bind different canonical source digests, owners, transforms, lifecycle states, public names, invocation classes, or external-ledger fingerprints
- **THEN** parity returns a provenance-field failure naming the stable ID, field, expected identity, and observed identity

#### Scenario: Output equality hides metadata drift

- **WHEN** two surfaces have identical output bytes and entry counts but differ in usage or provenance
- **THEN** parity remains non-passing and reports the metadata drift rather than treating byte equality as sufficient
