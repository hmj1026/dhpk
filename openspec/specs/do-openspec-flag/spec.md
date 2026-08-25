# do-openspec-flag Specification

## Purpose
TBD - created by archiving change codex-flow-parity-and-do-openspec-flag. Update Purpose after archive.
## Requirements
### Requirement: /dhpk:do accepts an --openspec flag

`/dhpk:do` SHALL accept an optional `--openspec` flag (alias `--opsx`). The flag SHALL be
detected and **stripped** from the request text before route matching, so the cleaned query
never contains it and `scripts/lib/route-table.json` / `scripts/lib/pre-route.sh` remain
untouched — identical to the `--plan` and `--codex` strip-before-match contract. When
present, it SHALL set `OPENSPEC=on`; otherwise `OPENSPEC=off`.

#### Scenario: Flag is parsed and stripped
- **WHEN** a user runs `/dhpk:do --openspec "add feature X"`
- **THEN** `OPENSPEC=on` is set
- **AND** the cleaned query passed to `pre-route.sh` is `add feature X` with no `--openspec`
  token
- **AND** the alias `--opsx` behaves identically

#### Scenario: Flag absent leaves behavior unchanged
- **WHEN** a user runs `/dhpk:do "add feature X"` with no flag
- **THEN** `OPENSPEC=off` and routing/behavior is unchanged from today

### Requirement: --openspec forces the artifact-then-review flow on implementation routes

`/dhpk:do` SHALL, when `OPENSPEC=on` and the resolved route is one of the
change-authoring route (`adaptive-dev-workflow`), discover
whether the external OpenSpec authoring entries are available to Claude's Skill tool.
When both are model-callable, it SHALL invoke `openspec-new-change` followed by
`openspec-ff-change`. When either is explicit-only or unavailable to model invocation,
it SHALL present the matching exact human command and stop without programmatically
invoking that entry. The human-facing Claude aliases `/opsx:new` and `/opsx:ff` SHALL
NOT be passed to the generic Skill tool. Codex guidance for the same operations SHALL
use `$dhpk:openspec-new-change` and `$dhpk:openspec-ff-change` on the verified dhpk
surface, or the unprefixed forms only when a standalone local surface has been
verified.

After emitting proposal, design, specs, and tasks, `/dhpk:do` SHALL stop and wait for human
review instead of proceeding to implementation. The `opsx-apply-goal` route SHALL be
excluded from this set: it applies an existing change and emits a `/goal` string for a
fresh session, so forcing a new change there is contradictory. For any other resolved
route, including `opsx-apply-goal`, `/dhpk:do` SHALL print a single literal
`--openspec ignored: ...` line and proceed unaffected.

#### Scenario: Implementation route uses canonical Skill IDs and stops
- **WHEN** `OPENSPEC=on` and the route resolves to `adaptive-dev-workflow`
- **AND** both OpenSpec authoring entries are available to the Skill tool
- **THEN** `/dhpk:do` invokes `openspec-new-change` then `openspec-ff-change` through Claude's Skill tool
- **AND** it does not pass `opsx:new` or `opsx:ff` to the Skill tool
- **AND** it stops for human review without starting implementation

#### Scenario: OpenSpec authoring entry is explicit-only
- **WHEN** `OPENSPEC=on` and a required OpenSpec authoring entry cannot be invoked by the Skill tool
- **THEN** `/dhpk:do` presents the matching exact `/opsx:*` command and waits
- **AND** it does not bypass the entry's invocation restriction or edit its generated metadata

#### Scenario: Human-facing and Codex guidance retain their own syntax
- **WHEN** the artifact flow is documented for direct use
- **THEN** Claude guidance uses `/opsx:new` and `/opsx:ff`
- **AND** dhpk Codex guidance uses `$dhpk:openspec-new-change` and `$dhpk:openspec-ff-change`
- **AND** standalone `$openspec-new-change` and `$openspec-ff-change` are shown only when that local surface is verified

#### Scenario: Non-authoring route ignores the flag
- **WHEN** `OPENSPEC=on` and the route resolves to a non-authoring skill such as a review or exploration command
- **THEN** `/dhpk:do` prints a literal `--openspec ignored: ...` line
- **AND** proceeds with the resolved route unaffected

#### Scenario: opsx-apply-goal route is excluded
- **WHEN** `OPENSPEC=on` and the route resolves to `opsx-apply-goal`
- **THEN** `/dhpk:do` prints a literal `--openspec ignored: ...` line because it applies an existing change
- **AND** proceeds with the normal `opsx-apply-goal` behavior

### Requirement: --openspec takes precedence over --plan

When both `--openspec` and `--plan` are supplied, `--openspec` SHALL take precedence: the
pre-implementation planner consult is skipped because the flow terminates at artifact
generation and human review. This precedence SHALL be documented in the `/dhpk:do` Notes and
the OpenSpec routing SSOT in `rules/execution-policy.md`.

#### Scenario: Both flags supplied
- **WHEN** a user runs `/dhpk:do --plan --openspec "add feature X"` on an implementation route
- **THEN** the `--openspec` artifact-then-review flow runs
- **AND** the `dhpk:planner` consult does not run

#### Scenario: SSOT documents the override
- **WHEN** a reader consults the OpenSpec routing SSOT table in `rules/execution-policy.md`
- **THEN** it states that `--openspec` force-selects the "create a change" (`y`) path,
  overriding the per-type ask behavior
