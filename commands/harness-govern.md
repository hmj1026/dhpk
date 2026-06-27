---
description: 'End-to-end harness governance loop and single front door for the harness-* family — measure (harness-budget + harness-audit) -> conform to official Claude Code best-practices -> fix (harness-revise) -> verify. Read-only by default; --fix opts into mutations. Safe to /loop.'
argument-hint: '[--fix] [--scope repo|skills|rules|mcp]'
allowed-tools: 'Read, Grep, Glob, Bash, Skill'
---

# /harness-govern

Single orchestrator and **front door for the harness-* family** — runs the governance loop end-to-end by **delegating** to the existing specialists; it adds zero new measurement logic.

> The harness-* family (use a specialist directly when you only need that one concern):
> - `/harness-audit` = deterministic 7-category **score** (read-only). `harness-budget` = **token** accounting. `/harness-revise` = **trim/dedupe/validate** (G1–G13, mutating). `/harness-fill` = one-shot **backfill** of missing `.claude/` infrastructure (onboarding). `claude-health` = `.claude/` hygiene.
> - This command is the **detect -> fix loop** that sequences them and applies the official best-practices lens (the broader reliability/cost/throughput scoring that the former `harness-optimizer` agent did is now this command's conform step).

## Mode (loop-safe)

- **Default = read-only**: Measure + Conform + report. Nothing is mutated, so `/loop /harness-govern` is safe.
- **`--fix`** opts into the mutating Fix step (routes to `/harness-revise --apply`). Never auto-applied without this flag.

## Usage

```
/harness-govern [--fix] [--scope repo|skills|rules|mcp]
```

## Workflow

### Step 1 — Measure (delegate; do NOT re-implement)

- **Precondition** — if `.claude/` is sparse or unbuilt (no agents/skills/rules to govern), this loop has nothing to act on: suggest `/harness-fill` first (one-shot backfill) and stop. `/harness-fill` is onboarding, deliberately *not* part of this maintenance loop.
- Run `Skill(harness-budget)` for token consumption across agents/skills/rules/MCP/CLAUDE.md.
- Run `/harness-audit` (script SSOT: `scripts/harness-audit.js`) for the 7-category scorecard.
- Collect a few raw counts for the conform pass:
  ```bash
  PROJ="${CLAUDE_PROJECT_DIR:-$PWD}"; G="$HOME/.claude"
  echo -n "CLAUDE.md lines: "; wc -l < "$PROJ/CLAUDE.md" 2>/dev/null
  for f in $(find -L "$PROJ/.claude/rules" -name '*.md' 2>/dev/null); do head -8 "$f" | grep -q '^paths:' && s=SCOPED || s=ALWAYS; echo "$s ${f#$PROJ/}"; done
  echo -n "global rules always-on lines: "; find -L "$G/rules" -name '*.md' 2>/dev/null | xargs wc -l 2>/dev/null | tail -1
  ```

### Step 2 — Conform (the only net-new knowledge here)

Judge the measurements against the **official Claude Code best-practices checklist**, mark ✅/⚠️ each:

| Check | Threshold |
|---|---|
| CLAUDE.md lean | < 200 lines; every line passes "removing it would cause a mistake?" |
| rules path-scoping | language/context-specific rules carry `paths:`; only ALWAYS-on the truly cross-cutting |
| skill-surface budget | many skills -> descriptions truncate and lose trigger keywords (`/doctor` to confirm) |
| side-effect skills | `disable-model-invocation: true` for manual/mutating skills |
| MCP | disable unused servers; `/mcp` for per-server cost |
| guardrails | "must happen every time" lives in a hook, not a prompt |
| verification gate | a check Claude can run (test/build) + Stop hook / `/goal` |

Then scan the **five leverage areas** (absorbed from the former `harness-optimizer` agent) and name the top 3 with the highest reliability/cost/throughput payoff — propose minimal, reversible changes for each, but **delegate the edits to the Fix step** (`/harness-revise`); do not mutate here:

| Leverage area | What to look for |
|---|---|
| hooks | must-happen guardrails missing / fragile / firing on the wrong files |
| evals | no runnable check Claude can self-verify against (test/build/goal) |
| routing | triggers/keywords that don't reach the right skill or agent |
| context | token bloat, truncated skill surface, redundant always-on rules |
| safety | dangerous-command coverage, sentinel gates, protected-branch handling |

**Known caveats (cite when relevant):**
- `skillOverrides` does **not** apply to plugin skills — cannot hide them via settings. The `modules` option gates hooks/triggers, **not** the skill listing (issue #12); reduce the *listed* plugin-skill count via whole-plugin `/plugin` disable or by shipping fewer modules.
- claude.ai connectors (Canva/Gmail/Drive/...) are **account-level**; disable via `/mcp`, not a file edit. Only `~/.claude.json` `mcpServers` are file-level.
- `skillListingBudgetFraction` is the **only file-level lever** that stops description truncation across *all* skills (plugin included).

Docs: `code.claude.com/docs/en/{best-practices,features-overview,skills,hooks-guide,mcp,permission-modes,sandboxing}`.

### Step 3 — Fix (only with `--fix`)

- Route deterministic trim/dedupe to `/harness-revise --scan` then `/harness-revise --apply` (G1–G13, with its own acceptance gate + `code-reviewer`).
- List items that **cannot** be auto-applied and need an interactive command: `/doctor` (skill truncation), `/mcp` (disable connectors/servers), `/plugin` (disable plugin components).

### Step 4 — Verify

- Re-run Step 1 measurement; confirm deltas moved the right way.
- `/doctor` shows truncated/dropped skills decreased; `/mcp` shows removed servers gone.
- Spot-check that triggers which should fire still fire (no behavior drift).

## Delegation Routing

| Step | Delegates to |
|------|--------------|
| Measure | `Skill(harness-budget)` + `/harness-audit` (or `/harness-fill` first if `.claude/` is unbuilt) |
| Conform | this command (official best-practices lens + five-leverage-area scan) |
| Fix (`--fix`) | `/harness-revise --scan` -> `--apply` (-> `harness-reviser` agent, `code-reviewer`) |
| Verify | re-measure + `/doctor` + `/mcp` |

## Output Contract

Reply in order: (1) Measure summary (token + 7-category score + counts), (2) Conform checklist with ✅/⚠️ and the relevant caveats, (3) prioritized findings, (4) Fix results if `--fix` else "read-only — pass `--fix` to apply", (5) interactive follow-ups (`/doctor` `/mcp` `/plugin`).

## Anti-patterns

- Re-implementing token/score measurement instead of delegating to `harness-budget` / `/harness-audit`.
- Mutating anything without `--fix`.
- Merging or duplicating the specialist skills — this command only orchestrates; the specialists stay the SSOT.

## Loop

Periodic governance: `/loop 7d /harness-govern` (read-only) or let the model self-pace. Use `--fix` only in attended runs.

$ARGUMENTS: `--fix` (apply trim step) | `--scope repo|skills|rules|mcp` (optional focus)
