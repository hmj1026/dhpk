# implementation-dispatch Specification

## Purpose
TBD - created by archiving change dhpk-orchestration-workers. Update Purpose after archive.
## Requirements
### Requirement: Dispatch decision table in execution-policy (SSOT)

`rules/execution-policy.md` SHALL define an "Implementation dispatch" section — the single source of truth for implement-phase routing while `orchestration_dispatch=on`:

- Reasoning-heavy work (unknown root cause, algorithm design, cross-file complex analysis) → `deep-reasoner`
- Purely mechanical work with a clear, spec-exact task (boilerplate, test scaffolds, rename sweeps, CLI-backed repetitive edits) → the selector-resolved fast-worker backend
- Judgment-dense but standardizable work touching more than two files (bounded description migrations, bilingual documentation restructuring, or a batch of known review fixes) → in-process `fast-worker` by default
- Small diffs (roughly ≤2 files with unambiguous intent) → inline in the main loop
- Complex implementation → `deep-reasoner` produces the fix spec, then `fast-worker` applies it
- RED PHPUnit unit/integration test that must be authored test-first and run against a live DB (e.g. Testbench / docker MySQL) → `tdd-guide` — distinct from `e2e-runner` (Playwright), read-only `deep-reasoner` (cannot run a test), and `fast-worker` (whose "make verification pass" contract conflicts with authoring a failing RED test)
- Plan critique / blind-sketch / dual-plan before implementation, or a warm diff review at task end → `dhpk:planner`, opt-in via `/dhpk:do --plan` on the implementation-class routes (`dhpk:adaptive-dev-workflow`, `dhpk:opsx-apply-goal`)
- Dispatching `general-purpose` for implementation is prohibited while `orchestration_dispatch=on`

For a parallel mechanical batch, the section SHALL require every worker task spec to declare `Parallel: yes`, exact assigned repo-relative file paths, per-file intent, and a path-scoped verification command or explicit report-only outcome. Globs, directory guesses, and unlisted generated files are not valid scope; a worker that needs another file SHALL return `BLOCKED` rather than expand the list. A worker SHALL treat that assigned list as its write, diff, and verification boundary. Shared validators and ratchet/configuration files are reconciled once by the orchestrator after the batch.

Workers MAY report out-of-scope observations, but an out-of-scope write SHALL remain `BLOCKED` and SHALL NOT be repaired by the worker. Workers SHALL NOT run `git checkout`, `git restore`, `git reset`, `git clean`, forceful deletion, or equivalent cleanup against out-of-scope files.

When a validator reads or modifies shared ratchet/configuration state, workers SHALL use a dispatcher-provided scoped or no-write equivalent. If none exists, the default result is `BLOCKED`; report-only is permitted only when explicitly declared by the dispatcher. A task whose intended output includes shared state SHALL run serially.

The section SHALL additionally state an **orchestrator posture**: the main session is the expensive, high-capability orchestrator whose implement-phase job is to decide, dispatch, and verify — not to hand-type mechanical edits. Dispatch to a worker is the **default**; inline is a **narrow exception**, not a co-equal option. The section SHALL state that the "≤2 files" inline bound is measured on the **whole implement-step footprint, not each individual Edit** — a run of individually-small mechanical edits that together touch more than two files is one `fast-worker` dispatch (batched into a single fix-spec), and that **when the choice between inline and `fast-worker` is unclear, the orchestrator dispatches**. The section SHALL further state a **plan-brief discipline** sentence: any brief assembled for a dispatched agent — including the `dhpk:planner` plan brief — SHALL follow conclusions-not-context, a bounded token budget, and a lookup fence, so downstream skills that build their own briefs for `dhpk:planner` follow the same shape.

Downstream skills SHALL reference this section, not restate it.

#### Scenario: Mechanical task routed to fast-worker
- **WHEN** adaptive-dev-workflow reaches Implement with an approved, precise plan
- **THEN** the orchestrator dispatches the selector-resolved fast-worker, not `general-purpose`

#### Scenario: Judgment-dense batch routes to the in-process fast-worker
- **WHEN** an implement step has a bounded, standardizable intent touching three or more files but requires consistent wording or cross-file judgment
- **THEN** the orchestrator dispatches `dhpk:fast-worker` with one fix-spec rather than authoring the batch inline

#### Scenario: Small diff stays inline
- **WHEN** the change is a 1-file, unambiguous edit
- **THEN** the orchestrator implements inline without dispatching any worker

#### Scenario: Multi-file mechanical work is not salami-sliced into inline
- **WHEN** an implement step applies a clear, mechanical spec that together touches more than two files (e.g. a doc mirror plus a script and its test)
- **THEN** the orchestrator dispatches one selector-resolved fast-worker with one batched fix-spec rather than performing the edits inline on the grounds that each individual edit is small

#### Scenario: Ambiguous inline-vs-worker choice resolves to dispatch
- **WHEN** the orchestrator is unsure whether a step qualifies as an inline small diff or worker work
- **THEN** it dispatches `dhpk:fast-worker` rather than defaulting to inline

#### Scenario: Parallel task spec declares its safety boundary
- **WHEN** a mechanical batch is dispatched to more than one worker in a shared checkout
- **THEN** each task spec declares parallel mode, exact assigned files, per-file intent, and scoped verification before the worker starts

#### Scenario: RED PHPUnit test routes to tdd-guide, not e2e-runner
- **WHEN** an implement step requires authoring a test-first RED PHPUnit unit/integration test that must run against a live DB
- **THEN** the orchestrator dispatches `dhpk:tdd-guide` (not `e2e-runner`, which is Playwright-scoped, nor `fast-worker`, whose contract conflicts with a failing RED test)

#### Scenario: Plan critique before implementation routes to planner
- **WHEN** `/dhpk:do --plan` resolves to one of the four implementation-class routes
- **THEN** the orchestrator dispatches `dhpk:planner` for a pre-implementation plan consult before invoking the target implementation skill

#### Scenario: Plan-brief discipline applies to the planner brief
- **WHEN** the orchestrator assembles a brief for a `dhpk:planner` dispatch
- **THEN** the brief follows conclusions-not-context, a bounded token budget, and a lookup fence, per the dispatch-table's plan-brief discipline sentence

### Requirement: Skill wiring in dhpk:do downstream flows
`skills/dhpk-adaptive-dev-workflow/SKILL.md` (bug/feature classification and implement rows) SHALL route the implement phase through the Implementation dispatch table. `commands/do.md` SHALL remain unchanged (router only) EXCEPT the opt-in `--plan` flow added by this change: brief assembly, `dhpk:planner` dispatch, verdict fold-in, and warm-review obligation recording — no implementation logic beyond that carve-out.

