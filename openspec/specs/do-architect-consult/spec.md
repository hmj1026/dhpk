# do-architect-consult Specification

## Purpose
TBD - created by archiving change do-flags-and-harness-consolidation. Update Purpose after archive.
## Requirements
### Requirement: Architect consult on architecture-relevant `--plan`/`--opsx` invocations
When `/dhpk:do` runs with `PLAN=on` or `OPENSPEC=on` and the cleaned query describes a new feature requiring architectural judgment or architecture research (cross-module design, new subsystem, layering decisions), the router SHALL dispatch a `dhpk:architect` subagent before the downstream flow and fold its opinion in: under PLAN, into the plan brief handed to `dhpk:planner`; under OPENSPEC, into the change description handed to `opsx:new`. The trigger SHALL be a semantic judgment documented in `commands/do.md` with at least one positive and one negative example. Mechanical or single-module tasks SHALL NOT trigger the consult.

#### Scenario: OPENSPEC architecture task gets a consult
- **WHEN** `/dhpk:do --opsx` is invoked with a task describing a new cross-module capability needing architecture research
- **THEN** `dhpk:architect` is dispatched first and its conclusions are folded into the `opsx:new` change description

#### Scenario: Mechanical task skips the consult
- **WHEN** `/dhpk:do --plan` is invoked with a single-file mechanical task
- **THEN** no architect dispatch occurs and the planner consult proceeds as before

### Requirement: Architect default tier is fable/low
`agents/architect.md` frontmatter SHALL default to `model: fable` / `effort: low`, and `rules/model-economics.md`'s tier map SHALL reflect the new default with rationale. The configured-role override mechanism SHALL allow raising the tier per session, and reviewer-style up-only escalation guidance applies for high-risk architecture decisions.

#### Scenario: Default dispatch uses the new tier
- **WHEN** architect is dispatched with no override configured
- **THEN** the dispatch runs at fable/low and the tier map documents the default
