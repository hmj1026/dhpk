# Source adapters and evidence contract

## Scope

The audit runs on the current machine and treats the current user home as the
boundary. It never recursively searches an arbitrary home directory. The
collector skips symbolic links and reports unreadable or unsupported sources.

The default roots are:

| Source | Roots | Evidence |
|---|---|---|
| Claude transcript | `~/.claude/projects/**/*.jsonl` | JSON Lines (JSONL) session records, hook attachments, tool output |
| Claude artifacts | `~/.claude/artifacts/**/*.{jsonl,log}` | dhpk hook/learning summaries; logs are inventory-only unless JSONL |
| Codex transcript | `~/.codex/sessions/**/*.{jsonl,ndjson}` and project `.codex/sessions/` | native Codex session records when the runtime exposes them |
| Claude agents | `~/.claude/agents/**/*.md` and `~/.claude/plugins/installed_plugins.json` install paths | installed-agent inventory, including plugin-provided agents |
| Codex agents | `~/.codex/agents/**/*.md` | installed-agent inventory |
| Orca trace/session | `~/.config/orca/logs/**/*.{jsonl,ndjson}`, `~/.config/orca/sessions/`, and equivalent `~/.orca/` roots | local orchestration traces and newline-delimited JSON (NDJSON) session records with ISO 8601, millisecond, or nanosecond timestamps |
| Project surfaces | immediate children of `~/projects`, `~/workspaces`, `~/repos`, `~/src` | project `.claude`, `.codex`, receipts, agents, artifacts |

The `--home` and `projectRoots` options may narrow these roots. `--home` must
resolve inside the current user's real home. The production CLI has no
override for scanning an external home; isolated tests use a separate
fixture-only process boundary.

## Installation evidence

Read-only installation evidence is collected from:

- `~/.claude/plugins/installed_plugins.json`, for `dhpk@dhpk` version/scope;
- project `.codex/.dhpk-installed.json`, for receipt version/mode/entry count;
- the executing plugin root (or an explicitly supplied `--plugin-root`) `.claude-plugin/plugin.json`, for source version when it remains under the selected home boundary.

Management metadata is not treated as proof that runtime content is valid. A
consumer validator or clean-install check is required during verification.

## Session evidence levels

- **strong** — runtime hook path, `CLAUDE_PLUGIN_ROOT`, `/dhpk:<name>`, or a
  canonical dhpk skill/agent marker appears in the record.
- **weak** — only a free-text `dhpk` mention appears.
- **none** — no dhpk marker; retained only for coverage counts and never
  promoted to a dhpk finding.

Every record keeps the source kind, file/line reference, session id, UTC
timestamp, local date, agent name when available, evidence level, and a
redacted excerpt. Date-scoped records without dhpk evidence are counted in
`sourceStats.*.nonDhpk` but are not copied into the report, reducing prompt and
artifact exposure. A runtime package version found in the record is exact;
when only the current installation registry is available, the report marks it
`current-install-inferred` and does not use it as historical version evidence.
Unknown timestamps and malformed JSON are counted and excluded from
date-scoped analysis.

## Unsupported sources

Private SQLite databases, memory stores, browser caches, authentication files,
Orca aggregate JSON stores, and unknown vendor formats are not parsed
heuristically. Known state files appear under `omittedSources` with
`UNSUPPORTED` or `UNREADABLE` status and can receive a future adapter without
changing the report schema. A source filter that selects an unavailable adapter
returns an empty scan plus the omitted-source record; it never broadens the
allowlist.
