# policy-content-dedup Specification

## Purpose
Keep execution-policy prose compact by assigning normative detail to its
canonical reference files and preserving a single definition for exemptions.
## Requirements
### Requirement: Policy paragraphs whose reference file already exists are summary-plus-pointer, not restatements
`rules/execution-policy.md` SHALL NOT carry a dense restatement of content owned by an existing reference file (`skills/dhpk-execution-policy/references/implementation-dispatch.md`, `references/review-gate-mechanics.md`, `rules/model-economics.md`). Each such block SHALL be at most a 1–2-line normative summary plus the pointer to its owning reference.

#### Scenario: Orchestrator-posture paragraph collapses
- **WHEN** `rules/execution-policy.md` §Implementation dispatch is read after this change
- **THEN** the orchestrator-posture, Repository-Discovery-Gate, and CODEX-peer blocks each occupy ≤2 lines plus a pointer, and their full elaboration exists only in `implementation-dispatch.md`

#### Scenario: Generated blocks are untouched
- **WHEN** the dedup edits are applied
- **THEN** the `<!-- BEGIN GENERATED sentinel-slots -->` agent and sentinel tables are byte-identical to `scripts/ci/gen-slots.js` output and `tests/sentinel-slots.test.js` passes

### Requirement: Mid-task-only policy sections live in references with pointers in the rule body
Sections needed only mid-task (multi-AI independence, in-flight doubt cycle, script test coverage policy, component-addition gate) SHALL live under `skills/dhpk-execution-policy/references/` with a 1-line pointer remaining in `rules/execution-policy.md`.

#### Scenario: Doubt cycle relocated
- **WHEN** a session needs the in-flight doubt cycle detail
- **THEN** it loads the reference file via the rule body's pointer; the rule body itself carries only the pointer line

#### Scenario: No content loss
- **WHEN** each relocated section is diffed against its new reference home
- **THEN** every normative statement from the original section is present in the reference (relocation, not deletion)

### Requirement: The append-only exemption has exactly one normative definition
The Glossary in `rules/execution-policy.md` SHALL be the sole normative definition of the append-only exemption, adopting the stricter condition set (including "no module-level state changes"); `skills/tool-routing/references/decision-tree.md` and `skills/execution-checklist/SKILL.md` SHALL defer to it without restating conditions.

#### Scenario: Drift reconciled
- **WHEN** the three current definition sites are read after this change
- **THEN** only the Glossary lists conditions; the other two sites point to the Glossary

#### Scenario: Reference-integrity guards stay green
- **WHEN** `node scripts/ci/validate-references.js` and `node scripts/ci/catalog.js --check all` run after the dedup
- **THEN** both pass (pointer paths carry the `${CLAUDE_PLUGIN_ROOT}` fallback convention; catalog counts match)