#### Scenario: /dhpk:do feature request end-to-end
- **WHEN** `/dhpk:do "implement <feature>"` routes to adaptive-dev-workflow in a session with `orchestration_dispatch=on`
- **THEN** mechanical implement steps dispatch `dhpk:fast-worker` and reasoning-heavy steps dispatch `dhpk:deep-reasoner`

#### Scenario: Bug with unknown root cause
- **WHEN** adaptive-dev-workflow runs a bug branch with no confirmed root cause
- **THEN** the investigation step dispatches `dhpk:deep-reasoner`, and the resulting fix spec is applied by `dhpk:fast-worker` or inline per the table

#### Scenario: /dhpk:do without --plan is unchanged router-only behavior
- **WHEN** `/dhpk:do` runs without `--plan`
- **THEN** behavior is unchanged and router-only, with no `dhpk:planner` dispatch or plan-brief assembly

#### Scenario: --plan on an implementation-class route runs the planner consult before the target skill
- **WHEN** `--plan` is present and the resolved route is one of the four implementation-class routes
- **THEN** the `dhpk:planner` consult happens before the target skill invocation, per the carve-out

### Requirement: opsx-apply-goal emits the dispatch directive for unattended sessions

When `orchestration_dispatch=on`, the Step 6 Part 0 kickoff of the `/goal` condition emitted by `skills/opsx-apply-goal/SKILL.md` SHALL include a **compact** posture-first dispatch directive that (a) names the session as the orchestrator, (b) carries a one-line dispatch roster — mechanical/multi-file clear-spec work to `dhpk:fast-worker`, reasoning-heavy work to `dhpk:deep-reasoner`, RED PHPUnit unit/integration tests to `dhpk:tdd-guide`, Playwright RED/E2E specs to `dhpk:e2e-runner` — (c) restricts inline editing to a ≤2-file whole-implement-step footprint plus the orchestrator's own bookkeeping (tasks.md checkboxes, sentinel handling), (d) prohibits `general-purpose` for implementation, (e) states the session's CODEX on/off setting explicitly on one line (the CODEX=off line keeps its short "cross-model doubt skipped (CODEX=off)" skip-announced wording inline), and (f) carries the self-locating pointer to `rules/execution-policy.md` — resolved via `$CLAUDE_PLUGIN_ROOT` first, then the newest installed cache path, never a filesystem scan — which the orientation step reads. The behavioral elaborations that previously rode Part 0 — the dispatch-verify procedure, the doc-consistency example, "when unsure, dispatch", premise-verification routing (deep-reasoner vs e2e-runner/scratch-probe), and the CODEX=on proactive high-stakes-peer path — reside in `rules/execution-policy.md` (§Implementation dispatch, §In-flight doubt cycle, §CODEX=on high-stakes parallel peer path) and SHALL NOT be restated in the emitted condition; they bind the session through the orientation-step policy read, with the condition's inline roster and gates as the fallback when the policy file is unresolvable. The Part 1–4 stop/verification conditions retain their semantics; worker-produced sentinels still converge through the universal `ls .pending-*` gate (Part 2). The skill's Verification checklist SHALL assert the compact directive's presence — orchestrator naming, the four-role roster, the inline bound, the `general-purpose` prohibition, the CODEX on/off line, and the policy pointer — when `DISPATCH_ON=true`, and SHALL assert the relocated elaborations are present in `rules/execution-policy.md` rather than in the template.

#### Scenario: Dry-run output includes the compact directive

- **WHEN** `/dhpk:opsx-apply-goal <change-id> --dry-run` runs with dispatch enabled
- **THEN** the emitted `/goal` Part 0 names the session as orchestrator, carries the one-line four-role roster, bounds inline to a ≤2-file whole-step footprint plus bookkeeping, prohibits `general-purpose`, states the session's CODEX on/off setting, and points to the self-locating execution-policy path — without restating the premise-verification, doubt-cycle, or high-stakes-peer elaborations

#### Scenario: Dispatch disabled

- **WHEN** `orchestration_dispatch=off`
- **THEN** the emitted `/goal` Part 0 is the single-paste opsx:apply kickoff with the orientation instruction and policy pointer but no dispatch roster

#### Scenario: Execution-policy reference stays self-locating

- **WHEN** the emitted `/goal` Part 0 references execution-policy
- **THEN** the reference resolves `$CLAUDE_PLUGIN_ROOT` first with the installed-cache fallback, never a bare repo-relative path and never a filesystem scan

#### Scenario: Relocated elaborations bind via the orientation read

- **WHEN** a goal session's orientation step resolves and reads `rules/execution-policy.md`
- **THEN** the premise-verification routing, doubt-cycle announcements, and CODEX=on high-stakes-peer obligations apply to the session from that read, exactly as they previously applied from the inline Part 0 text

### Requirement: Review gates are preserved under worker dispatch
Worker edits SHALL remain subject to the full post-implementation agent gate and sentinel machinery. After a `fast-worker` dispatch returns, the orchestrator SHALL check for pending sentinels; if the project's post-edit hooks did not fire for subagent tool calls, the orchestrator SHALL derive the applicable reviewer gates from the worker's edited-file list and run them (back-stop). Dispatch never weakens a gate.

#### Scenario: Worker edits a PHP file
- **WHEN** `fast-worker` edits a `*.php` file
- **THEN** `code-reviewer` runs before the task is considered complete — via the sentinel if written, otherwise via the edited-file-list back-stop

### Requirement: CODEX=on high-stakes parallel peer path
Under `CODEX=on`, for high-stakes decisions the orchestrator SHALL dispatch `deep-reasoner` and the Codex peer in parallel on the same problem, blind to each other, per execution-policy §Multi-AI / dual-perspective independence, then synthesize. Default sessions remain codex-free.

#### Scenario: Codex-free default
- **WHEN** a session runs without the codex opt-in
- **THEN** no `mcp__codex__*` call occurs anywhere in the dispatch flow

#### Scenario: Blind parallel consult
- **WHEN** `CODEX=on` and the orchestrator faces a high-stakes design/diagnosis decision
- **THEN** the Codex prompt contains the question + paths + stack only — no deep-reasoner findings — and divergences are flagged in the synthesis

### Requirement: Orchestrator verifies worker output before accepting (implement phase)

