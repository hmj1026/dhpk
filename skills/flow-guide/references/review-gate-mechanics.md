# Review-gate mechanics — operational detail

Operational detail for `${CLAUDE_PLUGIN_ROOT}/rules/execution-policy.md` §Mandatory
post-steps. The always-loaded SSOT keeps the reviewer trigger table, the
post-implementation gate, the one consolidated parallel batch, the Review
output gate, and the AI-judgment back-stop trigger list. This file defines the
current platform-neutral Review Gate identity, evidence, retry, and batching
rules. Every "§X" below refers to a section of that SSOT file.

## Current Review Gate contract

The orchestrator derives applicable reviewer obligations from the completed
implementation wave and its exact changed-file scope. It then creates one
immutable Review Request per applicable lane and dispatches the selected
reviewers in one parallel batch. A reviewer produces a durable artifact and a
`dhpk.reviewer-contract.v2` Review Result; the orchestrator records the result
and lifecycle evidence in the Review Gate evidence store.

The Review Request binds the decision, wave, obligation, lane, exact scope and
digest, base/head identity, diff digest, material risks, governing inputs,
exclusions, and any prior findings. A reviewer may inspect dependencies
read-only but may not silently expand the obligation. Missing material scope is
a completed `BLOCKED` result, not permission to guess.

Review Results keep execution, applicability, and semantic judgment separate:

- `executionStatus` is `COMPLETE`, `NOT_RUN`, `INTERRUPTED`, or `UNAVAILABLE`;
- `applicability` is `REQUIRED` or `NOT_APPLICABLE`; and
- `semanticVerdict` is `PASS`, `CHANGES_REQUIRED`, or `BLOCKED` when a required
  review completed.

Only a complete required result with a valid `PASS` can resolve a semantic
obligation. `NOT_APPLICABLE` must be explicit. Missing, malformed, warning,
failing, interrupted, unavailable, foreign, or stale evidence remains
unresolved and fails closed; it never becomes an implicit pass.

## Identity-bound evidence and readiness

Every dispatch and retry keeps one stable `task_id` and assigns a new
`attempt_id` for each attempt. The lifecycle and Review Gate records also bind
the producer, wave, session/dispatch identity, evidence scope, adapter/stage,
and optional plan/artifact fingerprints. A new obligation that declares an
identity rejects missing, foreign, or mismatched values.

The producer writes the canonical artifact durably, then records an
`artifact-ready` event with its content digest. The consumer requires that
event, the artifact, the matching Review Request digest, and the matching
Review Result before recording the obligation as resolved. A reviewer message,
aggregate evidence object, terminal lifecycle event, path, file existence, or
mtime is not completion evidence by itself.

## `${CLAUDE_PLUGIN_ROOT}` command-path caveat

<!-- SSOT for the ${CLAUDE_PLUGIN_ROOT} interpolation-token caveat — rules/execution-policy.md and skills/flow-guide/SKILL.md point here. -->
`${CLAUDE_PLUGIN_ROOT}` is a markdown-interpolation token, not a shell variable: the orchestrator resolves it when reading this document, and it is unset inside a subagent's Bash environment. A subagent must never paste the literal `${CLAUDE_PLUGIN_ROOT}/...` into a Bash command — use the absolute path the orchestrator supplies, or, when a diagnostic command has printed an already-resolved command, use that command only when the orchestrator has explicitly authorized the diagnostic. On a 127 / "No such file or directory" failure, escalate to the orchestrator for the resolved path; never recover by scanning the filesystem with `find / -iname`.

## Reviewer reuse and corrected retry

When a follow-up reuses a reviewer through `SendMessage`, the orchestrator
records the prior artifact/result digests, preserves the stable `task_id`, and
assigns a new `attempt_id` before sending. The reviewer must produce a new
identity-bound artifact and Review Result for that attempt. An intermediate
response, a stale or foreign artifact, or a message without a result leaves the
obligation unresolved.

Allow one corrected retry for a missing or invalid result. After a second
failure, replace the reviewer or record an explicit human blocker. Do not
dispatch a duplicate while the original reviewer remains addressable. A retry
does not weaken scope, identity, or semantic-verdict requirements.

## Applicability and skipped paths

Applicability is a diff-and-policy decision made by the orchestrator. Triage may
drop a demonstrably irrelevant lane for a pure formatting change, comment-only
edit, cosmetic documentation change, or checkbox-only OpenSpec bookkeeping;
when uncertain, retain the obligation. Pure research and planning with no
`Edit`/`Write` skip implementation-wave reviewer dispatch.

Session evidence under `.claude/artifacts/**` is not product scope by default.
The reviewer trigger table and active module/extra-path configuration define
the normal role-specific exclusions. Generated projections are regenerated from
canonical sources; a generated copy does not silently expand the review scope.

## Historical migration-observation compatibility (non-authoritative)

Earlier releases used hook-backed Sentinel slots and an opt-in
migration-observation checkpoint. That lifecycle, its phase vocabulary, and
its compatibility adapters are retained in historical ADRs, fixtures, and
contracts for audit and migration diagnosis only. They do not select current
reviewers, resolve current obligations, or authorize completion. Current work
uses the Review Gate contract above; do not infer active marker or checkpoint
behavior from historical text.

## Reviewer dispatch — triage → parallel → merge

At the end of each contiguous implementation wave, inspect the final diff and
derive all applicable Review Gate obligations. Triage false positives first,
then dispatch each surviving lane once in one consolidated parallel batch.

