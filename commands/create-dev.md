---
description: Route a substantial change before implementation. Classify workflow type, invoke planning agents, and output the implementation gate checklist. Codex-free by default; --codex for the Codex-enhanced path.
argument-hint: '[--codex] <change description or current state>'
allowed-tools: Read, Grep, Glob, Skill, Agent
---

⚠️ **Must read and follow the skill below before executing this command:**

@skills/adaptive-dev-workflow/SKILL.md

## What This Command Does

Routes a substantial change to the correct workflow before implementation begins. It
classifies the request, invokes the appropriate planning agent, and outputs a gate
checklist that must be satisfied before writing any code. Use this command whenever a
change is more than a one-line patch.

This is the explicit entry point to `dhpk:adaptive-dev-workflow`; `/dhpk:do` also routes
substantial bug/feature tasks here.

## Codex mode

**Codex-free by default** — pure Claude + dhpk agents, no Codex CLI/MCP required, and no
`mcp__codex__*` tool is invoked (this command's `allowed-tools` omits it). Pass `--codex`
for the Codex-enhanced path: per the skill's **Codex mode** table, planning/review steps
delegate to the dedicated `/codex-*` commands, and the `--codex` flag is appended to the
recommended next command (`/dhpk:bug-fix --codex`, `/dhpk:feature-dev --codex`). If
`--codex` is given but Codex is unavailable, warn once and fall back to codex-free.

## Context

- Git status: !`git status -sb`
- Current branch: !`git branch --show-current`

## Workflow

```
Input: change description → Classify type → [Planning agent] → [OpenSpec ask] → Gate checklist + next command
```

Classification, the OpenSpec-ask decision, and the post-implementation gate are the single source of
truth in **@rules/execution-policy.md** — do not restate them here:

- *Change classification & OpenSpec routing (SSOT)* — the six change types (Bug Fix unknown/known,
  Feature Delivery cross-module/normal, Medium change, Lightweight Maintenance), whether each asks
  about OpenSpec, and its planning step.
- *Post-implementation agent gate (SSOT)* — applicable TDD/E2E specialists plus one
  consolidated parallel batch of every sentinel reviewer triggered by the implementation wave.

Classify the request against that table, then proceed to the Task steps below.

## Task

Use the adaptive dev workflow skill to:

1. Classify the request into one of the six change types in the SSOT classification table
2. State which artifacts or gates are required vs skipped
3. **Invoke the planning-phase step immediately** based on classification (codex-free default;
   under `--codex` use the skill's Codex-mode substitutes):
   - `Bug Fix (unknown root cause)` → run the `bug-investigation` skill (`--codex`: `/codex-brainstorm`)
   - `Feature Delivery (cross-module/DDD)` → Agent tool with `subagent_type=dhpk:architect` (`--codex`: `/codex-architect`)
   - Other types → no immediate agent, proceed to next step
4. **Ask the user about OpenSpec** (only for types whose *OpenSpec ask?* column is ✅ in the SSOT table):
   > "此變更是否需要 OpenSpec 文件留存？(y/n，預設 n)"
   - **y** → recommend `/opsx:new` to create `openspec/changes/<change-id>/` artifacts
   - **n** (or no response) → proceed with brief plan, no artifact created
5. Output the **Post-Implementation Agent Gate checklist** defined in
   `@rules/execution-policy.md` → *Post-implementation agent gate (SSOT)*. Mark
   the applicable implementation specialists and sentinel reviewers from the
   classification; reviewers run as one consolidated parallel batch per wave.
   Do not restate the gate — reference the SSOT.
6. Recommend the next workflow, skill, or command (append `--codex` to it when this command was run with `--codex`)

## Important Notes

**NEVER:**
- Skip the classification step and go directly to implementation
- Start writing code before the Gate checklist is output
- Assume a bug's root cause without running `bug-investigation` first
- Invoke `dhpk:architect` for single-module or lightweight changes
- Call any `mcp__codex__*` tool unless `--codex` was passed (default is codex-free)

**DO NOT:**
- Treat this command as an implementation command — it is a routing and planning command only
- Continue if the change description is too vague to classify (ask for clarification instead)

## Error Handling

If classification is ambiguous or the argument is missing:
- Ask the user: "Could you describe the change goal in one sentence, or indicate whether this is a bug, new feature, or cleanup?"

If the referenced skill (`@skills/adaptive-dev-workflow/SKILL.md`) cannot be read:
- Fall back to the Workflow diagram above and proceed with manual classification

If an invoked planning step (`bug-investigation` / `dhpk:architect`) returns an error or produces no output:
- Report the failure, state what was attempted, and recommend the next viable path (e.g., skip to `/opsx:new` with a manual problem statement)

## When to Stop

This command is complete when **all** of the following are true:
1. Classification result is stated (one of the six types)
2. Required vs. skipped gates are declared
3. Planning-phase step has been invoked (if required by classification)
4. OpenSpec question has been asked (if applicable) and user response recorded
5. Post-Implementation Agent Gates Checklist is output
6. Next command or skill is recommended

Stop after step 5. Do not begin implementation.

## Arguments

| Parameter | Description |
|-----------|-------------|
| `--codex` | Use the Codex-enhanced path (planning/review via `/codex-*`; appends `--codex` downstream). Default is codex-free. |
| `<change description or current state>` | The requested change, bug state, or current readiness snapshot |

## Examples

```bash
/dhpk:create-dev "Add refund API to the billing service"
/dhpk:create-dev "Investigate duplicate charge bug before fixing"
/dhpk:create-dev --codex "Add refund API"   # Codex-enhanced planning + review
/dhpk:create-dev "Extract constants from checkout helpers without behavior change"
```