When a `fast-worker` (or a `deep-reasoner` → `fast-worker`) dispatch returns during the implement phase, the orchestrator SHALL, before marking the task complete: (a) re-surface the worker's verification line (`<command> → PASS|FAIL`) and its complete assigned-scope edited-file list plus any out-of-scope observations into the main conversation, so the goal loop's evidence is visible to the conversation-only Haiku evaluator; (b) in parallel mode, cross-check the reported assigned-scope list against path-scoped `git status --short -- <assigned files>` / `git diff --name-only -- <assigned files>` and investigate any mismatch; (c) after all workers in the batch finish, perform the whole-tree reconciliation and shared-validator pass exactly once; (d) confirm the review sentinels expected for the edited file types are present, or were already cleared by a reviewer that ran — and when an expected sentinel is missing, invoke the reviewer derived from the assigned edited-file list (activating the edited-file-list back-stop defined by the "Review gates are preserved under worker dispatch" requirement, rather than leaving it dead); (e) on a worker FAIL or 3-attempt escalation, NOT mark the task complete, and re-scope or re-dispatch `deep-reasoner` for a corrected fix-spec. This is a lightweight cross-check — the full test-suite re-run remains the `opsx-apply-goal` Part 3 end-gate, not a per-task step.

#### Scenario: Worker no-op detected via scoped diff mismatch
- **WHEN** a parallel worker reports assigned files that do not appear in the assigned-scope status/diff
- **THEN** the orchestrator treats the task as unverified and investigates rather than marking it complete

#### Scenario: Sibling edits are not attributed to a worker
- **WHEN** a parallel worker's shared checkout contains edits to files outside its assigned list
- **THEN** those files are recorded as out-of-scope observations and are not treated as that worker's edited-file result

#### Scenario: Whole-tree reconciliation waits for the batch
- **WHEN** multiple parallel workers have returned and all assigned-scope verification has completed
- **THEN** the orchestrator performs one whole-tree validator/reconciliation pass with sibling edits visible together

#### Scenario: Missing sentinel activates the back-stop
- **WHEN** a worker edits a file type that should trigger a reviewer but no corresponding `.pending-*` sentinel exists and no reviewer ran
- **THEN** the orchestrator invokes the reviewer derived from the assigned edited-file list before accepting the task

#### Scenario: Worker failure is not marked complete
- **WHEN** a `fast-worker` returns FAIL or escalates after 3 attempts
- **THEN** the orchestrator leaves the task unchecked and re-scopes or re-dispatches `deep-reasoner` instead of proceeding

### Requirement: Dispatch posture is implement-phase; authoring and investigation are scoped separately

The Implementation dispatch table governs the **implement phase** only. OpenSpec artifact authoring (proposal / specs / design / tasks) is orchestrator-inline reasoning work — it is NOT mechanical and SHALL NOT be dispatched to `fast-worker`; the orchestrator authors it, seeded by any preceding investigation. Root-cause investigation SHALL dispatch read-only `deep-reasoner`, whose conclusion contract seeds the fix-spec or the authored artifacts. In plan mode, only read-only workers (`deep-reasoner`, `Explore`) may be dispatched — `fast-worker` cannot apply edits until plan mode is exited or the unattended implement session runs; `deep-reasoner` IS permitted in plan mode because it is read-only.

#### Scenario: Spec authoring stays inline
- **WHEN** the orchestrator authors an OpenSpec change's proposal/design/tasks (e.g. via `opsx:ff`)
- **THEN** it writes them inline as reasoning-heavy content and does not dispatch `fast-worker` for the authoring

#### Scenario: Plan-mode investigation uses deep-reasoner
- **WHEN** a root-cause investigation runs in plan mode
- **THEN** the orchestrator may dispatch `deep-reasoner` (read-only) but does not dispatch `fast-worker`, whose edits plan mode blocks; the fix is planned and applied after plan mode exits

### Requirement: `deep-reasoner` conclusion is sanity-checked before `fast-worker` applies it

Before dispatching `fast-worker` to apply a `deep-reasoner` conclusion contract, the orchestrator SHALL confirm the contract carries file:line evidence and next-actions precise enough to serve as a `fast-worker` task spec. A vague or evidence-free conclusion SHALL be re-worked (returned to `deep-reasoner`, or resolved inline) rather than dispatched for application, avoiding a wasted `fast-worker` apply-and-fail cycle.

#### Scenario: Evidence-free conclusion is not applied
- **WHEN** a `deep-reasoner` conclusion lacks file:line evidence or precise next-actions
- **THEN** the orchestrator re-works it before any `fast-worker` apply dispatch, rather than handing it off as-is

### Requirement: Premise verification before a write dispatch

