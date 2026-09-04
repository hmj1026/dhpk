## MODIFIED Requirements

### Requirement: Initial descriptions are progressive routing metadata

Canonical descriptions SHALL contain only purpose, positive trigger, exclusion/boundary, and expected output or safety cues. Version mechanics, migration traps, mode procedures, complete option tables, examples, and extended policy SHALL be loaded only from a selected conditional reference or an explicitly requested usage card. Every Codex-invokable skill SHALL have the closed inventory-owned usage contract defined by `skill-usage-discovery`; the contract SHALL have a schema version and deterministic fingerprint.

#### Scenario: A version is selected

- **WHEN** a Laravel or PHPUnit caller supplies an explicit selector
- **THEN** the router resolves exactly one reference path and does not load sibling-version detail

#### Scenario: Default discovery remains concise

- **WHEN** a consumer performs ordinary skill discovery without requesting help
- **THEN** it receives the concise canonical description and family routing cue without mode procedures, full option tables, or conditional reference bodies

#### Scenario: Explicit usage help is requested

- **WHEN** a caller requests `$flow-guide help <skill>` or the equivalent generated usage-card action
- **THEN** the help catalog returns the selected skill's normalized usage card without executing the skill or loading conditional procedural references

### Requirement: Family skills remain functional as a standalone copy

A family skill's canonical folder (`skills/laravel/` or `skills/phpunit/`), copied out of the repository in isolation or installed independently through `skills.sh`, SHALL function correctly for its core capability with no dhpk Workflow State, manifest, Hook, Agent, or MCP server present.

#### Scenario: Isolated copy resolves an explicit version

- **WHEN** the canonical family skill folder is copied to an empty directory with no other dhpk files present and invoked with an explicit version
- **THEN** it loads the correct version reference and produces its normal guidance

#### Scenario: Isolated copy has no unresolved dependency

- **WHEN** the isolated canonical family folder is inspected for path references
- **THEN** it contains no reference to a dhpk manifest, hook, agent, or MCP tool required for its core capability to function

### Requirement: Family consumers preserve profile and module topology

Validator, normalized projection, profile-selection, and module-topology implementations SHALL treat `laravel` and `phpunit` as the canonical family IDs, retain the existing versioned module IDs and dependency constraints from `manifests/module-catalog.json`, and exclude all retired version aliases from discovery, profile selection, projection, and direct execution. The module catalog SHALL remain authoritative for available versions, dependency closure, and PHPUnit annotation semantics.

#### Scenario: Profile and module selection use family IDs

- **WHEN** an install profile or affected module mapping is generated for a Laravel or PHPUnit version
- **THEN** it selects or provides the canonical family ID while retaining the corresponding versioned module ID and catalog-owned runtime dependency constraint

#### Scenario: Profile or module topology publishes a deprecated alias

- **WHEN** a generated profile or module topology includes one of the retired legacy IDs as a discovery-selected skill
- **THEN** validation fails and requires the canonical family entry, while no direct alias invocation is offered

#### Scenario: Retired alias is invoked directly

- **WHEN** a caller invokes a retired version-specific ID or historical public name
- **THEN** the resolver returns a closed retirement diagnostic naming the canonical family and selector and performs no skill execution

### Requirement: Runtime evidence remains stage-honest

Static inventory, discovery-budget, projection, profile-package, and rollback success SHALL NOT imply consumer-runtime support, a smaller live context, or successful skill loading in a configured host. Reports SHALL distinguish discovery, structural, package, budget, rollback, and consumer-runtime stages and bind each result to the selected package, profile, and selection identities when one exists. Unavailable or unconfigured consumers SHALL retain `NOT_RUN`, `NOT_CONFIGURED`, `BLOCKED`, or `UNAVAILABLE` evidence as applicable.

#### Scenario: Consumer is unavailable

- **WHEN** a named consumer executable or supported installation mode is absent or cannot be configured
- **THEN** the report records the closed non-pass state, selected package/profile identity, and a bounded resume command rather than claiming PASS or discovery reduction

#### Scenario: Consumer observes the selected bundle

- **WHEN** the exact configured consumer loads a profile artifact whose plan, artifact, usage, provenance, and selection fingerprints match the receipt
- **THEN** the report may record a passing consumer-runtime stage while preserving separate structural, package, budget, and rollback evidence

#### Scenario: Candidate activation fails

- **WHEN** generation, projection, or a required consumer verification fails for a candidate profile
- **THEN** the report records the failed stage and retains the prior active bundle and its evidence instead of converting static success into runtime PASS

#### Scenario: Optional consumer verification fails

- **WHEN** an optional consumer verification fails or is unavailable for an otherwise structurally valid candidate
- **THEN** the report records that surface's non-pass state without discarding the active bundle or converting structural success into runtime PASS

### Requirement: Capability-family discovery exposes interfaces rather than modes

