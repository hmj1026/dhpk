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

## Optional telemetry contract

Use the accepted
[telemetry specification](https://github.com/hmj1026/dhpk/blob/develop/openspec/specs/session-usage-telemetry/spec.md)
and public [issue #817](https://github.com/hmj1026/dhpk/issues/817) as the
behavior and delivery owners. The CLI accepts `--usage-telemetry`; supported
schema profiles extract typed counters and reconcile known consumption. The
package also has a pure consumer for verified planner and ancestry links, but
no supported native adapter currently produces those links. The CLI therefore
leaves usage unattributed and reports `adapter-not-supported` attribution
coverage. Native runtime verification remains `NOT_RUN`; synthetic fixtures
establish helper behavior and schema acceptance separately.

### Optional output and evidence

- Opt-in `--usage-telemetry` emits ignored `usage-telemetry.json` with schema `dhpk.session-usage-audit.telemetry.v1` in the selected audit output.
- Without the option, `report.v1`, filtering, findings, and verification gates retain their meanings; telemetry adds no second collector or report version.
- Keeping the optional schema in a sidecar isolates evolving numeric semantics
  from legacy consumers. Future rollback can disable the option or reinstall
  the prior package; no database or `report.v1` migration is planned.
- The current sidecar carries dates, timezone, source/resource selectors,
  hashed agent filters and source locators, `contract-only.v1` adapter markers,
  and allowlisted scan counts. Content fingerprints are null/unavailable and
  `reusable` is false. Matching scope or file presence does not prove freshness.
  Default invocations retain earlier sidecars; future reuse requires verified
  source-content binding.
- Each numeric or identity scalar carries `{value, status, evidence_refs,
  derivation}`; status is `observed`, `derived`, `unavailable`, `unsupported`,
  or `conflict`. Derived values name their rule and input evidence.
- Keep observed zero distinct from missing data. Missing stays null with a
  fixed reason; never invent zero, session identity, or execution fact.

### Current coverage

Envelope `metrics` and `identities` remain nullable placeholders; per-record
values live in `observations`, and selected non-overlapping usage lives in
`contributions`. With the current CLI adapters, only the unattributed known
subtotal may be populated because no native adapter emits verified invocation
links. Planner/descendant subtotals remain null in CLI output, and every
complete total remains null and incomplete. The contract helper preserves
explicitly evidenced zero and hashes string identities, including separate
requested/observed role and effort; it never derives an execution identity
from a selector or legacy diagnostic alias.

Coverage separates scan, source inventory, extraction, semantics,
reconciliation, attribution and cache categories. Scan counts retain malformed,
missing-timestamp, unsupported, partial and omitted information. Usage
extraction, semantic and reconciliation counts come from bounded typed
candidates; `legacy_scan_complete` describes the existing
bounded scan only. Telemetry scan completeness stays null/unavailable with
`scan-truncation-unverified`. Unsupported usage dimensions stay incomplete
rather than converting absent evidence to zero. Telemetry candidate
limits do not change legacy filtering. A metadata-only candidate can join a
strong dhpk context record only through a supported session identity in the
same selected file, including a context record encountered later in that scan.

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
- Adapters extract allowlisted numeric metadata only within the selected session, task,
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

#### Activated schema profiles

`claude.sdk-assistant.v0.2.163` (`schema-v0.2.163`) accepts only the
documented SDK assistant envelope in an already allowlisted Claude JSONL
source: root `type: assistant` and `session_id`, nested
`message.type: message`, `role: assistant`, `id`, `model`, `usage`, and a
completed stop reason (`end_turn`, `max_tokens`, `stop_sequence`, `tool_use`).
The mapping is pinned to the
[SDK v0.2.163 parser](https://github.com/anthropics/claude-agent-sdk-python/blob/v0.2.163/src/claude_agent_sdk/_internal/message_parser.py#L151).
This is schema compatibility, not detection of an installed SDK version.
`session_id` plus the API message ID identifies the logical event; transcript
`uuid` is not a provider request ID. Compatible repeats count once; changed
counters for that identity conflict. Provider stays null; `message.model`
supplies only an opaque observed model identity.

The profile maps fresh input from `input_tokens`, cache read from
`cache_read_input_tokens`, cache write from `cache_creation_input_tokens`,
and output from `output_tokens`. The
[Messages cache contract](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
defines these input categories as disjoint. Missing categories stay null.
[Streaming usage](https://platform.claude.com/docs/en/build-with-claude/streaming)
is cumulative within a message; raw stream events and incomplete messages
therefore do not enter this completed-message adapter.

Claude Code camelCase disk envelopes are not verified by that SDK mapping.
Unknown formats do not activate support through `profile_id`, `verified`,
mirror claims or ordinal metadata. Native Codex `token_count` snapshots may
retain allowlisted raw input/cache/output/total values but remain ineligible:
the [Codex 0.160.0 protocol](https://github.com/openai/codex/blob/rust-v0.160.0/codex-rs/protocol/src/protocol.rs#L2087)
does not provide a response identity or independently prove an interval
baseline. Its [provider mapping](https://github.com/openai/codex/blob/rust-v0.160.0/codex-rs/codex-api/src/sse/responses.rs#L112)
places cache read within input and reasoning within output. The inclusive
110 and verified cumulative 40 fixtures test those pure arithmetic rules;
they do not certify a native Codex consumption interval.

The pure reconciliation helper accepts adapter-owned evidence for mirror
origins, interval baselines/continuity/date allocation and complete aggregate
membership. Current native adapters do not copy such proofs from arbitrary
transcript flags. Unsupported native relationships remain unresolved even
when a synthetic helper oracle passes.

### Attribution consumer contract

The package-local `usage-attribution` helper consumes three adapter-verified
link sets. These are internal inputs, not fields copied or inferred from raw
transcripts:

- A planner root binds an opaque invocation reference to the exact selected
  session and context, with a sanitized source evidence reference.
- A consumption binding links one reconciled observation to that invocation,
  exact session/context, and optional attempt; its proof reference must belong
  to the observation's evidence set.
- An ancestry edge links a parent and child invocation in the same selected
  context; its proof reference must be present in the source evidence for both
  endpoints. Duplicate equivalent edges collapse; conflicting parents and
  cycles leave affected contributions unattributed.

The helper cross-checks references, selected scope, session, attempt, event
basis and acyclicity. A matching hash or a caller-supplied `verified` flag does
not prove a relationship. The adapter that supplies a link must establish its
meaning from a supported source format before calling the helper. Only
non-overlapping `per-event` contributions can be attributed; cumulative
intervals and parent-inclusive aggregates remain unattributed unless a future
adapter proves a consumption-level binding. If any link set is malformed or
truncated, the helper leaves all contributions unattributed so omitted links
cannot hide a conflicting root, binding, or ancestry edge. Known subtotals stay
separate from complete totals.

No current native source adapter emits planner roots, consumption bindings,
or ancestry edges. The CLI passes empty link sets, so all current CLI usage
remains unattributed and attribution coverage is `adapter-not-supported`.
Synthetic attribution fixtures prove only this consumer's behavior; they do
not establish native source compatibility or runtime ancestry.

#### Counting rules

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
