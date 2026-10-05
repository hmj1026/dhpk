# Design

Status: Supporting design for the requirements adopted on 2026-10-05. Implementation and behavioral validation: `NOT_RUN`. Motivation and architecture decision: [proposal.md](proposal.md). Contract: [session-usage-telemetry Specification](../../../openspec/specs/session-usage-telemetry/spec.md).

## Context

Research baseline: `f120e05d9f7b998f94774a38475d1907825c27ec`. Existing owner: `skills/dhpk-session-usage-audit/`. Repository-root source pointers: `skills/dhpk-session-usage-audit/scripts/session-usage-audit.js:317` normalizes diagnostic identity aliases; lines 795 and 1549 of that same file respectively exclude per-line evidence=none and own the current-user boundary/report.v1. `scripts/lib/dispatch-contract.js:676` owns dispatch task/attempt and scope/prompt digests; `scripts/lib/harness-receipt.js:76` lists producer/scope/adapter/stage/fingerprint identities; `scripts/lib/dispatch-scheduler.js:37` supplies wave arrays, not persisted stable wave identities.

The bounded observations below were made on 2026-10-05 against current-user dhpk logs. Their raw transcripts were not published. Detailed probe receipts remain local, ignored provenance and are not required inputs to this proposal. Independent sample selections mean ordinal joins across probes are invalid. These observations establish candidate field shapes only; implementation requires independently verified, version-bound identity and semantic contracts.

Observed Claude paths: `message.usage.input_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`, `output_tokens`; request and message identities accompany usage. One bounded sample has 594 usage-bearing rows, 286 distinct message groups and 201 repeated groups; repeated groups in that probe have no changing counters. These are repetition evidence, not consumption totals or proof all source versions behave identically.

Observed native Codex paths: `payload.info.last_token_usage` and `payload.info.total_token_usage` with input/cached-input/output/reasoning-output/total counters; `turn_context` carries turn/model/effort metadata. An independent identity probe for CLI 0.160.0 observes structured `subagent.thread_spawn.parent_thread_id`, depth and role paths in one sample. This establishes supported-shape candidates, not planner attribution for usage in another sample. Provider arithmetic semantics remain unverified by these probes.

## Goals / Non-Goals

**Goals:** Produce nullable source-bound metrics, non-overlapping contributions, verified invocation ancestry and independent coverage under the existing current-user audit boundary (REQ-1 through REQ-8).

**Non-Goals:** Provider billing/quota/savings, planner-quality benchmarks, model runs or policy changes, arbitrary transcript collection, private SQLite/authentication/aggregate-store adapters, and workflow/dispatch writes. Existing report and finding meanings remain the compatibility baseline.

## Decisions

### D1: Optional sidecar, one owner (REQ-1, REQ-8)

Proposed CLI grammar: `--usage-telemetry`, using existing date, agent, source and output selectors. The existing output directory contains `usage-telemetry.json` with `schema: dhpk.session-usage-audit.telemetry.v1`. Default invocations emit no sidecar. Both opted-in and default invocations preserve legacy outputs. A prior sidecar in a reused directory is not evidence for the latest invocation; consumers match its embedded selection/source binding rather than mere file existence.

The audit CLI delegates to package-local contract, source normalization, reconciliation, attribution and rendering helpers. Reuse the existing allowlisted scan boundary to extract supported typed metadata before the legacy per-line text filter; do not broaden legacy records or feed telemetry into finding/issue gates. Numeric events need verified selected session/task/invocation context. Orchestration identity is consumed read-only; no dependency on dispatch writers is added. Alternative: an additive optional report.v1 block is viable, but the sidecar isolates the new schema and permits separate adoption.

### D2: Nullable evidence is the cross-helper payload (REQ-2)

Each scalar uses `{value: T|null, status, evidence_refs, derivation}`. Status vocabulary: observed / derived / unavailable / unsupported / conflict. Derivation identifies a rule and referenced inputs; unsupported/missing/conflicting values carry fixed reasons. Missing identifiers remain null. IDs are namespaced and sanitized or pseudonymized consistently before output; no arbitrary metadata spreads enter serialization.

| Payload section | Allowlisted content |
| --- | --- |
| Selection and provenance | Date/timezone/filter scope, source format and adapter versions, redacted file/line and field locator, opaque observation references |
| Identity | Session/parent, request/message/event, task/attempt, producer/wave, scope ID/digest, adapter/stage, source commit/tree and plan/artifact fingerprints |
| Execution | Host, Target Agent, Provider, Model; separate requested and observed role/effort |
| Metrics | Reported input, fresh input, cache read, cache write, output, reported total and derived normalized input total |
| Semantics and reconciliation | Counter stream/epoch, per-message/cumulative/aggregate basis, interval, self/descendant inclusion, canonical contribution and duplicate/conflict reasons |
| Attribution and coverage | Planner root/ancestry references, planner/descendant/unattributed class, per-dimension omissions and known-subtotal completeness |

Existing legacy `execution_provider: codex|agy` is not a real vendor Provider identity. Requested/resolved dispatch configuration does not prove observed execution. Absent wave, stage, fingerprints, vendor or model fields remain null. The generic diagnostic aliases are not imported as numeric dedupe keys.

### D3: Normalize only verified semantics (REQ-3)

Each adapter declares source/version, exact supported field paths, identity rules, counter basis and verified inclusive/disjoint/unknown relationships. Source snapshots establish field presence; a supported semantic mapping additionally needs version-bound source-format evidence and independent fixture expectations. No mapping is inferred from a vendor label or arithmetic observed in two samples.

