## Context

The v0.37.0 audit spans two different evidence surfaces: Codex sessions for the dhpk checkout and Claude sessions in consumer worktrees. The current collector treats broad text matches as runtime diagnostics, verifies command exit status instead of the finding symptom, and reports complete coverage while omitting the active Orca Codex account path. Separately, orchestration documents and reviewer contracts mix planning, dispatch, persistence, and side effects. Codex role generation has the same projection problem: canonical role coverage, generated TOML, supporting trap sheets, and runtime validation are not one resolvable graph.

The change must remain read-only until a later implementation request, preserve unrelated dirty worktree changes, and avoid any GitHub issue side effect. Existing sentinel, single-writer, security, and explicit-authorization contracts remain authoritative.

## Goals / Non-Goals

**Goals:**

- Produce audit findings only from typed runtime evidence and make incomplete source coverage explicit.
- Require finding-specific reproduction and consumer assertions before a finding can be marked verified.
- Represent dispatch, artifact readiness, quota blocks, retries, and review closure as observable lifecycle states.
- Make every Codex role, supporting handoff, and generated projection resolvable and metadata-valid.
- Reduce repeated always-visible context while retaining safety and routing contracts in one SSOT.
- Keep the implementation testable with fixture-based regression tests and deterministic validators.

**Non-Goals:**

- Reclassifying the currently valid v0.37.0 model/effort tier map solely to reduce token counts.
- Filing GitHub issues, committing changes, cleaning the worktree, or changing unrelated OpenSpec work.
- Treating consumer-project Claude usage as dhpk-repository usage without an explicit scope label.
- Removing existing review, sentinel, security, dirty-worktree, or `NOT RUN`/`BLOCKED` safeguards.

## Decisions

### 1. Typed evidence adapters and explicit coverage states

Add a source adapter boundary beneath the session collector. Each adapter emits normalized records with source kind, record kind, role/task identity, parent session, exit status, structured error status, and timestamp. Diagnostic detection consumes only record kinds that can represent a runtime failure; user prompts, memory, inherited instructions, historical summaries, and successful hook attachments remain context evidence and cannot become failures by text match alone.

Source discovery will include the configured Codex home, the Orca account home(s) explicitly selected by the active host configuration, Claude project transcripts, and explicitly listed optional stores. It will not wildcard-scan unrelated account homes. Account identifiers will be redacted to a stable non-reversible label in reports. The report will expose `scanComplete`, `sourceCoverageComplete`, `malformedCount`, `unsupportedCount`, and omitted-source reasons independently. `partial=false` will no longer imply complete coverage.

**Alternative rejected:** continue recursively scanning all text and add more regular expressions. That would preserve the false-positive class and make historical prompt wording part of the runtime contract.

### 2. Finding-bound verification

Every finding definition will carry a stable fingerprint, an evidence predicate, a reproduction assertion, and a consumer-gate assertion. Verification succeeds only when the reproduction observes the expected symptom and the consumer gate observes its absence or the explicitly expected remediation state. Generic `--help`, date scans, or exit-0 commands may validate tool availability but cannot verify an arbitrary finding.

**Alternative rejected:** infer verification from two distinct successful commands. Distinct argv is a provenance check, not a behavioral assertion.

### 3. Evidence-backed orchestration lifecycle

Use a small state model for each dispatched unit: `planned → dispatched → started → artifact-ready → verdicted`, with terminal `blocked`, `failed-start`, `quota-blocked`, or `incomplete` states. A review obligation closes only with a fresh artifact linked to the current scope/diff identity and a parseable verdict. Retry policy permits one corrected retry after a failed start or missing artifact; quota blocks remain resumable and cannot be reported as completion.

The producer writes a completion marker only after the artifact is durable. Consumers depend on that marker rather than racing the filesystem. Review attempts, completed verdicts, and artifacts are recorded as separate counters.

**Alternative rejected:** use verbal approval or a fixed sleep before reading artifacts. Neither proves freshness or completion.

### 4. Canonical role graph and fail-loud projection validation

Treat canonical agents, coverage outcomes, direct Codex TOML, supporting assets, and dispatch namespaces as one graph. Validation will check filename/name equality, model/effort/sandbox enums, all direct and merged targets, supporting handoffs, module agents, and stale generated files. Generic roles remain stack-neutral; stack-specific guidance belongs in conditional trap references. Read-only reviewers return inline evidence while the host persists artifacts, avoiding a contradictory write contract.

**Alternative rejected:** maintain a permissive allowlist and rely on manual review of generated files. The audit already demonstrated that ghost targets and stale TOML can pass the current validators.

### 5. Conditional context and policy SSOT

Keep a short always-visible kernel for safety, authorization, dirty-worktree ownership, routing precedence, and completion semantics. Move stack/version traps, review mechanics, sentinel reconciliation, and OpenSpec details behind conditional references. A deterministic invocation-context/route result becomes the handoff between command parsing and policy, while `commands/do.md` and `rules/execution-policy.md` point to the SSOT instead of repeating it. Discovery metadata receives measured word/token budgets; optional lifecycle must not be described as hidden when the host still publishes descriptions.

**Alternative rejected:** delete rules opportunistically based only on line count. The current policy contains valid gates; reduction must preserve behavior and be measured against routing fixtures.

## Risks / Trade-offs

- [Coverage expansion may expose private or stale stores] → use explicit roots, redact paths in reports, and label optional/unreadable sources without broad filesystem scans.
- [Typed adapters may miss a new runtime error shape] → retain an `unsupported` counter and fail the completeness claim rather than silently treating it as healthy.
- [Stricter verification will downgrade historical findings] → preserve raw candidate evidence and report `unverified`/`blocked` instead of deleting it.
- [One review artifact per wave may slow emergency fixes] → allow a documented escalation state, but never replace fresh evidence with verbal approval.
- [Context reduction may lower routing recall] → add route fixtures and compare before/after activation precision before removing descriptions.
- [Role graph validation may reject local extensions] → distinguish receipt-managed package roles from explicitly declared workspace-local roles.

## Migration Plan

1. Add RED fixtures for false verification, successful-hook text containing timeout wording, prompt/memory contamination, active Orca source discovery, missing artifact, quota block, and ghost role targets.
2. Implement typed adapters, coverage states, and finding-bound verification behind report-schema compatibility fields; keep old candidate reports readable.
3. Add lifecycle/artifact readiness and bounded retry telemetry, then update reviewer and opsx handoff contracts.
4. Harden Codex generator and validators; regenerate only package-owned projections and leave local unowned roles untouched.
5. Refactor policy ownership and discovery metadata with route/size regression checks.
6. Run focused tests, full validation, and a fresh read-only audit; only then consider implementation review and any later issue filing.

Rollback is by disabling the new verifier/lifecycle consumers while retaining raw evidence and old report readers. No database migration or external service change is required.

## Open Questions

- What exact lifecycle event is guaranteed by each Claude and Codex host for `artifact-ready` and quota reset notification?
- Should `performance-analyzer` become a direct Codex role, or should the coverage matrix define a non-dispatchable capability fallback?
- What route-recall and token-budget thresholds should be enforced after description compression?