Discovery-visible metadata SHALL expose one concise description for each capability family and SHALL keep mode procedures out of the initial context. For this inventory revision the canonical inventory SHALL contain exactly 65 skills, exactly 9 live `portable-family` entries, and exactly 56 live entries whose public name retains the `dhpk-` prefix. The selected profile counts SHALL be `minimal=8`, `full=55`, and `compat-v1=62` before any explicit overlay.

#### Scenario: Family surface meets the structural baseline

- **WHEN** inventory and profile validation run after the consolidation
- **THEN** the reported canonical, naming-style, and profile counts match `65`, `9`, `56`, `8`, `55`, and `62`, and identify any unexpected entry by stable ID

#### Scenario: Mode procedures leak into discovery metadata

- **WHEN** a family description duplicates its mode steps, checklists, detailed reference content, or complete usage card
- **THEN** context-budget or skill-health validation fails with the offending family and directs the detail behind a conditional pointer or explicit help request

## REMOVED Requirements

### Requirement: Family routers preserve compatible aliases

**Reason**: The approved breaking cleanup removes the eleven deprecated Laravel/PHPUnit version-specific identities instead of extending their compatibility window.

**Migration**: Callers use the canonical `laravel` or `phpunit` family with an explicit selector, or use project-file detection followed by an explicit question when detection is inconclusive.

### Requirement: Family selectors and aliases have an explicit distribution contract

**Reason**: Version-specific aliases are retired and must not remain directly invocable or projected.

**Migration**: Use the alias-free family selector contract below and the canonical `skills/laravel/` or `skills/phpunit/` package paths.

## ADDED Requirements

### Requirement: Usage catalog is generated and progressively discoverable

The inventory SHALL be the single source of truth for a generated usage catalog covering every Codex-invokable canonical skill. The catalog SHALL expose concise cards on explicit request and SHALL not be included in ordinary discovery output. Each card SHALL include the stable/public identity, normalized usage contract, supported Codex surfaces, catalog schema/version, source inventory revision, and usage fingerprint. Catalog generation SHALL be deterministic and validation SHALL fail closed on missing, duplicate, unsupported, or contradictory usage fields.

#### Scenario: Help card loads one skill

- **WHEN** a caller requests help for one canonical skill
- **THEN** the catalog returns exactly that skill's usage card and does not load unrelated skill cards or mode reference bodies

#### Scenario: Usage contract is incomplete

- **WHEN** a Codex-invokable skill lacks any required normalized usage field, an applicable action/option definition, or an example for its declared interface
- **THEN** usage validation fails with the stable ID and missing field before any generated projection is published

#### Scenario: Usage contract is contradictory

- **WHEN** an option is undocumented, an example uses an unsupported action, invocation class conflicts with policy, or effect authority exceeds its parent
- **THEN** validation fails closed with the field-level diagnostic and produces no accepted help catalog

### Requirement: Family selectors have an alias-free distribution contract

The distribution inventory SHALL declare the live `laravel` and `phpunit` family selectors as safe paths under `skills/laravel/references/` and `skills/phpunit/references/` respectively: Laravel selectors `5.4`, `6`, `7`, `8`, `9`, `10`, `11`, and `mix` SHALL target `references/{5-4,6,7,8,9,10,11,mix}.md`, and PHPUnit selectors `9`, `10`, and `11` SHALL target `references/{9,10,11}.md`. The eleven former version-specific IDs (`laravel-10-notes`, `laravel-11-notes`, `laravel-5.4-notes`, `laravel-6-notes`, `laravel-7-notes`, `laravel-8-notes`, `laravel-9-notes`, `laravel-mix-notes`, `phpunit-10-notes`, `phpunit-11-notes`, and `phpunit-9-modern`) and their historical public names SHALL be retired, excluded from discovery/profile/projection artifacts, and rejected by direct resolution. Inventory validation and normalized projections SHALL fail closed on missing, ambiguous, escaping, or retired-alias-published targets.

#### Scenario: Family selector targets a canonical reference

- **WHEN** a live Laravel or PHPUnit family selector is compiled
- **THEN** its target is exactly one reference file below the corresponding canonical family `references/` directory and never a retired legacy `SKILL.md` path or an installation/publication manifest

#### Scenario: Retired aliases are absent from every projection

- **WHEN** discovery, profile, package, or consumer-runtime projections are generated from the inventory
- **THEN** only the canonical family IDs are selectable and none of the eleven retired IDs, historical names, paths, or aliases is emitted

#### Scenario: Alias or selector metadata is invalid

- **WHEN** validation sees duplicate aliases, ambiguous selectors, unsupported surfaces, a missing reference, a target outside the owning family `references/` directory, or a retired alias in a projection
- **THEN** `node scripts/ci/validate-distribution.js --strict` fails with a stable diagnostic before projection or profile publication
