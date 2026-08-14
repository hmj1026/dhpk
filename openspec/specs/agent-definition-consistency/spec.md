# agent-definition-consistency Specification

## Purpose
TBD - created by archiving change script-test-backfill-and-harness-fixes. Update Purpose after archive.
## Requirements
### Requirement: The INDEX opus rollup lists every opus-model agent

`agents/INDEX.md`'s model-tier summary SHALL list every agent whose frontmatter declares `model: opus`. No opus-tier agent that appears in the roster tables SHALL be omitted from the opus rollup line.

#### Scenario: An opus agent missing from the rollup is added
- **WHEN** `agents/planner.md` declares `model: opus` and appears in the Situational roster table but is absent from the "## Models" opus rollup
- **THEN** the opus rollup line is corrected to include `planner`

#### Scenario: The rollup matches the frontmatter
- **WHEN** the set of agents in the opus rollup is compared with the set of agent files declaring `model: opus`
- **THEN** the two sets are equal

### Requirement: Sentinel-driven reviewer descriptions use consistent MANDATORY-sentinel phrasing

Every agent that is a sentinel-driven mandatory review gate (its body clears a `.pending-*` sentinel) SHALL state that role in its frontmatter description using consistent phrasing — a "MANDATORY final step" clause and an explicit `.pending-*` sentinel reference — matching the phrasing already used by `code-reviewer` / `doc-reviewer` / `polyfill-reviewer`. `database-reviewer` and `security-reviewer`, whose bodies implement the gate but whose descriptions understate it, SHALL be raised to this phrasing.

#### Scenario: An understated sentinel-reviewer description is raised
- **WHEN** `agents/database-reviewer.md` or `agents/security-reviewer.md` has a body that clears a `.pending-*` sentinel but a description with no MANDATORY/sentinel language
- **THEN** its frontmatter description is updated to the consistent "MANDATORY final step … sentinel `.pending-*`" phrasing

#### Scenario: Non-sentinel situational agents are unaffected
- **WHEN** an agent is a non-sentinel situational delegate (e.g. `silent-failure-hunter`, `performance-analyzer`)
- **THEN** this requirement does not force MANDATORY-sentinel phrasing on it

### Requirement: The build-resolver family shares one effort tier

The single-language build-resolver agents (`python-build-resolver`, `rust-build-resolver`, `swift-build-resolver`) share identical tools, the same 3-attempt-then-escalate contract, and the same "hand a green build to code-reviewer" hand-off, and SHALL therefore declare the same `effort` tier unless a divergence is justified with an inline rationale. `swift-build-resolver`'s `effort: high` outlier SHALL be reconciled to `effort: medium` (or carry a documented rationale).

#### Scenario: The effort outlier is reconciled
- **WHEN** `swift-build-resolver` declares `effort: high` while `python-build-resolver` and `rust-build-resolver` declare `effort: medium`, with no stated reason
- **THEN** `swift-build-resolver` is set to `effort: medium` to match the family

#### Scenario: A justified divergence is documented
- **WHEN** a build-resolver legitimately needs a different effort tier
- **THEN** the divergence is accompanied by an inline rationale rather than left unexplained
