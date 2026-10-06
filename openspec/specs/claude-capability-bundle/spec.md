# claude-capability-bundle Specification

## Purpose

Define the inventory-bound common Claude marketplace artifact and retained
standalone utilities, preserving canonical sources, explicit routing, and
historical receipt ownership before Host discovery.

## Requirements

### Requirement: Common selection is closed and inventory-owned

The compiler SHALL resolve the internal common collection and validated module/dependency closure from their catalogs and select only inventory entries. Common SHALL match the shared catalog's fifteen public IDs and include the four reviewed required-core IDs. Unknown, duplicate, retired new-selection IDs, cycles, missing requirements, and conflicts MUST fail closed before materialization. Historical receipt reads SHALL preserve exact stored IDs, including retired identities, rather than resolve a new selection. Public `--profile` flags SHALL be rejected; manual bundle generation SHALL require explicit `--out`, while read-only plans and standalone utility remain supported.

#### Scenario: Common is compiled

- **WHEN** common is compiled with unchanged inputs and no override
- **THEN** its IDs match the shared catalog and contain all required-core IDs, and its identity is deterministic

#### Scenario: Historical selection is read

- **WHEN** a named retired-profile receipt is inspected for read, plan, uninstall, or recovery
- **THEN** its exact stored scope is returned without retirement filtering or recompilation

#### Scenario: A new selection is invalid

- **WHEN** a skill or module closure is unknown, retired, conflicting, cyclic, missing, or outside the allowed inventory plan
- **THEN** compilation returns a structured error and no materialization intent

#### Scenario: Output includes an undeclared public entry

- **WHEN** generated output contains a public entry outside the selected inventory plan
- **THEN** validation rejects it and distinguishes declared Host support and folded child resources from public entries

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

Every profile bundle SHALL be produced by the shared distribution compiler and artifact store. Its plan and artifact SHALL include the target surface, normalized profile ID, selected stable IDs, selection-policy/compiler versions, inventory/source/selection fingerprints, canonical source identities, ownership, transforms, destination roots, content fingerprints, compatibility mode, and activation state. Materialization MUST NOT re-select membership or read ambient profile state.

#### Scenario: Equivalent profile inputs compile identically

- **WHEN** the same canonical sources, inventories, profile inputs, and compiler version are compiled twice
- **THEN** both plans and ordered bundle metadata have the same profile and selection fingerprints

#### Scenario: A plan omits selection provenance

- **WHEN** a plan lacks its normalized profile ID, selected stable IDs, compatibility mode, or source/selection fingerprints
- **THEN** materialization rejects it as incomplete and publishes no artifact

#### Scenario: A plan omits profile provenance

- **WHEN** a plan lacks its normalized profile ID, selected stable IDs, or source/selection fingerprints
- **THEN** materialization rejects it as incomplete and publishes no artifact

#### Scenario: A staged output escapes the plan

- **WHEN** an adapter attempts to write an unplanned skill, root, or manifest entry
- **THEN** the artifact store rejects the write and leaves the previously accepted bundle unchanged

### Requirement: Historical ownership and explicit routing are preserved

Stable IDs, public names, required core availability, and invocation classes SHALL retain their existing contracts. Retired minimal/full/compat-v1 artifacts MUST NOT be regenerated or offered for new publication. Their historical receipts SHALL preserve exact stored scope for read, plan, uninstall, and recovery; update MUST be BLOCKED before mutation. Unannotated receipts SHALL retain their existing structural route. Standalone and module presets SHALL remain available through their existing owners; an unavailable optional ID MUST NOT silently resolve to another skill.

#### Scenario: A historical update is requested

- **WHEN** a named retired-profile receipt is updated
- **THEN** the adapter returns BLOCKED before mutation and preserves owned, modified, and foreign content

#### Scenario: An optional capability is unavailable

- **WHEN** an explicit request names an unavailable optional stable ID
- **THEN** the system reports it unavailable and identifies an applicable retained standalone or module route without restoring a retired alias

#### Scenario: Compilation changes an invocation class

- **WHEN** compilation would change a skill's invocation class, public name, or canonical identity
- **THEN** it fails closed unless a separately approved compatibility change defines that behavior

### Requirement: Bundle evidence separates structural and consumer claims

Bundle generation SHALL emit structural evidence bound to profile, selected stable IDs, plan, artifact, selection, and compiler identities. Consumer verification SHALL use a declared stage and exact artifact identity; static generation or context-budget totals MUST NOT upgrade a consumer runtime verdict. Unsupported or unavailable probes MUST use `NOT_RUN`, `NOT_CONFIGURED`, `BLOCKED`, or `UNAVAILABLE` as applicable, and failed candidate activation MUST preserve the prior active bundle.

#### Scenario: Structural bundle checks pass

- **WHEN** the scoped root, manifest, selected IDs, profile, and fingerprints match the profile plan
- **THEN** the structural result is `PASS` and remains separate from runtime support

#### Scenario: The Claude probe is unavailable

- **WHEN** the configured Claude consumer executable or installation mode is absent
- **THEN** the result records the non-pass state and a resume command without claiming discovery reduction or replacing an active installed bundle

#### Scenario: The consumer sees a stale bundle

- **WHEN** consumer-observed package identity differs from the profile or selection artifact fingerprint
- **THEN** verification returns a stale-identity failure and does not reuse an earlier passing result

#### Scenario: Marketplace structural evidence is not Claude consumer evidence

- **WHEN** the OpenAI portable marketplace artifact reports structural `PASS` with runtime `NOT_RUN`
- **THEN** that package receipt does not satisfy Claude profile verification or claim Claude discovery/runtime support, and the active Claude selection and historical receipt behavior remain governed by this bundle's own selection and consumer evidence

### Requirement: Default Claude marketplace publication uses the shared catalog

The existing `dhpk@dhpk` marketplace entry SHALL publish `generated/claude-marketplace/package`, derived from the reviewed shared catalog's fifteen common public entries and bundled children, with necessary `claude-core` Host resources selected separately. Catalog provenance SHALL record actual selection and resource ownership, paths, kinds, and hashes. Publication MUST NOT introduce a separate common variant or retain tracked minimal/full/compat-v1 artifacts. Generation MUST NOT claim native runtime acceptance or live activation.

#### Scenario: Main catalog package is generated

- **WHEN** the main Claude marketplace package is generated from the reviewed selection
- **THEN** its public identities match the common catalog, its receipt records actual selected resources, and its marketplace identity remains dhpk@dhpk
