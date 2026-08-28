# cli-prompt-composition Specification

## Purpose
TBD - created by archiving change cli-prompt-composition-and-agy-flags. Update Purpose after archive.
## Requirements
### Requirement: A prompt-composition effectiveness baseline exists alongside the security baseline
The plugin SHALL ship `agent-traps/_common/cli-prompt-composition.md`, an on-demand baseline governing **how** a CLI-backed agent composes the prompt it hands to an external model. It SHALL sit alongside `agent-traps/_common/prompt-defense.md` and follow the same conventions: small, loaded on demand by a one-line directive, and requiring no manifest registration. The file SHALL be organized as a shared section plus one section per target model family (GPT-5.x, Gemini), so that a loader can name the section it needs.

#### Scenario: Baseline is loadable and sectioned
- **WHEN** an agent's prompt-composition step references the baseline
- **THEN** the file exists at `agent-traps/_common/cli-prompt-composition.md` and contains a shared section plus separately addressable GPT-5.x and Gemini sections

#### Scenario: Security and effectiveness baselines are distinct
- **WHEN** a CLI-backed agent loads its prompt-composition guidance
- **THEN** `prompt-defense.md` continues to govern untrusted-content handling and the new baseline governs composition effectiveness, with neither restating the other

### Requirement: Every CLI-backed prompt-composition surface loads the baseline
Each surface that composes a prompt for an external model SHALL carry a load directive naming the baseline's Shared section **and its applicable per-model section**. Shared SHALL always be loaded — only the per-model half is a choice — because Shared carries the discipline (state each instruction once; a flag beats prose) that the per-model sections depend on and do not restate. The surfaces SHALL be `agents/codex-worker.md`, `agents/codex-reasoner.md`, `agents/agy-worker.md`, and `skills/dhpk-codex-bridge/SKILL.md` (legacy alias files `agents/codex-fast-worker.md`, `agents/codex-deep-reasoner.md`, and `agents/agy-fast-worker.md` remain for the compatibility window). The directive SHALL be placed at the prompt-composition step, not the agent preamble, so the load happens when needed.

#### Scenario: Codex-family surfaces name the Shared and GPT-5.x sections
- **WHEN** `codex-worker` (legacy alias: `codex-fast-worker`), `codex-reasoner` (legacy alias: `codex-deep-reasoner`), or the `codex-bridge` skill reaches its prompt-composition step
- **THEN** the directive loads the baseline's Shared and GPT-5.x sections and not the Gemini section

#### Scenario: Agy surface names the Shared and Gemini sections
- **WHEN** `agy-worker` (legacy alias: `agy-fast-worker`) reaches its prompt-composition step
- **THEN** the directive loads the baseline's Shared and Gemini sections and not the GPT-5.x section

#### Scenario: codex-bridge is wired at the skill, not the agent
- **WHEN** the load directive is added for the codex-bridge path
- **THEN** it is placed in `skills/dhpk-codex-bridge/SKILL.md` because `agents/codex-bridge.md` already delegates prompt discipline to that skill, and the agent file gains no competing directive

### Requirement: Composed prompts carry an autonomy boundary and a report shape
A composed prompt SHALL state the autonomy boundary matching the backend's sandbox mode — inspect-and-report for read-only invocations, in-scope-changes-only for write-enabled invocations — and SHALL state the expected report shape (conclusion first, then supporting evidence, then next action). Where the backend CLI provides a flag that enforces either property, the flag SHALL be used and the prompt text SHALL NOT restate it.

#### Scenario: Read-only backend receives an inspect-and-report boundary
- **WHEN** `codex-reasoner` composes a prompt for a read-only sandbox run
- **THEN** the prompt states that the request authorizes inspection and reporting, not modification

#### Scenario: Write-enabled backend receives an in-scope-changes boundary
- **WHEN** `codex-worker` composes a prompt for a workspace-write run
- **THEN** the prompt authorizes the in-scope local changes named by the task spec and no others

#### Scenario: A flag supersedes prompt text
- **WHEN** the backend CLI offers a flag that enforces the boundary or the report shape
- **THEN** the invocation sets that flag and the prompt omits the equivalent prose

### Requirement: Each instruction appears once in a composed prompt
A composed prompt SHALL state each instruction exactly once. Because these prompts are self-contained by design — the backend sees a fresh session — restating a constraint in multiple sections is a recognized failure mode and SHALL be avoided.

#### Scenario: No duplicated instruction blocks
- **WHEN** a composed prompt is inspected
- **THEN** no constraint appears in more than one block

### Requirement: Model-family guidance records its source and version distance
Each per-model section SHALL name its source and SHALL state any version distance between the documented model and the model actually dispatched. Guidance derived from a source already falsified on mechanics SHALL be marked at lower confidence than first-party documentation.

#### Scenario: Version distance is stated
- **WHEN** the Gemini section is derived from documentation covering a different minor version than the dispatched model
- **THEN** the section states the distance rather than presenting the guidance as exact

#### Scenario: Falsified source is down-weighted
- **WHEN** guidance originates from a corpus shown to be wrong about the CLI's actual flag surface
- **THEN** that guidance is marked lower-confidence than first-party documentation and its incorrect examples are excluded from the file

### Requirement: Prompt-composition guidance is verified at the prompt, not the outcome
Verification of this capability SHALL assert on the composed prompt artifact rather than on downstream model behavior. Because each surface writes its prompt to a temp file before invoking the CLI, that file SHALL be the assertion target. Downstream behavior MAY be recorded as an advisory observation but SHALL NOT be the acceptance gate.

#### Scenario: Composed prompt is asserted
- **WHEN** a CLI-backed agent is dispatched during verification
- **THEN** the composed prompt file is inspected and asserted to contain the sandbox-matching autonomy boundary, the report-shape instruction, and no duplicated instruction block

#### Scenario: Downstream behavior is not the gate
- **WHEN** a single dispatch produces no observable behavioral difference
- **THEN** that observation is recorded as advisory and does not by itself fail the change, because no baseline run exists to compare against

### Requirement: The hook-based prompt-rewriting route is recorded as infeasible
The plugin SHALL NOT attempt to rewrite user prompts from a `UserPromptSubmit` hook. That event supports only `additionalContext` injection and `decision: "block"` — it has no prompt-replacement facility — and its payload carries no model identity. This constraint SHALL be recorded so the route is not re-explored.

#### Scenario: No hook rewrites a user prompt
- **WHEN** model-aware prompt optimization is proposed for the interactive session surface
- **THEN** the `UserPromptSubmit` route is rejected on capability grounds and the work is placed where the plugin itself composes the prompt

#### Scenario: Model identity is not read from a prompt-submit payload
- **WHEN** a component needs the active model
- **THEN** it does not read it from `UserPromptSubmit`, whose payload has no `model` field

### Requirement: Reviewer and sweep agents are excluded from generic model guidance
Generic per-model prompting guidance SHALL NOT be applied to the reviewer agents or the spec-bounded sweep agents. Their existing instructions already encode stricter, deliberately-chosen behavior, and the generic guidance contradicts it.

#### Scenario: Reviewer confidence gate is preserved
- **WHEN** generic guidance recommends reporting every finding including low-confidence ones
- **THEN** it is not applied to the reviewer agents, whose confidence gate deliberately filters emission while keeping investigation broad

#### Scenario: Sweep agents keep spec-bounded scope
- **WHEN** generic guidance recommends broadening instruction scope across all occurrences
- **THEN** it is not applied to the spec-bounded mechanical implementers, whose enumerated-path contract makes literal adherence the intended property
