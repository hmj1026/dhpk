# implementation-dispatch Specification

## Purpose

Defines implementation routing across inline work, worker tiers, and specialist roles while preserving dispatch ownership and verification boundaries.

## Requirements

The requirements below describe the current dispatch, verification, review, and
evidence contract. Acceptance is based on applicable outcomes and current
evidence; orchestration does not depend on a retired marker or named producer.

### Requirement: Dispatch decision table in execution-policy (SSOT)

`rules/execution-policy.md` SHALL define an "Implementation dispatch" section — the single source of truth for implement-phase routing while `orchestration_dispatch=on`:

- Reasoning-heavy work (unknown root cause, algorithm design, cross-file complex analysis) → `deep-reasoner`
- Purely mechanical work with a clear, spec-exact task (boilerplate, test scaffolds, rename sweeps, CLI-backed repetitive edits) → a Provider-neutral Dispatch Engine `worker` target
- Judgment-dense but standardizable work with a bounded, repeatable intent, known verification, and a coordination or consistency benefit from a shared owner → the Provider-neutral in-process `worker` tier when delegation fits
- Work with settled decisions, one clear owner, adequate local context, and low coordination need → inline in the main loop, regardless of file count
- Complex implementation → `deep-reasoner` resolves the non-trivial uncertainty before a writer; select inline or the resolved Provider-neutral `worker` tier from ownership, coupling, context locality, verification needs, and coordination benefit
- RED PHPUnit unit/integration test that must be authored test-first and run against a live DB (e.g. Testbench / docker MySQL) → `tdd-guide` — distinct from `e2e-runner` (Playwright), read-only `deep-reasoner` (cannot run a test), and the `worker` tier (whose "make verification pass" contract conflicts with authoring a failing RED test)
- Plan critique / blind-sketch / dual-plan before implementation, or a warm diff review at task end → `dhpk:planner`; pre-implementation consultation is explicit via `/dhpk:do --plan` on the implementation-class routes (`dhpk:adaptive-dev-workflow`, `dhpk:opsx-apply-goal`), while a missing planning outcome may also warrant a consult
- Dispatching `general-purpose` for implementation is prohibited while `orchestration_dispatch=on`

For a parallel mechanical batch, the section SHALL require every worker task spec to declare `Parallel: yes`, exact assigned repo-relative file paths, per-file intent, and a path-scoped verification command or explicit report-only outcome. Globs, directory guesses, and unlisted generated files are not valid scope; a worker that needs another file SHALL return `BLOCKED` rather than expand the list. A worker SHALL treat that assigned list as its write, diff, and verification boundary. Shared validators and ratchet/configuration files are reconciled once by the orchestrator after the batch.

Workers MAY report out-of-scope observations, but an out-of-scope write SHALL remain `BLOCKED` and SHALL NOT be repaired by the worker. Workers SHALL NOT run `git checkout`, `git restore`, `git reset`, `git clean`, forceful deletion, or equivalent cleanup against out-of-scope files.

When a validator reads or modifies shared ratchet/configuration state, workers SHALL use a dispatcher-provided scoped or no-write equivalent. If none exists, the default result is `BLOCKED`; report-only is permitted only when explicitly declared by the dispatcher. A task whose intended output includes shared state SHALL run serially.

The section SHALL additionally state an **orchestrator posture**: the main session is the high-capability owner of the requested outcome whose implement-phase job is to decide, assign ownership, and verify. It SHALL select inline, worker, or parallel work from ownership, coupling, context locality, scope clarity, verification needs, and coordination benefit; task and file counts alone SHALL NOT trigger planning or delegation. A sufficient plan from any producer MAY be reused, and a supported explicit `--plan` request remains an explicit planner consult. The section SHALL further state a **plan-brief discipline** sentence: any brief assembled for a dispatched agent — including the `dhpk:planner` plan brief — SHALL follow conclusions-not-context, a bounded token budget, and a lookup fence, so downstream skills that build their own briefs for `dhpk:planner` follow the same shape.

Downstream skills SHALL reference this section, not restate it.

#### Scenario: Mechanical task routed to fast-worker

- **WHEN** adaptive-dev-workflow reaches Implement with an approved, precise plan
- **THEN** the orchestrator dispatches the Provider-neutral Dispatch Engine `worker` target, not `general-purpose`

#### Scenario: Coordination benefit routes a standardizable batch to the in-process fast-worker

