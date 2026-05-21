# Tool-routing decision tree (extended reference)

This is the long-form companion to the `tool-routing` skill. The skill body has the table; this file documents edge cases and rationale.

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

## Append-only exemption (for impact)

You may skip `gitnexus_impact` only when ALL of these hold:

- Adding a new function, method, or class without touching any existing symbol
- Not changing any existing signature, body, or PHPDoc/typehint
- Not changing any module-level state (imports, top-level constants)

State "append-only — gitnexus_impact skipped" in your plan or commit message when invoking this exemption.

## Sub-agent inheritance

Sub-agents do not inherit this skill's content. When spawning a sub-agent that will do code exploration, include the source-reading boilerplate from `${CLAUDE_PLUGIN_ROOT}/docs/subagent-prompt-template.md` in the agent prompt.
