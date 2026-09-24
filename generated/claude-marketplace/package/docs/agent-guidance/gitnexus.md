# GitNexus and Repository Exploration

Use this page when the task inspects or changes a symbol, call relationship,
or unfamiliar execution flow. The required impact, change-detection, and
rename gates live in the GitNexus block of the root `AGENTS.md` / `CLAUDE.md`;
this page carries only the tool order and the recovery paths.

## Exploration order

1. Prefer `cx overview <file>` for structure and symbols.
2. Use `cx definition --name <symbol> --from <file>` for the body.
3. Use `cx references --name <symbol>` for callers.
4. Use GitNexus `query` for process-grouped unfamiliar flows and `impact` for
   blast radius.
5. Fall back to `rg`, `Grep`, or a focused file read when the symbol tools
   return nothing, `UNKNOWN`, or a literal-only question.

## Recovery

- **Stale index:** run `node .gitnexus/run.cjs analyze --index-only` from the
  repository root before relying on impact or process results.
- **"Trying to read a database file with a different version":** the global
  `gitnexus` that `run.cjs` selects first is older than the one that built the
  index. Compare `gitnexus --version` with `cliVersion` in
  `.gitnexus/meta.json`, upgrade the global install, and restart the session so
  the MCP server picks up the new version.
- **Ambiguous `impact` target:** a name shared by many symbols returns
  `risk: UNKNOWN` with a candidate list; narrow it with the file path or
  `target_uid` before treating the result as evidence.
- **Sibling worktree hides changes:** use `detect-changes --scope all` or
  `--scope compare` and inspect the real diff/status.
