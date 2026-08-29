# do-architect-consult Specification

## Purpose
TBD - created by archiving change do-flags-and-harness-consolidation. Update Purpose after archive.
## Requirements
### Requirement: Architect consult on architecture-relevant `--plan`/`--opsx` invocations

When `dhpk-do` entered through either host has PLAN or OPENSPEC on and the query
requires architecture judgment, it SHALL dispatch the verified architect role
before downstream work and fold conclusions into planner or authoring input.
Mechanical/single-module work SHALL skip it. Missing role SHALL return truthful
`UNAVAILABLE` or `BLOCKED` before downstream work.

#### Scenario: OPENSPEC architecture task gets a consult
- **WHEN** an architecture-relevant authoring task has a callable architect
- **THEN** architect runs first and conclusions enter authoring input

#### Scenario: Mechanical task skips the consult
- **WHEN** a single-file mechanical task uses `--plan`
- **THEN** no architect runs

#### Scenario: Architect is unavailable
- **WHEN** consultation is required but the role is undiscovered
- **THEN** downstream authoring/implementation does not start

### Requirement: Architect default tier is fable/low
`agents/architect.md` frontmatter SHALL default to `model: fable` / `effort: low`, and `rules/model-economics.md`'s tier map SHALL reflect the new default with rationale. The configured-role override mechanism SHALL allow raising the tier per session, and reviewer-style up-only escalation guidance applies for high-risk architecture decisions.

#### Scenario: Default dispatch uses the new tier
- **WHEN** architect is dispatched with no override configured
- **THEN** the dispatch runs at fable/low and the tier map documents the default
