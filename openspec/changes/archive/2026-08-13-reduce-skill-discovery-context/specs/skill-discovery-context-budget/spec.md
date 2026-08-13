## ADDED Requirements

### Requirement: Discovery-visible descriptions stay within lifecycle and surface budgets

Every skill published on a discovery-visible surface SHALL have a canonical frontmatter description whose whitespace-delimited word count and conservative token count are within the configured budget for its lifecycle and surface. The strict context-budget validator SHALL fail when any entry exceeds either limit, and SHALL pass only when the complete report has zero violations.

#### Scenario: Existing baseline violations are remediated

- **WHEN** strict context-budget validation scans the current inventory and all publication surfaces
- **THEN** the 18 measured violations across 15 unique skills (ios-platform, js-lint-config, laravel-11-notes, openspec-artifact-guard, nextjs-16-notes, php-pro, php-modern-pro, react-18-notes, react-19-notes, swift-test-strategy, swift-language, swiftui-architecture, php56-yii-dev, agy-fast-worker, and skill-judge) produce zero violations after remediation

#### Scenario: A single surface exceeds a limit

- **WHEN** a fixture description is over either its word or token budget on one declared surface
- **THEN** the report names the stable skill ID, lifecycle, surface, measured counts, and limits, and strict validation exits non-zero

#### Scenario: Optional metadata remains host-discoverable

- **WHEN** an optional module skill is not activated at runtime
- **THEN** its always-visible description is still measured and reported as discovery-visible, while its detailed guidance remains conditional

### Requirement: Initial discovery metadata is a concise routing contract

Each canonical description SHALL contain only the skill's stable purpose, positive trigger, exclusion or boundary, and expected output/safety cue needed for initial selection. Framework-version mechanics, examples, migration tables, and extended policy prose MUST live in conditional references or the selected skill body rather than always-visible metadata.

#### Scenario: A user selects a version-specific skill

- **WHEN** routing identifies a framework or test-runner version
- **THEN** the description supplies enough trigger and scope information to select the skill, and the router loads the relevant conditional reference only after selection

#### Scenario: A role has a distinct responsibility

- **WHEN** audit, judge, stocktake, GitNexus, investigation, or review skills are published together
- **THEN** each retains its distinct responsibility and routing cue; budget reduction does not merge or alias away role boundaries

### Requirement: Laravel and PHPUnit version families use shared routers with compatible aliases

The publication model SHALL provide one Laravel router covering Laravel 5.4 through 11 and Mix, and one PHPUnit router covering PHPUnit 9, 10, and 11. Each router SHALL select version-specific conditional references from an explicit version map. Every existing Laravel/PHPUnit skill ID and supported invocation spelling SHALL remain registered as a concise compatibility alias resolving deterministically to the appropriate router and version selector.

#### Scenario: Laravel legacy ID remains callable

- **WHEN** a caller invokes any retained Laravel ID, including `laravel-5.4-notes`, `laravel-6-notes`, `laravel-7-notes`, `laravel-8-notes`, `laravel-9-notes`, `laravel-10-notes`, `laravel-11-notes`, or `laravel-mix-notes`
- **THEN** routing resolves the request to the shared Laravel router with the matching version constraint and does not require the caller to rename the ID

#### Scenario: PHPUnit legacy ID remains callable

- **WHEN** a caller invokes `phpunit-9-modern`, `phpunit-10-notes`, or `phpunit-11-notes`
- **THEN** routing resolves the request to the shared PHPUnit router with the matching major and preserves the original explicit identifier

#### Scenario: Alias points to one canonical target

- **WHEN** alias-resolution tests enumerate all retained legacy IDs across Claude and Codex surfaces
- **THEN** each ID resolves to exactly one router/version pair, has no conflicting target, and is absent from generated publication output only if an equivalent callable alias is present

### Requirement: Publication projections are deterministic and parity-checked

Claude and Codex publication projections SHALL be generated from one inventory-owned router/alias manifest. Repeated generation from unchanged inputs SHALL be byte-identical, and parity validation SHALL compare stable IDs, public names, alias targets, budgets, and canonical source fingerprints across the declared surfaces.

#### Scenario: Projection generation is repeated

- **WHEN** the projection generator runs twice with unchanged canonical sources, inventory, and version maps
- **THEN** both outputs have identical metadata and content fingerprints

#### Scenario: Projection metadata drifts

- **WHEN** one surface omits a retained alias or changes a router target/budget without an inventory change
- **THEN** parity validation fails with the stable ID and surface-specific mismatch

### Requirement: React and Next consolidation is explicitly deferred

This capability SHALL preserve the current separate React and Next skill IDs and publication mappings. It SHALL record current context-budget evidence and a follow-up boundary for future consolidation, but MUST NOT merge React or Next descriptions, routers, or aliases in this change.

#### Scenario: React/Next evidence is captured without implementation

- **WHEN** the change's scope and verification plan are reviewed
- **THEN** React/Next remain separate, their measured evidence is identified as follow-up input, and no React/Next source or registration is rewritten by this capability