- **WHEN** an implement step has a bounded, standardizable intent whose independent ownership or consistency needs make a separate worker useful
- **THEN** the orchestrator dispatches the Provider-neutral in-process `worker` tier with one fix-spec because of that coordination benefit, regardless of file count

#### Scenario: Settled cohesive work stays inline

- **WHEN** a settled implementation has one clear owner, adequate local context, and low coordination need, even if its approved scope touches multiple files
- **THEN** the orchestrator may implement inline without dispatching a worker based solely on file count

#### Scenario: Independent ownership can warrant delegation

- **WHEN** a settled implementation has independently owned scopes, meaningful coupling boundaries, or coordination risk that benefits from a separate owner
- **THEN** the orchestrator may assign bounded worker scopes for those reasons without using task or file counts as the trigger

#### Scenario: Adequate plan is reused

- **WHEN** existing text, a file, or a report establishes scope, outcomes, supporting observations, and remaining gaps for an implementation with multiple tasks
- **THEN** the orchestrator reuses that evidence and does not dispatch a planner solely because of task count

#### Scenario: Missing outcome receives a targeted follow-up

- **WHEN** existing planning evidence leaves one material dependency or ownership decision unresolved
- **THEN** the orchestrator seeks that specific outcome before dependent writes without repeating settled planning work

#### Scenario: Explicit planning consult remains available

- **WHEN** `/dhpk:do --plan` is explicitly requested on an implementation-class route
- **THEN** the planner consult runs under the existing interface even when a sufficient plan already exists

#### Scenario: Ambiguous inline-vs-worker choice resolves to dispatch

- **WHEN** the orchestrator is unsure whether a step qualifies as an inline small diff or worker work
- **THEN** it dispatches the Provider-neutral `worker` tier rather than defaulting to inline

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

Adaptive-dev workflow SHALL continue to consume the Implementation dispatch
table. `dhpk-do` SHALL own router orchestration while consuming that table as
policy SSOT. `/dhpk:do` SHALL be a thin adapter and neither command nor skill
SHALL restate worker/reasoner decision rows.

#### Scenario: /dhpk:do feature request end-to-end

- **WHEN** `/dhpk:do "implement <feature>"` reaches adaptive-dev-workflow with dispatch on
- **THEN** mechanical and reasoning-heavy work use the targets selected by execution-policy

#### Scenario: Bug with unknown root cause

- **WHEN** adaptive-dev-workflow has no confirmed root cause
- **THEN** the selected reasoner produces the fix spec and application follows the existing table

#### Scenario: /dhpk:do without --plan is unchanged router-only behavior

- **WHEN** `/dhpk:do` or `$dhpk-do` runs without `--plan`
- **THEN** routing proceeds without planner brief or consult

#### Scenario: --plan on an implementation-class route runs the planner consult before the target skill

- **WHEN** `--plan` resolves to an implementation-class target
- **THEN** `dhpk-do` consults planner before the target and retains the warm-review obligation

### Requirement: opsx-apply-goal emits the dispatch directive for unattended sessions

When `orchestration_dispatch=on`, the Step 6 Part 0 kickoff of the `/goal` condition emitted by `skills/dhpk-opsx-apply-goal/SKILL.md` SHALL include a **compact** posture-first dispatch directive that (a) names the session as the orchestrator, (b) carries a one-line dispatch roster — bounded mechanical work to the Provider-neutral `worker` tier (implemented by `dhpk:fast-worker` where applicable), reasoning-heavy work to the Provider-neutral `reasoner` tier (implemented by `dhpk:deep-reasoner` where applicable), RED PHPUnit unit/integration tests to `dhpk:tdd-guide`, Playwright RED/E2E specs to `dhpk:e2e-runner` — (c) states that inline, worker, or parallel execution is selected from ownership, coupling, context locality, scope clarity, verification needs, and coordination benefit, with task and file counts alone not creating a gate, (d) prohibits `general-purpose` for implementation, (e) states the retired CODEX interface and its blocking deprecation diagnostic explicitly on one line, without treating it as a peer, worker, or reasoner selector, and (f) carries the self-locating pointer to `rules/execution-policy.md` — resolved via `$CLAUDE_PLUGIN_ROOT` first, then the newest installed cache path, never a filesystem scan — which the orientation step reads. The behavioral elaborations that previously rode Part 0 — the dispatch-verify procedure, the doc-consistency example, premise-verification routing (deep-reasoner vs e2e-runner/scratch-probe), and the explicit second-opinion path — reside in `rules/execution-policy.md` (§Implementation dispatch, §In-flight doubt cycle, §High-stakes second opinion after flag retirement) and SHALL NOT be restated in the emitted condition; they bind the session through the orientation-step policy read, and SHALL fail closed with an unresolved-policy handoff when the policy file cannot be resolved; the compact text is not authority to continue without the policy. The Part 1–4 stop/verification conditions retain their semantics; worker verification and applicable review outcomes remain visible to the goal gate. The skill's Verification checklist SHALL assert the compact directive's presence — orchestrator naming, the four-role roster, outcome-based routing posture, the `general-purpose` prohibition, the retired CODEX/deprecation line, and the policy pointer — when `DISPATCH_ON=true`, and SHALL assert the relocated elaborations are present in `rules/execution-policy.md` rather than in the template.

