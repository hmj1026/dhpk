# skill-discovery-context-budget Specification

## Purpose

Define the discovery-visible metadata budget, progressive-loading boundary, family-router compatibility contract, and deterministic publication parity for dhpk skills.

## Requirements

### Requirement: Discovery-visible descriptions stay within lifecycle and surface budgets

Every skill published on a discovery-visible surface SHALL have a canonical frontmatter description whose whitespace-delimited word count and conservative token count are within the configured budget for its lifecycle and surface. Strict validation SHALL fail on either overflow and SHALL pass only when the complete report has zero violations.

#### Scenario: Current baseline is clean

- **WHEN** strict context-budget validation scans the current inventory and declared surfaces
- **THEN** the report contains 133 discovery-visible entries, 45 optional discovery-visible entries, and zero violations

#### Scenario: A surface exceeds a limit

- **WHEN** a fixture description exceeds either configured limit
- **THEN** validation reports the stable ID, lifecycle, surface, measured counts, and limits and exits non-zero

### Requirement: Initial descriptions are progressive routing metadata

Canonical descriptions SHALL contain purpose, positive trigger, exclusion/boundary, and expected output or safety cues. Version mechanics, migration traps, examples, and extended policy SHALL be loaded only from a selected conditional reference.

#### Scenario: A version is selected

- **WHEN** a Laravel or PHPUnit caller supplies an explicit selector
- **THEN** the router resolves exactly one reference path and does not load sibling-version detail

### Requirement: Family routers preserve compatible aliases

The inventory SHALL provide one Laravel family covering 5.4 through 11 and Mix and one PHPUnit family covering 9 through 11. Every legacy Laravel/PHPUnit ID SHALL resolve to exactly one router/selector pair while preserving its public invocation class and declared surfaces.

#### Scenario: Legacy alias resolution

- **WHEN** any retained Laravel or PHPUnit ID is resolved
- **THEN** the result contains its original ID, one family/router, one selector, invocation class, surfaces, and safe conditional reference path

#### Scenario: Invalid routing metadata

- **WHEN** aliases duplicate, targets are missing, selectors are ambiguous, surfaces are unsupported, or reference paths escape the repository
- **THEN** validation fails closed with a stable diagnostic

### Requirement: Publication projections are deterministic and parity-checked

Claude and Codex projections SHALL use one inventory-owned normalized router/alias view. Repeated generation from unchanged inputs SHALL be byte-identical, and parity SHALL compare IDs, names, targets, selectors, invocation classes, surfaces, budgets, and source fingerprints.

#### Scenario: Projection drift

- **WHEN** one declared surface omits an alias or changes a selector target without an inventory change
- **THEN** parity fails and identifies the stable ID and surface

### Requirement: React and Next remain separate

React 18/19 and Next.js 15.5/16 SHALL retain separate IDs and source mappings. This capability SHALL not merge, rename, or alias these entries.

#### Scenario: Frontend regression guard

- **WHEN** the regression guard scans inventory and projections
- **THEN** all four families remain independently addressable with their current mappings

### Requirement: Runtime evidence remains stage-honest

Static inventory and projection success SHALL NOT imply consumer-runtime support. Unavailable or unconfigured consumers SHALL retain `NOT_RUN`, `NOT_CONFIGURED`, `BLOCKED`, or `UNAVAILABLE` evidence as applicable.

#### Scenario: Consumer is unavailable

- **WHEN** a named consumer executable is absent or cannot be configured
- **THEN** the report records the closed non-pass state and a resume command rather than claiming PASS
