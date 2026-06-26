---
name: create-skill
argument-hint: '<skill-name> [docs-path]'
description: 'Create a new Claude Code skill or refactor an existing one to dhpk conventions (lean SKILL.md + progressive disclosure, trigger-rich description, validation gate). Use when the user asks to "create a skill", "make a skill", "refactor this skill", or wants to capture a workflow as a reusable skill. Not for: writing a slash command (use command-creator) or auditing skill quality only (use /check-skill).'
---

# Create Skill

Author or refactor a skill so it triggers reliably, loads lean, and passes the
health check. Backs the `/create-skill <skill-name> [docs-path]` command.

## Step 0 — Search first (avoid duplication)

Before writing anything, run the `skill-scout` skill to check for an existing
local / marketplace / GitHub / community skill that already covers the workflow.
Adopt or fork a vetted match instead of duplicating it. Only proceed to create
when nothing suitable exists.

## Step 1 — Create vs refactor

- **No `skills/<name>/` dir** → create mode (scaffold from scratch).
- **Dir exists** → refactor mode: read the current `SKILL.md` first, preserve its
  trigger phrasing and any cross-skill links, then apply the conventions below.
  Do not silently drop existing behavior — surface what you change.

## Step 2 — Anatomy & naming

```
skills/<name>/
  SKILL.md            # entry point — frontmatter + lean workflow
  references/         # optional: deep detail loaded on demand
  scripts/            # optional: runnable helpers
```

- **name**: kebab-case, matches the directory, ≤ 40 chars, verb-led where it reads
  naturally (`create-skill`, `bug-fix`).
- **description** (the single most important field — it is how the skill gets
  selected): third person, one sentence of *what it does* + explicit **triggers**
  (the phrases a user would say) + a **"Not for:"** clause that fences it off from
  neighboring skills. Mirror the style of sibling skills in this repo.

## Step 3 — Progressive disclosure

- Keep `SKILL.md` **lean** (target < 200 lines, hard ceiling per repo policy).
  It is loaded into context on selection — every line costs tokens.
- Push deep detail (long tables, code catalogs, edge-case matrices) into
  `references/*.md` and link to them; the model reads them only when needed.
- One responsibility per skill. If it sprawls into two jobs, split it.

## Step 4 — Write the files

- Author `SKILL.md` with the frontmatter from Step 2 and a numbered, verifiable
  workflow. Use guard-clause / single-level-of-abstraction prose.
- Add `references/` files for anything that would bloat the entry point.
- No emojis in the skill body. Cross-link related skills with their names.

## Step 5 — Validate (mandatory gate)

Run the health check and fix what it flags before declaring done:

```bash
bash scripts/run-skill.sh skill-health-check skill-lint.js --fix-hint
```

or invoke `/check-skill <name>`. Iterate until routing, progressive-loading, and
verification criteria pass.

## Verification

- [ ] `skill-scout` ran; no duplicate exists (or fork rationale recorded).
- [ ] `name` matches the directory; `description` has what-it-does + triggers + "Not for:".
- [ ] `SKILL.md` under the line budget; deep detail moved to `references/`.
- [ ] `/check-skill` (or `skill-health-check`) passes clean.