#### Scenario: Dry-run output includes the compact directive

- **WHEN** `/dhpk:opsx-apply-goal <change-id> --dry-run` runs with dispatch enabled
- **THEN** the emitted `/goal` Part 0 names the session as orchestrator, carries the one-line four-role roster, states the outcome-based routing posture with no task/file-count gate, prohibits `general-purpose`, states the retired CODEX/deprecation status, and points to the self-locating execution-policy path — without restating the premise-verification, doubt-cycle, or explicit second-opinion elaborations

#### Scenario: Dispatch disabled

- **WHEN** `orchestration_dispatch=off`
- **THEN** the emitted `/goal` Part 0 is the single-paste opsx:apply kickoff with the orientation instruction and policy pointer but no dispatch roster

#### Scenario: Execution-policy reference stays self-locating

- **WHEN** the emitted `/goal` Part 0 references execution-policy
- **THEN** the reference resolves `$CLAUDE_PLUGIN_ROOT` first with the installed-cache fallback, never a bare repo-relative path and never a filesystem scan

#### Scenario: Relocated elaborations bind via the orientation read

- **WHEN** a goal session's orientation step resolves and reads `rules/execution-policy.md`
- **THEN** the premise-verification routing, doubt-cycle announcements, and explicit second-opinion obligations apply to the session from that read, while the retired CODEX interface remains a blocking deprecation outcome rather than a dispatch trigger

### Requirement: Applicable review outcomes are preserved under worker dispatch

Worker edits SHALL remain subject to the applicable post-implementation review outcomes and current project acceptance. The orchestrator SHALL derive applicable review domains from the edited-file list when required evidence is missing, and SHALL accept sufficient current external review evidence. Retired marker machinery, named reviewer prerequisites, and duplicate review receipts are not mandatory gates. Dispatch never weakens a required outcome.

#### Scenario: Worker edits a PHP file

- **WHEN** `fast-worker` edits a `*.php` file
- **THEN** the applicable code-review outcome is established by the current review wave or sufficient external evidence; a named `code-reviewer` dispatch is used only when that outcome is missing or explicitly requested

### Requirement: High-stakes second opinions require explicit opt-in after CODEX retirement

The orchestrator SHALL require explicit caller opt-in before it MAY dispatch
`deep-reasoner` and an independent `codex-bridge` opinion in parallel, blind to
each other's findings, only when the caller explicitly requests
`--second-opinion=codex-exec`. The default path remains Codex-free, and the
retired `CODEX=on`/`--codex` interface never selects or implies a peer.

#### Scenario: Codex-free default

- **WHEN** a session runs without an explicit second-opinion request
- **THEN** no `codex-bridge` or retired `mcp__codex__*` call occurs anywhere in the dispatch flow

#### Scenario: Explicit blind second opinion

- **WHEN** the caller explicitly requests `--second-opinion=codex-exec` for a high-stakes design or diagnosis decision
- **THEN** the orchestrator may dispatch the independent Codex CLI opinion blind to the primary reasoning pass, and the synthesis records any divergence

### Requirement: Orchestrator verifies worker output before accepting (implement phase)

