# GitNexus and Repository Exploration

Use this page when the task inspects or changes a symbol, call relationship,
or unfamiliar execution flow. The root guidance keeps the mandatory gates;
this page carries the decision detail.

## Required gates

- Before editing a function, class, method, or other indexed symbol, run
  `gitnexus_impact({target, direction: "upstream"})` and report direct callers,
  affected processes, and risk. Stop and warn before HIGH or CRITICAL work.
- Before committing, run `gitnexus_detect_changes()` with a scope that sees the
  actual worktree. If a sibling worktree makes `staged` incomplete, use
  `scope: "all"` or `scope: "compare"` and inspect the real diff/status.
- Never rename by blind replacement; use `gitnexus_rename`, or enumerate
  references before a scoped edit when the tool is unavailable.

## Exploration order

1. Prefer `cx overview <file>` for structure and symbols.
2. Use `cx definition --name <symbol> --from <file>` for the body.
3. Use `cx references --name <symbol>` for callers and impact.
4. Use `gitnexus_query({query})` for process-grouped unfamiliar flows.
5. Fall back to `rg`, `Grep`, or a focused file read only when symbol tools
   cannot answer the question.

If GitNexus reports a stale index, run `npx gitnexus analyze` before relying
on its impact or process results.
