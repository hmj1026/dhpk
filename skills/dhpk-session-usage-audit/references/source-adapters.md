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

## Accepted telemetry contract — pending implementation

Use this proposed integration reference when implementing the accepted
[telemetry specification](https://github.com/hmj1026/dhpk/blob/develop/openspec/specs/session-usage-telemetry/spec.md)
and public [issue #817](https://github.com/hmj1026/dhpk/issues/817). Adoption
sets desired behavior, not runtime support; implementation and behavioral
verification remain `NOT_RUN`; the current CLI has no option or sidecar support.

### Optional output and evidence

- Future opt-in `--usage-telemetry` emits ignored `usage-telemetry.json` with schema `dhpk.session-usage-audit.telemetry.v1` in the selected audit output.
- Without the option, `report.v1`, filtering, findings, and verification gates retain their meanings; telemetry adds no second collector or report version.
- Keeping the optional schema in a sidecar isolates evolving numeric semantics
  from legacy consumers. Future rollback can disable the option or reinstall
  the prior package; no database or `report.v1` migration is planned.
- Bind the sidecar to selected dates, timezone, filters, sources, adapter
  version, and sanitized source fingerprints. Reuse requires scope and source
  binding matches; file presence alone cannot validate a stale sidecar.
- Each numeric or identity scalar carries `{value, status, evidence_refs,
  derivation}`; status is `observed`, `derived`, `unavailable`, `unsupported`,
  or `conflict`. Derived values name their rule and input evidence.
- Keep observed zero distinct from missing data. Missing stays null with a
  fixed reason; never invent zero, session identity, or execution fact.

### Allowlisted fields and selection

- Allow only selection envelope (date, timezone, filter, source format, adapter
  version, sanitized locator); typed session, parent, request/message/event,
  task, attempt, producer, wave, scope ID/digest, adapter, stage, source
  commit/tree, plan and artifact fingerprints; Host, Target Agent, actual vendor/provider, Model, and
  requested versus observed role and effort.
- Keep fresh input, cache-read, cache-write, output, reported input, and
  reported total separate. Record stream, epoch, basis, interval,
  self/descendant inclusion, canonical contribution, duplicate/conflict status,
  verified planner-root ancestry, unattributed usage, and independent coverage.
- Extract allowlisted numeric metadata only within the selected session, task,
  or invocation scope, before the legacy text filter. It may add telemetry
  evidence but cannot expand legacy records or change findings.
- Package-local telemetry helpers consume orchestration identity read-only;
  they add no dependency on dispatch writers.
- Metadata without a per-line dhpk marker qualifies only through verified
  selected context. Keep current-user home, source allowlist, and symlink
  controls; pseudonymize identities and sanitize evidence references. Exclude
  transcripts, prompts, tool content, secrets, and home paths; never spread
  arbitrary source metadata into the sidecar.

### Adapter and reconciliation rules

- A versioned adapter profile declares field paths, identity rules, counter
  basis, and an independent semantic oracle. Provider names and local samples
  alone prove neither counter relationships nor parent-child ancestry.
- Reconcile physical observations to logical events in a verified source
  namespace.
  Count compatible evidence for one verified event once; deduplicate mirrors
  only with original-event identity/provenance. Retries and distinct attempts
  remain separate; equal values or timestamps do not prove identity.
- Normalize only under verified semantics: inclusive input subtracts
  documented subsets, disjoint categories add documented disjoint values, and
  unknown relationships stay null. Do not re-add output subcategories.
- Cumulative snapshots need a verified same-stream baseline or reset origin.
  If cumulative and `last`/per-event counters overlap, choose one basis and
  retain the other as corroboration. Unknown baseline, reset, regression, date
  gap, or boundary allocation stays null; never widen the selected scan window.
- A verified parent aggregate that includes children and those children cannot
  both contribute to one subtotal. Unknown inclusion leaves the combined total
  unresolved. Group contributions by supported provider, Model and semantic
  profile; separate known subtotals from complete totals and expose unknown
  grouping keys explicitly.
- Require safe integers and valid derivations: impossible/negative
  subtractions and incompatible totals are conflicts. Planner/descendant
  attribution requires verified invocation ancestry; unresolved usage remains
  unattributed.
- `execution_provider` is diagnostic dispatch context (`codex` or `agy`),
  distinct from observed vendor/provider and Model. A diagnostic alias is not
  a logical-event deduplication key.