When a `fast-worker` (or a `deep-reasoner` → `fast-worker`) dispatch returns during the implement phase, the orchestrator SHALL, before marking the task complete: (a) re-surface the worker's verification line (`<command> → PASS|FAIL`) and its complete assigned-scope edited-file list plus any out-of-scope observations into the main conversation, so the goal loop's evidence is visible to the conversation-only Haiku evaluator; (b) in parallel mode, cross-check the reported assigned-scope list against path-scoped `git status --short -- <assigned files>` / `git diff --name-only -- <assigned files>` and investigate any mismatch; (c) after all workers in the batch finish, perform the whole-tree reconciliation and shared-validator pass exactly once; (d) confirm that applicable review outcomes are present and current, accepting sufficient external evidence when it covers the scope; when an outcome is missing, request only that missing review or evidence derived from the assigned edited-file list; (e) on a worker FAIL or 3-attempt escalation, NOT mark the task complete, and re-scope or re-dispatch `deep-reasoner` for a corrected fix-spec. This is a lightweight cross-check — the full test-suite re-run remains the `opsx-apply-goal` Part 3 end-gate, not a per-task step.

#### Scenario: Worker no-op detected via scoped diff mismatch

- **WHEN** a parallel worker reports assigned files that do not appear in the assigned-scope status/diff
- **THEN** the orchestrator treats the task as unverified and investigates rather than marking it complete

#### Scenario: Sibling edits are not attributed to a worker

- **WHEN** a parallel worker's shared checkout contains edits to files outside its assigned list
- **THEN** those files are recorded as out-of-scope observations and are not treated as that worker's edited-file result

#### Scenario: Whole-tree reconciliation waits for the batch

- **WHEN** multiple parallel workers have returned and all assigned-scope verification has completed
- **THEN** the orchestrator performs one whole-tree validator/reconciliation pass with sibling edits visible together

#### Scenario: Missing review outcome blocks acceptance

- **WHEN** a worker edits a file type with an applicable review domain but no current review outcome or sufficient external evidence exists
- **THEN** the orchestrator requests that scoped outcome before accepting the task

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

When a dispatched worker returns a finding that **overturns an existing design premise** — for example "the bug is not reproducible as `design.md` assumed" or "the documented approach cannot work" — the orchestrator SHALL treat it as an approach-changing decision and obtain an **independent** second opinion per §Multi-AI / dual-perspective independence before reframing the plan on that finding. In a default (codex-free) session the independent opinion SHALL be a second `deep-reasoner` pass prompted independently from the source (never fed the first conclusion); when the caller explicitly selects `--second-opinion=codex-exec` it MAY be the `codex-bridge` peer. Orchestrator-inline self-confirmation SHALL NOT substitute for the independent pass. After the reframe is agreed, and BEFORE the reframed artifacts are sent to the doc-review gate, the orchestrator SHALL grep the whole change directory (proposal/design/tasks/specs) for the old, now-disproven wording — a keyword sweep — and update or remove every remaining occurrence, so that stale wording surviving the reframe does not cause a doc-reviewer BLOCK -> fix -> re-review round.

#### Scenario: Overturned design premise triggers an independent cross-check

- **WHEN** a `fast-worker` escalation reports that the bug is not reproducible as the design assumed, overturning the plan's premise
- **THEN** the orchestrator obtains an independent second opinion (a fresh, independently-prompted `deep-reasoner` pass, or `codex-bridge` when `--second-opinion=codex-exec` is explicitly selected) before reframing the approach, rather than self-confirming inline alone

#### Scenario: Codex-free session uses a second deep-reasoner, not codex-bridge

- **WHEN** the session is codex-free (default) and a worker overturns a design premise
- **THEN** the independent cross-verification is a second `deep-reasoner` pass and no `codex-bridge` / `mcp__codex__*` path is taken

#### Scenario: Stale wording is swept before the doc gate

- **WHEN** the orchestrator reframes a change's artifacts after a premise-overturning discovery
- **THEN** it greps the change directory for the disproven wording and fixes every remaining occurrence before dispatching `doc-reviewer`, rather than letting the reviewer catch it and issuing a BLOCK

### Requirement: Orchestrator reconciles applicable review outcomes before acceptance

After a reviewer or sufficient external review evidence is returned, the orchestrator SHALL verify the final verdict, changed-scope coverage, freshness, and supporting artifact when one is supplied. Missing, stale, malformed, out-of-scope, or unresolved evidence SHALL remain pending and SHALL NOT be reported as approval. Actionable findings SHALL remain visible until resolved or explicitly escalated under the project review contract; acceptance SHALL be fail-closed on an unresolved applicable outcome.

#### Scenario: Current review evidence is accepted

- **WHEN** a reviewer or external report covers the current scope with a current, well-formed verdict and supporting evidence
- **THEN** the orchestrator records the applicable outcome and may proceed to the next acceptance gate

#### Scenario: Missing or stale review evidence blocks acceptance

