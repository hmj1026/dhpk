# skill-discovery-context-budget Specification

## Purpose

Define the discovery-visible metadata budget, progressive-loading boundary, family-router compatibility contract, and deterministic publication parity for dhpk skills.

## Requirements

### Requirement: Discovery-visible descriptions stay within lifecycle and surface budgets

Every skill published on a discovery-visible surface SHALL have a canonical frontmatter description whose whitespace-delimited word count and conservative token count are within the configured budget for its lifecycle, surface, and selected profile artifact. Discovery visibility, lifecycle, publication surface, normalized profile ID, selected stable-ID set, artifact/selection identity, estimator/version, and applicable limits MUST be explicit accounting inputs. A missing visibility or budget configuration SHALL return a structured configuration failure and MUST NOT be evaluated as a zero-valued content budget. Strict validation SHALL fail on either overflow and SHALL pass only when the complete scoped report has zero violations.

#### Scenario: Explicit visibility is measured

- **WHEN** a skill entry supplies declared discovery visibility, lifecycle, surface/profile scope, selected artifact identity, estimator, and applicable limits
- **THEN** the report measures and labels the entry in its declared scope

#### Scenario: Current report is internally consistent

- **WHEN** strict context-budget validation scans the current inventory and declared surfaces for `minimal`, `full`, or `compat-v1`
- **THEN** the report contains measured discovery-visible and optional counts for each surface/profile and zero violations, or exits non-zero with every violation listed

#### Scenario: Current baseline is clean

- **WHEN** strict context-budget validation scans the current inventory and declared surfaces with no violations
- **THEN** the complete report passes and records the measured baseline by scope

#### Scenario: Visibility is not known

- **WHEN** an entry has no explicit host visibility or its surface/profile budget is missing
- **THEN** validation returns a structured configuration failure rather than treating the limit as zero or claiming the entry is discovery-visible

#### Scenario: A scoped description exceeds a limit

- **WHEN** a discovery-visible description exceeds either configured limit
- **THEN** validation reports the stable ID, lifecycle, surface/profile, selected artifact, estimator, measured counts, and limits and exits non-zero

#### Scenario: A surface exceeds a limit

- **WHEN** any declared discovery-visible surface exceeds its applicable word or token limit
- **THEN** validation reports the affected surface and limit and exits non-zero

#### Scenario: Profile scope is omitted

- **WHEN** a Claude budget report mixes unscoped, `minimal`, and `compat-v1` entries without recording the selected artifact identity
- **THEN** validation fails with a scope/provenance diagnostic rather than presenting one combined total as a bundle result

#### Scenario: Metadata is within budget

- **WHEN** all explicitly scoped discovery-visible descriptions meet their configured budgets
- **THEN** the budget result passes independently of projection parity and reports totals by category, surface, and selected profile artifact

### Requirement: Initial descriptions are progressive routing metadata

Canonical descriptions SHALL contain only purpose, positive trigger,
exclusion/boundary, and expected output or safety cues. Version mechanics,
migration traps, mode procedures, complete option tables, examples, and
extended policy SHALL be loaded only from a selected conditional reference or
an explicitly requested usage card. Every Codex-invokable skill SHALL have the
closed inventory-owned usage contract defined by `skill-usage-discovery`; the
contract SHALL have a schema version and deterministic fingerprint.

#### Scenario: A version is selected

- **WHEN** a Laravel or PHPUnit caller supplies an explicit selector
- **THEN** the router resolves exactly one reference path and does not load sibling-version detail

#### Scenario: Default discovery remains concise

- **WHEN** a consumer performs ordinary skill discovery without requesting help
- **THEN** it receives the concise canonical description and family routing cue without mode procedures, full option tables, or conditional reference bodies

#### Scenario: Explicit usage help is requested

- **WHEN** a caller requests `$flow-guide help <skill>` or the equivalent generated usage-card action
- **THEN** the help catalog returns the selected skill's normalized usage card without executing the skill or loading conditional procedural references

### Requirement: React and Next remain separate

React 18/19 and Next.js 15.5/16 SHALL retain separate IDs and source mappings. This capability SHALL not merge, rename, or alias these entries.

#### Scenario: Frontend regression guard

- **WHEN** the regression guard scans inventory and projections
- **THEN** all four families remain independently addressable with their current mappings

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

### Requirement: Default-discoverable surface stays within an aggregate ceiling

In addition to the existing per-lifecycle/per-surface description budgets, the catalog SHALL compute and enforce a whole-catalog ceiling over the default-discoverable set (the `implicit-eligible` entries published on the `claude-core` surface for the `minimal`/default Claude install artifact): no more than 15 entries, and an aggregate description-token total reduced by at least 70% from the recorded raw-compatibility pre-curation baseline. The baseline SHALL be measured and recorded before any curation edit lands, using the same estimator and scope already defined for per-entry budgets. The measurement SHALL be reproducible: running it twice against unchanged canonical sources and inventory SHALL produce an identical entry count and token total.

