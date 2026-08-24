# distribution-surface-governance Specification

## Purpose
TBD - created by archiving change curate-dhpk-distribution-surfaces. Update Purpose after archive.

## Requirements

### Requirement: Every consumer-reachable package has a lifecycle
The distribution inventory SHALL assign each consumer-reachable skill and module exactly one lifecycle state from `promoted`, `optional`, `experimental`, or `deprecated`, and SHALL identify every publication surface on which the package is permitted to appear.

#### Scenario: A new skill has no lifecycle entry
- **WHEN** a canonical skill can be reached by a plugin manifest, installer, generated package, or marketplace wrapper but is absent from the distribution inventory
- **THEN** distribution validation fails with the missing skill path and no release artifact is accepted

#### Scenario: Inventory and canonical packages agree
- **WHEN** every consumer-reachable package has one valid lifecycle and its declared surfaces resolve
- **THEN** distribution validation passes without deriving promotion from directory placement

### Requirement: Promoted surfaces are generated from the inventory
The Claude plugin skill registrations and every generated Codex publication tree SHALL be derived deterministically from the distribution inventory. Generated output SHALL NOT become an independently authored source of skill behavior.

#### Scenario: A generated manifest contains an undeclared skill
- **WHEN** a generated publication surface contains a skill not permitted on that surface by the inventory
- **THEN** the no-drift validation fails and identifies the extra entry

#### Scenario: Generation is repeatable
- **WHEN** generation runs twice against unchanged canonical sources and inventory
- **THEN** both runs produce byte-identical publication metadata and package contents

### Requirement: Core and optional surfaces are distinguishable

The distribution model SHALL distinguish broadly applicable core workflow skills from opt-in stack skills, and documentation SHALL state whether the current host truly gates discovery or merely gates runtime hooks and activation. A profile-scoped Claude package SHALL be identified as a pre-discovery selected artifact, while the unscoped compatibility package SHALL be identified separately. The catalog SHALL report description word/token totals separately for promoted, optional, experimental, and deprecated entries and separately for each selected profile artifact. An `optional` lifecycle SHALL NOT be described as hidden from discovery when the host still publishes its description.

#### Scenario: Host cannot hide optional skill descriptions

- **WHEN** the unscoped Claude plugin host registers optional module skill descriptions regardless of selected modules
- **THEN** documentation reports that limitation and SHALL NOT describe the optional set as hidden at discovery time

#### Scenario: Profile artifact excludes optional metadata

- **WHEN** a profile bundle is generated before Claude discovery
- **THEN** its scoped root contains only the selected core and module entries, and its report labels the excluded optional entries as absent rather than runtime-hidden

#### Scenario: Optional metadata is discovery-visible

- **WHEN** optional skills are published in any host discovery manifest
- **THEN** catalog output labels them discovery-visible and runtime- or activation-optional

#### Scenario: Description budget is exceeded

- **WHEN** a discovery-visible skill or agent description exceeds the configured always-visible word/token budget for its lifecycle, surface, or selected profile
- **THEN** validation reports the entry and fails or requires an explicit reviewed exemption

#### Scenario: Metadata is within budget

- **WHEN** all discovery-visible descriptions meet their scoped budgets
- **THEN** validation passes and reports the budget totals by publication surface and selected profile artifact

### Requirement: Deprecation precedes source deletion
A deprecated package SHALL first be removed from promoted publication surfaces while retaining its canonical source, replacement or migration guidance, and compatibility-window metadata. Canonical deletion SHALL require a later reviewed change and a passing repository reference scan.

#### Scenario: A promoted skill is deprecated
- **WHEN** a skill lifecycle changes from `promoted` to `deprecated`
- **THEN** generated promoted surfaces omit it while its canonical source and migration guidance remain available for the declared compatibility window

#### Scenario: Deprecated source is deleted too early
- **WHEN** a change deletes a deprecated canonical source before its compatibility window expires or while live references remain
- **THEN** distribution validation fails with the blocking condition

### Requirement: Always-visible and conditional context are distinguishable
Publication and manifest generation SHALL expose which safety/routing contracts are always visible and which stack/version/review mechanics are conditional references. The generator SHALL not duplicate full description prose in developer instructions when a short trigger and pointer are sufficient.

#### Scenario: A role repeats its full description in the body
- **WHEN** an agent description and its developer instructions contain duplicated policy prose
- **THEN** metadata health validation reports the duplication and suggests a pointer-based form

