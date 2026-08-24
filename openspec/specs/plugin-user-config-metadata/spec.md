# plugin-user-config-metadata Specification

## Purpose
TBD - created by archiving change compact-plugin-user-config-metadata. Update Purpose after archive.

## Requirements

### Requirement: User configuration compatibility is preserved

The compact Claude `userConfig` metadata SHALL preserve every characterized
configuration key, type, default, validation rule, alias, and consumer-facing
behavior. Metadata changes MUST NOT remove, rename, or reinterpret an option.

#### Scenario: Compact metadata preserves the schema

- **WHEN** the generated compact manifest is compared with the characterized
  manifest
- **THEN** all keys, types, defaults, validation rules, and aliases match

#### Scenario: A metadata edit changes behavior

- **WHEN** a compact description or generated entry causes SessionStart or the
  config parser to select a different module/value
- **THEN** parity validation fails and the legacy manifest remains authoritative

### Requirement: Descriptions are compact progressive routing metadata

Each published `userConfig` description SHALL provide a concise purpose,
positive trigger, boundary or exclusion, and a schema-compatible pointer to
canonical extended guidance. Long-form policy, examples, and version mechanics
MUST remain in canonical skills or documentation rather than being duplicated
in every manifest description.

#### Scenario: An option has canonical guidance

- **WHEN** a user selects a compactly described option
- **THEN** the description identifies the intended use and a validated path or
  follow-up reference for extended guidance

#### Scenario: A description has no boundary

- **WHEN** compact metadata omits a trigger, exclusion, or safety boundary
- **THEN** metadata validation rejects the entry before publication

### Requirement: Metadata ownership and generation are deterministic

The compact metadata SHALL be generated from one authoritative source and
validated against the canonical config contract. Repeated generation from
unchanged inputs SHALL produce byte-identical metadata, and the validator SHALL
reject duplicate long-form prose, invalid pointers, unknown keys, and
generator-local entries.

#### Scenario: Generation is repeated

- **WHEN** the same canonical metadata source and generator version are used
  twice
- **THEN** the resulting `userConfig` metadata and manifest fingerprint match

#### Scenario: A pointer escapes the repository

- **WHEN** a metadata pointer targets a missing path or escapes the declared
  canonical documentation root
- **THEN** validation fails closed and identifies the option and pointer

#### Scenario: A manifest adds an unowned option

- **WHEN** generated output contains a config key absent from the characterized
  contract and authoritative source
- **THEN** generation fails and publishes no accepted manifest

### Requirement: Metadata reduction evidence is stage-honest

The change SHALL report manifest byte and conservative token reduction as
structural metadata evidence separate from skill discovery, profile-bundle,
agent, command, and runtime-activation evidence. A static reduction MUST NOT
be reported as a live Claude context reduction without an exact configured
consumer probe bound to the generated manifest fingerprint.

#### Scenario: Structural metadata reduction passes

- **WHEN** the compact manifest preserves the config contract and its measured
  metadata totals are below the characterized baseline
- **THEN** the structural result records the reduction and remains separate
  from consumer-runtime support

#### Scenario: Claude consumer is unavailable

- **WHEN** the exact Claude installation or consumer probe cannot be configured
- **THEN** the result is `NOT_RUN`, `NOT_CONFIGURED`, `BLOCKED`, or
  `UNAVAILABLE`, with no claim that session context decreased
