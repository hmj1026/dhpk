---
description: "Parallel Explore inventory of a project → fill in .claude/skills/agents/rules + per-layer CLAUDE.md (meta-workflow, one-shot)"
argument-hint: "[--layers <list>] [--dry-run] [<extra task description>]"
allowed-tools: Read, Grep, Glob, Bash, Task
---

# /goal-ex

User-initiated meta-workflow (extended `/goal` — explore-driven). Splits work across multiple parallel Explore subagents to inventory a project's layout, and fills in the `.claude/skills/`, `.claude/agents/`, `.claude/rules/`, and per-layer CLAUDE.md infrastructure so that downstream AI work (refactoring / bug triage / testing / feature extension) hits fewer missing pieces, duplicate inventions, broken architecture assumptions, or wrong defaults.

> Difference vs `/repo-intake`: `/repo-intake` runs a deterministic script and emits a project map cache; `/goal-ex` uses AI multi-agent dispatch + writes into `.claude/` infrastructure.
> Difference vs `/harness-revise`: `/harness-revise` trims / dedupes an existing `.claude/`; `/goal-ex` fills in missing infrastructure.

Must read the skill first:

@skills/goal-ex/SKILL.md

## Usage

```
/goal-ex [--layers <list>] [--dry-run] [<extra task description>]
```

- `--layers all` (default): inventory + fill all layers (project decides what its layers are — common patterns: `app / domain / infrastructure / presentation`, or `src / lib / web / docs`)
- `--layers domain,infrastructure`: scope to specific layers
- `--dry-run`: run Phase 1-3 and emit the proposed action list, **do not write files**
- Extra task description: focus on a specific module / scenario (example: `/goal-ex fill in event-listener docs for the Sales module`)

## Examples

```
/goal-ex
/goal-ex --dry-run
/goal-ex --layers infrastructure --dry-run
/goal-ex re-evaluate alignment between the view layer and frontend.md
```

## When NOT to use

- Single-file patch (use Edit)
- Find a specific symbol / impact radius (use `cx definition` / `gitnexus_impact`)
- PR / commit review (route through the sentinel chain to the matching reviewer agent)
- No independently-analysable module / scenario (subagents have nothing to dispatch on → abort)

## Output Contract

The skill body defines the reply shape, which must include (in order):

1. Phase 1 inventory summary (tech stack / layers / high-risk zones / existing `.claude/` gaps)
2. Phase 2 list of dispatched Explore agents and each one's boundary
3. Phase 3 consolidated, de-duplicated action list (root CLAUDE.md / per-layer / skills / rules / agents / memory)
4. Phase 4-5 list of created / modified files (paths + line counts)
5. Suggested conventional commit message draft (`docs:` or `feat:` prefix)
6. Unverified items needing second-pass investigation

## Anti-patterns

- Skipping `cx overview` and jumping to Read on large files (> 200 lines: hard prohibition)
- Dispatching more than 3 Explore agents at once (parallel cap)
- Overlapping Explore-agent boundaries / duplicating work
- Cramming all outputs into one giant skill (must split by real development scenarios)
- Brute-overwriting existing `.claude/` content (must be incremental)
- Auto `git add / commit / push / stash` (invoke `/smart-commit` and let the user execute)
- Producing generic-engineering advice (must be project-specific + traceable back to code facts)

## Arguments

$ARGUMENTS