#### Scenario: A safety contract is always visible
- **WHEN** a role is published for discovery
- **THEN** destructive-action, authorization, and completion-boundary constraints remain in its always-visible contract

### Requirement: Portable and client-native surfaces are explicit inventory members

The distribution inventory SHALL support explicit `agent-plugin`,
`cursor-plugin`, and `agy-plugin` surfaces in addition to existing Claude and
Codex surfaces.
Every skill, agent, command, rule, hook, and MCP entry published on one of
these surfaces MUST have an inventory-owned stable ID, public name, lifecycle,
source path, and surface membership. No surface may be inferred from a
directory, README list, or manifest presence.

#### Scenario: Portable skill is intentionally selected

- **WHEN** a canonical skill is assigned to `agent-plugin`
- **THEN** the inventory declares the membership and the generator includes
  exactly that skill in the standard package

#### Scenario: Cursor-only component is not portable

- **WHEN** a rule, hook, or agent is assigned only to `cursor-plugin`
- **THEN** the standard package excludes it and the Cursor inventory entry
  records its native capability and fallback

### Requirement: Cross-surface projections have one canonical source

All generated Agent Plugins, Codex, Cursor, AGY, and Claude projections, including profile-scoped Claude bundles, SHALL be derived from canonical sources plus explicit adaptation rules. Generated files MUST NOT become an independently authored source of behavior, and identical portable skill content across surfaces SHALL share a fingerprint or a recorded intentional transform. A profile identity and selected stable-ID set SHALL be part of Claude projection provenance.

#### Scenario: Generated package contains an undeclared skill

- **WHEN** any generated surface or Claude profile bundle contains a public name absent from its inventory surface and selected profile
- **THEN** the distribution gate fails and names the extra entry

#### Scenario: Native adaptation is intentional

- **WHEN** a Cursor, Codex, AGY, or Claude profile projection differs from canonical content because its client contract requires an adaptation
- **THEN** the inventory/projection matrix records the rule, source ID, output fingerprint, profile where applicable, and compatibility rationale

### Requirement: Support tiers are reported per surface

Documentation and release gates SHALL report Supported, Experimental,
Structural-only, `NOT_CONFIGURED`, `SKIP_INCOMPATIBLE`, `BLOCKED`, and
`UNAVAILABLE` per client surface rather than one global "platform supported"
claim. A successful static generator or manifest validator SHALL not upgrade a
runtime consumer tier.

#### Scenario: Cursor is not installed

- **WHEN** the repository has a valid Cursor projection but no Cursor consumer
  is configured
- **THEN** the report says `NOT_CONFIGURED` or `UNAVAILABLE` and preserves the
  structural result separately

#### Scenario: One surface fails

- **WHEN** the Cursor-native package fails while Claude and project-local Codex
  pass
- **THEN** the final matrix identifies only Cursor as failed/blocked and does
  not downgrade unrelated supported surfaces or hide the failure

### Requirement: Shared portable projections have one physical owner

The inventory and projection matrix SHALL distinguish a shared portable skill
store from an environment-specific overlay. A skill selected for both the
standard Agent Plugin and Cursor SHALL have one physical generated owner by
default; a second physical copy requires an explicit overlay transform and
stable-ID provenance linking it to the owner.

#### Scenario: Identical skills are selected for Agent Plugin and Cursor

- **WHEN** the Cursor matrix row declares `projection_mode: shared` with
  `shared_surface: agent-plugin`
- **THEN** the Cursor native package contains no duplicate `skills/` directory
  and the release gate compares the shared IDs against the Agent Plugin store

#### Scenario: A platform requires a custom skill variant

- **WHEN** a Cursor matrix row declares `projection_mode: overlay`
- **THEN** the generated copy is limited to that row's stable IDs and records
  its environment-specific transform and fallback instead of becoming a second
  implicit source of truth

### Requirement: Distribution inventory is the projection selection SSOT

`manifests/distribution-inventory.json` SHALL be the sole source of component selection, lifecycle, permitted surfaces, canonical source identity, physical ownership, transforms, and symlink policy supplied to `compileDistribution`. Install profiles and module catalogs MAY provide normalized selection inputs, but generators, adapters, manifests, directory layouts, README lists, and installed artifacts MUST NOT independently add, remove, promote, or re-own a distribution entry.

#### Scenario: Surface adapter discovers an extra component

