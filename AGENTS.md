<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **dhpk**.

> Index stale? Run `node .gitnexus/run.cjs analyze --index-only` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? Bootstrap with `npx`, `bunx`, or `pnpm dlx` — e.g. `bunx gitnexus@latest analyze` (npm 11 npx crash; #1939).

## Always Do

- **MUST run impact before editing.** Use `impact({target: "symbolName", direction: "upstream"})` or `node .gitnexus/run.cjs impact "symbolName" --direction upstream --repo .`; report callers, processes, and risk. Never substitute grep for graph analysis.
- **MUST analyze graph changes before committing.** Use `detect_changes({scope: "all"})` (MCP) or `node .gitnexus/run.cjs detect-changes --scope all --repo .` (CLI fallback). `partial: true` or `truncated: true` is not a clean check — a zero means unseen, not unaffected; re-run it. For regression review: `detect_changes({scope: "compare", base_ref: "main"})` or `node .gitnexus/run.cjs detect-changes --scope compare --base-ref "main" --repo .`.
- MUST warn on HIGH/CRITICAL `risk` pre-edit; never use `riskSharedAxes` to waive a HIGH/CRITICAL `risk` warning. Compare File/symbol: MCP File omits axes; Graph-RAG expands File.
- **MUST treat `risk: UNKNOWN` as unresolved, not as low.** An empty caller set is not evidence the symbol is unused — it can also mean the callers are not resolvable by the index (plain-object property access, dynamic dispatch, cross-language calls). `impact` pairs `UNKNOWN` with a `riskNote` saying so. Confirm with a text search before treating the symbol as safe to change or delete; do not proceed on the strength of a zero.
- **MUST use `query({search_query: "concept"})` for concepts/flows, `context({name: "symbolName"})` for a named symbol, or `impact` for blast radius, on read-only callers, dependencies, imports, or execution flow.** Graph first; text search only for empty/`UNKNOWN`/literals.
- For security review, `explain({target: "fileOrSymbol"})` lists taint findings (source→sink flows; needs `analyze --pdg`).

## Never Do

- NEVER edit a function, class, or method before MCP/CLI impact analysis.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis, and never read `UNKNOWN` as an all-clear — it means the walk could not answer, which is the one verdict that requires confirming by other means.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit before MCP/CLI graph change analysis.

## Resources

| Resource | Use for |
| --- | --- |
| `gitnexus://repo/dhpk/context` | Codebase overview, check index freshness |
| `gitnexus://repo/dhpk/clusters` | All functional areas |
| `gitnexus://repo/dhpk/processes` | All execution flows |
| `gitnexus://repo/dhpk/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
| --- | --- |
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus-cli/SKILL.md` |
<!-- gitnexus:end -->

- **Editing plugin sources, skills, agents, rules, or guidance:** load the matching page from the [agent guidance index](docs/agent-guidance/README.md), including [plugin development](docs/agent-guidance/plugin-development.md) and [writing for agents](docs/agent-guidance/writing-for-agents.md); Codex projection rules live in [Codex guidance](codex/guidance.md). For specifications and development records, follow [document storage by type](docs/README.md) and [OpenSpec authoring](docs/agent-guidance/openspec-authoring.md), including superpowers workflows.
- **Changing `generated/` or `plugins/` outputs:** follow the [generated-output preflight](docs/agent-guidance/plugin-development.md#ci-preflight-for-generated-and-release-shaped-changes) for commands and clean-checkout ordering; use [distribution surfaces](docs/distribution-surfaces.md) for surface ownership.
- **Orchestrating implementation:** follow the canonical [execution policy](rules/execution-policy.md) — record decision state, run the read-only reasoner before a writer when required, keep planner/review/CI/archive/PR checkpoints, and leave external `/opsx:apply` unchanged.
- **Project workflow defaults:** Agent-First and multi-file Plan Mode are task-fit recommendations; use them when ownership, uncertainty, risk, or coordination supports them. Apply an 80% coverage target only when project/task acceptance or runner configuration makes it applicable; do not invent a universal threshold. See the [execution policy](rules/execution-policy.md) and [testing governance](docs/testing-governance.md). They do not override stronger current-session instructions or change user-global settings.

## Agent skills

### Issue tracker

GitHub Issues 是本專案的 issue tracker。依 `docs/agents/issue-tracker.md` 使用 `gh`。

### Triage labels

使用 `needs-triage`、`needs-info`、`ready-for-agent`、`ready-for-human`、`wontfix`。詳見 `docs/agents/triage-labels.md`。

### Domain docs

本專案採 single-context。讀取根目錄的 `CONTEXT.md` 和相關 `docs/adr/`。詳見 `docs/agents/domain.md`。

## Guidance ownership

`AGENTS.md` is the only repository instruction entrypoint source. Edit it directly; `CLAUDE.md`, `codex/AGENTS.md`, and `cursor/AGENTS.md` are relative symlinks to this file. Resolve reference links from the repository root. Load [Codex guidance](codex/guidance.md) for Codex work and [Cursor guidance](cursor/guidance.md) for Cursor work; these are topic references, not separate instruction entrypoints.
