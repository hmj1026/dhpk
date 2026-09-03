# skill-invocation-policy Specification

## Purpose
Define one canonical invocation class for every distributed skill and command,
then propagate that classification consistently through paired commands,
consumer metadata, generated projections, and validation evidence.

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

An explicitly invoked workflow MAY invoke implicit-eligible skills or agents
needed for its contract. It SHALL NOT invoke another explicit-only workflow
unless the human invocation carries a reviewed entry-specific delegation. For
`dhpk-do`, `--execute-explicit` delegates only the single resolved target once;
without it the router presents the exact invocation and waits. Authority SHALL
NOT cascade or bypass downstream gates.

#### Scenario: Apply workflow reaches code review
- **WHEN** an explicit apply workflow requires an implicit-eligible review
- **THEN** it may dispatch review without a second human invocation

#### Scenario: Workflow wants to start release
- **WHEN** an explicit workflow reaches an explicit release entry without reviewed delegation
- **THEN** it presents the exact release invocation and waits

#### Scenario: Router receives one-use delegation
- **WHEN** a human invokes `dhpk-do --execute-explicit` and one callable explicit target resolves
- **THEN** that target may run once and authority is unavailable to retry, fallback, or nested explicit targets

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

### Requirement: Retired Codex-MCP entries have no active invocation path

Former Codex-MCP-backed skill identities (`codex-architect`, `codex-implement`, `codex-code-review`, `doc-review`, `test-review`, `codebase-exploration`, `feature-verify`, `issue-analyze`, and `feasibility-study`) SHALL NOT remain active MCP-backed targets. Canonical skills and commands SHALL NOT declare `mcp__codex__codex` or `mcp__codex__codex-reply`. The capability-family retirement SHALL remove `codex-review`, `codex-review-fast`, `codex-review-branch`, `codex-review-doc`, `codex-security`, `codex-test-review`, and `review-spec` rather than retaining aliases; supported review requests SHALL route to `change-verdict` and an explicit CLI second opinion MAY run only through its selected backend. The retired `CODEX=on` and `/dhpk:do --codex` interfaces SHALL be rejected and SHALL NOT route to a peer, worker, reasoner, `codex exec`, or app-server plugin. `check-coverage` remains an explicit-only legacy alias outside the retired command family.

#### Scenario: Model attempts implicit routing to a retired MCP identity

- **WHEN** a user request would otherwise route implicitly to a formerly Codex-MCP-backed skill or removed command
- **THEN** the model selects the backend-neutral `change-verdict` mode or reports the retirement guidance without invoking a removed identity

#### Scenario: User directly invokes a retained Codex review entry

- **WHEN** a user supplies an exact retired command name from the capability-family retirement
- **THEN** the DHPK dispatcher fails closed with the `change-verdict` successor and mode and does not resolve an alias package or command

#### Scenario: A Codex MCP grant remains after retirement

- **WHEN** any canonical skill or command declares `mcp__codex__codex` or `mcp__codex__codex-reply` in its allowed-tools
- **THEN** invocation-policy validation reports the entry as an invalid retired dependency and fails; no frozen-set exception applies

### Requirement: Reviewed capability-family names may use portable identities

A reviewed capability-family consolidation MAY publish an unprefixed kebab-case name when the inventory marks the entry as `portable-family`, the name is unique across canonical and retired identities, and the entry retains a DHPK capability ID and invocation class. Unmarked canonical skills SHALL continue to require the `dhpk-` public-name prefix.

#### Scenario: Declared portable family is validated
- **WHEN** a successor named `skill-scope`, `skill-forge`, `flow-guide`, `flow-drive`, `change-verdict`, or `code-trace` declares `name_style: portable-family`
- **THEN** inventory validation accepts the unprefixed name and validates its canonical path, capability ID, and invocation class normally

#### Scenario: Arbitrary skill drops its prefix
- **WHEN** any other canonical entry uses an unprefixed name without the reviewed portable-family declaration
- **THEN** inventory validation fails and names the invalid public identity
