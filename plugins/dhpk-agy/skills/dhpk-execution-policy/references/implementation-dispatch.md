# Implementation dispatch — operational detail

Operational detail for `${CLAUDE_PLUGIN_ROOT}/rules/execution-policy.md` §Implementation dispatch. The dispatch **table** and the decide→dispatch→verify posture summary live there (the always-loaded SSOT); this file carries the how/why the orchestrator needs **when actually dispatching implement-phase work**. Every "§X" below refers to a section of that SSOT file.

## Orchestrator posture

The main session is the expensive, high-capability orchestrator; its implement-phase job is **decide → dispatch → verify**, not hand-typing mechanical edits. Dispatch to a worker is the **default**; inline is a **narrow exception**, not a co-equal option. The economic reason is the point, not a nicety — the orchestrator runs on the expensive tier and `fast-worker` on a cheaper one, so routing mechanical work to `fast-worker` is why this policy exists and the default bias is to dispatch. Unattended goal sessions (`dhpk-opsx-apply-goal`) bind this posture by reading the execution policy during their orientation step; the emitted `/goal` condition carries only the compact roster line and the self-locating policy pointer, never these elaborations.

Apply the canonical `Decision: CLEAR | REASONER_REQUIRED | HUMAN_REQUIRED |
BLOCKED` contract in `rules/execution-policy.md` before selecting a writer. A
settled static fact may be `CLEAR`; the whole-step footprint still decides inline
versus worker. A non-trivial unresolved root cause, algorithm, architecture,
cross-file, data-shape, behavioral, runtime, or public-contract choice is
`REASONER_REQUIRED`: use a read-only reasoner first. A domain-boundary decision
requiring architectural ownership consults `architect` first; if uncertainty
remains, record `REASONER_REQUIRED` and obtain the reasoner result before any
writer. Its exact result is
`Reasoner result: READY_FOR_DISPATCH | DECISION_FOR_USER | BLOCKED`; retain `##
Conclusion`, file-and-line evidence, and `## Next actions`. Only
`READY_FOR_DISPATCH` permits a bounded writer, `DECISION_FOR_USER` becomes
`HUMAN_REQUIRED` and pauses, and `BLOCKED` stops.

## OpenSpec planner gate

Before the first write wave of an existing OpenSpec apply, the orchestrator
counts unchecked tasks in the task artifact. With `>=2` unchecked tasks (two or
more), `planner` is mandatory and runs before any writer. The planner handoff is
actionable only when it records the dependency order, exact owner and explicit
write scope for each task, and the next checkpoint; the orchestrator owns that
record and uses it as the writer dispatch boundary. With exactly one clear task,
record `planner=skipped` and continue through the canonical decision and writer
gates.

**The "≤2 files" inline bound is measured on the whole implement-step footprint, not each individual Edit.** A run of individually-small mechanical edits that together touch more than two files — e.g. a multi-file doc-consistency fix across ≥3 files — is **one `fast-worker` dispatch** (batched into a single fix-spec), not a salami-sliced sequence of "small" inline diffs. When the choice between inline and `fast-worker` is unclear, **dispatch**.

**Review-fix waves follow the same posture.** After a consolidated review batch,
combine actionable findings into one fix-spec and measure the whole fix footprint
against the inline bound. A batch exceeding two files goes to the
selector-resolved fast-worker. The bounded fix loop is worker verification plus a
diff-scope recheck for LOW/WARNING-only findings; `BLOCK`, `CRITICAL`, and `HIGH`
findings additionally require a dedicated confirm-only reviewer. Applying
production fixes inline one finding at a time after review is the audited
anti-pattern: it salami-slices one mechanical wave and expands the orchestrator's
replay context.

**`general-purpose` is prohibited for implementation while `orchestration_dispatch=on`.** It carries no dhpk policy context, inherits the main-session model regardless of task cost, and has no defined input/output contract — use `deep-reasoner` / `fast-worker` / inline per the dispatch table instead.

## Orchestration identity and evidence presentation