1. **Triage first (cheap, no agent).** A pure-style CSS tweak, a single-string,
   comment-only, or whitespace-only change does not warrant a full reviewer.
   Pure formatting documentation and checkbox-only OpenSpec bookkeeping may be
   dropped; substantive policy/spec changes remain reviewable. Triage only
   removes a demonstrably irrelevant obligation; when uncertain, retain it.
2. **Dispatch the surviving reviewers in parallel.** Each reviewer audits only
   its own concern and is independent, so wall-clock is `max(reviewers)`, not
   the sum. Do not run independent lanes as a sequential chain.
3. **`code-reviewer` is the merge/dedup owner.** When it is in the batch,
   `code-reviewer` (or the orchestrator while collecting results) merges all
   findings and removes cross-reviewer duplicates. Specialists still own their
   lanes; code-reviewer does not re-run OWASP/SQL/link checks, and doc-reviewer
   does not audit code quality.

The counter-example this consolidation prevents is a six-dispatch goal-session tail: 2 code-review rounds + 1 database-review round + 2 doc-review rounds + 1 `dhpk-codex-bridge` round. Those concerns belong in one parallel batch per implementation wave; a second round requires new substantive scope or explicit escalation, and `dhpk-codex-bridge` is escalation-only, at most once per change.

- Each reviewer handles only its own obligation: no applicable obligation →
  skip; an applicable obligation that survives triage → it MUST run, including
  when the orchestrator selected it through the semantic back-stop.
- **Batched per turn, not per edit**: a turn with N Edits runs each reviewer at most once, after the last edit — never once per Edit. This extends across a **review round**: when responding to a set of already-flagged findings (Codex findings, reviewer-flagged issues, a `design.md` append recording one) with a series of small fixes, apply all of that round's known-finding-mapped small fixes first and dispatch the re-review ONCE for the batch — never edit→re-review→edit→re-review serially, one finding-fix at a time. A genuinely new finding discovered mid-batch still gets its own cycle.
- **CRITICAL handling under parallel dispatch**: collect every parallel verdict, then if any reviewer returns CRITICAL → surface it and block the merge/commit. (Parallel means all reviewers run regardless of another's CRITICAL — independent concerns are not short-circuited.)
- `code-reviewer` and `doc-reviewer` **are not mutually exclusive**: mixed diffs (PHP + .sh + plain `.claude/` policy doc) dispatch both. Single-type diffs dispatch only the matching one.
- Pure research / planning (no Edit/Write) skips all reviewer agents.

## Reduced-tier dispatch for known-finding-mapped tiny deltas

A delta of roughly **≤3 net changed lines** that maps 1:1 to a finding **already flagged in the current review round** (not new or uninspected work) MAY be dispatched to the required reviewer at a *reduced* tier — e.g. `haiku` — via the same `model` param the §Model tier rule uses to *escalate* a HIGH-risk dispatch, here reused symmetrically for a LOW-risk case, instead of the reviewer's frontmatter-default tier. Guards: never for a **security/db-sensitive file** or a **CRITICAL-severity** target finding (those stay at the default tier), and this lowers the gate's *cost*, not the gate itself — the reviewer dispatch still runs. SSOT: `${CLAUDE_PLUGIN_ROOT}/rules/execution-policy.md` §Model tier.

## Reviewer liveness — a no-op return is a failed gate

A reviewer that *ran* but did no work is a distinct failure from a reviewer that
was not applicable. When a dispatched reviewer returns with `tool_uses=0` (no
`Read`/`Grep`/`Bash`), or a body that only echoes an injected
`<system-reminder>` / agent roster rather than a findings-plus-verdict report,
the Review Gate is **FAILED, not satisfied**. The orchestrator must not mark the
obligation complete. Re-dispatch exactly once with a corrected prompt. If that
retry is still empty, use a replacement reviewer or leave an explicit blocker;
never perform a third identical retry. A real review — inspection performed,
findings or an explicit no-findings statement, and a parseable verdict — is
evaluated on its contract as usual. SSOT: `${CLAUDE_PLUGIN_ROOT}/rules/execution-policy.md` §Reviewer dispatch.

## File-state ground truth — re-verify a file-state defect live before reporting it

Before concluding a file was reverted, a regression exists, or the working tree is broken/inconsistent, re-verify live — `git status --porcelain` + a direct `Read` of the target file's current content — rather than treating a single injected file-snapshot (e.g. a `<system-reminder>` capturing a mid-operation, mid-branch-switch working tree) as proof. Such a snapshot can transiently show a stale or reverted-looking state that is not a real defect; the live re-check is the tie-breaker. A live-confirmed defect is still reported — the check confirms genuine defects, it does not suppress them. SSOT: `${CLAUDE_PLUGIN_ROOT}/rules/execution-policy.md` (File-state ground truth paragraph, §Agent dispatch).

## AI-judgment back-stop — explanatory notes

> **Why view-layer script uses a back-stop**: path matching is deterministic,
> while identifying an embedded `<script>` block is content-sensitive. The
> orchestrator inspects the completed diff and adds the frontend obligation when
> the semantic trigger is present; no hook-side content scan is required.
>
> **When to improve deterministic routing**: if repeated misses show that a
> semantic class is routinely overlooked, update the trigger taxonomy or
> project configuration and validate the new routing. Do not treat a reviewer
> message, artifact path, or hook side effect as a substitute for a durable
> Review Gate result.
>
> **`tdd-guide` is conditional**: it owns tests-first work when the selected
> change requires it. Unattended goal runs enforce testing through the detected
> test/coverage outcome or the change's explicit tasks; there is no universal
> reviewer obligation for every change.
