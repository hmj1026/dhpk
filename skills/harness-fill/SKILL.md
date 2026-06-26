---
name: harness-fill
description: 'Explore-driven meta-workflow SSOT: 5-phase parallel inventory → fill in .claude/ infrastructure. Use when: user explicitly invokes /harness-fill to backfill .claude/skills/agents/rules + per-layer CLAUDE.md (one-shot, ≤3 Explore agents in parallel per round). Not for: single-file patches (use Edit), specific symbol lookups (use cx definition / gitnexus_impact), PR review (route through the sentinel chain to the matching reviewer agent). Output: list of created / modified files + conventional commit message draft.'
argument-hint: '[--layers <list>] [--dry-run] [<extra task description>]'
allowed-tools: 'Read, Grep, Glob, Bash, Agent'
model: opus
effort: high
disable-model-invocation: true
---

# Harness-Fill — Explore-Driven Project Knowledge Backfill

Meta-workflow SSOT. Triggered by the `/harness-fill` command; not auto-loaded by description matching (`disable-model-invocation: true`) — entry MUST be via explicit `/harness-fill`.

## When to use / When NOT to use

| Scenario | Use harness-fill? | Alternative |
|---|---|---|
| New-team onboard / `.claude/` infrastructure not yet built | ✅ | `/repo-intake` (run project map cache first) |
| `.claude/` is outdated after a large refactor | ✅ | `/harness-revise` (trim first, then consider backfill) |
| Fill in one specific layer's CLAUDE.md (e.g. `domain/CLAUDE.md` missing) | ✅ (`--layers domain`) | Manual Edit (if content is already known) |
| Fix one controller action / bug | ❌ | `/bug-fix` / `/feature-dev` |
| Look up a specific function / usage | ❌ | `cx definition` / `gitnexus_query` |
| Change is known to affect only 1-2 skills | ❌ | Edit the matching SKILL.md directly |
| `.claude/` is already saturated, no real gaps | ❌ | `/harness-audit` to read the score |

## Workflow (5 phases)

```
Phase 1  Main-agent inventory
    └─ cx overview + key files + identify tech stack / layers / high-risk zones / existing .claude/ gaps
Phase 2  Parallel dispatch ≤3 Explore agents
    └─ Split by topic; each agent prompt must include scope + tool priority + 8-item output contract
Phase 3  Consolidate + de-duplicate
    └─ Re-check conflicting conclusions with cx definition / Read specific sections; ground truth is code
Phase 4  Build .claude/ infrastructure
    └─ skills / agents / rules — three product types; frontmatter & line contracts in references
Phase 5  Write / fill in CLAUDE.md
    └─ root + per-layer (project-specific layers — e.g. domain / infrastructure / presentation, or src / app / lib)
```

## Phase 1: main-agent inventory

### Tool priority (Hard rule)

`cx overview <file|dir>` (≈200 token) > `cx definition --name X` (≈500 token) > `Read` (full 800-line file ≈ 6,000 token). **>200-line files: direct Read prohibited.** Read is only for "needs ≥5 consecutive methods" OR "file <100 lines AND cx overview already confirmed".

### Must-check list