Orchestration owns worker/reviewer selection, dispatch, handoff, lifecycle, retry, and evidence presentation. A worker or reviewer owns the work and its artifact; it does not own dispatch identity or Sentinel clearance. Keep the dispatch table in `rules/execution-policy.md`; this section defines the contract around that table without duplicating its roster.

Every dispatch and handoff records one durable `task_id`. A retry of that task keeps the same `task_id` and receives a new `attempt_id`; an unrelated scope, session, or work item receives a new task identity. The lifecycle envelope may also carry `producer`, `wave`, evidence `scope`, `adapter`, `stage`, and optional `plan_fingerprint` / `artifact_fingerprint` fields. Older scope/diff-only records remain readable, while a supplied new identity that is absent or mismatched in a new obligation fails closed.

The orchestrator presents the producer artifact and its identity envelope to the existing hook-owned Sentinel path in this order: dispatch/handoff identity, fresh artifact marker, lifecycle verdict, then the matching Sentinel decision. A message, aggregate `EvidenceResult`, or terminal lifecycle event alone is not clearance and must never be copied into the identity fields as a verdict. Only the existing hook/reconcile path may clear the matching Sentinel; unresolved or foreign evidence remains debt.

## Parallel dispatch contract

Use `Parallel: yes` only when two or more workers will operate in the same checkout. The dispatcher must provide each worker with:

```text
Parallel: yes
Assigned files:
- repo-relative/path-a
- repo-relative/path-b
Intent:
- repo-relative/path-a: exact bounded change
- repo-relative/path-b: exact bounded change
Verification: path-scoped command, or `REPORT-ONLY: <reason and orchestrator command>`
```

The assigned list is the worker's authoritative write, diff, and verification boundary. Paths must be explicit repo-relative paths; globs, directory guesses, and unlisted generated files are not valid scope. A worker that needs another file returns `RESULT: BLOCKED` and names the required scope expansion. A worker may report out-of-scope observations, but it must not modify, revert, reset, clean, or force-delete them. Any out-of-scope write is a contract violation and remains blocked for orchestrator review.

In parallel mode, before/after accounting uses path-scoped `git status --short -- <assigned files>` and `git diff --name-only -- <assigned files>`. A global status result is not evidence of worker ownership. The report separates assigned edits, out-of-scope observations, out-of-scope writes, verification, and backend identity.

If a validator reads or updates shared ratchet/configuration state, the worker uses only a dispatcher-provided scoped or no-write equivalent. Without one, it reports the exact missing command as blocked or uses the explicitly declared report-only outcome; it must not invoke a global read-modify-write path. A task intentionally changing shared state is serial. After all workers return, the orchestrator runs one sequential whole-tree validator/reconciliation pass and records the consolidated result before dispatching the implementation-wave reviewers.

## CLI worker mid-batch timeout recovery