Before dispatching `fast-worker` to write for a task that rests on an unverified **behavioral premise** — that a bug reproduces under the given fixture/data, that an algorithm or formula is correct, or that an assumed data-shape / plan-dependency holds — the orchestrator SHALL first verify the premise, and SHALL dispatch `fast-worker` only once the premise holds. Verification routing is probe-matched to what the premise is actually about: a code/algorithm/data-shape premise (settleable by reading and reasoning over code) is verified by dispatching read-only `deep-reasoner`; a runtime/browser/environment behavior premise (scroll position, render timing, an environment-dependent effect — not settleable by reading code alone) is verified by dispatching `e2e-runner` or a scratch executable probe, since `deep-reasoner` cannot itself execute or observe such behavior. **Cross-file load-order / script-registration timing is a runtime premise, not a structural one** — extracting an inline `<script>` block into a separately-registered page asset can look like a mechanical file-move, but it changes *when* that code runs relative to state it depends on (a `const` the page defines inline, a third-party widget's own ready/draw sequence); verify the new load position against that dependency **before** writing the extraction, with a scratch probe or `e2e-runner`, not by shipping a first attempt and diagnosing the failure after. This check is distinct from, and logically prior to, the `deep-reasoner`-conclusion sanity-check (which checks that a produced conclusion is precise enough to apply): premise verification checks the assumption the task is built on before any fix-spec exists. Because `deep-reasoner` and `e2e-runner`'s read/observe-only verification runs are read-only with respect to the premise itself, this obligation applies in plan mode as well.

#### Scenario: Unverified bug-repro premise is verified before a RED-test dispatch
- **WHEN** a task requires writing a RED regression test whose design assumes a bug reproduces deterministically in small fixture data, and that reproduction has not been verified
- **THEN** the orchestrator dispatches `deep-reasoner` to verify the reproduction premise before dispatching `fast-worker` to write the test

#### Scenario: Disproven premise is reframed, not dispatched
- **WHEN** premise verification shows the behavioral premise does not hold (e.g. the bug is plan-dependent and non-deterministic, not reproducible in the fixture)
- **THEN** the orchestrator reframes the task (e.g. a unit shape-lock instead of an integration RED) rather than dispatching `fast-worker` against the impossible premise, avoiding a wasted apply-and-fail cycle

#### Scenario: Runtime/browser premise is verified with an executable probe, not deep-reasoner
- **WHEN** the premise under verification is a runtime/browser/environment behavior claim (e.g. "the page scrolls to X on this action") that `deep-reasoner` cannot itself execute or observe
- **THEN** the orchestrator dispatches `e2e-runner` (or a scratch executable probe) to confirm it, rather than dispatching `deep-reasoner` to assert it from reading code alone

#### Scenario: Cross-file script-extraction load-order is treated as a runtime premise
- **WHEN** an implement step extracts an inline `<script>` block into a separately-registered page asset
- **THEN** the orchestrator verifies the new load-order/timing against the dependencies the extracted code relies on before dispatching the extraction as a write, treating it as a runtime/environment-behavior premise rather than a structural one settled by a single Read

### Requirement: A premise-overturning worker discovery is independently cross-verified before reframing

When a dispatched worker returns a finding that **overturns an existing design premise** — for example "the bug is not reproducible as `design.md` assumed" or "the documented approach cannot work" — the orchestrator SHALL treat it as an approach-changing decision and obtain an **independent** second opinion per §Multi-AI / dual-perspective independence before reframing the plan on that finding. In a default (codex-free) session the independent opinion SHALL be a second `deep-reasoner` pass prompted independently from the source (never fed the first conclusion); when `CODEX=on` it MAY be the `codex-bridge` peer. Orchestrator-inline self-confirmation SHALL NOT substitute for the independent pass. After the reframe is agreed, and BEFORE the reframed artifacts are sent to the doc-review gate, the orchestrator SHALL grep the whole change directory (proposal/design/tasks/specs) for the old, now-disproven wording — a keyword sweep — and update or remove every remaining occurrence, so that stale wording surviving the reframe does not cause a doc-reviewer BLOCK -> fix -> re-review round.

#### Scenario: Overturned design premise triggers an independent cross-check
- **WHEN** a `fast-worker` escalation reports that the bug is not reproducible as the design assumed, overturning the plan's premise
- **THEN** the orchestrator obtains an independent second opinion (a fresh, independently-prompted `deep-reasoner` pass, or `codex-bridge` under `CODEX=on`) before reframing the approach, rather than self-confirming inline alone

#### Scenario: Codex-free session uses a second deep-reasoner, not codex-bridge
- **WHEN** the session is codex-free (default) and a worker overturns a design premise
- **THEN** the independent cross-verification is a second `deep-reasoner` pass and no `codex-bridge` / `mcp__codex__*` path is taken

#### Scenario: Stale wording is swept before the doc gate
- **WHEN** the orchestrator reframes a change's artifacts after a premise-overturning discovery
- **THEN** it greps the change directory for the disproven wording and fixes every remaining occurrence before dispatching `doc-reviewer`, rather than letting the reviewer catch it and issuing a BLOCK

### Requirement: Orchestrator confirms a reviewer cleared its sentinel (Closing-hook back-stop)

Reviewer sentinel clearance is hook-driven: `subagent-stop-verify.sh` auto-clears a successful reviewer's sentinel as the sanctioned path, and reviewer agent definitions carry no manual clear step. This is nonetheless not guaranteed (a crashed reviewer, a missed `SubagentStop` event, or a resumed `SendMessage` result that does not emit the same event). After a reviewer returns, the orchestrator SHALL verify the final verdict and fresh canonical artifact, then reconcile the exact sentinel basename through the native hook result or the recorded resumed-review/Stop-time back-stop. A stale or missing artifact SHALL leave the sentinel armed. A BLOCK/FAIL or actionable severity result SHALL remain visible through `.unresolved-verdict`; clearing the lifecycle obligation SHALL NOT be reported as approval.

#### Scenario: Hook auto-clear handles the routine case

- **WHEN** a reviewer subagent stops successfully with a fresh review artifact
- **THEN** `subagent-stop-verify.sh` clears the sentinel and the orchestrator's check confirms nothing is left to clear manually

#### Scenario: Resumed reviewer uses the artifact-backed back-stop

- **WHEN** a reviewer reused through `SendMessage` returns a final verdict with a fresh canonical artifact but its sentinel remains present
- **THEN** the orchestrator consumes the matching resumed-review obligation and clears only the exact corresponding sentinel through the sanctioned reconcile path

#### Scenario: Reviewer APPROVE without fresh evidence leaves a sentinel armed

- **WHEN** a reviewer returns APPROVE but no fresh canonical artifact proves the current review cycle
- **THEN** the orchestrator leaves the sentinel armed and does not treat the message as completed review evidence

#### Scenario: Reviewer BLOCK remains unresolved

- **WHEN** a reviewer returns BLOCK or FAIL, or its fresh artifact records actionable critical/high/medium findings
- **THEN** the orchestrator preserves the unresolved-verdict evidence and does not mark the review gate approved even if the sentinel lifecycle is reconciled

#### Scenario: Exact basename is required

- **WHEN** the orchestrator or resumed-review fallback clears a sentinel manually through the SSOT
- **THEN** it passes the full `.pending-*` basename from `SENTINEL_NAMES` (a keyword such as `review` is rejected as an unknown sentinel name)

### Requirement: No block-polling a running local_agent worker

While a dispatched `local_agent`/background worker is still running, the orchestrator SHALL NOT block-poll it with a short-timeout monitor/output call (e.g. a repeated or single long-timeout `TaskOutput`-style wait) as a way to check progress, and SHALL NOT Read or grep the running agent's `output_file`/raw JSONL transcript for the same purpose. Either action risks dumping the subagent's raw transcript (JSONL) into the main conversation, burning tokens without adding decision-useful information. The orchestrator SHALL instead wait for the task's completion notification event, then fetch the agent's final result.

Output silence is NOT a hang signal: a long Playwright step or a single mega-action (a full checkout / clear-settlement / batch operation) is slow by nature, so mtime silence alone SHALL NOT be treated as a hang. Before issuing a `TaskStop` against a quiet background agent, the orchestrator SHALL peek the agent's last action (its most recent tool_use) — a killed agent's completion `<result>` is a mid-flight message, not a final verdict, so a premature kill both loses the verdict and wastes a resume cycle. When waiting on a **mutating** agent that writes an observable artifact (a new DB row, a file), the orchestrator SHOULD poll that artifact as a **deterministic completion signal** (e.g. `SELECT MAX(id) > baseline`) rather than mtime heuristics — one deterministic hit both confirms completion and directly yields the observed value. Because the Stop hook only reads the goal's own stop conditions and does not sense an in-flight background agent, while such an agent is in flight the orchestrator SHALL bridge the wait with a heartbeat / `ScheduleWakeup` (or a deterministic-signal poll) and SHALL NOT treat repeated Stop reminders as evidence the session is stuck.

#### Scenario: Orchestrator waits for the notification instead of polling
- **WHEN** a `fast-worker` or `deep-reasoner` background dispatch is still running
- **THEN** the orchestrator does not issue a blocking output-fetch call against it, and instead proceeds with other work until the completion notification arrives

#### Scenario: Result is fetched only after the completion notification
- **WHEN** the completion notification for a background worker dispatch arrives
- **THEN** the orchestrator fetches the agent's final result at that point — and at no earlier point did a blocking poll place the subagent's in-progress raw JSONL transcript into the main conversation

#### Scenario: Orchestrator does not read a running agent's output file
- **WHEN** a background worker/reviewer dispatch is still running and the orchestrator wants a progress signal
- **THEN** it does not Read or grep that agent's `output_file`/JSONL transcript, and waits for the completion notification instead

#### Scenario: Silence is not treated as a hang, and a peek precedes any kill
- **WHEN** a background agent has produced no output for several minutes while executing a known-slow step (e.g. a large Playwright action)
- **THEN** the orchestrator does not treat the silence as a hang; before any `TaskStop` it peeks the agent's last tool_use rather than killing blind, since a kill would surface only a mid-flight `<result>` and cost a resume cycle

#### Scenario: A mutating agent is awaited via a deterministic completion signal
- **WHEN** the orchestrator is waiting on an agent that mutates state by writing an observable artifact (e.g. inserts a settlement row)
- **THEN** it polls that artifact as the done-signal (e.g. `SELECT MAX(id) > baseline`) rather than relying on mtime silence, and does not treat the Stop hook's goal-condition reminders as evidence of being stuck while the agent is in flight

### Requirement: SendMessage reuse-vs-spawn criterion for worker agents

When a follow-up dispatch targets the same test file, the same user journey, or would otherwise benefit from context (fixtures, environment overrides, prior findings) already accumulated by a still-addressable prior worker dispatch, the orchestrator SHALL reuse that agent via `SendMessage` rather than spawning a new one. When the follow-up is unrelated in scope (different file, different journey, no shared context to preserve), the orchestrator SHALL spawn a new agent instead. When the reused agent is any configured sentinel-backed reviewer, the orchestrator SHALL record one session-scoped resumed-review obligation before sending `SendMessage` and SHALL not consider the review complete until its final result passes the artifact-backed sentinel reconcile contract.

#### Scenario: Same E2E journey reuses the prior e2e-runner
- **WHEN** a follow-up dispatch continues testing the same user journey an `e2e-runner` agent already has fixtures and environment overrides loaded for
- **THEN** the orchestrator sends the follow-up via `SendMessage` to that same agent rather than spawning a new one

#### Scenario: Unrelated task spawns a new agent
- **WHEN** a follow-up dispatch targets a different file and a different user journey with no shared accumulated context
- **THEN** the orchestrator spawns a new agent rather than reusing an unrelated prior one via `SendMessage`

#### Scenario: Resumed reviewer obligation is recorded
- **WHEN** a pending sentinel-backed reviewer is reused through `SendMessage`
- **THEN** the orchestrator records the reviewer, exact sentinel basename, session/dispatch identity, and resume timestamp before awaiting the final result

#### Scenario: Resumed reviewer cannot silently satisfy the gate
- **WHEN** a resumed reviewer sends an intermediate message or a final-looking message without a fresh matching artifact
- **THEN** the orchestrator leaves the review gate pending and does not clear the sentinel solely from that message

#### Scenario: One corrected resume precedes replacement
- **WHEN** a resumed reviewer remains addressable but returns a missing, stale, malformed, or otherwise invalid result
- **THEN** the orchestrator sends at most one corrected resume without dispatching a duplicate; a second failure leads to a replacement reviewer or an explicit human blocker

### Requirement: A warnings-only harness-validation result counts as green when pre-existing

The `opsx-apply-goal` completion/verify gate SHALL treat a harness-validator result (e.g. `scripts/validate/validate-harness.sh`) of PASS-with-warnings as green when every remaining warning is proven pre-existing — present and identical on a `git stash`-ed clean HEAD, unrelated to the change — and each is named in the completion summary. A warning that DISAPPEARS when the change is stashed is change-introduced and SHALL block, mirroring the existing pre-existing-*failure* rule for test runners. Optionally, `validate-harness.sh` MAY exit 0 (not 2) when only warnings remain, so a non-zero exit reliably signals a real failure; while it continues to exit non-zero on warnings, the gate SHALL NOT treat that non-zero exit alone as a failure when the PASS-with-warnings line and the pre-existing proof are present.

#### Scenario: Pre-existing warnings do not block the gate
- **WHEN** `validate-harness.sh` reports PASS-with-warnings and each warning is identical on a stashed clean HEAD (unrelated to the change) and named in the summary
- **THEN** the completion gate treats the result as green

#### Scenario: A change-introduced warning blocks
- **WHEN** a `validate-harness.sh` warning disappears when the change is stashed (so the change introduced it)
- **THEN** the gate does not treat the result as green until that warning is resolved

### Requirement: CODEX proactive peer triggers cover first-seen query patterns, framework internals, and explicit-rule deferrals
When `CODEX=on`, the implementation dispatch policy and generated `opsx-apply-goal` Part 0 SHALL require a proactive `codex-bridge` independent review before finalizing a high-stakes solo decision that introduces a repository/query pattern not previously used in the repo, uses a framework-internal hack or private-state reset, or defers an explicit project hard rule. This SHALL extend, not replace, the existing high-stakes solo trigger list.

#### Scenario: First-seen query pattern gets a Codex peer
- **WHEN** a `CODEX=on` implementation introduces a query-builder JOIN or repository/query style that is new to the repo
- **THEN** the orchestrator runs a proactive `codex-bridge` independent review before treating that approach as final

#### Scenario: Framework-internal hack gets a Codex peer
- **WHEN** a `CODEX=on` implementation relies on framework private state, reflection against framework internals, or another framework-internal workaround
- **THEN** the orchestrator runs a proactive `codex-bridge` independent review before accepting the workaround

#### Scenario: Explicit-rule deferral gets a Codex peer
- **WHEN** a `CODEX=on` implementation proposes deferring an explicit project hard rule such as Repository / query-layering placement
- **THEN** the orchestrator runs a proactive `codex-bridge` independent review before the deferral can stand

### Requirement: Repository Discovery Gate precedes new persistence code
Before new DB, SQL, query-builder, criteria, model-persistence, or repository-like code is finalized, the orchestrator SHALL check the project's repository/query-layering convention and route new persistence behavior through the existing boundary. Controller- or service-local persistence code SHALL NOT be accepted merely because the OpenSpec design snapshot named that cheaper placement.

#### Scenario: Controller-local DB code is not accepted by design snapshot alone
- **WHEN** implementation adds new DB update/select logic in a controller and the project convention places persistence in repositories
- **THEN** the orchestrator moves the behavior to the repository boundary or records a human-approved exception before the task is marked complete

#### Scenario: Reviewer flags hard-rule violation as actionable
- **WHEN** a reviewer flags a Repository / query-layering hard-rule violation at MEDIUM or higher severity
- **THEN** the orchestrator treats it as an actionable fix, not as an optional follow-up, unless a human explicitly approves the exception

### Requirement: Explicit project hard rules cannot be rationalized away by cost or prior design
The implementation dispatch policy SHALL state that explicit project hard rules, including SSOT and query-layering rules, outrank cost-based reasoning such as "disproportionate", "approved design already chose this", or "small enough to defer". Before skipping such a rule, the orchestrator SHALL load the anti-rationalization guidance and either comply with the rule or obtain explicit human approval for an exception.

#### Scenario: Prior design conflicts with hard rule
- **WHEN** an approved design suggests an implementation that violates an explicit project hard rule discovered during implementation
- **THEN** the orchestrator follows the hard rule or asks for explicit human approval to proceed with the exception

#### Scenario: Cost language triggers anti-rationalization
- **WHEN** the orchestrator is about to skip a hard rule using cost language such as "disproportionate" or "acceptable to defer"
- **THEN** it loads the anti-rationalization guidance and re-evaluates before proceeding

### Requirement: opsx-apply-goal emits the expanded CODEX and hard-rule guardrails

When `orchestration_dispatch=on`, the `/goal` condition emitted by `skills/opsx-apply-goal/SKILL.md` SHALL bind the expanded `CODEX=on` proactive peer triggers (first-seen query/repository patterns, framework-internal hacks, explicit-rule deferrals) through the one-line CODEX declaration plus the orientation-read execution-policy sections that define them — not by restating the trigger list in the condition. The Repository / explicit-hard-rule guardrail SHALL remain inline in the condition (the hard-rule carve-out sentence and the Part 4 hard-rule-escalation stop clause), since it is a stop-condition safety clause, not a behavioral elaboration. The dry-run verification checklist SHALL assert the CODEX declaration line and the inline hard-rule clauses are present, and that the expanded trigger list is present in `rules/execution-policy.md`.

#### Scenario: Dry-run carries the CODEX declaration, policy carries the triggers

- **WHEN** `/dhpk:opsx-apply-goal <change-id> --codex --dry-run` runs with dispatch enabled
- **THEN** the emitted `/goal` states CODEX=on on one line pointing at the execution-policy CODEX sections, the expanded trigger categories are found in `rules/execution-policy.md`, and the emitted condition does not enumerate them

#### Scenario: Dry-run includes hard-rule guardrail inline

- **WHEN** `/dhpk:opsx-apply-goal <change-id> --dry-run` runs with dispatch enabled
- **THEN** the emitted `/goal` text states inline that explicit project hard rules cannot be deferred because a prior design chose a cheaper implementation, and Part 4 carries the hard-rule-escalation stop clause

### Requirement: Unattended goal-mode hard-rule conflicts default to compliance and halt outright when blocked
When `orchestration_dispatch` operates inside an unattended `/goal`-driven session (`opsx-apply-goal`), an explicit project hard-rule conflict SHALL NOT be resolved by proceeding without human authorization, and SHALL NOT be resolved by waiting indefinitely for a human who is not present. The orchestrator SHALL default to strict compliance with the hard rule; if compliance is genuinely blocked pending a human decision, the orchestrator SHALL halt the goal loop immediately, write a hard-rule escalation artifact under the active change directory identifying the rule, the conflicting decision, and file:line evidence, and end the turn. It SHALL NOT silently defer, downgrade, or treat "no human available" as implicit permission to proceed.

#### Scenario: Hard-rule conflict in unattended mode defaults to compliance
- **WHEN** an unattended `/goal` session, following an approved design, discovers the design conflicts with an explicit project hard rule
- **THEN** the orchestrator complies with the hard rule instead of the design, without waiting for a human confirmation that cannot arrive

#### Scenario: Compliance is genuinely blocked pending human input
- **WHEN** complying with the hard rule requires a decision only a human can make and no human is present in the unattended session
- **THEN** the orchestrator halts the goal loop immediately, writes `openspec/changes/<CHANGE_ID>/.hard-rule-escalation.md`, and does not continue implementing past that point

#### Scenario: "No human available" is never read as permission
- **WHEN** the orchestrator is about to reason that the absence of a human implies permission to bypass a hard rule
- **THEN** it treats that reasoning itself as a rationalization requiring the anti-rationalization guidance (`rules/anti-rationalization.md`), and defaults to halt-and-report instead of proceeding

### Requirement: opsx-apply-goal Part 0 carves out hard-rule conflicts from "without stopping for confirmation"
`skills/opsx-apply-goal/SKILL.md` Part 0 SHALL state that "without stopping for confirmation" governs ordinary implementation judgment calls only, and SHALL NOT be read to authorize proceeding past an explicit project hard-rule conflict; Part 4 SHALL carry a corresponding stop clause that writes the hard-rule escalation artifact and ends the turn.

#### Scenario: Part 0 states the carve-out explicitly
- **WHEN** `opsx-apply-goal` emits Part 0 (either `orchestration_dispatch` setting)
- **THEN** the emitted text states the "without stopping for confirmation" instruction does not cover an explicit hard-rule conflict

#### Scenario: Dry-run asserts the carve-out and halt clause are present
- **WHEN** `/dhpk:opsx-apply-goal <change-id> --dry-run` runs
- **THEN** the emitted `/goal` text includes both the Part 0 carve-out sentence and the Part 4 hard-rule-escalation stop clause

### Requirement: The emitted opsx-apply-goal roster names tdd-guide for RED PHPUnit dispatch

When `orchestration_dispatch=on`, the dispatch roster embedded in the `/goal` condition emitted by `skills/opsx-apply-goal/references/goal-templates.md` SHALL name `dhpk:tdd-guide` as the dispatch target for a RED PHPUnit unit/integration test (authored test-first, run against a live DB), alongside `dhpk:e2e-runner` for Playwright RED/E2E specs. This closes the roster gap in which all RED work appeared to route to `e2e-runner` (Playwright-only), which had misled the orchestrator into dispatching `tdd-guide` roster-out on judgment alone. The Part 1–4 stop/verification conditions remain unchanged.

#### Scenario: Goal roster lists tdd-guide for RED PHPUnit
- **WHEN** `/dhpk:opsx-apply-goal <change-id> --dry-run` runs with dispatch enabled
- **THEN** the emitted `/goal` roster names `dhpk:tdd-guide` for RED PHPUnit unit/integration specs, distinct from `dhpk:e2e-runner` for Playwright RED/E2E

### Requirement: CODEX=on session-end self-check reconciles a zero-dispatch codex-bridge session

When `CODEX=on`, the session-end self-check — before declaring the goal complete, if `codex-bridge` was dispatched 0 times, enumerate the session's high-risk decision points and either run one retrospective `codex-bridge` independent peer review or record an explicit per-point "why-not" justification — SHALL be defined in `rules/execution-policy.md` (§CODEX=on high-stakes parallel peer path or an adjacent subsection) and bind goal sessions through the orientation-read policy plus the condition's one-line CODEX=on declaration; the emitted `/goal` condition SHALL NOT restate the self-check procedure. This complements — and does not replace — the proactive, before-finalizing high-stakes-peer path. Default (codex-free) sessions take none of this path.

#### Scenario: Zero-dispatch CODEX=on session still owes the wrap-up self-check

- **WHEN** a `CODEX=on` goal session that read the execution policy at orientation reaches its completion check having dispatched `codex-bridge` 0 times
- **THEN** the policy-defined self-check obliges the orchestrator to enumerate the session's high-risk decision points and either run one retrospective `codex-bridge` review or record a per-point "why-not" before declaring done

#### Scenario: The condition stays lean

- **WHEN** `/dhpk:opsx-apply-goal <change-id> --codex --dry-run` emits its condition
- **THEN** the self-check procedure text appears in `rules/execution-policy.md`, not in the emitted `/goal` string

#### Scenario: Codex-free session skips the self-check

- **WHEN** a default (codex-free) goal session reaches completion
- **THEN** no `codex-bridge` wrap-up self-check is required

### Requirement: Live CI/deploy verification loops are dispatchable work
The Implementation dispatch table SHALL include a row routing live CI/deploy verification work —
watching CI runs (`gh run watch`), triaging run logs, babysitting retries — to `smoke-tester`
(read-only probe) or a background `fast-worker`, with only merge/fix decisions retained in the
main context.

#### Scenario: CI babysitting is dispatched instead of held inline
- **WHEN** an implement step requires watching a CI run and triaging its failures across multiple polls
- **THEN** the orchestrator dispatches the watch/triage loop to smoke-tester or a background fast-worker and consumes only its conclusion, rather than running the loop in the main context

### Requirement: Background waits use completion notifications, never bash polling
The execution policy SHALL state that waiting on background agents or sentinel clearance is done
by waiting for agent completion notifications; bash sleep/poll loops against `.pending-*`
sentinels or idle sleep loops awaiting agent results are prohibited. This does not restrict the
deterministic-completion-signal polling already sanctioned by the existing "No block-polling a
running local_agent worker" requirement (polling an observable artifact such as a DB row baseline
for a mutating worker remains permitted).

