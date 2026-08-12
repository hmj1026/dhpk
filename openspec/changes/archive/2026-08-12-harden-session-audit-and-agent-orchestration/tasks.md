## 1. Baseline and regression fixtures

- [x] 1.1 Record the current v0.37.0 Codex/Claude source roots, report schema, and package-owned role set in focused test fixtures without including private account identifiers.
- [x] 1.2 Add RED fixtures for successful hook records containing historical timeout text, prompt/memory sentinel text, historical projection prose, and structured non-zero runtime failures.
- [x] 1.3 Add RED fixtures proving generic `--help` and date-scan commands cannot verify an arbitrary finding.
- [x] 1.4 Add RED fixtures for missing active Orca sources, malformed records, unsupported record kinds, and unique-agent versus installation-row counts.

## 2. Typed session collection and coverage

- [x] 2.1 Introduce source adapters that normalize source kind, record kind, role/task identity, parent session, exit status, structured error status, and timestamp.
- [x] 2.2 Extend source discovery to configured Codex homes and active Orca account homes while redacting account identity in reports.
- [x] 2.3 Restrict runtime finding detection to registered typed failure predicates and retain ambiguous text matches as unverified candidates.
- [x] 2.4 Add independent `scanComplete`, `sourceCoverageComplete`, `malformedCount`, `unsupportedCount`, and omitted-source reason fields to the report schema.
- [x] 2.5 Deduplicate parent/child records by stable event or task identity and report candidate, unverified, verified, blocked, and suppressed states.

## 3. Finding-bound verification and inventory reporting

- [x] 3.1 Extend finding definitions with stable fingerprints, reproduction assertions, and consumer-gate assertions.
- [x] 3.2 Make verification fail closed unless both finding-specific assertions pass; retain tool-availability results as non-verification diagnostics.
- [x] 3.3 Separate installation rows, unique role identities, cache/version duplicates, and excluded index records in the rendered report.
- [x] 3.4 Update session-audit tests and report consumers for the new verification and coverage states, including backward-readable old reports.

## 4. Orchestration and review lifecycle

- [x] 4.1 Define lifecycle transitions and durable event schema for planned, dispatched, started, artifact-ready, verdicted, failed-start, quota-blocked, blocked, and incomplete states.
- [x] 4.2 Add producer-ready markers and consumer dependency checks for audit reports and review artifacts; remove fixed-sleep readiness assumptions.
- [x] 4.3 Bind review artifacts to wave scope/diff identity and require a fresh parseable verdict before closing a review obligation.
- [x] 4.4 Separate reviewer attempts, started/completed verdicts, fresh artifacts, retries, and unresolved obligations in telemetry.
- [x] 4.5 Implement one corrected retry for missing-start or missing-artifact conditions and resumable quota-blocked task identity without unbounded retries.
- [x] 4.6 Add regression coverage proving liveness-marker cleanup does not clear a pending review without fresh evidence.

## 5. Opsx handoff integrity

- [x] 5.1 Replace missing or legacy opsx skill references with canonical registered names and add natural-language handoff resolution to reference validation.
- [x] 5.2 Rewrite opsx save/resume semantics around live worktree and task artifacts; make commit, memory, precommit, and provider gates explicit optional actions.
- [x] 5.3 Add compatibility fixtures proving resume works without commit, compact provider, or memory provider and does not claim uncommitted files are lost.

## 6. Codex role projection and model contracts

- [x] 6.1 Extend role graph validation across direct, merged, fallback, capability-gated, module, and supporting-asset targets and dispatch namespaces.
- [x] 6.2 Validate role filename/name equality, model, effort, sandbox enums, and declared ownership for generated and local role files.
- [x] 6.3 Make generation fail loudly on stale package-owned TOML while preserving explicitly declared workspace-local extensions.
- [x] 6.4 Remove unavailable supporting handoffs, correct namespace typos, and decide the direct-role or capability-gated outcome for performance analysis.
- [x] 6.5 Make hand-maintained bug-investigator and worker instructions stack-neutral and align their sandbox/completion contracts.
- [x] 6.6 Add mutation tests for invalid metadata, ghost targets, dangling traps, stale TOML, module-agent drift, and default-effort mismatch.

## 7. Context and policy consolidation

- [x] 7.1 Add discovery metadata word/token budgets by lifecycle and host surface, with explicit reporting when optional entries remain discovery-visible.
- [x] 7.2 Reduce duplicated agent descriptions and subagent prompt boilerplate while retaining safety, authorization, dirty-worktree, routing, and completion contracts.
- [x] 7.3 Create the deterministic invocation-context/route-result boundary and remove duplicate precedence/dispatch prose from `commands/do.md`.
- [x] 7.4 Split execution-policy mechanics into the always-visible kernel and conditional references, preserving one SSOT for routing and review decisions.
- [x] 7.5 Reconcile hook documentation/configuration so opt-in events are not described as default wired, and add a regression test for the default event set.

## 8. Verification and rollout

- [x] 8.1 Run focused session-audit, reference-integrity, reviewer-lifecycle, Codex-runtime, catalog, and context-budget tests.
- [x] 8.2 Run the full repository validation suite and record unrelated environment failures separately from implementation failures.
- [ ] 8.3 Generate a fresh read-only v0.37.0 audit with complete source-coverage evidence and compare findings against the pre-change baseline. **DEFERRED:** the merged implementation has fixture-level source-coverage evidence, but no durable fresh real-home audit artifact was retained; run this bounded audit before release sign-off.
- [x] 8.4 Run doc-reviewer and applicable code/config reviewers against the final diff with fresh artifacts and scope/diff identity.
- [x] 8.5 Update implementation and release documentation only after the gates pass; do not create GitHub issues or commit as part of this change.

## Evidence and deferred work

Implementation and review evidence is in merged PR #152 (`97600b5`) and its feature commits:

- 1.1–1.4: `85b940f` fixtures and `tests/session-audit-integrity-fixtures.test.js`.
- 2.1–3.4: `b6c88c7`, `b8c3f27`, and `tests/session-usage-audit.test.js`.
- 4.1–4.6: `c5a496c`, `aa87216`, `92f8817`, and `tests/review-lifecycle.test.js` plus reconciliation tests.
- 5.1–5.3: `a072443`, `41646f8`, and `tests/reference-route-policy.test.js`.
- 6.1–6.6: `5688ef7` and `tests/codex-runtime-contract.test.js` mutation coverage.
- 7.1–7.5: `a072443`, `ce988e9`, and context, route, policy, and default-hook tests.
- 8.1, 8.2, 8.4, and 8.5: PR CI/review gates passed and `4efad55` records the release documentation fragment.

Task 8.3 remains explicitly deferred. It is not represented as a verified
finding or release approval; the next release gate must generate and retain a
bounded fresh audit comparison with `sourceCoverageComplete` evidence.
