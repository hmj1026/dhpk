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

### Requirement: Every registered agent has a roster disposition

The implementation evidence SHALL record Keep, Merge-pointer, Retire, or Add for every shipped agent (root `agents/*.md` plus `modules/library-author/agents/polyfill-reviewer.md`). Default disposition is Keep. Merge-pointer SHALL name the surviving SSOT path and SHALL NOT delete the agent file. Retire or Add SHALL NOT proceed unless the table proves a coverage hole or a fully subsumed trigger, `agents/INDEX.md` records the harness-component-gate justification, and plugin registration plus `review_agents` stay consistent.

#### Scenario: Planning default keeps the roster

- **WHEN** the roster audit completes with no proven coverage hole and no fully subsumed trigger
- **THEN** every registered agent is Keep or Merge-pointer and no agent file is deleted

#### Scenario: A retire is attempted without INDEX justification

- **WHEN** a change would delete `agents/<name>.md` without a Keep/Merge/Retire table row and an INDEX justification that remaining agents cover the trigger
- **THEN** the change is incomplete and the agent file remains

#### Scenario: Merge-pointer does not delete the agent

- **WHEN** `code-reviewer` inlines the shared trap-sheet loader and the disposition is Merge-pointer
- **THEN** `agents/code-reviewer.md` remains and the inlined loader steps are replaced by a pointer to `agent-traps/_common/trap-sheet-loader.md`

### Requirement: Shared trap-sheet loader is pointer-not-copy

Generic stack-neutral agents SHALL load `${CLAUDE_PLUGIN_ROOT}/agent-traps/_common/trap-sheet-loader.md` rather than pasting its detection steps. Agent-specific extra signals or module-id remaps (for example a `fastapi` dependency, `vue-2`→`vue`, or frontend/ios stack-id consolidation) SHALL remain in that agent’s trap-sheet section. The loader’s detection order SHALL NOT change in this pass.

#### Scenario: code-reviewer points at the shared loader

- **WHEN** `agents/code-reviewer.md` is rewritten
- **THEN** the shared project-root detection steps are a pointer to `agent-traps/_common/trap-sheet-loader.md` and the `fastapi` extra signal plus module-id remaps remain inline as exceptions

#### Scenario: Loader detection order is unchanged

- **WHEN** the agent prose pass finishes
- **THEN** `agent-traps/_common/trap-sheet-loader.md` compares equal in detection order and stack signals to the pre-pass file

### Requirement: Agent prose exposes role, completion, and named neighbors

Each canonical agent body SHALL state role scope, tools/model entitlement already declared in frontmatter, checkable completion evidence, and the next-role handoff. Neighbor agents or counterpart skills SHALL be named in the description or an opening non-use boundary. The prose pass SHALL NOT change `model`, `tools`, sentinel names, `maxTurns`, or worker-backend selection. Description fence wording MAY change.

#### Scenario: A reviewer names its delegate instead of restating the delegate’s checklist

- **WHEN** `code-reviewer` would otherwise restate OWASP or silent-failure checklists
- **THEN** it names `security-reviewer` or `silent-failure-hunter` as the handoff and does not copy those checklists

#### Scenario: Frontmatter contracts stay stable

- **WHEN** agent prose is rewritten
- **THEN** `name`, `tools`, `model`, `effort`, `maxTurns`, and `skills` compare equal before and after except where a separately specified requirement already mandates a field fix