#### Scenario: Waiting on a background reviewer
- **WHEN** a dispatched background reviewer has not yet completed and the orchestrator has nothing else actionable
- **THEN** the orchestrator ends the turn and resumes on the completion notification, instead of running sleep or polling loops in Bash

### Requirement: Session-environment traps are documented in policy guidance

The execution policy (or its implementation-dispatch reference) SHALL carry these one-line guidance notes: the shell is zsh where `status` is a read-only variable (use `st=`/`rc=`); words beginning with `=` trigger zsh `=cmd` path expansion (an unquoted `==` yields `== not found`) — quote such words; PR self-merge is classifier-blocked, so `gh pr merge --admin` and remote branch deletion must not be attempted (hand to the human); and the post-edit advisory SHALL tell the model to run the pending reviewer BEFORE attempting commit/push. `rules/tool-routing.md` SHALL additionally state: when the GitNexus index contains multiple repositories, always pass the `repo` parameter to `gitnexus_impact`/`gitnexus_query` calls.

#### Scenario: Model avoids the zsh status trap

- **WHEN** a session composes a shell snippet that would assign to a variable named `status`
- **THEN** policy guidance steers it to `st=`/`rc=` naming, avoiding the read-only-variable error

#### Scenario: Model quotes =-leading words

- **WHEN** a session composes a shell one-liner containing a bare `==` or another `=`-leading word
- **THEN** policy guidance steers it to quote the word, avoiding the zsh `== not found` expansion error

