---
name: tool-routing
description: 'Decide which code-exploration tool to use (gitnexus, cx, claude-mem, Read, Grep). Triggers: where is X defined, what breaks if I change X, find callers, explore unfamiliar module, rename X across codebase, past decisions about Y, file overview, find a function by symbol. Use this skill BEFORE reading large files with Read or using text-only grep on code.'
---

# Tool Routing

SSOT for code-exploration tool selection. Cost anchors live in `~/.claude/CX.md`.

## Decision tree

| Intent | Primary | Fallback |
|---|---|---|
| What breaks if I edit X? | `gitnexus_impact({target, direction:"upstream"})` | `cx references` |
| Where is X defined? | `cx definition --name X` | `gitnexus_query` |
| File overview (>200 lines) | `cx overview <file>` | `cx definition` for selected fns |
| File <100 lines, full read needed | `Read` (after `cx overview` confirms necessity) | — |
| Find callers | `cx references --name X` | `gitnexus_impact upstream` |
| Global rename / refactor | `gitnexus_rename` | **find-and-replace forbidden** |
| Pre-commit scope check | `gitnexus_detect_changes()` | `git diff --stat` |
| Explore unfamiliar module | `cx overview <dir>` | `gitnexus_query` |
| Past decisions (cross-session) | claude-mem `smart_search` / `search` | `get_observations([IDs])` |
| Plain text / comments / docs | `Grep` | — |

## Tie-breakers

1. **cx > gitnexus** when both apply (cheaper, local, no MCP)
2. `gitnexus` is the hard rule for `impact` / `detect_changes` / `rename`
3. `claude-mem` skips current session (already in scrollback); only for past decisions
4. `Read` is floor — only when nothing else fits

## gitnexus_impact timing

Run at planning time (once the target symbol is identified) AND immediately before Edit/Write. Planning catches blast radius early; pre-edit is the final gate.

```
gitnexus_impact({ target: "<symbol>", direction: "upstream" })
```

Append-only exemption: pure additions not touching existing symbol body/signature can skip the impact pass (state "append-only" in plan/commit).

## claude-mem at planning start

Before spawning Explore agents:

```
claude-mem smart_search "<module or key function name>"
```

The session-start hook auto-matches context but doesn't replace a targeted query. No results → proceed without blocking.

## Sub-agent prompts

Sub-agents do NOT inherit these rules. Paste the relevant block from `${CLAUDE_PLUGIN_ROOT}/docs/subagent-prompt-template.md` into the agent prompt. Required blocks: source-reading boilerplate (always), DB-access boilerplate (when task touches a table).

## Top anti-patterns

- `Read` of a large file to find one function → use `cx definition`
- `Grep "function X"` to locate a definition → use `cx definition` (AST > regex)
- Find-and-replace for renaming → must use `gitnexus_rename`
- `gitnexus_query` for plain text (error messages) → use `Grep`
- `mem-search` for current-session content → already in scrollback

Full decision-tree reference: see `references/decision-tree.md`.
