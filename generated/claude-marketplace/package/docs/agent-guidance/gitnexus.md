# GitNexus and Repository Exploration

Use this page when the task inspects or changes a symbol, call relationship,
or unfamiliar execution flow. The required impact, change-detection, and
rename gates live in the GitNexus block of the root `AGENTS.md` / `CLAUDE.md`;
this page carries only the tool order and the recovery paths.

## Prose edits

Impact applies before a function, class, or method change. Skill, guidance,
and other prose have no call-graph symbol. Run `detect_changes` before commit.
A target-not-found impact is not a gate for those files. Refresh the index
with `node .gitnexus/run.cjs analyze --skip-agents-md` so this repository's
wording in the root GitNexus block stays in place.

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
  staging with `node .gitnexus/run.cjs analyze --force --no-parse-cache --skip-agents-md --skip-skills`.
  Observed on gitnexus 1.6.12 (2026-11-09): an incremental run that reused
  cached parser output left whole files out of the graph. `.gitnexus/meta.json`
  `fileHashes` listed them while no matching `File` node existed.
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
- **Source-present symbol returns not found:** follow the ordered checks in
  [Bounded diagnosis](#source-present-symbol-returns-not-found).
- **Repository selector:** query commands (`impact`, `context`, `cypher`,
  `detect-changes`) take `--repo .`. Another indexed name in `gitnexus list`
  can point at a sibling worktree's older index, so a hit through that name is
  evidence about that checkout only.
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

### Source-present symbol returns not found

When `impact` or `context` returns `not found` for a symbol that `cx definition`
or a source search shows exists, check these in order from the repository root.
A runner fix in step 1 is new evidence that changes the suspected cause, so its
retry is outside the budget above; the retry after step 2 is the one narrowed
query that follows the justified refresh.

1. **Compare the runner with the index before rebuilding.** `run.cjs` uses the
   `gitnexus` found first on `PATH`, so a different shell can run another
   version:

   ```sh
   node .gitnexus/run.cjs --version
   node -p "require('./.gitnexus/meta.json').runnerIdentity.cliVersion"
   which -a gitnexus
   ```

   If the versions differ, put the installation that matches `cliVersion`
   first on `PATH`, restart the MCP session, and retry the same query. Do not
   rebuild the index to fix a version mismatch; the **"Trying to read a
   database file with a different version"** entry under [Recovery](#recovery)
   covers the storage side.
2. **With matching versions, spend the one justified refresh on a full
   rebuild** without the parse cache, as the **Incremental scan corruption**
   entry under [Recovery](#recovery) describes:

   ```sh
   node .gitnexus/run.cjs analyze --force --no-parse-cache --skip-agents-md --skip-skills
   ```

   Coordinate the rebuild if others share the index, send one serial request
   after it, then retry the same query.
3. **Keep `--repo .`.** Do not switch to another name from
   `node .gitnexus/run.cjs list` to make the symbol appear: a name can point at
   a sibling worktree's older index, so a hit describes that checkout, not this
   one. Compare each name's `Path` with this checkout before reading any result.
4. **Still not found:** record the result as `UNKNOWN`, account for the
   affected boundary with CX and source inspection, and keep the raw result of
   `node .gitnexus/run.cjs impact "<symbol>" --direction upstream --repo . --summary-only`
   with the versions from step 1 under local `docs/evidence/`. Do not refresh
   again unless new evidence changes the suspected cause.

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
