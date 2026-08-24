# claude-capability-bundle Specification

## Purpose
Define the inventory-bound, profile-scoped Claude publication artifact that
reduces discovery-visible capability entries before Claude host discovery while
preserving canonical sources and explicit routing compatibility.

## Requirements

### Requirement: Profile selection is closed and inventory-owned

The profile-bundle compiler SHALL accept an explicit install-profile selector,
resolve its module dependency closure from `manifests/install-profiles.json`
and `manifests/module-catalog.json`, and select components only from
`manifests/distribution-inventory.json`. Unknown profiles, unknown modules,
cyclic or missing requirements, duplicate stable IDs, and conflicting
exclusions SHALL fail closed before a plan is returned.

#### Scenario: A known profile is selected

- **WHEN** the compiler receives a declared profile and unchanged profile,
  module, and distribution inventory inputs
- **THEN** it returns the promoted core plus exactly the optional stable IDs in
  the resolved module closure, with the normalized profile identity recorded
  in the plan

#### Scenario: An invalid profile is selected

- **WHEN** the selector names an unknown profile, an unavailable module, or a
  dependency closure with a cycle or missing requirement
- **THEN** compilation returns a stable structured error and produces no
  materialization intent

#### Scenario: A generator finds an unselected skill

- **WHEN** a canonical or generated directory contains a skill not selected by
  the profile and inventory policy
- **THEN** validation reports the stable ID as out of scope and excludes it
  from the accepted bundle

### Requirement: The bundle boundary precedes Claude discovery

The generated Claude capability bundle SHALL contain a physically scoped
`./skills/` root and SHALL be installable or selected before the Claude host
discovers plugin skills. SessionStart module activation MUST NOT be the only
mechanism used to claim discovery reduction.

#### Scenario: A profile bundle is generated

- **WHEN** a valid profile plan is materialized
- **THEN** the bundle's manifest points to its scoped `./skills/` root and no
  unselected optional skill is present under that root

#### Scenario: Only a runtime hook changes modules

- **WHEN** SessionStart changes `DHPK_ACTIVE_MODULES` after the host has loaded
  the plugin manifest
- **THEN** the evidence remains a runtime-activation result and does not claim
  that discovery-visible entries were reduced

### Requirement: Profile plans and artifacts are deterministic and complete

Every profile bundle SHALL be produced by the shared distribution compiler and
artifact store. Its plan and artifact SHALL include the target surface,
normalized profile ID, selection-policy/compiler versions, ordered stable IDs,
canonical source identities, ownership, transforms, destination roots,
content fingerprints, and compatibility mode. Materialization MUST NOT
re-select membership or read ambient profile state.

#### Scenario: Equivalent profile inputs compile identically

- **WHEN** the same canonical sources, inventories, profile inputs, and
  compiler version are compiled twice
- **THEN** both plans and ordered bundle metadata have the same fingerprints

#### Scenario: A plan omits profile provenance

- **WHEN** a plan lacks its normalized profile ID, selected stable IDs, or
  source/selection fingerprints
- **THEN** materialization rejects it as incomplete and publishes no artifact

#### Scenario: A staged output escapes the plan

- **WHEN** an adapter attempts to write an unplanned skill, root, or manifest
  entry
- **THEN** the artifact store rejects the write and leaves the previously
  accepted bundle unchanged

### Requirement: Compatibility and explicit routing are preserved

The unscoped Claude package SHALL remain available as an explicit compatibility
target until the profile bundle passes its characterization, parity, rollback,
and consumer gates. Stable IDs, public names, promoted core availability, and
explicit-only invocation classes SHALL remain unchanged; an unselected
optional ID MUST NOT silently resolve to a different skill.

#### Scenario: A user needs the full catalog

- **WHEN** the compatibility target is selected
- **THEN** the existing characterized unscoped package is generated and its
  stable IDs and bytes remain available for rollback

#### Scenario: An optional skill is not in a profile

- **WHEN** an explicit request names an optional stable ID absent from the
  selected bundle
- **THEN** the system reports that the capability is unavailable in that
  bundle and identifies the compatibility or alternate profile path

#### Scenario: A profile changes an invocation class

- **WHEN** profile compilation would change an existing skill's invocation
  class, public name, or canonical identity
- **THEN** compilation fails closed until a separately approved compatibility
  change defines the migration

### Requirement: Bundle evidence separates structural and consumer claims

Bundle generation SHALL emit structural evidence bound to profile, plan,
artifact, and compiler identities. Consumer verification SHALL use a declared
stage and exact artifact identity; static generation or context-budget totals
MUST NOT upgrade a consumer runtime verdict. Unsupported or unavailable probes
MUST use `NOT_RUN`, `NOT_CONFIGURED`, `BLOCKED`, or `UNAVAILABLE` as applicable.

#### Scenario: Structural bundle checks pass

- **WHEN** the scoped root, manifest, selected IDs, and fingerprints match the
  profile plan
- **THEN** the structural result is `PASS` and remains separate from runtime
  support

#### Scenario: The Claude probe is unavailable

- **WHEN** the configured Claude consumer executable or installation mode is
  absent
- **THEN** the result records the non-pass state and a resume command without
  claiming discovery reduction

#### Scenario: The consumer sees a stale bundle

- **WHEN** consumer-observed package identity differs from the profile artifact
  fingerprint
- **THEN** verification returns a stale-identity failure and does not reuse an
  earlier passing result