- **WHEN** a review result is missing, stale, malformed, or does not cover the current scope
- **THEN** the orchestrator leaves the outcome unresolved and requests only the missing review or evidence

#### Scenario: Actionable review findings remain visible

- **WHEN** a current review reports BLOCK, FAIL, or actionable critical/high/medium findings
- **THEN** the orchestrator preserves that evidence, does not mark the task accepted, and routes the bounded fix or human escalation required by policy

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

When a follow-up dispatch targets the same test file, the same user journey, or would otherwise benefit from context (fixtures, environment overrides, prior findings) already accumulated by a still-addressable prior worker dispatch, the orchestrator SHALL reuse that agent via `SendMessage` rather than spawning a new one. When the follow-up is unrelated in scope (different file, different journey, no shared context to preserve), the orchestrator SHALL spawn a new agent instead. A reused reviewer or worker retains its task identity and context, but its final applicable outcome must still be current and evidence-backed; an intermediate message never completes the review.

#### Scenario: Same E2E journey reuses the prior e2e-runner

- **WHEN** a follow-up dispatch continues testing the same user journey an `e2e-runner` agent already has fixtures and environment overrides loaded for
- **THEN** the orchestrator sends the follow-up via `SendMessage` to that same agent rather than spawning a new one

#### Scenario: Unrelated task spawns a new agent

- **WHEN** a follow-up dispatch targets a different file and a different user journey with no shared accumulated context
- **THEN** the orchestrator spawns a new agent rather than reusing an unrelated prior one via `SendMessage`

#### Scenario: Resumed review retains identity and requires current evidence

- **WHEN** a reviewer is reused through `SendMessage`
- **THEN** the orchestrator preserves the task and dispatch identity, records the resume, and accepts completion only when the applicable outcome and supporting evidence are current

#### Scenario: Intermediate review messages do not satisfy acceptance

- **WHEN** a resumed reviewer sends an intermediate or final-looking message without sufficient current evidence
- **THEN** the orchestrator leaves the review outcome unresolved and requests the missing evidence or a bounded follow-up

#### Scenario: One corrected resume precedes replacement

- **WHEN** a reused reviewer remains addressable but returns a missing, stale, malformed, or otherwise invalid result
- **THEN** the orchestrator sends at most one corrected resume without duplicating the dispatch; a second failure leads to a replacement review or an explicit human blocker

### Requirement: A warnings-only harness-validation result counts as green when pre-existing

The `opsx-apply-goal` completion/verify gate SHALL treat a harness-validator result (e.g. `scripts/validate/validate-harness.sh`) of PASS-with-warnings as green when every remaining warning is proven pre-existing — present and identical on an owned clean baseline snapshot, unrelated to the change — and each is named in the completion summary. The comparison SHALL use a disposable snapshot or worktree and SHALL NOT automatically stash, reset, or restore the user's working tree. A warning that DISAPPEARS when compared with that baseline is change-introduced and SHALL block, mirroring the existing pre-existing-*failure* rule for test runners. Optionally, `validate-harness.sh` MAY exit 0 (not 2) when only warnings remain, so a non-zero exit reliably signals a real failure; while it continues to exit non-zero on warnings, the gate SHALL NOT treat that non-zero exit alone as a failure when the PASS-with-warnings line and the pre-existing proof are present.

#### Scenario: Pre-existing warnings do not block the gate

- **WHEN** `validate-harness.sh` reports PASS-with-warnings and each warning is identical on an owned clean baseline snapshot (unrelated to the change) and named in the summary
- **THEN** the completion gate treats the result as green

#### Scenario: A change-introduced warning blocks

- **WHEN** a `validate-harness.sh` warning disappears when compared with the owned clean baseline (so the change introduced it)
- **THEN** the gate does not treat the result as green until that warning is resolved

### Requirement: Explicit second-opinion triggers cover first-seen query patterns, framework internals, and explicit-rule deferrals

When a caller explicitly selects `--second-opinion=codex-exec`, the implementation dispatch policy SHALL require a proactive `codex-bridge` independent review before finalizing a high-stakes solo decision that introduces a repository/query pattern not previously used in the repo, uses a framework-internal hack or private-state reset, or defers an explicit project hard rule. Without that explicit opt-in, the default path remains Codex-free and uses the normal independent-review or degraded-state contract.

#### Scenario: First-seen query pattern gets an explicit Codex peer

