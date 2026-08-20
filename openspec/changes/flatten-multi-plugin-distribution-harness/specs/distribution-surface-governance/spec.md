## ADDED Requirements

### Requirement: Platform ownership is declarative
Each retained distribution surface SHALL declare only its layout, required transform, and evidence probe in inventory-owned metadata. Membership, ownership, and common materialization policy SHALL remain owned by the distribution Module.

#### Scenario: Cursor reuses portable content
- **WHEN** Cursor native and Agent Plugin select the same portable skill
- **THEN** the inventory identifies Agent Plugin as the physical owner and the Cursor Adapter does not create an implicit second copy

### Requirement: Gemini CLI is retired while AGY is retained
The surface matrix SHALL omit Gemini CLI and retain `agy-plugin` as an Experimental Antigravity surface. Documentation and release gates SHALL not use Gemini CLI terminology to describe AGY.

#### Scenario: Surface status is reported
- **WHEN** a release matrix is generated
- **THEN** it contains AGY evidence independently and contains no Gemini CLI row or support claim
