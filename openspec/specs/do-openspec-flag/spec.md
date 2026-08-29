# do-openspec-flag Specification

## Purpose
TBD - created by archiving change codex-flow-parity-and-do-openspec-flag. Update Purpose after archive.
## Requirements
### Requirement: /dhpk:do accepts an --openspec flag

`dhpk-do` SHALL accept `--openspec` and alias `--opsx` through `/dhpk:do` and
`$dhpk-do`, strip recognized tokens before matching, and set `OPENSPEC=on`.

#### Scenario: Flag is parsed and stripped
- **WHEN** either entry receives `--openspec "add feature X"`
- **THEN** matching receives `add feature X` and `OPENSPEC=on`
- **AND** `--opsx` behaves identically

#### Scenario: Flag absent leaves behavior unchanged
- **WHEN** neither flag is supplied
- **THEN** `OPENSPEC=off` and ordinary routing is unchanged

### Requirement: --openspec forces the artifact-then-review flow on implementation routes

On the change-authoring route, `dhpk-do` SHALL preflight the complete external
new-change/fast-forward sequence. When both entries are callable and
invocation-eligible it SHALL run them and stop after proposal, specs, design,
and tasks for human review. If either is explicit-only it SHALL start neither
entry, present the exact first human invocation, and stop. If either is
unavailable it SHALL start neither entry and return terminal `UNAVAILABLE` with
evidence plus optional non-callable resume guidance. `--execute-explicit` SHALL
NOT authorize the compound sequence. External packages remain unchanged. Other
routes emit literal `--openspec ignored: ...`.

#### Scenario: Implementation route uses canonical Skill IDs and stops
- **WHEN** both authoring entries are callable and eligible
- **THEN** the canonical sequence runs and stops at the Planning Review Gate without apply

#### Scenario: OpenSpec authoring entry is explicit-only
- **WHEN** either authoring entry is explicit-only
- **THEN** no partial sequence starts and the exact first human invocation is presented

#### Scenario: OpenSpec authoring entry is unavailable
- **WHEN** either authoring entry is not callable on the active surface
- **THEN** no partial sequence starts and the router returns `UNAVAILABLE` with evidence
- **AND** any resume text is labelled non-callable guidance rather than an executable invocation

#### Scenario: Human-facing and Codex guidance retain their own syntax
- **WHEN** direct syntax is reported
- **THEN** Claude uses verified `/opsx:*` and Codex uses only discovered skill syntax

#### Scenario: Non-authoring route ignores the flag
- **WHEN** the resolved route is non-authoring
- **THEN** one ignore line is printed and routing proceeds

#### Scenario: opsx-apply-goal route is excluded
- **WHEN** the route applies an existing change
- **THEN** one ignore line is printed and normal apply-goal behavior remains

### Requirement: --openspec takes precedence over --plan

On authoring routes, `--openspec` SHALL override `--plan` through either host
entry because the flow stops at human review.

#### Scenario: Both flags supplied
- **WHEN** either entry receives both flags on an authoring task
- **THEN** authoring runs and planner does not

#### Scenario: SSOT documents the override
- **WHEN** routing policy is read
- **THEN** it records authoring precedence and the pre-apply human stop