Inclusive example: input 100 includes cache read 80, output 10; fresh=20, input+output=110. Disjoint example: fresh 20 + read 80 + write 5 + output 10 =115. Unknown cache-write remains null; known subtotals show incomplete category coverage. Cache/output subsets, including reasoning where applicable, are not re-added. Invalid safe-integer bounds, impossible subtraction or inconsistent relationships produce conflict and exclude affected derivations.

### D4: Reconcile before aggregation (REQ-4, REQ-5)

Physical file/line observation identity is distinct from a documented logical event namespace. For supported Claude shapes, verified runtime/session/request/message identity can reconcile repeated identical message usage; line UUID and stop reason alone do not prove separate usage or finalization. Changed counters require a verified revision/finalization rule or remain conflict. A shared task ID or equal timestamp/values cannot deduplicate different requests. Mirrors require documented original provenance; retry attempt identities remain separate consumption.

For Codex candidates, total usage snapshots and last-usage fields may describe overlapping consumption. Reconciliation chooses one basis for a verified stream/epoch interval and retains the other as corroboration. A verified baseline 100 then 140 produces 40, never snapshot sum 240 or delta plus last usage 80. A missing baseline, reset, regression, gap or unsupported date-boundary allocation yields a null dated contribution rather than an assumed zero origin. Unknown fields do not become deltas. Do not widen the selected scan window silently to find a baseline.

Hierarchy reconciliation follows the same overlap rule: a verified descendant-inclusive parent aggregate and child measurements do not both enter the same rollup. Inclusion unknown means combined completeness unresolved. Contributions are grouped by Provider/Model/semantic profile when supported; unknown group keys stay explicit. There is no pricing conversion or cross-provider savings comparison.

### D5: Attribute invocation scope, not whole sessions (REQ-6, REQ-7)

Planner roots are typed invocations within the selected scope. A verified receipt/native-session/turn link supplies root ownership; a parent session containing a planner invocation does not make all parent usage planner usage. Traverse only supported acyclic agent ancestry; grandchildren can join through verified parents. Native spawn parent IDs are candidate join paths once source format and exact session linkage are verified. Conversation `parentUuid`, `isSidechain`, agent nickname, prose and timestamps cannot independently establish agent ancestry. Missing/conflicting links remain unattributed; matching cwd alone is insufficient selected dhpk context.

Report separate source/scan, extraction, semantics, reconciliation, ancestry/attribution and category coverage. Known subtotals exclude unresolved contributions and record missing/conflict counts. Completeness is stated per subtotal/dimension, never inferred from `partial=false`.

## Risks / Trade-offs

| Risk / uncertainty | Mitigation and detecting gate | Owner |
| --- | --- | --- |
| Repeated/cumulative/mirror usage counts twice | REQ-4/5 independent overlap, retry and conflict fixtures | Audit implementation + TDD |
| Vendor input includes cached tokens | Version-bound adapter profile; unknown relationships remain null; REQ-3 arithmetic fixtures | Adapter owner |
| Missing ancestry assigns unrelated work to planner | Typed invocation root and acyclic ancestry; REQ-6 negative fixtures | Attribution owner |
| Metadata exposes identifiers/content | Allowlisted serialization, sanitized refs, current-user limits; REQ-8 boundary fixtures and security review | Audit owner + reviewer |
| Legacy records/findings change | Optional sidecar, legacy compatibility oracle with and without option | Audit owner |
| Monolithic audit becomes a God Object | Package-local pure helper files; no unrelated audit refactor | Implementation owner |
| Local probes mistaken for general evidence | Label PARTIAL sampling and independent selections; create synthetic versioned fixtures | Spec/TDD owner |

## Migration Plan

After the recorded specification acceptance and separate implementation authorization, ship three independently useful slices: optional nullable contract/coverage; supported counter normalization and reconciliation; verified planner/descendant attribution. Each slice remains usable with unsupported/unattributed evidence. Construct contracts and RED fixtures before implementation, then integrate, document and regenerate declared projections. Normal deployment/publication authority is unchanged. Rollback disables the option or reinstalls the prior package; no DB or report.v1 migration is required. This supporting design records implementation options; the adopted main spec owns the behavioral contract and implementation remains a separate checkpoint.

## Traceability and acceptance

| Requirement | Decision | Future task | Independent oracle | Current evidence |
| --- | --- | --- | --- | --- |
| REQ-1 | D1 | T-1, T-2, T-3 | Legacy default/opt-in output parity and schema | NOT_RUN |
| REQ-2 | D2 | T-1, T-2 | Zero/null/conflict and requested/observed fixtures | NOT_RUN |
| REQ-3 | D3 | T-4, T-5 | Inclusive 110, disjoint 115, unknown/null | NOT_RUN |
| REQ-4 | D4 | T-4, T-5 | Repeated message/mirror once, retry separately | NOT_RUN |
| REQ-5 | D4 | T-4, T-5 | Cumulative interval 40, baseline/reset/hierarchy negatives | NOT_RUN |
| REQ-6 | D5 | T-6, T-7 | Planner invocation/grandchild, missing/cyclic ancestry | NOT_RUN |
| REQ-7 | D1, D5 | T-1, T-6, T-7 | Clean scan with incomplete semantics/attribution | NOT_RUN |
| REQ-8 | D1, D2 | T-1, T-2, T-8 | Boundary/redaction and local-usage-only claims | NOT_RUN |

## Open Questions

Which additional source-format versions have trustworthy identity and semantic evidence can be answered per adapter without changing this contract: unsupported versions remain explicit. Whether future planner comparisons warrant separately authorized native experiments or provider accounting remains a separate work item. The adopted main spec owns sidecar grammar, ownership, missing-value behavior and conservative attribution. Source-version support and helper layout remain implementation design work.
