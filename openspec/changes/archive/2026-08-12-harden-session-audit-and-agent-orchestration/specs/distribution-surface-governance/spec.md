## MODIFIED Requirements

### Requirement: Core and optional surfaces are distinguishable
The distribution model SHALL distinguish broadly applicable core workflow skills from opt-in stack skills, and documentation SHALL state whether the current host truly gates discovery or merely gates runtime hooks and activation. The catalog SHALL report description word/token totals separately for promoted, optional, experimental, and deprecated entries. An `optional` lifecycle SHALL NOT be described as hidden from discovery when the host still publishes its description.

#### Scenario: Host cannot hide optional skill descriptions
- **WHEN** the Claude plugin host registers optional module skill descriptions regardless of selected modules
- **THEN** documentation reports that limitation and SHALL NOT describe the optional set as hidden at discovery time

#### Scenario: Optional metadata is discovery-visible
- **WHEN** optional skills are published in the host's discovery manifest
- **THEN** catalog output labels them discovery-visible and runtime- or activation-optional

#### Scenario: Description budget is exceeded
- **WHEN** a discovery-visible skill or agent description exceeds the configured always-visible word/token budget
- **THEN** validation reports the entry and fails or requires an explicit reviewed exemption

#### Scenario: Metadata is within budget
- **WHEN** all discovery-visible descriptions meet their scoped budgets
- **THEN** validation passes and reports the budget totals by publication surface

## ADDED Requirements

### Requirement: Always-visible and conditional context are distinguishable
Publication and manifest generation SHALL expose which safety/routing contracts are always visible and which stack/version/review mechanics are conditional references. The generator SHALL not duplicate full description prose in developer instructions when a short trigger and pointer are sufficient.

#### Scenario: A role repeats its full description in the body
- **WHEN** an agent description and its developer instructions contain duplicated policy prose
- **THEN** metadata health validation reports the duplication and suggests a pointer-based form

#### Scenario: A safety contract is always visible
- **WHEN** a role is published for discovery
- **THEN** destructive-action, authorization, and completion-boundary constraints remain in its always-visible contract