#### Scenario: Multi-repo gitnexus call carries the repo parameter

- **WHEN** a session in a multi-repo GitNexus environment prepares a `gitnexus_impact` or `gitnexus_query` call
- **THEN** tool-routing guidance has it pass `repo` explicitly, avoiding the "Multiple repositories indexed" error-and-retry cycle

#### Scenario: Push attempted with a pending reviewer

- **WHEN** edits produced a pending review sentinel and the model prepares to commit/push
- **THEN** the post-edit advisory has already instructed running the reviewer first, so the push-gate block path is not exercised

### Requirement: Dispatch rows for CLI-backed fast-worker variants
The execution-policy Implementation dispatch section SHALL define a deterministic selector for the three mechanical backends: `fast-worker` is the shipped default and maps to the Claude/default backend; `codex-worker` and `agy-worker` (legacy aliases `codex-fast-worker` and `agy-fast-worker`) are selected only by an explicit backend preference or by the configured `auto` availability order. The selector SHALL check prerequisites before dispatch, record the requested and selected backend, and apply only the configured missing-executable fallback. Authentication, authorization, model, and task failures SHALL remain `RESULT: BLOCKED` and SHALL never silently switch backends.

#### Scenario: Default worker remains default
- **WHEN** a mechanical batch is dispatched with no backend preference
- **THEN** the table routes it to `fast-worker`

