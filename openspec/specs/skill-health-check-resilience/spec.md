# skill-health-check-resilience Specification

## Purpose

TBD - created by archiving change repair-open-issues-and-agent-guidance. Update Purpose after archive.

## Requirements

### Requirement: Canonical skills declare a non-use boundary

Every shipped canonical skill SHALL include a `When NOT to Use` section that names at least one neighboring shipped route or explicit exclusion. Any named neighboring route SHALL resolve to a shipped canonical identifier; an explicit exclusion may be prose without a route token. The health checker SHALL report a P1 when the section is absent, empty, or names an unresolvable route, and SHALL preserve the relative skill path in the finding.

#### Scenario: The two current omissions are corrected

- **WHEN** `dhpk-codebase-exploration` and `dhpk-module-design` contain non-empty `When NOT to Use` sections naming resolvable neighboring routes
- **THEN** the health checker emits no missing-section or unresolvable-route P1 for either skill

#### Scenario: A new skill omits the section

- **WHEN** a canonical skill is added without a non-use boundary
- **THEN** health lint emits a deterministic P1 finding with the skill path and a fix hint

#### Scenario: Non-use route is stale

- **WHEN** a canonical skill names a neighboring route that is not shipped
- **THEN** health lint emits a deterministic P1 route finding with the skill path, stale identifier, and a qualified replacement hint

### Requirement: The canonical source tree has a zero-P1 regression gate

The health validation suite SHALL assert that the current canonical source tree has zero P1 findings after all required checks complete. P2 advisories SHALL remain visible and SHALL not be silently promoted or hidden by this assertion.

#### Scenario: Corrected canonical tree is linted

- **WHEN** the full health linter runs against the canonical skills, agents, and commands
- **THEN** the process exits zero for P1 severity and reports any remaining P2 advisory count separately

#### Scenario: A malformed entry regresses

- **WHEN** a fixture introduces a missing non-use section or malformed frontmatter
- **THEN** the regression test fails with the stable P1 path/check and does not accept a green result because other checks pass
