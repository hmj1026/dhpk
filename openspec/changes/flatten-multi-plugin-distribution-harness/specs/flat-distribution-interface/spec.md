## ADDED Requirements

### Requirement: Retained surfaces share one distribution Interface
The system SHALL expose one distribution Module Interface for every retained surface: `dhpk distribution <surface> <generate|validate|verify>`. The Module SHALL select entries only from the inventory and delegate only declared layout, transform, and probe work to the selected Adapter.

#### Scenario: A retained package is generated
- **WHEN** a maintainer runs the generate operation for a retained surface
- **THEN** the Module produces the surface only from the inventory-bound plan and records plan, artifact, and provenance identities

#### Scenario: An Adapter attempts independent selection
- **WHEN** an Adapter discovers or adds a source outside its plan
- **THEN** generation fails before publication and identifies the undeclared entry

### Requirement: Common projection behavior has one test owner
The system SHALL test deterministic planning, containment, atomic publication, rollback, provenance, and evidence vocabulary only through the distribution Module contract. Each Adapter SHALL test only its unique transform, layout, or consumer probe.

#### Scenario: An Adapter publication fails
- **WHEN** an Adapter render fails during staging
- **THEN** the core contract proves prior accepted output remains intact without repeating the same rollback test for every surface

### Requirement: Repository integration verifies generated projections once
The system SHALL provide one integration gate that generates every retained surface in isolated output roots and compares its structural/provenance result with the tracked projection.

#### Scenario: A tracked projection drifts
- **WHEN** the isolated generated output differs from a retained tracked projection
- **THEN** the integration gate fails with the surface and changed output identity
