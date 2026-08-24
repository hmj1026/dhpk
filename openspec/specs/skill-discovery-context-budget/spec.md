# skill-discovery-context-budget Specification

## Purpose

Define the discovery-visible metadata budget, progressive-loading boundary, family-router compatibility contract, and deterministic publication parity for dhpk skills.

## Requirements

### Requirement: Discovery-visible descriptions stay within lifecycle and surface budgets

Every skill published on a discovery-visible surface SHALL have a canonical
frontmatter description whose whitespace-delimited word count and conservative
token count are within the configured budget for its lifecycle and surface.
Discovery visibility, lifecycle, publication surface, selected profile/artifact
identity, estimator/version, and applicable limits MUST be explicit accounting
inputs. A missing visibility or budget configuration SHALL return a structured
configuration failure and MUST NOT be evaluated as a zero-valued content
budget. Strict validation SHALL fail on either overflow and SHALL pass only
when the complete scoped report has zero violations.

#### Scenario: Explicit visibility is measured

- **WHEN** a skill entry supplies declared discovery visibility, lifecycle,
  surface/profile scope, estimator, and applicable limits
- **THEN** the report measures and labels the entry in its declared scope

#### Scenario: Current baseline is clean

- **WHEN** strict context-budget validation scans the current inventory and declared surfaces with no violations
- **THEN** the complete report passes and records the measured baseline by scope

#### Scenario: Current report is internally consistent

- **WHEN** strict context-budget validation scans the current inventory and declared surfaces
- **THEN** the report contains measured discovery-visible and optional counts for each surface/profile and zero violations, or exits non-zero with every violation listed

#### Scenario: Visibility is not known

- **WHEN** an entry has no explicit host visibility or its surface budget is
  missing
- **THEN** validation returns a structured configuration failure rather than
  treating the limit as zero or claiming the entry is discovery-visible

#### Scenario: A scoped description exceeds a limit

- **WHEN** a discovery-visible description exceeds either configured limit
- **THEN** validation reports the stable ID, lifecycle, surface/profile,
  estimator, measured counts, and limits and exits non-zero

#### Scenario: A surface exceeds a limit

- **WHEN** any declared discovery-visible surface exceeds its applicable word or token limit
- **THEN** validation reports the affected surface and limit and exits non-zero

#### Scenario: Profile scope is omitted

- **WHEN** a Claude budget report mixes unscoped and profile-scoped entries without recording the selected artifact identity
- **THEN** validation fails with a scope/provenance diagnostic rather than presenting one combined total as a bundle result

#### Scenario: Metadata is within budget

- **WHEN** all explicitly scoped discovery-visible descriptions meet their
  configured budgets
- **THEN** the budget result passes independently of projection parity and
  reports totals by category and scope

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

### Requirement: React and Next remain separate

React 18/19 and Next.js 15.5/16 SHALL retain separate IDs and source mappings. This capability SHALL not merge, rename, or alias these entries.

#### Scenario: Frontend regression guard

- **WHEN** the regression guard scans inventory and projections
- **THEN** all four families remain independently addressable with their current mappings

### Requirement: Runtime evidence remains stage-honest

Static inventory, budget, projection, and profile-package success SHALL NOT imply consumer-runtime support or a smaller live Claude context. Unavailable or unconfigured consumers SHALL retain `NOT_RUN`, `NOT_CONFIGURED`, `BLOCKED`, or `UNAVAILABLE` evidence as applicable, bound to the selected package identity when one exists.

#### Scenario: Consumer is unavailable

- **WHEN** a named consumer executable or supported Claude installation mode is absent or cannot be configured
- **THEN** the report records the closed non-pass state, selected package identity, and a resume command rather than claiming PASS or discovery reduction

#### Scenario: Consumer observes the selected bundle

- **WHEN** the exact configured consumer loads a profile artifact whose plan and artifact fingerprints match the receipt
- **THEN** the report may record a passing consumer stage while preserving separate structural and budget evidence
