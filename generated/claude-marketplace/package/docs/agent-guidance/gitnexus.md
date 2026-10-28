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

- **Stale index:** run `node .gitnexus/run.cjs analyze --skip-agents-md` from the
  repository root before relying on impact or process results. This preserves
  checked-in repository guidance. Check `analyze --help` for the installed
  version: `--index-only` is not supported by every runner.
- In Git repositories, GitNexus checks both the indexed commit and working-tree
  dirtiness. A successful analysis can update changed-file content from the
  working tree; a new or changed symbol is available only after that content is
  indexed and included by the scanner. Absence from an older index is unresolved.
- **Incremental scan corruption or post-refresh `Transport closed`:** when an
  incremental `analyze` still misses source-present symbols or returns `NUL` or
  concatenated strings in table scans (`@ladybugdb/core` `0.18.3` out-of-place
  `CHECKPOINT` splits `>256 KiB` string columns into 64-row segments that
  `StringColumn::scanFiltered` skips at `offset % 2048 >= 64`), rebuild through
  staging with `node .gitnexus/run.cjs analyze --force --skip-agents-md --skip-skills`.
  After any index refresh, send one serial MCP request before issuing concurrent
  MCP queries so the server reopens the replaced database without racing
  in-flight connections.
- **Tool arguments:** use the exposed tool schema. MCP concept search accepts
  `query({query: "concept"})`; the CLI's positional `<search_query>` is not an
  MCP field. Preserve this distinction when updating the generated guidance.
- **"Trying to read a database file with a different version":** the CLI or
  MCP native storage reader differs from the reader that built the index.
  Compare `gitnexus --version`, available index version metadata, and the MCP
  runtime; matching package versions alone do not prove storage compatibility.
  Use a compatible runner and restart its session before rebuilding the index.
  Keep existing graph evidence and the failed refresh explicit until then;
  avoid deleting the index or changing global installations to hide the error.
- **Ambiguous `impact` target:** a name shared by many symbols returns
  `risk: UNKNOWN` with a candidate list; narrow it with the file path or
  `target_uid` before treating the result as evidence.
- **Impact reporting:** keep the default report compact: include risk, direct
  callers (count and names when manageable), affected process names, and
  unresolved state. Put `HIGH`/`CRITICAL`, `UNKNOWN`, `partial`, and `truncated`
  results up front; none is an all-clear. Provide full `byDepth`,
  `affected_processes`, and `affected_modules` details on request or when needed
  to explain material risk.
- **Large `impact` output:** `--summary-only` returns counts and risk, while
  `--limit` with `--offset` pages symbol details. State which details or ranges
  are omitted; a summary or one page is not the full blast radius. Treat
  `UNKNOWN`, `partial`, `truncated`, and graph-query errors as unresolved, even
  when the visible caller count is zero.
- **Search capability:** unavailable `VECTOR` does not by itself establish that
  semantic search is unavailable; check `doctor` for the reported fallback,
  such as exact-scan, and its limits. BM25/full-text keyword search is a
  separate lane; missing embeddings or vector acceleration alone does not show
  that lexical search is unavailable. Check the reported capability and query
  result completeness separately.
- **Sibling worktree hides changes:** use `detect-changes --scope all` or
  `--scope compare` and inspect the real diff/status.

## Bounded diagnosis

For one unchanged failure, perform at most one justified index refresh and one
query narrowed by file or symbol unique identifier (UID). Coordinate a shared index refresh with
other active users. Retry again only when new evidence changes the suspected
cause; otherwise preserve the unresolved result and use CX and source inspection
to account for the affected boundary. This limits retries; it does not waive the
required impact attempt, HIGH/CRITICAL warnings, or unresolved-risk reporting.

Keep freshness, missing symbols, malformed result data, resolver caps, output
truncation, and MCP transport failures separate. Record the checkout/index
identity, CLI and native-reader versions, exact command, and redacted raw result
under local `docs/evidence/`. Compare raw data before presentation truncation
before attributing unexpected characters to the output budget. A cap that omits
edges is incomplete evidence even after a successful refresh.

Use an owned disposable fixture for a minimal reproduction. Preserve the shared
index and installed tools; a dependency upgrade, cap change, or index deletion
requires a separately scoped repair. If the failing layer cannot be identified,
report UNKNOWN with the next discriminating check rather than a guessed cause.