Applies only to a CLI-backed multi-file dispatch (`codex-worker` / `agy-worker`, canonical role IDs; legacy aliases `codex-fast-worker` / `agy-fast-worker`) that reports a contained runner timeout (see each worker's Backend availability section) — never to a single-file dispatch, a non-timeout failure, or a missing-executable/auth/model failure, which keep their existing semantics unchanged.

The portable runner returns exit `124` only with the dispatcher-selected,
contained `0600` `dhpk.cli.receipt.v1` terminal `TIMEOUT` receipt. The
dispatcher verifies the receipt path, owner/mode, immutable launch identity,
and terminal status before interpreting the exit code. A missing, invalid, or
uncontained receipt is `BLOCKED`; a non-empty report never proves edits or
success without independent path-scoped diff verification.

**Path-scoped completion ledger.** Before dispatch, the dispatcher records the exact assigned file list and a path-scoped `git status --porcelain -- <assigned files>` baseline. After a verified runner timeout, the worker derives three disjoint sets covering the assigned list:

- `confirmed` — intersection of the backend's own reported files and path-scoped diff evidence attributable to this dispatch.
- `unconfirmed` — assigned files with changed or claimed work whose report or ownership evidence is incomplete.
- `remaining` — assigned files with no confirmed or unconfirmed evidence.

A global (non-path-scoped) `git status` is never completion or ownership evidence in parallel mode.

**One scoped same-backend retry.** After the first verified runner timeout on a multi-file dispatch, the orchestrator may dispatch exactly one recovery invocation: same backend, same model/effort, same original intent, and write scope limited to `remaining ∪ unconfirmed` — confirmed files are not repeated. The worker never edits the unresolved files inline and never falls back to another backend because of a timeout (the existing missing-executable fallback carve-out is unrelated and unaffected).

**Second timeout is terminal.** If the recovery invocation also has a verified runner timeout, the worker stops and reports `RESULT: PARTIAL` (at least one assigned file confirmed) or `RESULT: BLOCKED` (none confirmed), naming both timeout observations, the backend identity, all three ledger sets, and the next action.

**PARTIAL marker (control-plane, not a product edit).** Before returning `RESULT: PARTIAL`, the worker writes one JSON marker at a dispatcher-preallocated path: `.claude/artifacts/sessions/.partial-cli-batch-<backend>-<session-id>-<dispatch-id>.json`, where `<session-id>`/`<dispatch-id>` are safe slugs the dispatcher allocates before dispatch (never a raw timestamp, to avoid collisions). The marker records backend, session/dispatch identity, the `assigned`/`confirmed`/`remaining`/`unconfirmed` sets, both timeout observations, and the next action. It is reported as a separate control-plane output, never counted in the assigned-scope edited-file list, never matches `.pending-*`, and is never auto-cleared by the worker or by a reviewer sweep — it stays until a human or the orchestrator explicitly reconciles it. An unresolved PARTIAL marker blocks marking the implementation task complete, but it is not itself a reviewer sentinel and does not gate on reviewer approval.

**Six-file starting guideline.** Recommend splitting a mechanical batch with more than six assigned product files into independently verifiable batches; six is an unmeasured starting point, not a wrapper or CLI setting. A deliberately larger batch requires an override reason recorded in the dispatch record and the worker's report — the worker itself never expands or splits its own assigned scope.

## Live CI/deploy verification loops are dispatchable work

Watching a live CI run (`gh run watch`), triaging its run logs, and babysitting retries is dispatchable work — route it to `dhpk:smoke-tester` (read-only probe) or a background `fast-worker`, per the §Implementation dispatch table row, so the main context consumes only the resulting merge/fix decision rather than running the poll/triage loop inline.

## Gate preservation (edited-file-list back-stop)

Worker dispatch never weakens a gate. `fast-worker` always reports its complete edited-file list (mandatory, even on a failed/escalated attempt — see its agent body). After a dispatch returns, the orchestrator checks for pending sentinels as usual; subagent Edit/Write triggers the same PostToolUse hooks as a main-loop edit in the default Claude Code hook wiring, so sentinels are the common path. If a project setup ever does not fire hooks for subagent tool calls, the orchestrator derives the applicable reviewer gates from the edited-file list instead and runs them — same Post-implementation agent gate either way.

## Verify worker output before accepting (implement phase)

When a `fast-worker` (or `deep-reasoner` → `fast-worker`) dispatch returns, before marking the task complete the orchestrator (a) re-surfaces the worker's verification line (`<command> → PASS|FAIL`) and complete assigned-scope edited-file list plus out-of-scope observations into the conversation, so the goal loop's conversation-only Haiku evaluator can see the evidence; (b) in parallel mode, cross-checks the assigned list against path-scoped `git status --short -- <assigned files>` / `git diff --name-only -- <assigned files>` and investigates any mismatch; (c) after all workers in the batch finish, performs the one whole-tree shared-state reconciliation described above; (d) confirms the review sentinels expected for the edited file types are present or were already cleared by a reviewer that ran, and when an expected sentinel is missing invokes the reviewer derived from the assigned edited-file list (activating the back-stop above rather than leaving it dead); (e) on a worker FAIL, out-of-scope write, or 3-attempt escalation, does NOT mark the task complete and re-scopes or re-dispatches `deep-reasoner` for a corrected fix-spec. This is a lightweight cross-check — the full test-suite re-run stays the `dhpk-opsx-apply-goal` Part 3 end-gate, not a per-task step. Wait on the dispatched worker's completion notification; NEVER bash-poll `.pending-*` sentinels or sleep-loop awaiting agent results — this does not restrict the deterministic-completion-signal polling sanctioned by §No block-polling a running worker below (polling an observable artifact such as a DB row baseline for a mutating worker remains permitted).

## Repository Discovery Gate and explicit hard rules

Before finalizing new DB, SQL, query-builder, criteria, model-persistence, or repository-like code, run a Repository Discovery Gate: inspect the project's existing repository/query-layering convention, identify the current boundary, and route new persistence behavior through that boundary unless the human explicitly approves an exception. A design artifact is a planning snapshot, not permission to bypass a project hard rule discovered during implementation. Controller- or service-local persistence code must be moved to the repository/query layer, or the exception must be recorded with the approving human's decision.

Anti-rationalization handling is mandatory here. If the reason for bypassing a rule sounds like "disproportionate", "approved design already chose this", "small enough to defer", "no human is available", or another cost-based deferral, load `${CLAUDE_PLUGIN_ROOT}/rules/anti-rationalization.md` before proceeding. The outcome is one of two states: comply with the explicit hard rule, or stop and record a human-approved exception. In unattended goal mode, no human being present is never implicit approval; default to compliance, and if compliance is genuinely blocked, halt and report via the hard-rule escalation artifact named by `dhpk-opsx-apply-goal`.

## Phase scoping (implement phase only)

The dispatch table governs the **implement phase**. OpenSpec artifact authoring (proposal / specs / design / tasks) is orchestrator-inline reasoning work — it is NOT mechanical and is never dispatched to `fast-worker`; the orchestrator authors it, seeded by any preceding investigation. Root-cause investigation dispatches read-only `deep-reasoner`, whose conclusion contract seeds the fix-spec or the authored artifacts. In plan mode only read-only workers (`deep-reasoner`, `Explore`) may be dispatched — `fast-worker` cannot apply edits until plan mode is exited; `deep-reasoner` **is** permitted in plan mode because it is read-only.

## Decision gate before dispatching a write worker

For a `REASONER_REQUIRED` decision, the read-only reasoner runs before a writer.
Static / structural facts a Read settles are `CLEAR`, but a behavioral, runtime,
algorithm, data-shape, cross-file, or public-contract choice is not. Route a
runtime observation to the executable probe or `e2e-runner` the reasoner names;
do not turn an unobserved runtime claim into a writer task. The reasoner must
return the exact canonical result and preserve its `## Conclusion`, file-and-line
evidence, and `## Next actions`; only `READY_FOR_DISPATCH` supplies a bounded
writer spec. `DECISION_FOR_USER` is `HUMAN_REQUIRED`; `BLOCKED` stops.

## Sanity-check a `deep-reasoner` conclusion before `fast-worker` applies it

Before dispatching `fast-worker` to apply a conclusion contract, confirm it carries file-and-line evidence and next-actions precise enough to serve as a task spec. Re-work a vague or evidence-free conclusion (return it to `deep-reasoner`, or resolve it inline) rather than dispatching it for application — a wrong confident conclusion otherwise costs a full 3-attempt apply-and-fail cycle.

## Kill switch

`orchestration_dispatch=off` restores pre-change implementation behavior
exactly: inline implementation, no implementation-worker/reasoner dispatch
prohibition, and no `dhpk-opsx-apply-goal` directive line (see that skill's
wiring). The mandatory multi-task OpenSpec planner is an independent lifecycle
gate and remains active in off mode; it may dispatch `planner` before inline
writes. This is a full opt-out of implementation routing, not a bypass of
planner or verification gates.

## No block-polling a running worker

While a dispatched `local_agent`/background worker is still running, the orchestrator MUST NOT block-poll it with a short-timeout monitor/output call (a repeated or single long-timeout `TaskOutput`-style wait) to check progress, and MUST NOT Read or grep the running agent's `output_file`/raw JSONL transcript for the same purpose. A blocking poll against a still-running agent risks dumping the subagent's raw JSONL transcript into the main conversation, burning tokens with no decision-useful information — this happened in the `fe13512c` session where a 300s blocking poll dumped a subagent's raw JSONL into main context, and the same session later grepped a running reviewer's `output_file` mid-run, the very anti-pattern it had just shipped. Instead, wait for the task's completion notification event, then fetch the agent's final result.

**Silence is not a hang; peek before you kill.** A long Playwright step or a single mega-action (a full checkout / clear-settlement / batch write) is slow by nature, so output/mtime silence alone is NOT a hang signal. Before issuing a `TaskStop` against a quiet background agent, peek its last action (most recent tool_use) — a killed agent's completion `<result>` is a *mid-flight* message, not a final verdict, so a premature kill both loses the verdict and costs a resume cycle. In one session an e2e-runner went silent for ~4 minutes mid-action and was killed as "hung"; the `<result>` then showed it was one dialog-accept away from completing.

**Await a mutating agent by a deterministic completion signal.** When waiting on an agent that mutates observable state (inserts a DB row, writes a file), poll that artifact as the done-signal — e.g. `SELECT MAX(id) > baseline` on the row it will write — rather than an mtime heuristic. One deterministic hit both confirms completion and directly yields the observed value; in one session a single `SELECT MAX(settlement_id)` poll replaced four idle mtime-silence loops and returned the observed row in the same step.

**The Stop hook does not sense in-flight agents.** The Stop hook reads only the goal's own stop conditions (sentinels / tasks), so while a background reviewer or worker is in flight it keeps firing "still-open" reminders that do not mean the session is stuck. Bridge the wait with a heartbeat / `ScheduleWakeup` (or the deterministic-signal poll above) and do NOT treat the repeated Stop reminders as evidence of a hang.

## SendMessage reuse vs. spawn

When a follow-up dispatch targets the same test file, the same user journey, or would otherwise benefit from context (fixtures, environment overrides, prior findings) already accumulated by a still-addressable prior worker, reuse that agent via `SendMessage` rather than spawning a new one. When the follow-up is unrelated in scope (different file, different journey, no shared context to preserve), spawn a new agent instead.

For any configured sentinel-backed reviewer, the orchestrator records one
`.resumed-review-obligations` entry before sending `SendMessage`. The entry fixes
the slot, exact sentinel basename, resolved agent, session/dispatch identity,
resume timestamp, and artifact baseline. Intermediate responses do not clear or
consume it. A final response requires actual review work, findings or an explicit
no-findings statement, and a parseable verdict; the orchestrator then reconciles
only the exact sentinel when a fresh canonical artifact and matching ownership
are proven. Native `SubagentStop` remains first choice and the fallback is
idempotent. A missing, stale, foreign, misplaced, malformed, or conflicting
artifact keeps the gate pending; at most one corrected resume is allowed before
replacement or an explicit blocker, and no duplicate reviewer is dispatched
while the original remains addressable. Session evidence: a 7-round reuse of one
`e2e-runner` via `SendMessage` preserved its env overrides and fixtures across
rounds and was the best-practice pattern observed in the `fe13512c` run.

**Resuming a pending REVIEWER via `SendMessage`** carries an extra obligation the general reuse rule above does not: run `bash scripts/hooks/record-resumed-obligation.sh <sentinel-name>` BEFORE the `SendMessage` call, capture its `RESUMED_REVIEW_IDENTITY ...` output (including any non-empty optional plan/artifact fingerprints), and include that exact identity envelope in the resumed reviewer instruction. The reviewer must copy every declared envelope field into the new canonical artifact frontmatter; the fallback then proves both that a NEW review doc was written during the resume and that it belongs to this handoff rather than trusting the resumed reply on its own (design: `fix-resumed-review-sentinel-clearance`). Classify the resumed reply as intermediate or final before acting on it — a final reply must contain actual review work (findings or an explicit no-findings statement) plus a parseable verdict; anything else is intermediate and the sentinel stays armed. On a final reply, run `bash scripts/hooks/reconcile-resumed-review.sh <sentinel-name>`; while the resumed reviewer remains addressable, do not dispatch a duplicate — send at most one corrected resume for a missing/invalid result, then replace the reviewer or leave an explicit pending gate with a recorded reason, mirroring the existing corrected-retry contract in §Reviewer dispatch. Full fallback mechanics and freshness rules: `${CLAUDE_PLUGIN_ROOT}/skills/dhpk-execution-policy/references/review-gate-mechanics.md` §Resumed reviewer reconcile contract.

## `CODEX=on` high-stakes parallel peer path

For a high-stakes implement-phase design/diagnosis decision, dispatch `deep-reasoner` and the Codex peer in parallel, each blind to the other's findings, per §Multi-AI / dual-perspective independence — do not feed one side's conclusion into the other's prompt. The concrete Codex-peer mechanism is the `dhpk-codex-bridge` subagent (a one-shot `codex exec` via `${CLAUDE_PLUGIN_ROOT}/skills/dhpk-codex-bridge/scripts/run-codex.sh`, output quarantined in the subagent and relayed verbatim) — the plugin's **third** Codex path, distinct from the in-session MCP `codex-*` skills (structured review/implement, output in the main context) and the external `codex:` app-server plugin (persistent broker). `dhpk-codex-bridge` also serves non-peer `CODEX=on` dispatch: offloading a self-contained clear-spec bulk task to gpt-5.5, per the §Implementation dispatch row. The `dhpk-opsx-apply-goal` goal template wires this path **proactively**: under `CODEX=on` it instructs the orchestrator to run a parallel `dhpk-codex-bridge` independent review before finalizing a high-stakes **solo** design edit or decision that has no inter-agent contradiction to trigger the §In-flight doubt cycle. The trigger list includes the goal-template generator itself, an SSOT policy file, a spec-requirement deferral, first-seen query/repository patterns, framework-internal hacks or private-state resets, and explicit-rule deferrals. As a **wrap-up self-check**, the goal template additionally requires that a session which declared `CODEX=on` but dispatched `dhpk-codex-bridge` 0 times, before declaring the goal complete, enumerate its high-risk decision points and either run one retrospective `dhpk-codex-bridge` peer review or record an explicit per-point "why-not" — so a declared CODEX=on capability that fired 0 times is reconciled rather than left silently unused (three consecutive goal sessions had a 0-dispatch `dhpk-codex-bridge` under CODEX=on before this backstop). Default (codex-free) sessions never take any of this path; `deep-reasoner` alone handles the work.

## Session-environment traps

The shell is zsh, where `status` is a read-only variable — use `st=` / `rc=` for captured exit codes, never `status=`. PR self-merge is classifier-blocked — never attempt `gh pr merge --admin` or remote branch deletion from an agent session; hand off to a human.

## Cross-verify a premise-overturning worker discovery before reframing

When a worker returns a finding that *overturns an existing design premise* — "the bug is not reproducible as `design.md` assumed", "the documented approach cannot work", any result that changes the plan's direction — treat it as an approach-changing decision, not a routine result. Before reframing the plan on that single finding, obtain an **independent** second opinion per §Multi-AI / dual-perspective independence: in a default (codex-free) session, a second `deep-reasoner` pass prompted independently from the source (never fed the first conclusion); when `CODEX=on`, the `dhpk-codex-bridge` peer. A single model overturning its own earlier premise is exactly the shared-blind-spot case independence guards against — orchestrator-inline self-confirmation is not a substitute. Once the reframe is agreed and before the reframed artifacts go to the doc-review gate, run a **keyword sweep**: grep the whole change directory (proposal / design / tasks / specs) for the old, now-disproven wording and update or remove every remaining occurrence — stale wording surviving the reframe otherwise causes a doc-reviewer BLOCK → fix → re-review round that the sweep would have avoided.
