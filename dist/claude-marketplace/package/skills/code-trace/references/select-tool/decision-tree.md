# Tool-routing edge cases and rationale

Read this reference for the compact decision table and tie-breakers. Consult the rationale below when multiple rows match or the primary tool is unavailable or unhelpful.

This local card owns tool selection for this skill. Tools are external capabilities: when unavailable, use the fallback and report the limitation. Project instructions retain precedence.

## Decision tree

| Intent | Primary | Fallback |
|---|---|---|
| What breaks if I edit X? | `gitnexus_impact({target, direction:"upstream"})` | `cx references` |
| Where is X defined? | `cx definition --name X` | `gitnexus_query` |
| File overview (>200 lines) | `cx overview <file>` | `cx definition` for selected functions |
| File <100 lines, full read needed | `Read` (after `cx overview` confirms) | — |
| Find callers | `cx references --name X` | `gitnexus_impact upstream` |
| Global rename / refactor | `gitnexus_rename` | `cx references` → scoped Edit (never *blind* find-and-replace) |
| Pre-commit scope check | `gitnexus_detect_changes()` | `git diff --stat` |
| Explore unfamiliar module | `cx overview <dir>` | `gitnexus_query` |
| Past decisions (cross-session) | claude-mem `smart_search` / `search` | `get_observations([IDs])` |
| Plain text / comments / docs | `Grep` | — |

## Tie-breakers

1. **cx > gitnexus** when both apply (cheaper, local, no MCP round-trip)
2. `gitnexus` is the hard rule for `impact` / `detect_changes` / `rename` (when installed)
3. `claude-mem` skips current session (already in scrollback); only for past-session decisions
4. `Read` is the floor — only when nothing else fits
5. Multi-repo GitNexus index: always pass the `repo` parameter to `gitnexus_impact` / `gitnexus_query` calls — omitting it errors with "Multiple repositories indexed" and costs a retry cycle

## Why cx is preferred over Read

`cx overview <file>` returns a tree-sitter-derived table of contents in ~200 tokens. A `Read` of an 800-line file costs ~6,000 tokens. That is a 30× difference, paid every time. The cheapest accurate tool wins.

## When `Read` is genuinely the right call

Both conditions must hold:

- The file is < 100 lines OR you need 5+ consecutive method bodies AND
- `cx overview` was already run and confirmed the full file is necessary

"I might need more context" is not a valid reason.

## gitnexus_impact vs cx references

- `cx references` lists call sites at the source-text level. Fast, no MCP.
- `gitnexus_impact` walks the dependency graph (calls, instantiations, type usage) and reports a richer impact set. Use for "what breaks if I change X" when X is non-trivial.
- For simple "show me callers", `cx references` is enough.

## When claude-mem helps

- "Did we already solve this last quarter?" → `smart_search`
- "What was the rationale for choosing Y over Z?" → `search` with decision keywords
- "Get the IDs from that observation" → `get_observations([id1, id2])`

Skip claude-mem for:

- Current session (already in scrollback)
- Generic programming concepts (use docs lookup instead)

## Impact timing

For a planned edit, run impact once the target is identified and again immediately before editing. Confirm unknown, stale or incomplete results with source references; zero callers do not establish safety. Use the project's explicit impact exceptions only when applicable.

## Sub-agent context

When delegating supported read-only exploration, supply the target symbols, scope, source-reading tool order and evidence the recipient cannot obtain. Use the current Host's available tools; provide source and caller context directly when a tool is unavailable.
