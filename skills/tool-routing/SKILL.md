---
name: tool-routing
description: 'Route code-exploration requests to gitnexus, cx, claude-mem, Read, or Grep. Use when locating a symbol, tracing callers or impact, exploring an unfamiliar module, planning a rename/refactor, checking change scope, or recalling a past decision. Not for plain-text/log/doc search, non-code questions, or a tool already chosen. Output: one primary tool, exact command or MCP call, and a named fallback.'
---

# Tool Routing

Route one code-exploration intent to one primary tool and one fallback. The compact card at `${CLAUDE_PLUGIN_ROOT}/rules/tool-routing.md` is authoritative for row order and tie-breakers.

## Route

1. Read `${CLAUDE_PLUGIN_ROOT}/rules/tool-routing.md` sections "Decision tree" and "Tie-breakers" before selecting a tool.
2. Map the request to exactly one intent row. Use its primary tool when available; use its named fallback when the primary is unavailable or returns no useful result.
3. For a planned edit, rename, or refactor, read the card's "gitnexus_impact timing" guidance before touching an existing symbol.
4. Return the route contract below, then stop routing so the caller can run the selected tool.

Completion criterion: the request has one matched intent, one executable primary call, and either a concrete fallback call or an explicit `none`.

## When NOT to Use

- Run the already-selected tool directly.
- Send plain-text, log-line, comment, and documentation searches to `Grep` directly.
- Read one known small file in full with `Read`.
- Answer non-code questions from the relevant configuration or prose source.

## Conditional references

- For an ambiguous request, overlapping intent rows, or a primary tool that returns no result, read `references/decision-tree.md` for edge cases and rationale.
- When dispatching a sub-agent that will inspect code, read `${CLAUDE_PLUGIN_ROOT}/rules/tool-routing.md` "Sub-agent prompts" and paste the relevant block from `${CLAUDE_PLUGIN_ROOT}/docs/subagent-prompt-template.md` into its prompt.
- For impact timing or the append-only exemption, read `${CLAUDE_PLUGIN_ROOT}/rules/tool-routing.md` "gitnexus_impact timing" and the Glossary in `${CLAUDE_PLUGIN_ROOT}/rules/execution-policy.md`.
- Before using a rename or broad search, read `${CLAUDE_PLUGIN_ROOT}/rules/tool-routing.md` "Top anti-patterns".

## Output

```text
Intent: <matched decision-tree row>
Primary: <exact command or MCP call>
Fallback: <exact command or MCP call, or none>
```

## Verification

- [ ] Read the decision tree and tie-breakers before routing.
- [ ] Selected exactly one intent row, primary call, and fallback or `none`.
- [ ] Chose `cx` over `gitnexus` when both are valid, except for GitNexus-only impact, rename, and change-detection operations.
- [ ] For edits to an existing symbol body or signature, satisfied the `gitnexus_impact` timing rule.
- [ ] Began symbol-level source lookup with the selected semantic tool before broad `Read` or `Grep`.

Read `references/decision-tree.md` only for the conditional cases above.
