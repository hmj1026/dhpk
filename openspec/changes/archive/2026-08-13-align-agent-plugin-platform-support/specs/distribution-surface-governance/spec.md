## ADDED Requirements

### Requirement: Portable and client-native surfaces are explicit inventory members

The distribution inventory SHALL support explicit `agent-plugin` and
`cursor-plugin` surfaces in addition to existing Claude and Codex surfaces.
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

All generated Agent Plugins, Codex, Cursor, and Claude projections SHALL be
derived from canonical sources plus explicit adaptation rules. Generated files
MUST NOT become an independently authored source of behavior, and identical
portable skill content across surfaces SHALL share a fingerprint or a recorded
intentional transform.

#### Scenario: Generated package contains an undeclared skill

- **WHEN** any generated surface contains a public name absent from its
  inventory surface
- **THEN** the distribution gate fails and names the extra entry

#### Scenario: Native adaptation is intentional

- **WHEN** a Cursor or Codex projection differs from canonical content because
  its client contract requires an adaptation
- **THEN** the inventory/projection matrix records the rule, source ID, output
  fingerprint, and compatibility rationale

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