- **WHEN** an implementation with `--second-opinion=codex-exec` introduces a query-builder JOIN or repository/query style that is new to the repo
- **THEN** the orchestrator runs a proactive `codex-bridge` independent review before treating that approach as final

#### Scenario: Framework-internal hack gets an explicit Codex peer

- **WHEN** an implementation with `--second-opinion=codex-exec` relies on framework private state, reflection against framework internals, or another framework-internal workaround
- **THEN** the orchestrator runs a proactive `codex-bridge` independent review before accepting the workaround

#### Scenario: Explicit-rule deferral gets an explicit Codex peer

- **WHEN** an implementation with `--second-opinion=codex-exec` proposes deferring an explicit project hard rule such as Repository / query-layering placement
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

### Requirement: opsx-apply-goal emits retired CODEX and hard-rule guardrails

When `orchestration_dispatch=on`, the `/goal` condition emitted by `skills/dhpk-opsx-apply-goal/SKILL.md` SHALL state the retired `CODEX=on`/`--codex` interface and its blocking deprecation outcome, without treating it as a peer selector. Any high-stakes independent-review triggers SHALL bind only through an explicit `--second-opinion=codex-exec` request and the orientation-read execution-policy sections that define them, not by restating a trigger list in the condition. The Repository / explicit-hard-rule guardrail SHALL remain inline in the condition (the hard-rule carve-out sentence and the Part 4 hard-rule-escalation stop clause), since it is a stop-condition safety clause. The dry-run verification checklist SHALL assert the retired CODEX/deprecation line and the inline hard-rule clauses are present, and that explicit second-opinion triggers are present in `rules/execution-policy.md`.

#### Scenario: Dry-run carries the retired CODEX declaration

- **WHEN** `/dhpk:opsx-apply-goal <change-id> --codex --dry-run` runs with dispatch enabled
- **THEN** the analyzer reports `STATUS=error` with `DEPRECATED_CODEX_FLAG`, names `--worker=codex` and `--second-opinion=codex-exec` as exact replacements, and emits no `/goal`; the explicit second-opinion route remains documented in `rules/execution-policy.md`

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
- **THEN** the orchestrator halts the goal loop immediately, writes `.hard-rule-escalation.md` under the resolved active change directory, and does not continue implementing past that point

#### Scenario: "No human available" is never read as permission

- **WHEN** the orchestrator is about to reason that the absence of a human implies permission to bypass a hard rule
- **THEN** it treats that reasoning itself as a rationalization requiring the anti-rationalization guidance (`rules/anti-rationalization.md`), and defaults to halt-and-report instead of proceeding

### Requirement: opsx-apply-goal Part 0 carves out hard-rule conflicts from "without stopping for confirmation"

`skills/dhpk-opsx-apply-goal/SKILL.md` Part 0 SHALL state that "without stopping for confirmation" governs ordinary implementation judgment calls only, and SHALL NOT be read to authorize proceeding past an explicit project hard-rule conflict; Part 4 SHALL carry a corresponding stop clause that writes the hard-rule escalation artifact and ends the turn.

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

### Requirement: Explicit second-opinion session-end evidence remains honest

When a goal explicitly requests `--second-opinion=codex-exec`, the session-end self-check — before declaring the goal complete, if `codex-bridge` was dispatched 0 times, record that no independent CLI opinion ran and either obtain the explicitly requested review or record an explicit per-point "why-not" justification — SHALL be defined in `rules/execution-policy.md` and bind goal sessions through the orientation-read policy. The emitted `/goal` condition SHALL NOT restate the self-check procedure, and the retiring release SHALL not infer an independent opinion from `CODEX=on`/`--codex`. Default (Codex-free) sessions take none of this path.

#### Scenario: Explicit request with zero dispatch remains degraded

- **WHEN** a goal session explicitly requests `--second-opinion=codex-exec` but reaches completion having dispatched `codex-bridge` 0 times
- **THEN** the policy-defined self-check records that no independent CLI opinion ran and either obtains the requested review or records a per-point "why-not" before declaring done

#### Scenario: The condition stays lean

- **WHEN** `/dhpk:opsx-apply-goal <change-id> --codex --dry-run` emits its condition
- **THEN** no condition is emitted; the retired flag's deprecation outcome is not converted into a peer dispatch, and any explicit second-opinion self-check remains in `rules/execution-policy.md`

#### Scenario: Codex-free session skips the self-check

- **WHEN** a default (Codex-free) goal session reaches completion
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

