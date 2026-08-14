# skill-invocation-policy Specification

## Purpose
TBD - created by archiving change clarify-dhpk-skill-invocation-policy. Update Purpose after archive.
## Requirements
### Requirement: Every distributed entry has one invocation class
Every Distributed Skill, including optional-module and experimental skills, SHALL declare exactly one `metadata.dhpk-invocation-class` value in its canonical `SKILL.md`: `explicit-only` or `implicit-eligible`. A paired Distributed Command SHALL inherit that class; an unpaired Distributed Command SHALL declare the same field in its own frontmatter. After report-only migration is complete, validation SHALL fail when an entry is missing a class, declares conflicting classes, or uses an unknown value.

The field SHALL use this nested YAML shape:

```yaml
metadata:
  dhpk-invocation-class: explicit-only
```

#### Scenario: Optional module skill is unclassified
- **WHEN** an optional-module Distributed Skill has no canonical invocation class after enforcement is enabled
- **THEN** invocation-policy validation fails with the canonical package path

#### Scenario: Experimental skill is unclassified
- **WHEN** an experimental Distributed Skill has no canonical invocation class after enforcement is enabled
- **THEN** its experimental status does not exempt it and validation fails

#### Scenario: Unpaired command owns its class
- **WHEN** a Distributed Command has no paired Distributed Skill
- **THEN** its own frontmatter is the canonical invocation class source

#### Scenario: Paired command disagrees with its skill
- **WHEN** a Distributed Command is paired with a Distributed Skill
- **AND** its Claude invocation restriction disagrees with the skill's canonical class
- **THEN** pairing validation fails with both entry paths

#### Scenario: Dotted top-level key is substituted
- **WHEN** frontmatter declares `metadata.dhpk-invocation-class` as a dotted top-level key instead of the nested mapping
- **THEN** invocation-policy validation fails with the entry path and expected YAML shape

### Requirement: Invocation classes are not inferred
Classification SHALL be an explicit reviewed decision. Validators and generators SHALL NOT infer or default a class from descriptions, current runtime flags, command names, or installed/enabled status.

#### Scenario: Existing flags appear consistent
- **WHEN** a skill has matching Claude and Codex runtime flags but lacks `metadata.dhpk-invocation-class`
- **THEN** report-only migration identifies it as unclassified and enforcement later fails rather than adopting those flags as canonical

### Requirement: Explicit-only entries require direct human invocation
An explicit-only entry SHALL NOT be selected or programmatically invoked by a model. Advisory routing guidance SHALL NOT instruct a model to call an explicit-only entry through a generic Skill tool; it SHALL either remain silent or present the exact supported human command. Setup, installation, credentials or session configuration, apply, release, commit, push, pull-request creation, deployment, publication, external-write, batch-governance, and high-authority orchestration entries SHALL be assigned reviewed canonical `explicit-only` metadata based on their maximum normal authority.

#### Scenario: Natural language resembles a release workflow
- **WHEN** the user discusses release planning without explicitly asking to run the release skill or command
- **THEN** the model may explain or recommend the workflow but does not invoke the explicit-only release entry

#### Scenario: User directly invokes an explicit-only skill
- **WHEN** the user supplies its exact supported callable syntax
- **THEN** the workflow may run subject to its own confirmation, permission, and verification gates

#### Scenario: Lower-authority flag exists
- **WHEN** an entry can commit or publish on one normal path but has a read-only flag
- **THEN** its fixed class remains explicit-only

#### Scenario: High-authority entry lacks reviewed metadata
- **WHEN** a high-authority entry has no canonical class
- **THEN** validation reports it as unclassified rather than defaulting it to explicit-only

#### Scenario: Advisory hook matches an explicit-only entry
- **WHEN** an advisory hook matches a route whose canonical class is `explicit-only`
- **THEN** the hook does not suggest calling the Skill tool
- **AND** any emitted guidance contains the exact human invocation syntax

### Requirement: Implicit-eligible skills remain task-routable
An implicit-eligible skill SHALL carry model-facing routing cues that identify positive triggers, exclusions, and expected output. Model invocation SHALL remain within the authority and scope of the user's request.

#### Scenario: Bug diagnosis request matches investigation
- **WHEN** the user asks for root-cause diagnosis and does not authorize a fix
- **THEN** the model may invoke the investigation skill but SHALL NOT broaden the task into implementation

#### Scenario: Authorized local edit uses a discipline
- **WHEN** the user has requested an in-scope implementation and an implicit-eligible discipline needs reversible workspace edits to fulfill that request
- **THEN** the discipline may make those edits subject to existing gates
- **AND** it does not commit, publish, write externally, or expand scope

### Requirement: Explicit-only workflows call only implicit-eligible disciplines automatically
An explicitly invoked workflow MAY invoke implicit-eligible skills or agents needed to fulfill its explicit contract. It SHALL NOT invoke another explicit-only workflow; that edge requires the exact supported invocation to be presented to the user.

#### Scenario: Apply workflow reaches code review
- **WHEN** an explicitly invoked apply workflow requires an implicit-eligible review discipline
- **THEN** it may dispatch that review without a second workflow invocation

#### Scenario: Workflow wants to start release
- **WHEN** one explicit-only workflow reaches a separate explicit-only release workflow
- **THEN** it presents the exact release invocation and waits instead of invoking it

### Requirement: Distributed entries remain human-invocable
Both invocation classes SHALL remain directly human-invocable. Claude `user-invocable: false` SHALL fail validation for a Distributed Skill or Distributed Command until both supported harnesses can represent and validate a model-only class.

#### Scenario: Skill is hidden from human invocation
- **WHEN** a Distributed Skill declares `user-invocable: false`
- **THEN** invocation-policy validation fails even when the skill is implicit-eligible

### Requirement: Reclassification preserves explicit names
Changing a skill's invocation class SHALL NOT rename its skill or command. Any reduction in implicit availability SHALL be documented with the stable explicit invocation syntax.

#### Scenario: Skill becomes explicit-only
- **WHEN** a previously implicit-eligible skill is reclassified as explicit-only
- **THEN** its prior explicit name remains callable and migration documentation explains that automatic selection is disabled
