---
name: harness-budget
description: 'Audits Claude Code context-window token consumption across agents, skills, MCP, rules, and CLAUDE.md; produces prioritized token-savings fixes. Use when: context feels bloated, after adding components, or checking headroom. Not for: trimming harness structure (use harness-revise), backfilling .claude/ (use harness-fill). Output: budget report + ranked fixes.'
---

# Harness Budget (context-window accounting)

Analyze token overhead across every loaded component in a Claude Code session and surface actionable optimizations to reclaim context space.

> See also: `/harness-govern` chains this token audit into an end-to-end harness governance loop.

## When to Use

- Session performance feels sluggish or output quality is degrading
- You've recently added many skills, agents, or MCP servers
- You want to know how much context headroom you actually have
- Planning to add more components and need to know if there's room
- Running `/harness-budget` command (this skill backs it)

## When NOT to Use

- Trimming, deduplicating, or validating harness structure — use `harness-revise`.
- Backfilling missing `.claude/` skills / agents / rules — use `harness-fill`.
- Auditing `.claude/` config health, naming, or hook wiring — use `/claude-health`.
- Reviewing business code — route through the reviewer agents.

## How It Works

### Phase 1: Inventory

Scan all component directories and estimate token consumption:

**Agents** (`agents/*.md`)
- Count lines and tokens per file (words × 1.3)
- Extract `description` frontmatter length
- Extract `model:` + `effort:` frontmatter and the tool list (feeds the Phase 3b tier-economics audit)
- Flag: files >200 lines (heavy), description >30 words (bloated frontmatter)

**Skills** (`skills/*/SKILL.md`)
- Count tokens per SKILL.md
- Flag: files >400 lines
- Check for duplicate copies in `.agents/skills/` — skip identical copies to avoid double-counting

**Rules** (`rules/**/*.md`)
- Count tokens per file
- Flag: files >100 lines
- Detect content overlap between rule files in the same language module

**MCP Servers** (`.mcp.json` or active MCP config)
- Count configured servers and total tool count
- Estimate schema overhead at ~500 tokens per tool
- Flag: servers with >20 tools, servers that wrap simple CLI commands (`gh`, `git`, `npm`, `supabase`, `vercel`)

**CLAUDE.md** (project + user-level)
- Count tokens per file in the CLAUDE.md chain
- Flag: combined total >300 lines

### Phase 2: Classify

Sort every component into a bucket:

| Bucket | Criteria | Action |
|--------|----------|--------|
| **Always needed** | Referenced in CLAUDE.md, backs an active command, or matches current project type | Keep |
| **Sometimes needed** | Domain-specific (e.g. language patterns), not referenced in CLAUDE.md | Consider on-demand activation |
| **Rarely needed** | No command reference, overlapping content, or no obvious project match | Remove or lazy-load |

### Phase 3: Detect Issues

Identify the following problem patterns:

- **Bloated agent descriptions** — description >30 words in frontmatter loads into every Task tool invocation
- **Heavy agents** — files >200 lines inflate Task tool context on every spawn
- **Redundant components** — skills that duplicate agent logic, rules that duplicate CLAUDE.md
- **MCP over-subscription** — >10 servers, or servers wrapping CLI tools available for free
- **CLAUDE.md bloat** — verbose explanations, outdated sections, instructions that should be rules

### Phase 3b: Tier economics (cost-posture audit)

Complements — does not replace — the token-size audit above: it measures **which model tier and effort each role runs on**, not how many tokens the file costs. For every `agents/*.md`, read the `model:` and `effort:` frontmatter and check it against the cost posture in `${CLAUDE_PLUGIN_ROOT}/rules/model-economics.md`. Files without agent frontmatter (e.g. `agents/INDEX.md`) have no tier and produce no row.