The execution policy SHALL state that waiting on background agents or review completion is done
by waiting for agent completion notifications; bash sleep/poll loops awaiting agent results are prohibited. This does not restrict the
deterministic-completion-signal polling already sanctioned by the existing "No block-polling a
running local_agent worker" requirement (polling an observable artifact such as a DB row baseline
for a mutating worker remains permitted).

#### Scenario: Waiting on a background reviewer

- **WHEN** a dispatched background reviewer has not yet completed and the orchestrator has nothing else actionable
- **THEN** the orchestrator ends the turn and resumes on the completion notification, instead of running sleep or polling loops in Bash

### Requirement: Session-environment traps are documented in policy guidance

The execution policy (or its implementation-dispatch reference) SHALL carry these one-line guidance notes: the shell is zsh where `status` is a read-only variable (use `st=`/`rc=`); words beginning with `=` trigger zsh `=cmd` path expansion (an unquoted `==` yields `== not found`) — quote such words; PR self-merge is classifier-blocked, so `gh pr merge --admin` and remote branch deletion must not be attempted (hand to the human); and the post-edit advisory SHALL tell the model to complete the applicable review outcome BEFORE attempting commit/push. `rules/tool-routing.md` SHALL additionally state: when the GitNexus index contains multiple repositories, always pass the `repo` parameter to `gitnexus_impact`/`gitnexus_query` calls.

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

- **WHEN** edits have an unresolved applicable review outcome and the model prepares to commit/push
- **THEN** the post-edit advisory has already instructed completing that review first, so the push-gate block path is not exercised

### Requirement: Dispatch rows for CLI-backed fast-worker variants

The execution-policy Implementation dispatch section SHALL define a deterministic
Provider-neutral selector for mechanical `worker` requests. The selector SHALL
use the current Host profile, Capability Matrix, requested Provider/Model/Effort,
and configured preference order. Host-native execution is the default target;
Claude Code, Codex CLI, AGY, and other supported Providers are eligible when the
Host policy and capability evidence allow them. The selector SHALL record the
requested and selected target and SHALL apply only policy-approved fallback.

#### Scenario: Host-native worker remains default

- **WHEN** a mechanical batch has no target preference
- **THEN** the table routes it to the current Host's native `worker` target

#### Scenario: Cursor explicitly selects Claude Code

- **WHEN** Cursor requests Claude Code Opus5 for a worker and the target is
  available
- **THEN** the table routes to the Claude Code Adapter with Role `worker`

#### Scenario: Auto preference follows capability order

- **WHEN** automatic selection lists AGY before Codex, AGY is unavailable, and
  Codex is available for the requested task
- **THEN** the selector records AGY as unavailable and routes to Codex

#### Scenario: Execution failure is not silently substituted

- **WHEN** the selected Provider rejects authentication or the requested Model
- **THEN** the worker reports the exact failure and does not switch target unless
  the request policy explicitly permits that failure class

### Requirement: Post-review fix application is a dispatch-table row

The execution-policy dispatch decision table SHALL contain a row routing post-review fix application according to the whole fix batch's ownership, coupling, context locality, verification needs, and coordination benefit. A separate Provider-neutral `worker` owner is appropriate when it improves focus or coordination; file count alone SHALL NOT require delegation.

#### Scenario: Review-fix batch benefits from a separate owner

- **WHEN** consolidated review returns a bounded fix batch with coordination or ownership needs that benefit from a separate worker
- **THEN** the orchestrator dispatches one batched fast-worker task regardless of file count

#### Scenario: Cohesive review-fix batch stays inline

- **WHEN** the whole fix batch has a clear owner, adequate local context, and low coordination need
- **THEN** the orchestrator may apply it inline regardless of file count

### Requirement: Specialist fix-spec handback is a dispatch-table row

The dispatch decision table SHALL contain a row routing fix-specs handed back by planning/acceptance specialists (tdd-guide GREEN handback, e2e-runner application-bug reports) to the Provider-neutral `worker` tier resolved by the Dispatch Engine, with acceptance owned by the originating specialist's stated verification command.

#### Scenario: tdd-guide hands back a GREEN fix-spec

- **WHEN** tdd-guide returns RED tests plus a fix-spec whose bounded ownership or verification needs benefit from a separate writer
- **THEN** the orchestrator dispatches the selector-resolved fast-worker with that fix-spec and re-runs the scoped tests as acceptance

### Requirement: RED Vitest/Jest tests have an explicit dispatch row

