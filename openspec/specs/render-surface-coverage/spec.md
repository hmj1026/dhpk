# render-surface-coverage Specification

## Purpose
TBD - created by archiving change harvest-advice-20260709. Update Purpose after archive.
## Requirements
### Requirement: Verification inventories every render surface when a field transitions from always-empty to populated

When a feature causes a field or output that was previously **always empty** to begin holding real data, verification (characterization tests and `e2e-runner` journey planning) SHALL inventory and exercise every render surface that consumes that field — screen/edit path, print output, and export — not only the edit/API path. A surface no journey or characterization test ever exercises can carry a latent formatting bug (e.g. a print-layout misalignment) that stays invisible on the tested surfaces alone. `agents/e2e-runner.md`'s Plan step and the legacy-code-characterization skill's behavior-inventory phase SHALL both name this requirement.

#### Scenario: A newly-populated field's plan covers every consuming render surface
- **WHEN** a feature causes a field that was previously always empty to begin holding real data
- **THEN** the `e2e-runner` journey plan and/or the characterization test's behavior inventory list every render surface consuming that field (screen, print, export), not only the edit/API path

#### Scenario: An edit-only plan for a newly-populated field is treated as incomplete
- **WHEN** a plan or characterization inventory for a newly-populated field covers only the edit/API path
- **THEN** it is treated as incomplete verification scope, since a print or export surface consuming the same field remains unexercised

#### Scenario: An always-populated field's plan is unaffected
- **WHEN** a field already held real data before the current feature (not transitioning from always-empty)
- **THEN** this requirement does not mandate an expanded render-surface inventory beyond the plan's existing risk-based scoping