Flag a cost-posture mismatch when:
- **Read-only discovery role on opus** — a role whose job is gather/search (read-only tools: `Read`/`Grep`/`Glob`, no `Edit`/`Write`, and a discovery/exploration description) pinned to `opus`. Reasoning roles (`architect`, `deep-reasoner`, `spec-miner`) are NOT discovery roles — they judge, so `opus` is correct for them; do not flag them.
- **Mechanical role at `high` effort** — a write-capable mechanical implementer (e.g. `fast-worker`) or a build-resolver set to `effort: high` where `medium` would pass.
- **High-frequency reviewer on an expensive tier** — a sentinel-driven reviewer pinned above the sonnet floor (`doc-reviewer` above `haiku`, or another reviewer hardcoded to `opus` rather than escalating by judgment per the up-only rule).

Emit a per-role tier/effort table with a cost-posture verdict per row:

| Role | model | effort | tools | posture |
|------|-------|--------|-------|---------|
| `deep-reasoner` | opus | high | read-only | OK (reasoning role, not discovery) |
| `fast-worker` | sonnet | medium | write | OK |
| `doc-reviewer` | haiku | low | ... | OK (cheapest floor) |
| `<role>` | opus | high | read-only | MISMATCH — discovery role on opus → suggest sonnet |

End with a one-line verdict — `Tier economics: N roles OK, M mismatches` — listing each mismatch with the suggested cheaper tier/effort. This pass and the size audit both run and report together; neither overrides the other.

### Phase 4: Report

**Detect the context window first.** The `Effective available context (XX%)`
percentage must be computed against the *actual* model window, not a fixed 200K.
A model id carrying a `[1m]` suffix (e.g. `claude-opus-4-8[1m]`), or a 1M-context
model (Opus 4.x / Sonnet 4.x / Fable 5), uses **1,000,000**; Haiku and legacy
models use **200,000**. Using 200K on a 1M session overstates usage ~5×.

Produce the context budget report:

```
Context Budget Report
═══════════════════════════════════════

Total estimated overhead: ~XX,XXX tokens
Context model: <detected model> (<window> window)
Effective available context: ~XXX,XXX tokens (XX%)

Component Breakdown:
┌─────────────────┬────────┬───────────┐
│ Component       │ Count  │ Tokens    │
├─────────────────┼────────┼───────────┤
│ Agents          │ N      │ ~X,XXX    │
│ Skills          │ N      │ ~X,XXX    │
│ Rules           │ N      │ ~X,XXX    │
│ MCP tools       │ N      │ ~XX,XXX   │
│ CLAUDE.md       │ N      │ ~X,XXX    │
└─────────────────┴────────┴───────────┘

WARNING: Issues Found (N):
[ranked by token savings]

Top 3 Optimizations:
1. [action] → save ~X,XXX tokens
2. [action] → save ~X,XXX tokens
3. [action] → save ~X,XXX tokens

Potential savings: ~XX,XXX tokens (XX% of current overhead)

Tier Economics (cost-posture — from Phase 3b):
┌──────────────────┬────────┬────────┬────────────┐
│ Role             │ model  │ effort │ posture    │
├──────────────────┼────────┼────────┼────────────┤
│ <role>           │ <tier> │ <eff>  │ OK|MISMATCH│
└──────────────────┴────────┴────────┴────────────┘
Verdict: N roles OK, M cost-posture mismatches
```

In verbose mode, additionally output per-file token counts, line-by-line breakdown of the heaviest files, specific redundant lines between overlapping components, and MCP tool list with per-tool schema size estimates. Always return the context-window model, effective available context, component breakdown, ranked issues, savings, tier-economics verdict, and measurement assumptions; keep estimates separate from observed counts.

## Examples

**Basic audit**
```
User: /harness-budget
Skill: Scans setup → 16 agents (12,400 tokens), 28 skills (6,200), 87 MCP tools (43,500), 2 CLAUDE.md (1,200)
       Flags: 3 heavy agents, 14 MCP servers (3 CLI-replaceable)
       Top saving: remove 3 MCP servers → -27,500 tokens (47% overhead reduction)
```

**Verbose mode**
```
User: /harness-budget --verbose
Skill: Full report + per-file breakdown showing planner.md (213 lines, 1,840 tokens),
       MCP tool list with per-tool sizes, duplicated rule lines side by side
```

