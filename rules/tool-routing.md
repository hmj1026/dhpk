# Tool Routing — gitnexus / cx / claude-mem / Read / Grep

SSOT for code exploration in dhpk-using projects. Cross-references the existing `dhpk:tool-routing` skill (richer prose, examples, sub-agent prompt boilerplate); this file is the compact reference card consumable directly from a project's `CLAUDE.md`.

> Tools mentioned (`cx`, `gitnexus`, `claude-mem`) are external — each project decides whether to install them. dhpk does not bundle them. The decision tree below degrades gracefully (fall back to `Grep` / `Read` if the primary tool is not installed).

## Decision tree

| Intent | Primary | Fallback |
|---|---|---|
| What breaks if I edit X? | `gitnexus_impact({target, direction:"upstream"})` | `cx references` |
| Where is X defined? | `cx definition --name X` | `gitnexus_query` |
| File overview (>200 lines) | `cx overview <file>` | `cx definition` for selected functions |
| File <100 lines, full read needed | `Read` (after `cx overview` confirms) | — |
| Find callers | `cx references --name X` | `gitnexus_impact upstream` |
| Global rename / refactor | `gitnexus_rename` | **find-and-replace forbidden** |
| Pre-commit scope check | `gitnexus_detect_changes()` | `git diff --stat` |
| Explore unfamiliar module | `cx overview <dir>` | `gitnexus_query` |
| Past decisions (cross-session) | claude-mem `smart_search` / `search` | `get_observations([IDs])` |
| Plain text / comments / docs | `Grep` | — |

## Tie-breakers

1. **cx > gitnexus** when both apply (cheaper, local, no MCP round-trip)
2. `gitnexus` is the hard rule for `impact` / `detect_changes` / `rename` (when installed)
3. `claude-mem` skips current session (already in scrollback); only for past-session decisions
4. `Read` is the floor — only when nothing else fits

## Investigation order & perspective depth

- **Path-first**: before reading code detail, locate the entry point, trace the call chain (A→B→C), and map data flow (input→transform→output). Analysing logic without its execution context produces local-reasoning misdiagnosis. (code-explore, code-investigate, bug-investigation, gitnexus-exploring)
- **Single vs dual perspective**: default to single-perspective (cx / gitnexus_query / code-explore) for clear errors with a stack trace. Escalate to dual-perspective (code-investigate, issue-analyze + Codex, gitnexus_context) only when findings are uncertain, contradictory, or intermittent, or the decision spans multiple modules. (code-explore, code-investigate, issue-analyze, gitnexus-debugging)
- **Parallel exploration**: for ≥3 independent directions (e.g. frontend + backend + data, or several module boundaries) dispatch ≤3 Explore agents in one turn, each with explicit non-overlapping scope and the cx tool-priority block. Max 3 per round; consolidate before the next round. Not for single-file patches or symbol lookup. (goal-ex, adaptive-dev-workflow)

## gitnexus_impact timing

Run **at planning time** (once the target symbol is identified) **and** immediately before Edit/Write. Planning catches blast radius early; pre-edit is the final gate. Append-only exemption → `${CLAUDE_PLUGIN_ROOT}/rules/execution-policy.md` Self-check §0.

```
gitnexus_impact({ target: "<symbol>", direction: "upstream" })
```

## claude-mem at planning start

Before spawning Explore agents:

```
claude-mem smart_search "<module or key function name>"
```

The session-start hook (if claude-mem ships one) auto-matches context but doesn't replace a targeted query. No results → proceed without blocking.

## Sub-agent prompts

Sub-agents do NOT inherit these rules — paste the relevant block from your project's sub-agent prompt template (or use the dhpk default at `${CLAUDE_PLUGIN_ROOT}/docs/subagent-prompt-template.md`) into the agent prompt. Required blocks: source-reading boilerplate (always), DB-access boilerplate (when the task touches a table).

## Top anti-patterns

- Read large file to find one function → use `cx definition`
- `Grep "function X"` to locate definition → use `cx definition` (AST > regex)
- Find-and-replace for renaming → must use `gitnexus_rename`
- `gitnexus_query` for plain text (error messages) → use `Grep`
- `mem-search` for current session content → already in scrollback

## Cross-reference

The dhpk skill `tool-routing` carries the longer prose version with examples and detailed sub-agent prompt boilerplate. This file is the compact card.