The execution-policy Implementation dispatch table SHALL include a row for RED Vitest/Jest tests with routing based on test-first requirements, test seam, runtime setup, ownership, and task risk. A separate `tdd-guide` consult or handoff is appropriate when specialist test strategy or setup is needed; task/file count alone SHALL NOT determine the route.

#### Scenario: RED Vitest test routes to tdd-guide

- **WHEN** a RED Vitest or Jest test has a non-trivial test seam or runtime setup that benefits from specialist strategy
- **THEN** the dispatch table directs the work to `tdd-guide` without using file count as the criterion

#### Scenario: Small Vitest fix stays inline

- **WHEN** a RED Vitest/Jest test has a settled seam, adequate local context, and one clear owner
- **THEN** the table permits inline or existing-worker handling according to the task's ownership and verification needs

### Requirement: Reasoner backend selection is a dispatch-table row

The execution-policy Implementation dispatch section SHALL define reasoner
selection through the same Provider-neutral target resolver used by workers.
Any Provider with a verified `reasoner` capability MAY be selected by the
`--reasoner` request or Host configuration; unsupported Providers remain
explicitly unavailable. The current Host native reasoner is the default. The
table SHALL record Provider, Model, Effort, Transport, and the same reasoning
brief/conclusion contract for every eligible target.

#### Scenario: Default reasoning dispatch is contextual

- **WHEN** a reasoning-heavy task is dispatched with no Provider preference
- **THEN** the table routes it to the current Host's native `reasoner`

#### Scenario: Codex reasoning target is selected

- **WHEN** a Host explicitly selects Codex CLI Model `sol5.6` at `high` and the
  capability is available
- **THEN** the reasoning task routes to Codex CLI under the same conclusion
  contract

#### Scenario: Unsupported AGY reasoning is explicit

- **WHEN** AGY has no verified `reasoner` capability in the matrix
- **THEN** the request reports `UNAVAILABLE` and does not silently route to an
  AGY worker or another Role

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

### Requirement: Orchestration owns dispatch and handoff while project policy owns acceptance

The orchestration layer SHALL own worker/reviewer selection, dispatch, follow-up handoff, bounded retry, lifecycle transitions, result collection, and acceptance sequencing. Current project policy and the review contract SHALL remain the source of applicable review domains, evidence eligibility, and fail-closed acceptance. Orchestration MUST NOT synthesize passing evidence or bypass an unresolved outcome.

#### Scenario: Edit creates an applicable review obligation

- **WHEN** an implementation edit matches a configured review domain
- **THEN** orchestration records the applicable obligation and dispatches or requests the relevant review without transferring acceptance ownership to the reviewer

#### Scenario: Reviewer hands back a final result

- **WHEN** a reviewer or external reviewer returns a result for the current dispatch
- **THEN** orchestration records the handoff and reconciles scope, freshness, verdict, and supporting evidence against current project policy

#### Scenario: Review result lacks qualifying evidence

- **WHEN** a review result is missing, stale, malformed, out of scope, or non-passing
- **THEN** orchestration leaves the task unresolved and requests the missing or corrected outcome

### Requirement: Dispatch lifecycle integration is additive

Architecture migration SHALL reuse the current dispatch table, applicable review domains, evidence contract, public orchestration commands, and established verdict vocabulary. New coordination ports MAY wrap these behaviors, but MUST NOT introduce a second dispatch policy, duplicate review or evidence acceptance path, parallel public command version, or alternate verdict vocabulary.

#### Scenario: Orchestration port wraps an existing reviewer dispatch

- **WHEN** a dispatch/handoff adapter is introduced during migration
- **THEN** it resolves the same applicable role, review domain, and acceptance contract as the characterized existing flow

#### Scenario: Proposed component duplicates acceptance

- **WHEN** a new coordinator attempts to establish acceptance independently of the project review contract
- **THEN** architecture validation rejects the duplicate acceptance path

### Requirement: Flow-drive dispatch consumes the common Dispatch Engine

The implementation workflow SHALL resolve planner, reasoner, worker, and
reviewer SubAgents through the common Dispatch Engine and SHALL not maintain a
second Provider selection policy in flow-drive.

#### Scenario: Worker and reasoner share target semantics

- **WHEN** flow-drive dispatches a worker and then a reasoner on the same Host
- **THEN** both use the same Host profile, Capability Matrix, fallback policy,
  receipt identity, and Provider-neutral Role vocabulary