- **WHEN** a surface-specific adapter or Claude profile generator finds a package in a conventional directory that is not selected for that surface by the inventory and explicit profile input
- **THEN** compilation or no-drift validation reports the extra component and excludes it from the accepted plan

#### Scenario: Inventory declares a shared physical owner

- **WHEN** two consumer surfaces select one portable entry and the inventory assigns one shared owner
- **THEN** both projections reference that ownership decision and no adapter creates a second implicit physical copy

#### Scenario: Projection rule has no inventory owner

- **WHEN** a generator-local default would choose a transform, output ownership, profile membership, or symlink behavior not declared by the inventory and normalized selection inputs
- **THEN** distribution validation fails instead of treating the local default as policy

#### Scenario: Native Codex uses its explicit allowlist

- **WHEN** the Codex-native adapter materializes a package
- **THEN** it emits only the entries selected by the inventory-owned allowlist and reports any unlisted entry as a validation error

### Requirement: Every migrated generated surface uses the shared projection pipeline

After its characterization gate and cutover, each Agent Plugin, Codex native, Cursor, AGY, and Claude generated surface SHALL be planned through `compileDistribution`, materialized through `materializeDistribution` and `ProjectionArtifactStore`, and assessed through `verifyDistribution` for each supported verification stage. A profile-scoped Claude artifact SHALL be planned before host discovery and SHALL retain a separate unscoped compatibility path until its migration gates pass. Before that per-surface cutover, the characterized legacy implementation remains authoritative as the rollback path. Surface adapters MAY render consumer-native syntax but MUST NOT bypass the shared selection, ownership, provenance, or evidence contracts after cutover.

#### Scenario: Consumer requires a native manifest format

- **WHEN** a surface adapter renders consumer-specific metadata from a valid plan
- **THEN** the output retains the plan's stable IDs, ownership, transforms, profile identity where applicable, and fingerprints while using the consumer-native syntax

#### Scenario: Profile is selected after discovery

- **WHEN** a Claude profile adapter relies on SessionStart to remove entries after the host has loaded the plugin manifest
- **THEN** the distribution gate rejects the path as a runtime filter and the compatibility implementation remains authoritative

#### Scenario: Legacy generator bypasses the compiler

- **WHEN** a surface that has completed its characterized cutover attempts to derive its membership directly from directories, its existing manifest, or ambient profile state
- **THEN** the distribution gate fails and identifies the bypassed projection stage

#### Scenario: Adapter reselects an inventory entry

- **WHEN** a surface adapter changes selected membership after receiving a compiled distribution plan
- **THEN** validation rejects the adapter output because selection is compiler-owned

### Requirement: AGY projection uses one physical owner per selected source

An AGY projection SHALL reference canonical source IDs and record its
adaptation transform and output fingerprint. It SHALL NOT create a second
implicit canonical skill or agent tree; any deliberate AGY-specific content
must have its own inventory identity and lifecycle.

#### Scenario: AGY projection adapts a canonical agent

- **WHEN** the AGY frontmatter differs from the Claude source only because of
  the declared AGY transform
- **THEN** provenance links both identities and validation accepts the output

#### Scenario: AGY generator discovers an unowned file

- **WHEN** a file appears in `plugins/dhpk-agy/` without an inventory owner
- **THEN** distribution validation rejects the surface

### Requirement: Surface migration preserves the current distribution contract

Migration to the shared projection pipeline SHALL proceed surface by surface behind characterization evidence. The repository MUST maintain one public version of each generator/verifier contract; it MUST NOT expose parallel legacy and profile-aware CLIs to consumers. Until a surface passes equivalence and rollback tests, the existing implementation remains authoritative for that surface. A profile-aware Claude rollout SHALL be opt-in until consumer evidence supports any default change.

#### Scenario: First surface is ready independently

- **WHEN** one surface or Claude profile passes its characterization, projection, validation, and rollback tests while another surface/profile has not migrated
- **THEN** the ready surface can ship through the existing CLI/install contract without requiring the unfinished surface/profile

#### Scenario: Migration changes an observable CLI behavior

- **WHEN** the new pipeline changes output bytes, ordering, diagnostics, selected IDs, or exit status for characterized inputs
- **THEN** validation blocks cutover and the existing surface implementation remains active

#### Scenario: Migration follows the approved order

- **WHEN** surfaces are migrated through the approved characterization and rollback sequence
- **THEN** each accepted surface can ship independently while unfinished surfaces retain their prior implementation
