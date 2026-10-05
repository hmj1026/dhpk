# session-usage-telemetry Specification

## Adoption and implementation status

The maintainer adopted REQ-1 through REQ-8 on 2026-10-05 after reviewing the proposal published by PR #864. This file is the authoritative behavioral contract. Adoption records desired behavior; implementation and behavioral verification remain NOT_RUN. The [design](../../../docs/proposals/session-usage-telemetry/design.md) and [future tasks](../../../docs/proposals/session-usage-telemetry/tasks.md) provide supporting context.

## Purpose

Provide source-bound local token usage evidence, including cache categories and planner descendants, without overstating attribution, source completeness, provider billing, or savings.

## Requirements

### Requirement: REQ-1 Optional telemetry preserves the legacy audit contract

The existing session usage audit SHALL accept opt-in `--usage-telemetry` and produce `usage-telemetry.json` with schema `dhpk.session-usage-audit.telemetry.v1` below its selected ignored audit output directory. Without that option, existing report.v1 outputs and behavior SHALL remain unchanged. Enabling telemetry SHALL preserve existing report fields, record filtering, finding predicates, verification and issue gates. The telemetry SHALL remain owned by the existing audit rather than a separate collector or a competing full report version.

#### Scenario: Existing invocation has no telemetry option

- **WHEN** the audit runs against fixed inputs without `--usage-telemetry`
- **THEN** its existing outputs match the legacy contract and no telemetry sidecar is emitted

#### Scenario: Opt-in invocation emits a separately identifiable sidecar

- **WHEN** the same audit inputs are processed with `--usage-telemetry`
- **THEN** the sidecar identifies its schema and selection scope while existing report.v1 fields and findings retain their legacy meanings

### Requirement: REQ-2 Every telemetry value preserves nullable evidence

Each usage counter and identity field SHALL carry a nullable value, status, and source evidence references; status SHALL distinguish `observed`, `derived`, `unavailable`, `unsupported`, and `conflict`. Derived values SHALL identify their rule and input evidence. Missing evidence SHALL remain null and SHALL NOT become zero, a synthetic session identity, or an inferred execution fact. Identity SHALL distinguish session, parent, request/message/event, task, attempt, producer, wave, scope, adapter, stage, source and plan/artifact fingerprints when evidence supplies them. Host, Target Agent, Provider, Model, and requested versus observed role/effort SHALL remain distinct.

#### Scenario: Zero and missing cache write differ

- **WHEN** one usage record reports cache-write zero and another provides no supported cache-write field
- **THEN** the first value is observed zero and the second is null with an unavailable or unsupported status and reason

#### Scenario: Requested effort lacks runtime evidence

- **WHEN** dispatch evidence contains requested effort but the selected runtime record supplies no observed effort
- **THEN** requested effort retains its dispatch source and observed effort remains null

#### Scenario: Identity is partially present

- **WHEN** task and attempt are evidenced but producer, wave or stage are absent
- **THEN** the present identities retain provenance and absent identities remain null without preventing the sidecar from explaining partial coverage

### Requirement: REQ-3 Cache arithmetic uses verified source semantics

Telemetry SHALL preserve reported input, fresh input, cache-read input, cache-write input, output, and reported total as distinct measurements. An adapter's verified source-format semantic profile SHALL establish whether input is inclusive of cache categories, disjoint from them, or unknown before normalization. Inclusive counts SHALL subtract only documented subsets when deriving fresh input; disjoint counts SHALL add only documented disjoint categories. Unsupported categories SHALL remain null. Unknown relationships, negative derived counts, unsafe integers, or incompatible totals SHALL exclude the affected derivation from authoritative totals and expose its reason. Reported reasoning/output subcategories SHALL NOT be added again when already included in output.

#### Scenario: Inclusive input includes cache read

- **WHEN** a verified inclusive profile establishes that reported input consists of fresh input and cache read, and reports input 100, cache read 80 and output 10
- **THEN** fresh input is derived as 20 and input plus output is 110 rather than 190

#### Scenario: Disjoint input categories are all supported

- **WHEN** a verified disjoint profile reports fresh input 20, cache read 80, cache write 5 and output 10
- **THEN** normalized input is 105 and input plus output is 115 with the derivation references recorded

#### Scenario: Provider name does not establish semantics

- **WHEN** counters are observed but their source-format cache relationship is unverified
- **THEN** the reported counters remain visible and normalized fresh/input totals requiring that relationship remain null

### Requirement: REQ-4 Repeated records and mirrors count one verified logical event

Reconciliation SHALL distinguish physical observations from logical usage events. A supported source contract SHALL define the runtime/session/request/message/event namespace needed to identify one logical event. Repeated observations with verified identical logical identity and compatible counters SHALL contribute once while retaining redacted provenance references. Different attempts or distinct logical events SHALL remain separate consumption. Equal counter values, timestamps, task identity alone, or file proximity SHALL NOT establish duplication. Known mirrors SHALL be deduplicated only through verified original identity or source provenance. Conflicting observations SHALL remain visible and unresolved contributions SHALL be excluded from authoritative totals.

#### Scenario: Repeated Claude message usage records are identical

- **WHEN** multiple Claude observations share a verified runtime/session/request/message identity and identical usage counters
- **THEN** they produce one eligible contribution with all observation references and a duplicate disposition

#### Scenario: Repeated identity has incompatible usage

- **WHEN** observations share logical identity but differ in counters without a verified update/finalization contract
- **THEN** reconciliation records conflict instead of selecting the largest or latest values silently

#### Scenario: Retry and equal values are separate usage

- **WHEN** two attempts report equal usage values or two distinct message identities have equal timestamps and values
- **THEN** the consumption remains distinct unless an explicit original-event link proves a mirror

