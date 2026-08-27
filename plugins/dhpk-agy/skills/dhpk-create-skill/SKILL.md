---
name: dhpk-create-skill
argument-hint: '<skill-name> [docs-path]'
description: 'Creates a new Claude Code skill, or refactors an existing one to dhpk conventions (lean SKILL.md + progressive disclosure, trigger-rich description, validation gate), from a request to "create a skill", "make a skill", "refactor this skill", or to capture a workflow as a reusable skill. Not for: writing a slash command (use command-creator) or auditing skill quality only (use /check-skill). Output: a validated skill package with an explicit diff summary and routing/verification evidence.'
disable-model-invocation: true
metadata:
  dhpk-invocation-class: explicit-only
---

# Create Skill

Author or refactor a skill so it triggers reliably, loads lean, and passes the
health check. Backs the `/dhpk:dhpk-create-skill <skill-name> [docs-path]` command.

Use the external `writing-for-agents` 1.2.x reference for universal pointer,
hierarchy, completion, leading-word, and pruning mechanics. The repository pin
and public source are recorded in `docs/agent-guidance/writing-for-agents.md`.
This skill keeps only dhpk packaging, routing, and validator decisions.

## When NOT to Use

- Writing a slash command rather than a skill — use `command-creator`.
- Auditing skill quality only, with no authoring — use `/check-skill` / `dhpk-skill-health-audit`.
- Searching for an existing skill to adopt — use `dhpk-skill-scout` (Step 0 calls it).

## Step 0 — Search first (avoid duplication)

Before writing anything, run the `dhpk-skill-scout` skill to check for an existing
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
naturally (`dhpk-create-skill`, `dhpk-adaptive-dev-workflow`).
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

### Source and format matrix

Before authoring a technical claim, resolve the current authoritative source:
query Context7 for an indexed library, SDK, API, or CLI; otherwise use the
owning official documentation. Record the source identity, version or retrieval
date, query or URL, claims covered, and the repository/consumer format checks
that will prove the result. If the source or validator is unresolved, mark the
claim `NOT VERIFIED` and keep it out of normative guidance until an owner
decides.

## Step 4 — Write the files

- Author `SKILL.md` with the frontmatter from Step 2 and a numbered, verifiable
  workflow. Use guard-clause / single-level-of-abstraction prose.
- Add `references/` files for anything that would bloat the entry point.
- No emojis in the skill body. Cross-link related skills with their names.

## Step 5 — Validate (mandatory gate)

Run the health check and fix what it flags before declaring done:

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/run-skill.sh" dhpk-skill-health-audit skill-lint.js --fix-hint
```

or invoke `/check-skill <name>`. Iterate until routing, progressive-loading, and
verification criteria pass.

## Output

- A `skills/<name>/` package: `SKILL.md` (frontmatter + lean workflow) plus
  optional `references/` and `scripts/`.
- A summary of what was created or changed (refactor mode: surface every diff to
  existing trigger phrasing or cross-skill links).
- A clean `dhpk-skill-health-audit` run (routing, progressive-loading, verification).

## Verification

- [ ] `dhpk-skill-scout` ran; no duplicate exists (or fork rationale recorded).
- [ ] `name` matches the directory; `description` has what-it-does + triggers + "Not for:".
- [ ] `SKILL.md` under the line budget; deep detail moved to `references/`.
- [ ] `/check-skill` (or `dhpk-skill-health-audit`) passes clean.
- [ ] Invocation/context cost and conditional reference branches are explicit.
- [ ] Completion is checkable and no-op, duplication, and sediment were pruned.