- `CLAUDE.md` (root) and per-layer: e.g. `domain/CLAUDE.md`, `infrastructure/CLAUDE.md`, `presentation/CLAUDE.md` (or whatever the project's actual layers are) — mark gaps where missing
- `.claude/agents/INDEX.md`, sample 1-2 existing agent .md
- `.claude/commands/INDEX.md`, `.claude/skills/` directory listing + representative SKILL.md
- `.claude/rules/execution-policy.md`, `.claude/rules/tool-routing.md` (or `${CLAUDE_PLUGIN_ROOT}/rules/` if dhpk-installed)
- Post-edit hook(s) (where sentinels and reviewer chains are wired) — e.g. `.claude/hooks/post-edit-*.sh` or dhpk's `post-edit-dispatch.sh`
- README, `docs/` directory (`rg --files docs/` or `cx overview docs/`)
- `openspec/` directory (if present)
- Build / dependency configuration: `package.json` / `composer.json` / `phpunit.xml` / `Cargo.toml` / `pyproject.toml`
- CI configuration: `.github/workflows/` / `Makefile`
- Entry points: `index.php` / `app.js` / `main.py` / `cmd/` / project equivalent
- Top-level recon: `rg --files | head -200` + `cx overview <core-dir>`

### Identify and record

- Primary tech stack (language / framework / version constraints — e.g. PHP 5.6 forbidden syntax)
- Execution mode (local dev / docker / CLI entry point)
- Test mode (framework, `docker exec` command format if any)
- Code layering (DDD / MVC / hexagonal / other)
- Core business domains and key module boundaries
- High-risk zones (security / financial calculation / high-volume tables / external API)
- Existing `.claude/` gaps (which skill / rules / agent are not yet built)

## Phase 2: parallel Explore-agent dispatch

≤3 parallel per round (single message, multiple Task calls); after one round completes, continue with the next, until all directions are analysed.

### Splittable directions (skip if not applicable; further split if too large)

Architecture & directory structure / local dev & build / testing & QA / frontend UI / backend API / data layer / integrations & external services / security & authorization / ops & release / existing tools & reuse points / historical docs & implicit conventions.

### Each Explore-agent prompt MUST include

1. **Scope**: explicit directories / files / boundaries, non-overlapping with other agents
2. **Tool priority**: cx overview > cx definition > Read (>200 lines: no direct Read; <100 lines + cx overview confirmed = Read OK)
3. **Expected 8-item output** (see below)

### Each Explore-agent output contract (8 items)

1. Scope: which directories / files / config / tests were actually read
2. Key facts: capabilities / patterns / tools / conventions already present in the project
3. Hard rules / implicit constraints / version constraints downstream AI MUST know
4. Easy-to-mis-edit / re-invent / overlook spots
5. Suggested target CLAUDE.md layer (root / per-layer)
6. Suggested new / updated `.claude/skills/` (name + trigger scenario + SKILL.md section outline)
7. Suggested new `.claude/rules/` (filename + core hard rule)
8. Unconfirmed info (needs main-agent second-pass verification)

## Phase 3: consolidate + de-duplicate

- Remove duplicates / conflicts / generic descriptions
- Conflicting conclusions: re-verify with `cx definition --name X` or `Read` of the specific section
- Ground truth is code
- Categorise into 6 action lists: root CLAUDE.md / per-layer CLAUDE.md / skills / rules / agents (+ INDEX.md sync) / memory

### Filtering principles

- Don't pile into one giant skill; split by real development scenarios (each SKILL.md 150–250 lines)
- Increment existing valid content, **don't** brute-overwrite
- Only build skill / rules with project specificity; don't build generic-engineering advice
- Every rule must be traceable to a code fact or a historical incident

## Phase 4: build .claude/ infrastructure

Frontmatter templates + required sections per product type → `references/frontmatter-templates.md`.

### Line contracts (Hard rule)

| Product | Line limit | Over-limit means |
|---|---|---|
| SKILL.md | 250 | Scope too large; split; extract heavy reference into `references/` |
| agent .md | 143 | Role responsibilities impure; split agent |
| rule .md | 124 | Rule scope too broad; split topic |

### New agent → must sync

1. `.claude/agents/INDEX.md`: add row to the Mandatory Chain or Situational table
2. Execution-policy rule (project's own `.claude/rules/execution-policy.md` or cross-ref to `${CLAUDE_PLUGIN_ROOT}/rules/execution-policy.md`): Agent dispatch table → add trigger; Mandatory post-steps → add sentinel (if any)
3. Post-edit hook: if the agent is sentinel-triggered, add path pattern → sentinel mapping

### New command → must sync

- `.claude/commands/INDEX.md`: add to matching category table
- Execution-policy rule "Skill priority" section (if high-frequency trigger)

## Phase 5: write / fill in CLAUDE.md

### Root CLAUDE.md required sections (in order)

1. Project intro (one sentence + primary tech stack with version constraints)
2. Rule priority (System → User → CLAUDE.md → `.claude/rules/*.md` → load-on-demand docs)
3. Communication (reply language / code comment language / domain term retention in source language)
4. Core rules: SSOT / Read-before-write (cx > gitnexus > Read) / No auto-commit / language version constraints
5. Key references table (Topic → File): execution-policy / tool-routing / sub-agent prompt template / agent roster / MCP server inventory / language patterns / frontend rules / per-layer CLAUDE.md
6. Settings split (`settings.json` shared / `settings.local.json` gitignored / `.harness-profile` optional)
7. (Optional) GitNexus section (if code index has been built)

### Per-layer CLAUDE.md (whatever layers the project actually has)

Each ≤40 lines, must include:

- Title: `# CLAUDE.md (<layer>)`
- `Local rules for <path>/`; cross-reference root
- Purpose (this layer's responsibility boundary)
- Read this when (scenarios)
- Local truths (naming / directory / pattern / data flow / anti-patterns)
- Avoid / Escalate (forbidden content / escalation notice)
- Related files (cross-reference other layers + key rules)

## Output Contract (reply shape)

Reply must include (in order):

1. Phase 1 inventory summary (tech stack / layers / high-risk zones / existing `.claude/` gaps)
2. Phase 2 list of dispatched Explore agents and their boundaries
3. Phase 3 consolidated 6-category action list
4. Phase 4-5 list of created / modified files (paths + line counts)
5. Suggested conventional commit message draft (`docs:` or `feat:` prefix)
6. Unconfirmed items needing second-pass verification

## Anti-patterns / Hard limits

- ❌ Skip `cx overview` and direct-Read a large file (>200 lines: hard prohibition)
- ❌ Dispatch more than 3 Explore agents per round (parallel cap)
- ❌ Explore-agent boundaries overlap / duplicate work
- ❌ Pile all outputs into one giant skill
- ❌ Brute-overwrite existing `.claude/` content (must be incremental)
- ❌ Auto `git add / commit / push / stash`
- ❌ Output generic-engineering advice (must be project-specific + traceable)
- ❌ Make up rules inside SKILL.md / agent .md / rules .md
- ❌ Add new agent without syncing INDEX.md and execution-policy.md

## Verification checklist

- [ ] Phase 1 used `cx overview`; no direct Read on files >200 lines
- [ ] Phase 2 each round ≤3 Explore agents in parallel; non-overlapping boundaries
- [ ] Phase 3 conflicting conclusions re-verified via `cx definition` or specific sections
- [ ] Phase 4 outputs conform to line contracts (SKILL.md ≤250 / agent ≤143 / rule ≤124)
- [ ] Phase 4 new agent synced to `.claude/agents/INDEX.md` + execution-policy + post-edit hook
- [ ] Phase 5 per-layer CLAUDE.md ≤40 lines
- [ ] Every rule / convention is traceable to a code fact (grep / cx evidence)
- [ ] Created / modified file list is in the output
- [ ] Conventional commit message draft is in the output; **NOT** auto-committed

## References

- `references/frontmatter-templates.md` — skill / agent / rule frontmatter templates + required-section lists
