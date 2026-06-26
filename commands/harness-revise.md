---
description: 'Trim, dedupe, and validate the Claude harness via harness-revise'
argument-hint: '[--baseline | --scan | --apply | --verify]'
allowed-tools: 'Read, Grep, Glob, Bash, Task'
---

# /harness-revise

Trim and validate the project harness via the deterministic scripts + the `harness-revise` skill + the `harness-reviser` agent. Reproduces the methodology from the 2026-05-13 harness trim pass so future runs can re-execute the same workflow without re-deriving the gap taxonomy.

> Different from `/harness-audit` (which scores via `scripts/harness-audit.js` against a 7-category rubric). This command focuses on **trim, dedupe, and validate**.
>
> See also: `/harness-govern` runs the end-to-end audit -> fix loop and routes its fix step here (`--apply`).

Read and follow the cross-LLM skill before executing this command:

@skills/harness-revise/SKILL.md

## Usage

```
/harness-revise [--baseline | --scan | --apply | --verify]
```

- `--baseline` (default if no flag): run all three scripts and emit the inventory + scenario + test-harness numbers. AI does NOT propose any changes.
- `--scan`: baseline + AI gap-walk against the G1–G13 taxonomy. Produces a ranked proposal table. No edits.
- `--apply`: requires the latest `--scan` proposal in context (or run scan first). AI applies the approved fixes one at a time, re-running the matching script after each fix.
- `--verify`: re-run the three scripts only. Use after an external change to confirm the harness still passes.

## Deterministic Engine

Three scripts must always run first; output is the source of truth.

```bash
bash "${CLAUDE_PLUGIN_ROOT}/skills/harness-revise/scripts/harness-inventory.sh" --dir .claude   # counts, JSON validity, cross-refs, mixed-lang
bash "${CLAUDE_PLUGIN_ROOT}/skills/harness-revise/scripts/harness-scenarios.sh" --dir .claude   # trigger/guard/lifecycle scenarios
bash "${CLAUDE_PLUGIN_ROOT}/skills/harness-revise/scripts/test-harness.sh" --dir .claude        # hook contract tests
```

> The scripts ship inside the plugin. `${CLAUDE_PLUGIN_ROOT}` is resolved by Claude Code to the plugin install path at runtime, so these run regardless of the project's cwd. For non-Claude environments (Gemini / Codex), the `harness-revise` skill resolves the same scripts via `${CLAUDE_SKILL_DIR:-.agents/skills/harness-revise}`.

Acceptance gate — `--apply` may only proceed when:
- `harness-scenarios.sh` reports `TOTAL: PASS=N FAIL=0`
- `test-harness.sh` reports `PASS: N / N` at the current ceiling (project-specific; e.g. zdpos `.claude` is 101/101)

A failing baseline means a prior regression exists; investigate that first.

## Workflow (5 phases)

The `harness-revise` skill encodes the full methodology. At a high level:

1. **Baseline** — run scripts, snapshot numbers
2. **Identify** — walk inventory + memory of trim history against the canonical gap taxonomy (G1–G13)
3. **Propose** — emit ranked table (ID, severity, effort, location, action), wait for user approval
4. **Apply** — minimal edit per fix, re-validate via the matching script after each one
5. **Final validate** — all three scripts pass; spawn `code-reviewer` on the diff; address MED/HIGH findings; clear the sentinel

## Agent Routing

| Phase | Tool / Agent |
|-------|--------------|
| Baseline + Scan | main agent + `harness-revise` skill + 3 scripts |
| Heavy refactor decisions | spawn `harness-reviser` agent (already wired to this skill) |
| Final review | `code-reviewer` agent (hook auto-flags `.pending-review`) |

## Output Contract

The skill defines the response shape. Reply must include, in order:

1. Baseline numbers (always-on lines, scenarios PASS, test-harness PASS)
2. Gap table with canonical IDs (G1–G13)
3. Fixes applied (file:line range per fix)
4. Post-fix numbers (with deltas)
5. Code-reviewer verdict + finding count
6. Deferred items with explicit IDs and reason

## Anti-patterns

- Running `--apply` without an explicit `--scan` proposal table in context
- Inventing new gap IDs instead of extending the taxonomy in the skill file
- Translating zh-TW in business code or commit messages (project communication stays zh-TW per `CLAUDE.md`)
- Skipping the post-apply `code-reviewer` run

## Arguments

$ARGUMENTS: `--baseline` (default) | `--scan` | `--apply` | `--verify`