#### Scenario: Explicit Codex preference
- **WHEN** `fast_worker_backend=codex` and the Codex CLI is available
- **THEN** the batch routes to `codex-worker` under the shared task-spec contract

#### Scenario: Auto preference follows configured order
- **WHEN** `fast_worker_backend=auto`, agy is first in the configured order but unavailable, and Codex is available
- **THEN** the selector records agy as unavailable and routes to `codex-worker`

#### Scenario: Backend execution failure is not silently substituted
- **WHEN** the selected CLI rejects authentication or the requested model
- **THEN** the worker reports `RESULT: BLOCKED` and does not silently run another backend

### Requirement: Post-review fix application is a dispatch-table row
The execution-policy dispatch decision table SHALL contain a row routing post-review fix application — reviewer findings forming a clear fix-spec whose whole batch exceeds the ≤2-file inline bound — to the fast-worker tier (in-process or CLI-backed per the backend selector). The inline exception SHALL be measured on the whole fix batch, not per finding.

#### Scenario: Orchestrator receives multi-file review findings
- **WHEN** consolidated review returns findings spanning more than two files
- **THEN** the orchestrator dispatches the fixes as one batched fast-worker task instead of applying them inline

#### Scenario: Single trivial finding stays inline
- **WHEN** the whole fix batch is a one-file, few-line edit
- **THEN** the inline exception applies and no dispatch is required