### Requirement: REQ-5 Counter and hierarchy intervals do not overlap in totals

Telemetry SHALL reconcile cumulative, per-message, and aggregate evidence by counter stream, epoch, covered interval, and self/descendant inclusion semantics. A cumulative interval SHALL require a verified same-stream baseline or explicit zero/reset origin; snapshots SHALL NOT be summed. Cumulative and per-message evidence covering the same consumption SHALL contribute through one basis only. Unknown baselines, regressions, resets, gaps and date-boundary allocation SHALL be surfaced without unsupported deltas. Parent aggregates known to include descendants SHALL NOT be added to those descendants; unknown inclusion semantics SHALL leave the combined authoritative total unresolved.

#### Scenario: Codex cumulative and last usage overlap

- **WHEN** verified same-epoch cumulative snapshots are 100 then 140 and last-usage evidence describes that same interval as 40
- **THEN** interval consumption is 40 through one basis, not 280 or 80, and the alternative evidence is retained as corroboration

#### Scenario: Date window lacks a verified baseline

- **WHEN** a cumulative snapshot within the selected date window lacks a verified baseline for that window
- **THEN** its observed snapshot remains visible but its dated contribution remains null with a coverage reason

#### Scenario: Parent aggregate includes the child

- **WHEN** an aggregate is verified to include a child's independently observed usage
- **THEN** the aggregate and child are not both added to the same subtotal and the report explains the chosen non-overlapping basis

### Requirement: REQ-6 Planner attribution requires verified invocation ancestry

Each eligible contribution SHALL be classified as `planner`, `descendant`, or `unattributed` with supporting identity evidence. Planner classification SHALL require a verified binding to a planner invocation within the selected scope. Descendant classification SHALL require an acyclic verified ancestry chain to that invocation, including grandchildren when evidenced. A planner invocation SHALL NOT confer planner ownership on all usage in its parent session. Role names, agent nicknames, prose, `isSidechain`, timestamps, cwd, and message-parent identifiers without a documented agent-parent relationship SHALL NOT independently prove planner ownership or ancestry. Unresolved or contradictory links SHALL remain unattributed.

#### Scenario: Child and grandchild have verified planner ancestry

- **WHEN** a planner invocation has a verified child-session link and that child has a verified grandchild link
- **THEN** both descendants' eligible usage is classified as descendant with its ancestry references retained

#### Scenario: Parent session contains other work

- **WHEN** a parent session has one bounded planner invocation and other usage not bound to that invocation
- **THEN** only the bound usage is classified as planner and unrelated contributions remain unattributed to that planner

#### Scenario: Role or apparent parent link is insufficient

- **WHEN** a record is named planner, is marked sidechain, or has a conversation parent UUID but lacks a verified invocation or agent ancestry binding
- **THEN** it remains unattributed with the missing relationship stated

### Requirement: REQ-7 Coverage and known subtotals remain independent

The sidecar SHALL separately report scan/source coverage, usage extraction, semantic support, reconciliation, attribution, and cache-category coverage, including malformed, missing, conflicting, unsupported, truncated and omitted evidence counts/reasons. It SHALL distinguish known subtotals from complete totals for planner, descendants and unattributed contributions. A clean scan SHALL NOT imply complete usage or ancestry. Metadata-only usage without a per-line dhpk marker SHALL be eligible only through a verified selected session/task/invocation context and SHALL leave legacy text filtering and finding behavior unchanged. Independent probe sample ordinals SHALL NOT join evidence across reports.

#### Scenario: Metadata-only usage has verified context

- **WHEN** a usage event lacks dhpk prose but has a verified link to the selected invocation or session/task context
- **THEN** its allowlisted numeric metadata can contribute to telemetry while the legacy report's record filter remains unchanged

#### Scenario: Clean scan has unsupported counters

- **WHEN** all selected readable files are scanned but some counters or ancestry links remain unsupported
- **THEN** scan completeness and incomplete semantic/attribution coverage are reported separately and known subtotals are not labeled complete totals

#### Scenario: Independent samples share an ordinal

- **WHEN** two independent probe reports both contain sampleOrdinal 3 without a shared verified source/session identity
- **THEN** their counters and ancestry evidence are not joined

### Requirement: REQ-8 Local usage respects privacy and accounting authority

Telemetry collection SHALL retain the existing current-user home boundary, source allowlists, explicit active-account selection, symlink/resource controls and source omissions. The sidecar SHALL contain only allowlisted numeric/typed metadata, opaque or redacted identities, sanitized evidence references and fixed reasons; raw transcripts, prompt/tool content, secrets and absolute home paths SHALL NOT appear. Unknown vendor formats and private/authentication/aggregate stores SHALL remain explicitly unsupported. The output SHALL describe local runtime evidence and SHALL NOT claim provider billing, quota, billable tokens, monetary savings, or proof that a lower-cost planner policy is better. This feature SHALL NOT call provider billing/admin APIs, run models or modify orchestration/model policy.

#### Scenario: Sensitive payload accompanies usage

- **WHEN** a selected usage record also contains prompt content, credentials or customer identifiers
- **THEN** the sidecar emits only supported sanitized metadata and excludes the sensitive payload from artifacts and diagnostic text

#### Scenario: Unsupported private store is present

- **WHEN** an existing omitted private database or unknown vendor store is encountered
- **THEN** the report records unsupported coverage and does not expand collection to parse that store

#### Scenario: Cache evidence is present without billing evidence

- **WHEN** local usage records expose cache counters
- **THEN** the output retains a local-usage-only claim boundary and does not infer charges, quota, savings or planner quality from those counters
