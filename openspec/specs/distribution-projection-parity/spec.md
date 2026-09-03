# distribution-projection-parity Specification

## Purpose
Define the projection-parity capability that compares compiler-selected,
provenance-bound consumer surfaces independently from discovery-budget
accounting and reports stale identity or output drift with structured evidence.

## Requirements

### Requirement: Projection parity owns cross-surface equivalence

The projection-parity capability SHALL compare normalized selected stable IDs,
public names, routing targets/selectors, invocation classes, canonical source
identities, transforms, ownership, and output fingerprints for declared
consumer projections. It SHALL consume explicit compiler-owned plan/artifact
inputs and MUST NOT select membership from directories, manifests, or ambient
profile state.

#### Scenario: Equivalent projections match

- **WHEN** two declared projections are generated from equivalent canonical
  inputs, inventory policy, and profile/artifact identity
- **THEN** parity returns a passing result with matching selected IDs,
  provenance, and output fingerprints

#### Scenario: A projection contains an extra entry

- **WHEN** a generated surface contains an ID or public name absent from its
  compiler-selected plan
- **THEN** parity returns a structured failure naming the surface, entry, and
  ownership/provenance mismatch

#### Scenario: A projection changes without source intent

- **WHEN** a selector, invocation class, source fingerprint, transform, or
  output fingerprint changes without a declared inventory/source change
- **THEN** parity fails closed and identifies the changed field

### Requirement: Parity verdicts are independent from budget verdicts

Projection parity SHALL return an independently addressable result and MUST NOT
read, calculate, or upgrade discovery-budget verdicts. Discovery-budget
accounting MUST NOT read or upgrade parity results. A combined report MAY
present both results, but it MUST preserve their separate codes, diagnostics,
scope, and fingerprints.

#### Scenario: Budget overflows while parity passes

- **WHEN** selected projections match but a scoped description exceeds its
  configured budget
- **THEN** parity remains `PASS` and the budget result reports the overflow
  independently

#### Scenario: Parity fails while budget passes

- **WHEN** all measured descriptions are within budget but a projection omits a
  selected ID or changes an output fingerprint
- **THEN** budget remains passing and parity reports the failure independently

#### Scenario: One result is unavailable

- **WHEN** one module lacks its required input or adapter
- **THEN** its result uses a structured non-pass/configuration state without
  changing the other module's result

### Requirement: Parity evidence binds compiler and lifecycle identity

Every parity result SHALL bind target surface, profile or artifact identity when scoped, plan fingerprint, artifact fingerprint when materialized, external-package-ledger fingerprint, parity checker identity and version, verification stage, checked fields, verdict, and diagnostics using the existing EvidenceResult and canonical lifecycle identity vocabulary. The capability MUST NOT introduce a competing verdict enum.

#### Scenario: A scoped artifact is checked

- **WHEN** parity evaluates a profile-scoped artifact
- **THEN** the result records the exact profile, plan, artifact, external ownership ledger, checker, and stage identities

#### Scenario: Evidence uses stale identity

- **WHEN** the observed output fingerprint or external ownership ledger does not match the plan and artifact identity supplied to parity
- **THEN** parity returns a stale-identity failure and does not reuse an older passing result

### Requirement: Parity migration preserves characterized behavior

Moving parity checks from the discovery-budget path SHALL preserve
characterized selected IDs, output ordering, diagnostics, exit codes, and
legacy report formatting unless an additive output change is explicitly
approved. The former discovery-budget requirement SHALL have one owner after
cutover.

#### Scenario: Legacy parity fixture is unchanged

- **WHEN** the new parity module runs against an existing characterized fixture
- **THEN** its selected-entry comparison and externally exposed outcome match
  the legacy behavior

#### Scenario: Dual ownership remains

- **WHEN** both the old discovery-budget path and the new parity module claim
  the same parity check after cutover
- **THEN** validation fails with an ownership diagnostic and migration is not
  complete

### Requirement: Capability-family projection parity includes ownership identity

Every generated surface SHALL derive successor-family and external-package membership from the same inventory revision. Parity evidence SHALL compare stable ID, emitted public name, invocation class, source ownership, content fingerprint, and retirement state before reporting equivalence.

#### Scenario: Shared surfaces project the consolidated inventory
- **WHEN** Agent Plugin, Cursor Plugin, and AGY Plugin compile the approved inventory
- **THEN** each contains 46 selected stable IDs, Cursor sync contains 46, and all retain the six GitNexus stable IDs without content or identity changes

#### Scenario: One surface adapts an external skill
- **WHEN** a projection renames, rewrites, retires, or substitutes a protected external-package skill
- **THEN** parity validation fails even if the total entry count remains equal