### Requirement: Specialist fix-spec handback is a dispatch-table row
The dispatch decision table SHALL contain a row routing fix-specs handed back by planning/acceptance specialists (tdd-guide GREEN handback, e2e-runner application-bug reports) to the fast-worker tier resolved by the backend selector, with acceptance owned by the originating specialist's stated verification command.

#### Scenario: tdd-guide hands back a GREEN fix-spec
- **WHEN** tdd-guide returns RED tests plus a fix-spec exceeding the inline bound
- **THEN** the orchestrator dispatches the selector-resolved fast-worker with that fix-spec and re-runs the scoped tests as acceptance

### Requirement: RED Vitest/Jest tests have an explicit dispatch row
The execution-policy Implementation dispatch table SHALL include a row for RED Vitest/Jest tests with the same routing semantics as the existing RED PHPUnit row: route to `tdd-guide`, with the inline exception permitted when the step's whole footprint is 2 files or fewer.

#### Scenario: RED Vitest test routes to tdd-guide
- **WHEN** the orchestrator faces a failing (RED) Vitest or Jest test whose fix footprint exceeds 2 files
- **THEN** the dispatch table directs it to `tdd-guide` rather than leaving the routing to ad-hoc judgment

#### Scenario: Small Vitest fix stays inline
- **WHEN** a RED Vitest/Jest fix has a whole-step footprint of 2 files or fewer
- **THEN** the table permits inline handling, mirroring the PHPUnit row

### Requirement: Reasoner backend selection is a dispatch-table row
The execution-policy Implementation dispatch section SHALL define the deep-reasoning backend selection: `deep-reasoner` (Claude, default) and `codex-reasoner` (codex CLI, default `gpt-5.6-sol` @ `high`; legacy alias: `codex-deep-reasoner`), selected per invocation by the `--reasoner` flag or its userConfig chain. Both backends SHALL receive the same reasoning task brief and return the conclusion contract. Missing-executable fallback (codex → claude) SHALL be the only silent substitution; authentication, model, and task failures SHALL remain `RESULT: BLOCKED`.

#### Scenario: Default reasoning dispatch is unchanged
- **WHEN** a reasoning-heavy task is dispatched with no `--reasoner` flag or codex userConfig preference
- **THEN** the table routes it to `deep-reasoner` exactly as before this change

#### Scenario: Codex reasoning backend selected
- **WHEN** `--reasoner=codex` is active and the codex CLI is available
- **THEN** the reasoning task routes to `codex-reasoner` under the same conclusion contract

### Requirement: Shared validator state has one orchestrator-owned writer

When a global validator reads or modifies shared ratchet/configuration state during a parallel mechanical batch, workers SHALL use a dispatcher-provided scoped or no-write equivalent. Workers SHALL NOT modify the shared state. Without a safe equivalent, the worker SHALL return `BLOCKED` unless the dispatcher explicitly declared report-only. After all workers return, the orchestrator SHALL run one sequential global validation and reconcile the shared state once.

#### Scenario: Parallel workers observe a shared ratchet file
- **WHEN** multiple workers edit disjoint files whose validator uses a shared ratchet/configuration file
- **THEN** each worker reports its own newly exceeding assigned files without modifying the shared ratchet file

#### Scenario: Orchestrator reconciles shared state once
- **WHEN** all workers in the parallel batch have completed assigned-scope verification
- **THEN** the orchestrator performs one sequential validator/reconciliation pass and records the consolidated result

#### Scenario: No scoped equivalent is available
- **WHEN** a worker task has no safe per-file or report-only verification equivalent for a global validator
- **THEN** the worker returns `BLOCKED` by default, or the explicitly declared report-only result, naming the missing command and does not invent or invoke a shared-state mutation path

### Requirement: Parallel workers cannot mutate out-of-scope files

When a worker runs under an explicit parallel-dispatch marker, it SHALL NOT run `git checkout`, `git restore`, `git reset`, `git clean`, forceful deletion, or an equivalent cleanup operation against files outside its assigned list. A worker that observes out-of-scope changes SHALL report them and leave cleanup to the orchestrator after the batch. Any out-of-scope write remains `BLOCKED`.

#### Scenario: Sibling edits appear in the working tree
- **WHEN** a worker sees files modified by sibling workers outside its assigned list
- **THEN** it reports those files as out-of-scope observations and does not attempt to revert them

#### Scenario: Worker verification uses assigned files
- **WHEN** a parallel worker verifies its own changes
- **THEN** it uses path-scoped status/diff checks for the assigned list and does not infer ownership from a whole-tree status result

### Requirement: Orchestration owns dispatch and handoff while Sentinel owns enforcement

The orchestration layer SHALL own worker/reviewer selection, dispatch, follow-up handoff, bounded retry, lifecycle transitions, result collection, and acceptance sequencing. The existing Sentinel enforcement core SHALL remain the independent source of pending review debt, reviewer-slot identity, evidence eligibility, and fail-closed clearance. Sentinel hooks MUST NOT become an agent scheduler, and orchestration MUST NOT directly erase or synthesize passing Sentinel evidence.

#### Scenario: Edit arms a review obligation

- **WHEN** an implementation edit matches a configured review trigger
- **THEN** Sentinel records the pending obligation and orchestration dispatches the resolved reviewer without transferring clearance ownership to that reviewer

#### Scenario: Reviewer hands back a final result

- **WHEN** a reviewer returns a result for the current dispatch
- **THEN** orchestration records the handoff and invokes the existing evidence reconciliation path while Sentinel alone determines whether the obligation can clear

#### Scenario: Reviewer result lacks qualifying evidence

- **WHEN** a reviewer message appears successful but its artifact is missing, stale, malformed, out of scope, or non-passing
- **THEN** orchestration leaves the task unresolved and Sentinel keeps the obligation armed

### Requirement: Dispatch lifecycle integration is additive

Architecture migration SHALL reuse the current dispatch table, reviewer slots, sentinel names, evidence artifact contract, and public orchestration commands. New coordination ports MAY wrap these behaviors, but MUST NOT introduce a second dispatch policy, second sentinel-clear implementation, parallel public command version, or alternate verdict vocabulary.

#### Scenario: Orchestration port wraps an existing reviewer dispatch

- **WHEN** a dispatch/handoff adapter is introduced during migration
- **THEN** it resolves the same agent, sentinel slot, and acceptance contract as the characterized existing flow

#### Scenario: Proposed component duplicates enforcement

- **WHEN** a new coordinator attempts to clear review debt independently of the Sentinel core
- **THEN** architecture validation rejects the duplicate enforcement path