**Pre-expansion check**
```
User: I want to add 5 more MCP servers, do I have room?
Skill: Current overhead 33% → adding 5 servers (~50 tools) would add ~25,000 tokens → pushes to 45% overhead
       Recommendation: remove 2 CLI-replaceable servers first to stay under 40%
```

## Verification

- [ ] Context window detected from the actual model id (`[1m]` / 1M vs 200K) before computing percentages.
- [ ] All buckets inventoried: agents, skills, rules, MCP tools, CLAUDE.md.
- [ ] Issues ranked by token savings; top 3 optimizations quantified.
- [ ] Potential-savings total reported (tokens + % of current overhead).

## Best Practices

- **Token estimation**: use `words × 1.3` for prose, `chars / 4` for code-heavy files
- **MCP is the biggest lever**: each tool schema costs ~500 tokens; a 30-tool server costs more than all your skills combined
- **Agent descriptions are loaded always**: even if the agent is never invoked, its description field is present in every Task tool context
- **Verbose mode for debugging**: use when you need to pinpoint the exact files driving overhead, not for regular audits
- **Audit after changes**: run after adding any agent, skill, or MCP server to catch creep early

## Prompt Caching

Context budget is about *how much* loads; prompt caching is about *how often it gets reprocessed*. The API caches by exact **prefix match** (no per-file/segment caching) across three layers, stablest first:

| Layer | Content | Invalidated by |
|-------|---------|----------------|
| System prompt | core instructions, **tool definitions**, output style | tool-set change, CC upgrade |
| Project context | CLAUDE.md, auto-memory, unscoped rules | session start, `/clear`, `/compact` |
| Conversation | messages, responses, tool results | every turn (appended at the tail — normal) |

A change anywhere in the prefix reprocesses everything after it. Appending at the tail is free.

### Do (highest-leverage, behavioural)

- **Pin model + effort at the start of a session.** Each model and each effort level has its own cache; switching mid-session reprocesses the whole conversation. **Avoid `opusplan`** — it resolves to Opus in plan mode and Sonnet in execution, so every plan↔execute toggle is a model switch.
- **Don't toggle fast mode mid-task.** The fast-mode header is part of the cache key; turning it on deep into a long session pays a full re-read at fast-mode rates.
- **`/compact` at task boundaries, not mid-task.** To abandon a path, prefer `/rewind` (returns to an already-cached prefix) over `/compact` (builds a new one).
- **Keep MCP servers stable.** On Opus/Sonnet with tool search, MCP tools are *deferred* — a server connecting/disconnecting only appends and is cache-safe. But when tools load into the prefix (Haiku, Vertex, custom `ANTHROPIC_BASE_URL` gateway, or `alwaysLoad`), any server flap busts the cache. A reaper that kills a live parallel session's stdio server is a self-inflicted version of this — reap orphans only (see `reap_stale_mcp_processes`).
- **TTL is automatic.** Claude subscription → 1h TTL (drops to 5m only over the usage limit). API key/Bedrock/Vertex → 5m default; opt into 1h with `ENABLE_PROMPT_CACHING_1H=1`.

### Does NOT affect the cache (don't "optimize" these)

These never enter the API prompt prefix, so they have zero caching impact:

- **statusline scripts** — terminal-only; they *read* `current_usage` to *observe* cache, they don't change it.
- **sentinel / marker files written by hooks** — on disk, not in context unless a tool Reads them.
- **async PostToolUse hooks** (linters, formatters, CRLF fixers) — their output isn't appended to the prefix.
- **SessionStart / UserPromptSubmit hook output** — injected once at the tail; fixed within a session. Dynamic content (timestamp, git counts, learned-context) only affects *cross-session* prefix sharing, never mid-session cache, and CC's own system prompt already varies by git branch + recent commits.

### Verify

Watch the two token counts the API returns each turn (via a statusline reading `current_usage`):

- `cache_read_input_tokens` — served from cache (~10% of input rate)
- `cache_creation_input_tokens` — written to cache (full rate)

Healthy = read stays far above creation. Creation high turn-after-turn = something in the prefix is changing; check the model/effort/fast/MCP/compact triggers above.