#### Scenario: Baseline is recorded before curation

- **WHEN** the aggregate-budget script runs against the pre-curation distribution inventory
- **THEN** it records the current default-discoverable entry count and aggregate token total as the frozen baseline before any lifecycle or invocation-class edit is made

#### Scenario: Curated default surface exceeds the entry ceiling

- **WHEN** the `implicit-eligible` + `claude-core` + default-profile entry count exceeds 15
- **THEN** validation reports the entry count, the excess entries, and exits non-zero

#### Scenario: Curated default surface fails the token-reduction target

- **WHEN** the aggregate description-token total for the curated default set is not at least 70% below the recorded baseline
- **THEN** validation reports the baseline, current total, and computed reduction percentage, and exits non-zero

#### Scenario: Measurement is reproducible

- **WHEN** the aggregate-budget script runs twice against unchanged canonical sources and inventory
- **THEN** both runs report the identical entry count and token total

### Requirement: Family skill version resolution is explicit-first with self-contained detection

A family skill (Laravel, PHPUnit) SHALL resolve the applicable version reference in this order: (1) an explicit version supplied by the caller, (2) auto-detection from standard project files (`composer.json`, `composer.lock`) read directly by the family skill's own logic, (3) if neither resolves a version, the skill SHALL ask the caller rather than guessing or silently defaulting. Version resolution SHALL NOT depend on `manifests/distribution-inventory.json`, `manifests/install-profiles.json`, or any other dhpk installation/publication manifest — those manifests govern which packages get installed and published, not which version reference a resolved family skill loads at runtime.

#### Scenario: Explicit version is supplied

- **WHEN** a caller supplies an explicit Laravel or PHPUnit version
- **THEN** the family skill loads exactly that version's reference file without reading any project file or manifest

#### Scenario: Version is auto-detected from the project

- **WHEN** no explicit version is supplied but the current project's `composer.json` or `composer.lock` declares a resolvable Laravel or PHPUnit constraint
- **THEN** the family skill reads that file directly and loads the matching version reference

#### Scenario: Version cannot be determined

- **WHEN** no explicit version is supplied and no project file yields a resolvable version
- **THEN** the family skill asks the caller for the version rather than guessing or defaulting to the newest or oldest reference

#### Scenario: Detection does not depend on dhpk manifests

- **WHEN** version detection runs in an environment with no `manifests/distribution-inventory.json` or `manifests/install-profiles.json` present
- **THEN** explicit-version and project-file auto-detection both still resolve correctly

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

### Requirement: PHPUnit references follow authoritative annotation lifecycle

The consolidated PHPUnit family SHALL follow the authoritative annotation lifecycle: PHPUnit 10 supports attributes and retains doc-comment annotations; PHPUnit 11 deprecates doc-comment annotations and uses attributes for new guidance; PHPUnit 12 removes doc-comment annotations except `@codeCoverageIgnore`. Legacy wording that says PHPUnit 11 already removed annotations SHALL be retained only as migration clarification and SHALL NOT be normative family guidance.

#### Scenario: PHPUnit 10 retains both annotation forms

- **WHEN** the PHPUnit 10 reference is selected
- **THEN** it documents attribute support while retaining compatible doc-comment annotation guidance

#### Scenario: PHPUnit 11 marks doc-comments deprecated

- **WHEN** the PHPUnit 11 reference is selected
- **THEN** new guidance prefers attributes and identifies doc-comment annotations as deprecated rather than already removed

#### Scenario: PHPUnit 12 removal preserves the exception

- **WHEN** migration guidance describes the PHPUnit 12 annotation removal
- **THEN** it states that doc-comment annotations are removed except `@codeCoverageIgnore`

### Requirement: Capability-family discovery exposes interfaces rather than modes

Discovery-visible metadata SHALL expose one concise description for each capability family and SHALL keep mode procedures out of the initial context. For this inventory revision the canonical inventory SHALL contain exactly 65 skills, exactly 9 live `portable-family` entries, and exactly 56 live entries whose public name retains the `dhpk-` prefix. The selected profile counts SHALL be `minimal=8`, `full=55`, and `compat-v1=62` before any explicit overlay.

#### Scenario: Family surface meets the structural baseline

- **WHEN** inventory and profile validation run after the consolidation
- **THEN** the reported canonical, naming-style, and profile counts match `65`, `9`, `56`, `8`, `55`, and `62`, and identify any unexpected entry by stable ID

#### Scenario: Mode procedures leak into discovery metadata
- **WHEN** a family description duplicates its mode steps, checklists, detailed reference content, or complete usage card
- **THEN** context-budget or skill-health validation fails with the offending family and directs the detail behind a conditional pointer or explicit help request

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
