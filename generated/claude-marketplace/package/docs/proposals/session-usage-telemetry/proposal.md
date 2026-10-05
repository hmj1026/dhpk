# Proposal

Status: Requirements adopted on 2026-10-05; implementation pending. Issue: #817. Authorized checkpoint: research and specification only. No implementation or model experiments are authorized by this artifact set.

## Why

The existing session usage audit reports local evidence and findings but cannot explain planner consumption together with descendant consumption and cache usage. Counting transcript lines or adding reported input to cache counters can count the same usage repeatedly, so #817 needs a source-bound telemetry contract before any cost or savings comparison is possible.

## What Changes

- Add opt-in `--usage-telemetry` output to the existing `dhpk-session-usage-audit` owner: an ignored, redacted `usage-telemetry.json` sidecar with schema `dhpk.session-usage-audit.telemetry.v1` (REQ-1).
- Preserve nullable, field-level source evidence for runtime identity, reported counters, and verified derivations; represent fresh input, cache read, cache write, and output separately without presuming that provider input counters are additive (REQ-2, REQ-3).
- Reconcile repeated message records, cumulative/per-message representations, known mirrors, retries, and parent-inclusive totals before producing known subtotals (REQ-4, REQ-5).
- Attribute contributions to the selected planner invocation, verified descendants, or unattributed usage using typed identities and ancestry rather than free text or temporal proximity (REQ-6).
- Expose source, extraction, semantic, reconciliation, and attribution coverage independently; preserve unknown and omitted evidence (REQ-7).
- Retain current-user source allowlists, privacy and finding gates; label local usage evidence separately from provider billing, quota, and monetary savings (REQ-8).

## Capabilities

### New Capabilities

- `session-usage-telemetry`: Optional cache-aware local usage evidence and planner/descendant attribution, owned by the existing audit package.

### Modified Capabilities

None. `session-audit-integrity` remains the owner of existing finding predicates, provenance and source coverage; `session-install-health` remains a separate installation concern. Their requirements are not replaced by the telemetry sidecar.

## Impact

Future owned source: `skills/dhpk-session-usage-audit/scripts/session-usage-audit.js`, package-local telemetry helpers, `SKILL.md`, and `references/source-adapters.md`; behavioral fixtures/tests; the existing distribution inventory usage grammar and declared generated projections. No new collector skill, arbitrary transcript roots, dispatch writer, provider/admin billing integration, private-store adapter, model policy change, or automatic model run is proposed.

Default `dhpk.session-usage-audit.report.v1` behavior and existing report files remain compatible. The sidecar extends the existing owner with one optional surface; it does not introduce competing report versions or redefine existing findings. REQ-1 through REQ-8 are adopted in the [main spec](../../../openspec/specs/session-usage-telemetry/spec.md). This proposal retains the decision rationale. The local OpenSpec workflow remains ignored; the adopted contract is not a shipped feature.

## Decision

### Context

Checkout research at `f120e05d9f7b998f94774a38475d1907825c27ec` found that `scanJsonlFile` drops records lacking a per-line dhpk text marker, and `normalizeRuntimeRecord` merges several diagnostic identity aliases. Those records are not a safe numeric ledger. Bounded sanitized probes supplied to this planning pass show repeated Claude message usage records and both `last_token_usage` and `total_token_usage` in native Codex evidence. These prove field presence and repetition, not vendor counter semantics or complete planner attribution. The probes selected samples independently; sample ordinals cannot join records across probe reports.

### Decision

Propose an opt-in sidecar under the existing audit owner. Reuse the allowlisted scan boundary, collect only allowlisted typed metadata for telemetry, and reconcile through package-local pure contracts before attribution/rendering. Preserve the legacy text filtering and finding path. Consume existing orchestration identity evidence read-only, with absent task/attempt/producer/wave/scope/adapter/stage/fingerprints represented as null. Require adapter-specific semantic evidence before deriving inclusive or disjoint input totals.

### Consequences

- Positive: backward compatibility, one collection owner, visible cache categories, reproducible deduplication and honest partial evidence.
- Negative: some native usage remains unattributed or semantically unresolved; no complete token or savings claim follows from a successful scan.
- Neutral: the report is local runtime evidence; native acceptance, provider accounting, release and publication retain their existing owners and authority.

### Alternatives

- Add an optional telemetry section to report.v1 while preserving existing fields: viable, but the proposed sidecar gives the new counter semantics an explicit schema boundary and permits independent downstream adoption without changing the legacy serialized report. Both designs require the same reconciliation rules.
- Sum every usage-bearing record: rejected because repeated messages and overlapping cumulative/per-message evidence would count consumption more than once, regardless of output placement.
- Introduce a separate broad transcript collector: rejected because it duplicates the audit owner and broadens collection authority.
- Treat requested model/effort or role names as observed usage attribution: rejected because configuration does not establish execution or ancestry.
- Fetch provider billing/admin usage or run comparative model sessions: outside this change's authorized scope.

### Status

REQ-1 through REQ-8 adopted by the maintainer on 2026-10-05. Implementation authorization remains separate. The main spec owns behavioral requirements; design and schema sketches support them. Implementation, behavioral tests, native model experiments, provider billing verification, release and publication are `NOT_RUN` in this planning pass.
