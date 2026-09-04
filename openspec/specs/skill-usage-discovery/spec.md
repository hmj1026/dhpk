# skill-usage-discovery Specification

## Purpose

Define one inventory-owned, machine-readable usage contract for every skill
that Codex can invoke, then expose that contract through progressive help and
deterministic host/documentation projections without duplicating procedure
content from the canonical skill.

## Requirements

### Requirement: Codex-invokable skills declare an inventory-owned usage contract

Every skill selected by the `codex-native` or `codex-sync` surface SHALL have
one normalized `usage` object in the distribution inventory. The object SHALL
contain `display_name`, `summary`, `syntax`, `input_kind`, `invocation_class`,
`effect_authority`, `actions`, `options`, and `examples`. `actions` and
`options` MAY be empty arrays, but every action SHALL contain a unique `id`,
`summary`, `syntax`, `input_kind`, and `effect_authority`; every option SHALL
contain a unique `id`, `syntax`, `value_kind`, `required`, and `summary`, with
optional `default`, `enum_values`, and `applies_to` fields. Every example SHALL
contain exactly `prompt` and `summary`. `syntax` and every example prompt SHALL
begin with `$` plus the inventory public skill name, and
`usage.invocation_class` SHALL equal the canonical invocation class. The usage
object and child records are closed schemas: unsupported fields, duplicate
IDs, unknown `applies_to` action IDs, invalid enum defaults, empty examples, or
child effect authority above the parent maximum SHALL fail. Skills not selected
by either Codex surface MAY omit `usage`.

#### Scenario: A Codex skill has no usage contract

- **WHEN** a skill is selected by `codex-native` or `codex-sync` without one of
  the required usage fields
- **THEN** inventory validation fails with the stable ID and missing field

#### Scenario: Usage invocation class disagrees with canonical policy

- **WHEN** a Codex-invokable skill declares `usage.invocation_class:
  implicit-eligible` but its canonical invocation class is `explicit-only`
- **THEN** usage validation fails before any projection is generated

#### Scenario: Usage grammar contains duplicate names

- **WHEN** two actions or two options in one usage contract have the same `id`
- **THEN** validation fails and identifies the owning skill and duplicate

#### Scenario: A non-Codex skill omits usage

- **WHEN** a skill is not selected by either Codex surface and has no `usage`
  object
- **THEN** the usage-contract gate does not require a fabricated Codex grammar

### Requirement: Usage help is progressively disclosed and read-only

The `flow-guide help` action SHALL list the available Codex-invokable skills
when no skill is supplied and SHALL return one usage card when a public skill
name is supplied. A card SHALL expose the inventory `syntax`, input kind,
actions, options, examples, invocation class, maximum effect authority, and the
evidence state of the generated catalog. Help SHALL not load the target skill's
procedural references, invoke the target, or grant authority. An unknown name
and a known non-Codex skill SHALL produce distinct diagnostics.

#### Scenario: User requests the available usage catalog

- **WHEN** a user invokes `$flow-guide help` without a skill name
- **THEN** the result lists Codex-invokable public names in deterministic order
  with a concise usage summary and no target execution

#### Scenario: User requests one usage card

- **WHEN** a user invokes `$flow-guide help flow-drive`
- **THEN** the result returns only `flow-drive`'s usage contract and states its
  explicit-only authority without loading implementation procedures

#### Scenario: Help receives a non-Codex skill

- **WHEN** a user requests `$flow-guide help` for a known skill absent from both
  Codex surfaces
- **THEN** the result reports `not-codex-invokable` and does not invent a usage
  contract

#### Scenario: Help receives an unknown name

- **WHEN** a user requests `$flow-guide help` for a name absent from the
  inventory
- **THEN** the result reports `unknown-skill` and does not resolve a prefix or
  legacy alias

### Requirement: Usage projections have one deterministic source

A generator SHALL compile normalized inventory usage records in public-name
order into the Codex help catalog, supported OpenAI default prompts, applicable
Claude argument hints, and the dedicated English and Traditional Chinese usage
documentation. Generated artifacts SHALL identify the source inventory
revision and SHALL fail parity validation when manually edited content or
ordering diverges. Broad hand-maintained cheat sheets MAY link to the generated
guide but SHALL not become a second usage source of truth.

#### Scenario: Inventory usage changes

- **WHEN** an action or option changes in the inventory usage contract
- **THEN** the generator updates every applicable usage artifact or the parity
  gate fails with the stale artifact and source record

#### Scenario: A generated usage card is manually changed

- **WHEN** a generated Codex help card differs from the normalized inventory
  record without a generator input change
- **THEN** validation fails and reports the source and generated paths

#### Scenario: Procedure detail is added to a usage contract

- **WHEN** a skill author puts safety procedures or completion instructions in
  inventory `usage` instead of the canonical `SKILL.md` or conditional
  references
- **THEN** the usage schema rejects the unsupported field and keeps the
  procedural content in the skill-owned source
