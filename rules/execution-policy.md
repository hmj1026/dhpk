# Execution Policy

dhpk's default execution policy for projects that adopt the harness. Read the
always-visible kernel first (`${CLAUDE_PLUGIN_ROOT}/rules/execution-policy-kernel.md`),
then load the conditional sections below as the selected route requires.
Resource-layer markdown — referenced from the `dhpk-execution-policy` skill and
consumable directly by a project's own `CLAUDE.md` via the
`${CLAUDE_PLUGIN_ROOT}/rules/execution-policy.md` path. Not auto-loaded; opt-in.

> Project overrides: projects that adopt this policy should keep their own short `.claude/rules/execution-policy.md` (or `CLAUDE.md` section) that only encodes deltas — e.g. extra sentinels, project-specific hot tables for performance reviewer, hook profile choice. Avoid copying the body wholesale; cross-link instead.
>
> Resolution order for any reference to this file: use the project's `.claude/rules/execution-policy.md` first if present (it carries only deltas — extra sentinels, hot tables, hook profile), otherwise resolve to `${CLAUDE_PLUGIN_ROOT}/rules/execution-policy.md` (the plugin SSOT). Projects should keep their local copy short and cross-link rather than copying the body wholesale.

## Glossary (inline)

- **sentinel**: `.claude/artifacts/sessions/.pending-*` marker file (written by a post-edit hook; cleared by the runtime hook `${CLAUDE_PLUGIN_ROOT}/scripts/hooks/subagent-stop-verify.sh` on a successful reviewer stop — the sanctioned path — or by the orchestrator via `${CLAUDE_PLUGIN_ROOT}/scripts/hooks/clear-sentinel.sh` for a triage-drop or a stale-sentinel back-stop; reviewer agents no longer self-clear). Existence check: `find -maxdepth 1 -name '.pending-*' -print 2>/dev/null` (avoids shell-specific `nomatch` behaviour with bare globs). Unrecognized `.pending-*` strays (not in the SSOT — a typo or abandoned custom sentinel) have no clearing agent and would block the opsx-apply-goal `NONE` gate forever; `${CLAUDE_PLUGIN_ROOT}/scripts/hooks/reap-stale-sentinels.sh` surfaces them always and, with `--clear`, removes ones older than the threshold.
- **back-stop**: hook pattern did not match but the AI semantically recognises the trigger should fire → AI proactively invokes the matching reviewer (and still clears the sentinel if present).
- **append-only exemption**: pure additions may skip `gitnexus_impact` only when they add a new function/method/class, change no existing body/signature/docblock/typehint, and change no module-level state (imports or top-level constants); label the change `append-only — gitnexus_impact skipped`.
- **reviewer dispatch**: when multiple sentinels coexist, triage out false positives → dispatch the rest **in parallel** → `code-reviewer` merges/dedups (see "Reviewer dispatch").
- **resumed review obligation**: a session-scoped record created before reusing an existing sentinel-backed reviewer through `SendMessage`; it binds the final result to one generated reviewer slot, exact sentinel basename, session, dispatch, and freshness baseline.
- **lifecycle clearance**: reconciliation and removal of a review sentinel after its lifecycle evidence is satisfied; it is not reviewer approval or completion.
- **Parallel Dispatch**: two or more workers operating in one checkout under explicit, non-overlapping assigned scopes.
- **Assigned Scope**: the exact repo-relative file list a worker may write, diff, and verify; it is not the whole working tree and cannot be expanded by the worker.
- **Worker-Owned Edit**: a change within the assigned scope attributable to that worker's dispatch.
- **Out-of-Scope Observation**: a sibling or unrelated change outside assigned scope that the worker reports but does not modify or clean.
- **Shared-State Reconciliation**: the single sequential orchestrator pass that validates and updates shared ratchet/configuration state (a monotonic baseline file, e.g. a coverage or size-budget allowlist) after all parallel workers finish.
- **Judgment-Dense Standardizable Batch**: a bounded, repeatable implementation step touching at least three files that requires consistent content judgment but has an exact file scope and verification contract; unresolved design and unknown root cause are excluded.

## Classification-first context loading

Determine the workflow type (Small change / Bug / Feature / Architecture) from the user request BEFORE loading heavy references (profiles, scope docs, legacy analysis, investigation scaffolding). Load only the references the chosen workflow needs; expand incrementally if the classification changes. Upfront loading burns context budget on paths not taken. (adaptive-dev-workflow, harness-fill)

### Change classification & OpenSpec routing (SSOT)

Single source of truth for the six change types, their flow, and whether to ask about OpenSpec. `commands/create-dev.md` and `skills/dhpk-adaptive-dev-workflow/SKILL.md` route through this table — reference it, do not restate it.

| Change type | OpenSpec ask? | Flow |
|---|---|---|
| Bug Fix (unknown root cause) | ✅ ask | `bug-investigation` → y: `/opsx:new` · n: brief plan → tdd-guide → patch |
| Feature Delivery (cross-module / DDD) | ✅ ask | `dhpk:architect` → y: `/opsx:new` · n: brief plan → tdd-guide → patch |
| Feature Delivery (normal) | ✅ ask | y: `/opsx:new` · n: brief plan → tdd-guide → patch |
| Bug Fix (known root cause) | ❌ no | inspect → tdd-guide RED → patch → tdd-guide verify |
| Medium change | ❌ no | inspect → brief plan → tdd-guide → patch |
| Lightweight Maintenance | ❌ no | inspect → patch |

> **`/dhpk:do --openspec` override (force-`y`):** the `--openspec` flag (alias `--opsx`) force-selects the "create a change" (`y`) path — running `opsx:new` → `opsx:ff` to emit artifacts, then pausing for human review — overriding the per-type ask behavior in the "OpenSpec ask?" column above. The override is keyed on the **resolved route**, not the change-type row: it activates whenever `/dhpk:do` resolves to one of the three change-authoring routes (`dhpk:adaptive-dev-workflow`, `dhpk:bug-fix`, `dhpk:feature-dev`) — where every substantial bug/feature request lands *before* this per-type classification runs — so on those routes it goes straight to artifact authoring instead of asking or classifying (bypassing the row's normal investigation/architecture steps). It is **not applicable** to `opsx-apply-goal` (which applies an *existing* change) or any other non-authoring route — there it prints `--openspec ignored: ...` and proceeds. `--openspec` supersedes `--plan` only when this authoring diversion activates. SSOT for the flag mechanics: `commands/do.md` §Step 0a–0e and §Openspec-mode rule.

## Invocation precedence & entry selection

Every distributed skill/command carries `metadata.dhpk-invocation-class`
(`explicit-only` or `implicit-eligible`). Entry selection across exact
invocation, `/dhpk:do`, `next-step`, and model selection follows one fixed
precedence; an explicitly-invoked router may start an `implicit-eligible`
target but must present-and-wait for an `explicit-only` target rather than
calling it through the Skill tool. Full precedence order, Explicit Invocation
definition, and the OpenSpec entry-point surface mapping:
`${CLAUDE_PLUGIN_ROOT}/skills/dhpk-execution-policy/references/invocation-precedence.md`.
Full classification rationale per entry:
`${CLAUDE_PLUGIN_ROOT}/skills/dhpk-execution-policy/references/invocation-classification.md`.

## Agent dispatch

Agents run via the `Agent` tool (`subagent_type=<name>`), not via skill names.

| Agent | Runs when | Review role |
|---|---|---|
| `tdd-guide` | RED / test-first specialist; GREEN stays inline only within its ≤2-production-file bound | specialist |
| `architect` | Cross-module or DDD-layer design | — |
| `deep-reasoner` | Reasoning-heavy implement-phase work (root cause, algorithm design, complex debugging) — see §Implementation dispatch | — |
| `codex-deep-reasoner` | Selected by `--reasoner=codex` — a `deep-reasoner` whose reasoning runs on the codex CLI backend (read-only sandbox); see §Implementation dispatch | — |
| `fast-worker` | Mechanical implement-phase work with a clear spec — see §Implementation dispatch | — |
| `codex-fast-worker` | Selected by `fast_worker_backend=codex` or an available `auto` candidate — a `fast-worker` whose edits run on the codex CLI backend; see §Implementation dispatch | — |
| `agy-fast-worker` | Selected by `fast_worker_backend=agy` or an available `auto` candidate — a `fast-worker` whose edits run on the agy CLI backend; see §Implementation dispatch | — |
| `codex-bridge` | **CODEX=on only** — outsource a self-contained clear-spec task, or a blind second opinion, to gpt-5.5 via the Codex CLI (`codex exec`); output isolated in the subagent, relayed verbatim — see §Implementation dispatch | — |
| `e2e-runner` | RED / E2E user-journey work — author a Playwright spec, reason about how to seed fixtures, and run it against a live server; not a PHPUnit runner — see §Implementation dispatch | — |
<!-- BEGIN GENERATED sentinel-slots:agent-table -->
<!-- Generated by scripts/ci/gen-slots.js from scripts/lib/sentinel-slots.json. -->
| `code-reviewer` | Code review — sentinel .pending-review | consolidated wave |
| `database-reviewer` | SQL / Repository / migration (SQL correctness) — sentinel .pending-db-review or back-stop | consolidated wave |
| `security-reviewer` | Auth / crypto / money / file upload — sentinel .pending-security-review or back-stop | consolidated wave |
| `frontend-reviewer` | JS / TS / view-layer JS — sentinel .pending-frontend-review or back-stop | consolidated wave |
| `doc-reviewer` | Documentation review — sentinel .pending-doc-review | consolidated wave |
| `polyfill-reviewer` | .php edits with a runtime version guard — sentinel .pending-polyfill-review (library-author module) | consolidated wave |
| `migration-reviewer` | Migration files (up/down symmetry, FK naming, large ALTER, multi-tenant deploy) — sentinel .pending-migration-review | consolidated wave |
<!-- END GENERATED sentinel-slots:agent-table -->
| `performance-analyzer` | Repository methods on high-volume tables — back-stop only | — |

`consolidated wave` means every triggered reviewer is dispatched together once per implementation wave. `specialist` denotes implementation/acceptance ownership rather than an unconditional post-edit reviewer; `—` denotes planning, worker, or back-stop-only roles.

Agent names above are dhpk defaults; override via `userConfig.review_agents` per slot. Projects with prefixed agents (e.g. `code-reviewer-<project>`) configure the override in their `settings.local.json`.

**Diff-scope mandate (all reviewers)**: reviewers audit the UNCOMMITTED working tree (`git diff --staged` + `git diff HEAD`), never committed history (`git diff <base>...HEAD` / merge-base diff). Under the no-auto-commit workflow the change-under-review sits uncommitted; a base-relative diff reviews the whole branch (often hundreds of files) — wasting tokens/time and misreporting committed-but-superseded code as unfixed. Orchestrators dispatching a reviewer MUST NOT instruct it to diff against a base branch unless an explicit full-branch/PR review is the intent.

**File-state ground truth**: re-verify live before reporting a file-state defect. Full mechanics: `${CLAUDE_PLUGIN_ROOT}/skills/dhpk-execution-policy/references/review-gate-mechanics.md`.

**Sentinel-scoped precedence**: when a reviewer's own sentinel exists (`.claude/artifacts/sessions/.pending-{review,db-review,security-review,frontend-review,doc-review,polyfill-review,migration-review}`), its listed paths are the SOLE authoritative scope — not the full uncommitted tree above. Parse each line's path via the field-3 convention (`cut -d' ' -f3-`; see `scripts/hooks/_lib/payload.sh` SENTINEL LINE FORMAT). Diff each listed path individually: `git diff --staged -- <path>` + `git diff HEAD -- <path>`. Skip every other uncommitted/staged file not on the list, even same extension/glob — it belongs to a different session's change. Fall back to the unfiltered mandate above only when (a) no sentinel exists for this slot (back-stop invocation — e.g. `performance-analyzer`, which has no slot), or (b) the user/orchestrator explicitly requests a full working-tree/PR review — that explicit request wins over sentinel-scoping.

**Model tier**: use agent defaults, with judgment-based risk escalation or eligible known-finding reduction. The normative role/tier rules live in `${CLAUDE_PLUGIN_ROOT}/rules/model-economics.md`.

**Configured role models** (`deep-reasoner` / `fast-worker`): `session-start.sh` announces the effective `deep_reasoner_model` / `fast_worker_model` at session start only when they differ from the shipped default (opus / sonnet) — configured via the `deep_reasoner_model` / `fast_worker_model` / `orchestration_dispatch` `userConfig` keys in `.claude-plugin/plugin.json`. When announced, the orchestrator passes that value on the `Agent` call's `model` param for every dispatch of that role; frontmatter is never edited. An invalid configured value (not a model name the running Claude Code supports) triggers one warning per session and the dispatch falls back to the agent's frontmatter default — it never fails the dispatch. The judgment-based HIGH-risk escalation above still applies on top of a configured value and takes precedence for that single dispatch (e.g. a configured `fast_worker_model=haiku` may still be raised to sonnet/opus for one high-risk task). The two workers also carry effort keys (`deep_reasoner_effort` / `fast_worker_effort`), applied on the `Agent` call's `effort` param by the same announce-when-non-default mechanism; the cost rationale for both dials is in `${CLAUDE_PLUGIN_ROOT}/rules/model-economics.md`.

The CLI-backed Codex roles use the same normalized project-over-global configuration seam for timeout budgets: `codex_fast_worker_timeout_secs`, `codex_deep_reasoner_timeout_secs`, and `codex_bridge_timeout_secs` override shared `codex_timeout_secs` within their scope, with the shipped `360`-second default below both scopes. `0` is an intentional wrapper-backstop disable; malformed values fail closed before the affected dispatch. The shared wrapper reports the effective role, budget, source, disabled state, and explicit outer-budget unknown/warning status without changing Claude's external tool wait.

**Deferred-tool trap**: `SendMessage`, `Monitor`, and their background-task peers (`TaskStop` / `TaskOutput`, whichever the session roster exposes) are deferred tools — their schemas are not sent to the API at session start, only their names. Call `ToolSearch` with `select:<name>` (e.g. `ToolSearch select:SendMessage,Monitor`) to load the schema BEFORE the first invocation, or the call fails with `InputValidationError` ("this tool's schema was not sent to the API") and burns a recovery turn. This bites hardest mid-orchestration — resuming a background agent with `SendMessage` or waiting on one with `Monitor` after only ever having used the eagerly-loaded tools.

## Implementation dispatch

SSOT for implement-phase routing while `userConfig.orchestration_dispatch=on` (default). Downstream skills (`feature-dev`, `bug-fix`, `adaptive-dev-workflow`, `opsx-apply-goal`) reference this table — they do not restate it. Unattended goal sessions bind the safety kernel and the selected route reference during orientation; the emitted `/goal` condition carries only the compact roster line and self-locating pointers, never these elaborations.

Goal-driven apply flows set `DHPK_ORCHESTRATION_DISPATCH=on`, enabling the runtime edit-batch gate: warn on the third distinct inline source file and block from the fourth unless `DHPK_INLINE_BATCH_OK=1` or a live fast-worker marker proves work is already dispatched.

**Orchestration lifecycle acceptance:** orchestration owns dispatch/handoff identity, retries, and evidence presentation; the existing runtime hook/reconcile path owns Sentinel clearance. Each handoff uses one stable `task_id` and an attempt-specific `attempt_id`; optional producer, wave, scope, adapter/stage, and plan/artifact fingerprints are additive. Before a resumed `SendMessage`, capture and forward the complete `RESUMED_REVIEW_IDENTITY` envelope printed by `record-resumed-obligation.sh` (including any non-empty optional fingerprints); the reviewer must reproduce every declared field in the canonical artifact frontmatter. Legacy scope/diff-only evidence remains readable, but a new obligation with declared identity fails closed on missing or foreign fields. Completion requires both a terminal lifecycle result and every applicable matching Sentinel gate resolved through the hook-owned contract; a message, aggregate verdict, or lifecycle event alone is not completion. Detailed identity/presentation mechanics live in `${CLAUDE_PLUGIN_ROOT}/skills/dhpk-execution-policy/references/implementation-dispatch.md` and `${CLAUDE_PLUGIN_ROOT}/skills/dhpk-execution-policy/references/review-gate-mechanics.md`; this rule intentionally does not duplicate the dispatch table or clearance implementation.

### Context tiers and dispatch packet

Select the smallest context tier that preserves the settled decision:

- **`cold`** — no parent-turn inheritance; use for independent reviewers,
  workers, monitors, and peer checks.
- **`bounded`** — inherit only the recent turns that contain unresolved user
  decisions; use for architect/TDD continuation.
- **`full`** — inherit the conversation only when the task is conversation-
  dependent; record the reason in the handoff.

Every `cold` handoff carries the same five-part packet: goal and non-goals;
exact owned files; settled interfaces, invariants, and constraints;
verification and acceptance; task/attempt identity plus required evidence
pointers. The packet is the context boundary: do not require a worker to
reconstruct it from parent history.

File count remains a collision and safety gate. It does not by itself justify a
`full` fork. When a task changes tier, packet, or inheritance mode, record the
selected mode and the marginal context cost in the context ledger.

### Bash hygiene

Each Bash tool call starts from its declared/default working directory; never assume a prior call's `cd` persists. Prefer absolute paths, `npm --prefix <dir>`, or `git -C <dir>`, and avoid command chains whose correctness depends on a directory change carrying across calls.

| Work shape | Dispatch |
|---|---|
| Reasoning-heavy (unknown root cause, algorithm design, cross-file complex analysis) | `deep-reasoner` (Claude, default) |
| The same reasoning-heavy work, offloaded to the codex CLI backend (read-only sandbox) — **codex CLI available**. Selected per invocation by `--reasoner=codex` or the `codex_deep_reasoner_model`/`codex_deep_reasoner_effort` userConfig chain (default `gpt-5.6-sol` @ `high`); same reasoning brief, same conclusion contract. Missing-executable fallback to `deep-reasoner` is the only silent substitution — auth/model/task failures stay `RESULT: BLOCKED`. | `codex-deep-reasoner` |
| Mechanical with a clear spec (boilerplate, test scaffolds, rename sweeps, multi-file doc-consistency fixes of ≥3 files, applying an already-approved plan) | `fast-worker` |
| Judgment-dense but standardizable work touching more than two files (bounded documentation migration, bilingual restructuring, or a known review-fix batch) | In-process `fast-worker` by default |
| The same mechanical clear-spec work, offloaded to the codex CLI backend — **codex CLI available**. Selected by an invocation override, explicit configuration, or as an available candidate in configured `auto` order; independent of the separate `CODEX` review-peer switch. | `codex-fast-worker` |
| The same mechanical clear-spec work, offloaded to the agy CLI backend — **agy CLI available** only. Selected by explicit configuration or as an available candidate in configured `auto` order. | `agy-fast-worker` |
| Small diff (roughly ≤2 files, unambiguous intent) | Inline in the main loop — no dispatch |
| Complex implementation (needs both reasoning and mechanical application) | `deep-reasoner` produces the fix spec (conclusion contract) → `fast-worker` applies it |
| Post-review findings form a clear fix-spec whose whole fix batch exceeds the ≤2-file inline bound | One batched selector-resolved fast-worker dispatch; never measure the bound per finding |
| Specialist fix-spec handback (`tdd-guide` GREEN footprint >2 files or `e2e-runner` application-bug report) | Selector-resolved fast-worker applies it; acceptance uses the originating specialist's stated scoped verification command or journey |
| RED / E2E test that must reason about seeding AND run against a live server (Playwright user journeys) — read-only `deep-reasoner` can't run it, mechanical `fast-worker` can't reason about the seeding | `e2e-runner` |
| RED PHPUnit unit/integration test authored test-first and run against a live DB (Testbench / docker MySQL) — Playwright-scoped `e2e-runner` doesn't fit, read-only `deep-reasoner` can't run it, and `fast-worker`'s "make verification pass" contract conflicts with a deliberately-failing RED test | `tdd-guide` |
| RED Vitest/Jest unit/integration test authored test-first — same semantics as the RED PHPUnit row: `e2e-runner` is Playwright-journey-scoped, read-only `deep-reasoner` can't run it, and `fast-worker`'s "make verification pass" contract conflicts with a deliberately-failing RED test; inline permitted when the step's whole footprint is ≤2 files | `tdd-guide` |
| A read-only, scenario-driven live-runtime probe (drive the real running system with one concrete scenario, observe rather than infer) — distinct from `e2e-runner` (authors/runs Playwright specs, write-capable, web-scoped) and the `feature-verify` skill (main-context, heavyweight P0–P5 scope, not a dispatchable isolated agent) | `dhpk:smoke-tester` |
| Plan critique / blind-sketch / dual-plan before implementation, or a warm diff review at task end | `dhpk:planner` — opt-in via `/dhpk:do --plan` on the four implementation-class routes (`dhpk:adaptive-dev-workflow`, `dhpk:bug-fix`, `dhpk:feature-dev`, `dhpk:opsx-apply-goal`) |
| Independent second opinion, or an offloaded self-contained clear-spec task — **CODEX=on only** | `codex-bridge` (subagent; one-shot bash `codex exec`, output isolated + relayed verbatim) |
| Live CI/deploy verification (`gh run watch`, run-log triage, retry babysitting) — main context keeps only merge/fix decisions | `dhpk:smoke-tester` (read-only probe) or background `fast-worker` |

For a parallel mechanical batch, every worker task spec MUST declare `Parallel: yes`, exact assigned repo-relative files, per-file intent, and either a path-scoped verification command or an explicit report-only outcome. The assigned list is the worker's authoritative write, diff, and verification boundary. New files must be listed before dispatch; workers must stop with `BLOCKED` rather than expand scope.

Workers may report out-of-scope observations, but an out-of-scope write is a worker contract violation and remains `BLOCKED`. Workers MUST NOT run `git checkout`, `git restore`, `git reset`, `git clean`, forceful deletion, or equivalent cleanup against out-of-scope files. They must leave sibling changes intact for the orchestrator.

When a validator reads or modifies shared ratchet/configuration state, workers MUST use a dispatcher-provided scoped or no-write equivalent. If no safe equivalent exists, the worker reports the missing command as `BLOCKED` or the explicitly declared report-only outcome; it must not invent a global mutation path. After all workers return, the orchestrator performs one sequential whole-tree `Shared-State Reconciliation` before the consolidated reviewer wave. A task whose intended output includes shared state is serial.

`Judgment-Dense Standardizable Batch` is a default fast-worker route, not a forced route. The orchestrator may override it only with a recorded reason. The route requires at least three files, bounded repeatable intent, and known verification; open-ended design, unresolved root cause, and architecture decisions remain orchestrator/deep-reasoner work. The policy does not require durable telemetry yet; the acceptance report records the selected tier, override reason if any, and result.

### Fast-worker backend selector

Mechanical implementation waves resolve through
`${CLAUDE_PLUGIN_ROOT}/scripts/fast-worker-selector.js` and the three selector
keys in `userConfig`:

| Requested value | Resolution |
|---|---|
| `claude` (default) | `dhpk:fast-worker`; deterministic in-process default. |
| `codex` / `agy` | Check the requested executable before dispatch; missing executable blocks unless `fast_worker_fallback=claude` was explicitly configured. |
| `auto` | Check `fast_worker_backend_order` in order and record rejected candidates plus reasons. |

Only a missing executable may use the configured `claude` fallback. Authentication,
authorization, model, task, execution, and verification failures remain
`RESULT: BLOCKED` on the selected backend and never silently switch semantics.
Every fast-worker report includes requested backend, selected backend, any
fallback reason, model/effort, effective Codex timeout budget/source when the
Codex backend is selected, verification result, and the complete edited-file
list. Worker-backend selection is independent of the `CODEX` review-peer switch:
`CODEX=off` disables the `codex-bridge` doubt/review path, but does not remove an
available `codex-fast-worker` backend. An explicit backend request is blocked only
by selector availability/fallback rules, never silently downgraded.

### Reasoner backend selector

Reasoning-heavy dispatches default to the in-process `deep-reasoner` (Claude). The
`/dhpk:do --reasoner=<claude|codex>[:<model>[:<effort>]]` flag (or its userConfig chain)
picks the backend for that invocation: `claude` → `dhpk:deep-reasoner`; `codex` →
`dhpk:codex-deep-reasoner` (codex CLI, read-only sandbox, default `gpt-5.6-sol` @ `high`).
Both backends receive the **same** reasoning brief and return the **same** conclusion
contract (conclusion + file:line evidence + fast-worker-ready next actions). `agy` has no
reasoning tier and is unsupported. Model/effort resolve flag > backend-specific userConfig
(`deep_reasoner_*` for claude; `codex_deep_reasoner_*` for codex) > built-in default. Only a
missing codex executable falls back to `deep-reasoner`; authentication, model, and task
failures remain `RESULT: BLOCKED` on the selected backend — never silently switched.

**Orchestrator posture**: implement-phase work defaults to **decide → dispatch → verify**; inline work is the narrow exception. Measure the **whole implement-step footprint**, so multi-file doc-consistency work is one batch; when unsure between inline and a worker, dispatch. Verify runtime premises with the applicable E2E lane or a scratch executable probe. The orientation step binds unattended goals to the kernel and selected route reference. Full routing, premise, verification, waiting, and plan-brief rules: `${CLAUDE_PLUGIN_ROOT}/skills/dhpk-execution-policy/references/implementation-dispatch.md`.

**Repository Discovery Gate**: before finalizing new DB, SQL, query-builder, criteria, model-persistence, or repository-like code, inspect and follow the established persistence boundary. Explicit project hard rules cannot be deferred; compliance is required unless the human records a human-approved exception. Full mechanics: `${CLAUDE_PLUGIN_ROOT}/skills/dhpk-execution-policy/references/implementation-dispatch.md`.

**Operational detail** (posture rationale, the ≤2-files measurement, `general-purpose` prohibition, gate-preservation back-stop, verify-worker-output cross-check, phase scoping, the premise-verification trio, kill switch, CODEX peer path): load `${CLAUDE_PLUGIN_ROOT}/skills/dhpk-execution-policy/references/implementation-dispatch.md` when dispatching implement-phase work.

### CODEX=on high-stakes parallel peer path

Under `CODEX=on`, high-stakes decisions use an independent blind Codex peer. Triggers include a first-seen query/repository pattern, framework-internal hack, or explicit-rule deferral. At wrap-up, a session that dispatched `codex-bridge` 0 times reconciles that outcome. Full triggers and mechanics: `${CLAUDE_PLUGIN_ROOT}/skills/dhpk-execution-policy/references/implementation-dispatch.md` §CODEX=on high-stakes parallel peer path.

## Multi-AI independence and in-flight doubt

Independent-perspective rules, the bounded adversarial doubt cycle, and premise-overturning reframe checks live in `${CLAUDE_PLUGIN_ROOT}/skills/dhpk-execution-policy/references/premise-verification.md`.

## Mandatory post-steps

### Post-implementation agent gate (SSOT)

After each implementation wave, dispatch every applicable sentinel reviewer as
**ONE consolidated parallel reviewer batch**. Only triggered lanes run; mixed diffs may
run code, database, security, frontend, documentation, polyfill, and migration
reviewers together. `tdd-guide` and `e2e-runner` are implementation specialists,
not unconditional post-edit reviewers: invoke them only when the work requires
their RED or browser-journey ownership contract.

Actionable findings become one clear fix-spec. If the whole fix batch exceeds the
≤2-file inline bound, hand it to one selector-resolved fast worker, then run one
bounded confirm-only re-review naming the findings being checked. Do not start a
fresh broad review for the same wave or measure the inline bound per finding.
When the fix originated from `tdd-guide` or `e2e-runner`, acceptance returns to
that specialist's scoped verification command or originating journey. A new
implementation wave receives a new consolidated review batch. The prompt/output
shape is canonicalized in `docs/contracts/reviewer-contract.md`.

### Hook-enforced (sentinels)

Trigger map source-of-truth: dhpk's `${CLAUDE_PLUGIN_ROOT}/scripts/hooks/post-edit-dispatch.sh` routes edits to the 7-slot default sentinel set (code, db, security, frontend, doc, polyfill, migration). Each sentinel is cleared by `subagent-stop-verify.sh` only when its matching reviewer stops successfully with fresh canonical timestamp/slug evidence, valid leading delimited frontmatter, all required reviewer fields, and a parseable passing verdict (`APPROVE or PASS`). A reviewer never self-clears. The orchestrator uses `clear-sentinel.sh <name> <label>` only through a known-slot reconcile, triage-drop, or stale-sentinel back-stop.

A subagent must never paste the literal `${CLAUDE_PLUGIN_ROOT}/...` into a Bash command — it is a markdown-interpolation token, unset in a subagent's shell. Full caveat (SSOT): `${CLAUDE_PLUGIN_ROOT}/skills/dhpk-execution-policy/references/review-gate-mechanics.md`.

**Auto-clear + fallback**: a successful reviewer with a fresh matching canonical timestamp/slug artifact, valid leading delimited frontmatter, all required reviewer fields, and an `APPROVE or PASS` verdict auto-clears only its own slot; absent, stale, unparseable, malformed, warning, or failing output stays armed. A resumed fallback additionally requires a matching `.resumed-review-obligations` record, conclusive final response, resume-relative freshness, and proven session/agent ownership. Exact fallback and fail-loud rules: `${CLAUDE_PLUGIN_ROOT}/skills/dhpk-execution-policy/references/review-gate-mechanics.md`.

**Resumed-reviewer fallback**: a reviewer resumed through `SendMessage` may never fire a native `SubagentStop`; clearance there is a session-scoped, artifact-backed reconcile — never approval. Full contract: `${CLAUDE_PLUGIN_ROOT}/skills/dhpk-execution-policy/references/review-gate-mechanics.md`.

| Sentinel | Required agent | Trigger summary (default; project can extend via `userConfig.review_trigger_extra_paths`) |
|---|---|---|
<!-- BEGIN GENERATED sentinel-slots:sentinel-table -->
<!-- Generated by scripts/ci/gen-slots.js from scripts/lib/sentinel-slots.json. -->
| `.pending-review` | `code-reviewer` | `*.php` / `*.js` / `**/CLAUDE.md` |
| `.pending-db-review` | `database-reviewer` | Repository / migration / model / `*.sql` |
| `.pending-security-review` | `security-reviewer` | Controllers / config / `*{Auth,Login,Acl,Upload,File}*` source files |
| `.pending-frontend-review` | `frontend-reviewer` | No built-in default; opt in through module triggers or fe: extra paths |
| `.pending-doc-review` | `doc-reviewer` | `.md` files under approved harness / OpenSpec / docs paths; `CLAUDE.md`, `AGENTS.md`, top-level `README*.md` |
| `.pending-polyfill-review` | `polyfill-reviewer` | Module-owned trigger only |
| `.pending-migration-review` | `migration-reviewer` | Module-owned migration: triggers or mig: extra paths only |
<!-- END GENERATED sentinel-slots:sentinel-table -->

**Skipped paths**: follow the self-edit and per-slot path exclusions in `${CLAUDE_PLUGIN_ROOT}/skills/dhpk-execution-policy/references/review-gate-mechanics.md`.

### Reviewer dispatch (when multiple sentinels coexist)

For each contiguous implementation wave, dispatch each applicable reviewer once as **triage → ONE consolidated parallel reviewer batch → merge**; CRITICAL blocks, and pure research skips. Known findings receive at most one confirm-only re-review; new substantive scope starts a new review decision. A missing or invalid reviewer result gets one corrected retry, then replacement or a pending gate with a recorded reason. `codex-bridge` remains escalation-only and runs at most once per change. Full batching, reminder, retry, and escalation mechanics: `${CLAUDE_PLUGIN_ROOT}/skills/dhpk-execution-policy/references/review-gate-mechanics.md`.

**Reviewer economy**: hold the review dispatch until the wave's edit batch is edit-complete — do not dispatch mid-batch and then re-review each micro-fix as its own round. Batch any post-confirm micro-edits together before a single confirm dispatch. A findings set that is LOW/WARNING-only (no BLOCK/CRITICAL/HIGH) may be closed on the fast-worker's own verification output plus a diff-scope recheck, without a dedicated confirm-only reviewer dispatch; reserve a re-review round for BLOCK/CRITICAL/HIGH findings. Split waves and confirm-only rounds are the dominant reviewer overspend — batching before dispatch is the primary lever.

### Hook lifecycle classes

Hooks are classified as a blocking safety gate, a sentinel/liveness gate,
module activation only, or opt-in advisory. The default lifecycle registers
only deterministic safety, review-debt routing, reviewer reconciliation, and
module activation. Completion inference, prompt routing, lifecycle snapshots,
and heuristic quality work remain available only through explicit opt-in setup.

| Hook surface | Lifecycle class | Default behavior |
|---|---|---|
| `PreToolUse(Edit\|Write\|MultiEdit)` → `pre-edit-guard.sh` | blocking safety gate | enabled; reject protected-path and secret-unsafe edits |
| `PreToolUse(Bash)` → `pre-bash-dispatch.sh` | blocking safety gate | enabled; preserve shell safety plus Git/review-debt checks |
| `PostToolUse(Edit\|Write\|MultiEdit)` → `post-edit-dispatch.sh` | sentinel/liveness gate | enabled; create and route review-debt sentinels only |
| `SubagentStop` → `subagent-stop-verify.sh` | sentinel/liveness gate | enabled; reconcile only fresh canonical artifacts with a parseable passing verdict |
| `SessionStart` → `session-start.sh` | module activation only | enabled; validate and activate configured modules |
| Prompt hints, stop reminders, snapshots, failure logging, completion scans, and heuristic quality checks | opt-in advisory | not registered in the default lifecycle |

**Reviewer liveness**: a no-op reviewer is a failed gate. Corrected-retry and replacement rules: `${CLAUDE_PLUGIN_ROOT}/skills/dhpk-execution-policy/references/review-gate-mechanics.md`.

### Review output gate

Every quality-gate reply (code / doc / test / security review, audit, risk-assess) leads with an explicit gate as the FIRST line of the reply — superseding any prior convention that placed this line at the end: a symbol (✅ pass / ⚠️ conditional / ⛔ block), a status word (Mergeable / Needs revision / Adequate / Insufficient / Inconclusive), and a one-line justification. The gate is the decision — reader sees the symbol first. Example: `✅ Mergeable — all dimensions ≥4/5, no P0 findings.` (pr-review, doc-review, test-review, security-review, project-audit, risk-assess)

### AI-judgment back-stop (self-trigger)

Semantically matches but path pattern did not trigger a sentinel → self-trigger:

- New feature / bugfix in business layer → `tdd-guide` **before** writing implementation.
- Money / crypto / cert / token paths not matched by hook patterns → `security-reviewer`.
- Repository methods on high-volume tables (each project declares its own hot tables via the `hot_tables` userConfig key or its CLAUDE.md / rules — names like `orders` / `records` / `stock` are POS-system examples only) → `performance-analyzer`.
- Editing `<script>` blocks inside view-layer template files (PHP / ERB / Twig / Razor) → `frontend-reviewer`.
- New / changed domain type, value object, enum, or struct with non-trivial invariants ("make illegal states unrepresentable") → `type-design-analyzer` (also a `code-reviewer` delegate).
- Deep error-handling audit (empty catch / swallowed exceptions / hidden fallbacks / missing rollback) → `silent-failure-hunter` (also a `code-reviewer` delegate).
- Structural change (new module / renamed dir / new public service or API surface) → `doc-updater` (it runs `/update-codemaps` + `/update-docs`).
- Needing current / up-to-date library / framework / API docs mid-task → `docs-lookup` (Context7).
- Cleanup beyond a single file — a file > 800 lines to split, cross-file duplicate logic, or a multi-module dead-code sweep → `refactor-cleaner` (use `/simplify` for in-place single-file work).
- Brownfield project with empty `openspec/specs/` + a spec-extraction request → `spec-miner` (or the `/spec-mine` front door).
- `swift build` / `xcodebuild` / SPM resolution failure → `swift-build-resolver` (swift / xcode-tooling module active).
- `ruff` / `mypy` / `pytest-asyncio` (and `pyright` / `pytest` / `uv sync`) error appears in Bash output → `python-build-resolver` (python / fastapi / pytest module active).
- `cargo build` / `cargo test` rustc (or `cargo clippy`) error appears in Bash output → `rust-build-resolver`.
- Editing version-specific dirs (`src/Laravel/`, `src/Symfony/`), composer version constraints, or `.github/workflows` CI matrices, or before tagging a release → `version-matrix-impact-reviewer` (library-author module).

> **Notes** — why view-layer `<script>` uses a back-stop not a hook · when to upgrade a back-stop to a hook · why `tdd-guide` has no sentinel and how the coverage gate enforces tests-first for unattended `opsx-apply-goal` runs: `${CLAUDE_PLUGIN_ROOT}/skills/dhpk-execution-policy/references/review-gate-mechanics.md`.

## Edit tool discipline

**Edit/Write, not Bash writes.** Repo file edits MUST use the Edit or Write tool, not Bash-based writes (python heredoc, `tee`, shell redirection). A Bash-written file never passes through the `PostToolUse` Edit/Write hooks, so the review sentinel that file type would arm never arms and the file silently skips its mandatory reviewer gate. Use a Bash write only as a last resort (the Edit/Write tools cannot express the operation); whenever you do, self-trigger the review gate that would have applied — dispatch the matching reviewer (or, if the post-edit hook did not fire, manually check for and handle the applicable `.pending-*` sentinel per the AI-judgment back-stop convention above).

**Symlink-safe writes.** Before using Write on an existing target, check whether
it is a symlink. Resolve it with `realpath <target>` and Write to the resolved
target; the Write tool refuses symlink paths. Preserve the link itself unless
the task explicitly requires changing deployment topology.

**CJK / fullwidth edits — copy `old_string` verbatim from Read.** When editing a document containing CJK text or fullwidth punctuation (，（）—— etc.), the Edit tool's `old_string` MUST be copied verbatim from the immediately preceding Read output for that region, never retyped or reconstructed from memory — fullwidth punctuation is visually similar to but distinct from halfwidth ASCII, and a reconstructed `old_string` fails to match silently or hits the wrong occurrence. When a verbatim-copied `old_string` still cannot be matched (non-unique text, tool limitation), fall back to a `python` or `sed` replacement rather than retrying a hand-retyped Edit string.

## Pre-plan checklist (Feature / Bug)

1. Past-decision search (claude-mem, if installed) — see `${CLAUDE_PLUGIN_ROOT}/rules/tool-routing.md` "claude-mem at planning start"
2. Spawn Explore agents with `cx` instructions (→ `${CLAUDE_PLUGIN_ROOT}/rules/tool-routing.md`)
3. Blast-radius check (gitnexus_impact, if installed) — see `${CLAUDE_PLUGIN_ROOT}/rules/tool-routing.md` "gitnexus_impact timing"
4. Database work → verify Repository routing via the project's query builder convention

## Deterministic first, judgment second

For audit / setup / inventory / generation work, separate fact-collection from interpretation: **collect** deterministically (scripts / Grep / Glob, no judgment, baseline first) → **gate** (present facts; confirm before destructive or multi-file outcomes) → **judge** (AI evaluation last). **Tool output is immutable** — forward stdout verbatim, never hand-construct contract output (e.g. `deploy-list` schema=v1); a tool failure stops-and-reports, never simulates. Full detail: `${CLAUDE_PLUGIN_ROOT}/skills/dhpk-execution-policy/references/deterministic-first.md`. (harness-revise, skill-stocktake, project-setup, project-audit, risk-assess, deploy-list, skill-scout)

## Self-check (before reply)

Wrap-up before reply / after a large Edit / before smart-commit → load `dhpk:execution-checklist` skill for the full self-audit (Per-reply / Conditional / Task-end three-stage + trigger-condition matrix). Daily single-line edits / pure research / typos do not need this.

Any applicable NO → fix first, then reply.

## Anti-rationalization

Before skipping any sentinel / TDD / reviewer mandated step, load `${CLAUDE_PLUGIN_ROOT}/rules/anti-rationalization.md` for self-rebuttal. On-demand load, not always-on. Trigger conditions: see that file's "When to load" table (SSOT).

## Git pipeline

`feat|fix|docs|refactor/*` → `develop` → `master` (or your equivalent branching model). Standard flow: feature branch → `/codex-review-fast` → `/precommit` → `/pr-review` → PR. dhpk does **not** auto `git add/commit/push/stash` — invoke `/smart-commit` or `/precommit`.

**Shell trap**: this policy's shell is zsh, where `status` is a read-only variable — use `st=` / `rc=` for captured exit codes, never `status=`. Words beginning with `=` trigger zsh `=cmd` path expansion (an unquoted `==` yields `== not found`) — quote `=`-leading words. **PR self-merge is classifier-blocked** — never attempt `gh pr merge --admin` or remote branch deletion; hand off to a human.

**PR-branch follow-up trap**: before pushing a follow-up commit to a branch that already has an open PR, check `gh pr view <branch> --json state,baseRefName` first — a concurrent session or a human may have merged (and deleted) it, orphaning the new commit onto a dead branch and forcing a second PR. For CI/run waits, prefer `gh run watch <run-id>` (or the harness completion-notification pattern) over hand-rolled `sleep`-poll loops over `gh run list` — the same "background waits use completion notifications, never bash polling" rule the anti-loop safety floor already assumes.

### Squash merge hygiene (recommended)

For squash-merge PRs (collapsing multiple feature-branch commits into a single commit on the integration branch), the PR description should include an `## Unrelated Changes` section listing variations not directly tied to the PR's stated feature (file paths, line count, why mixed in, assigned reviewer). Reformats / CI yml tweaks / README typos **don't count** as unrelated; new controller actions / new services / schema changes / cron jobs / private→protected refactors / service factory extractions **do count**.

The `pr-review` skill includes an optional `check-unrelated-changes.sh` script (advisory, not blocking).

## Anti-loop & output

**⚠️ Canonical auto-loop: fix → re-review → … → ✅ PASS. Stop at the ceilings below; never loop silently. ⚠️**

**Stop and escalate** when ANY holds (not just the first): same failure 3×; no progress across two consecutive checkpoints (edits/tool-calls produce no change in the failing signal); repeated failures with the *identical* error / stack trace; cost or context drifting outside the budget window; a blocking merge conflict that keeps recurring. On stop, report (1) what was tried + error, (2) ≥2 alternatives, (3) recommended next step.

**Before any autonomous / repeated loop**, confirm the safety floor exists: a quality gate is active (lint/test), a known-good baseline to diff against, a rollback path (clean git state / revert), and branch or worktree isolation. Missing any → set it up first or do the work non-autonomously.

**Review-loop ceiling (Codex auto-loop skills only)**: distinct from the general "same failure 3×" stop above — this is a hard per-sentinel counter for skills that auto-loop fix→re-review via Codex (doc-review, test-review, security-review), capped at **3 rounds per sentinel**. On round 4, stop and report the blocker for human review — do not retry the same finding.

Output: `Conclusion → Changed files → Verification → Risks/Open questions`. Blocked: `Blocker → Tried → Next viable option`.

## Testing

Run the project's standard test suite + browser verify (playwright-cli, manual, or stack-equivalent). For Docker projects: see your `${PHP_CONTAINER:-php}` workflow. Commands per stack live in the matching dhpk module reference (e.g. `modules/phpunit-5.7/references/testing.md`).

Script-test requirements live in `${CLAUDE_PLUGIN_ROOT}/skills/dhpk-execution-policy/references/testing-policy.md`.

## Component-addition gate

Addition/removal justification and residue-cleanup requirements live in `${CLAUDE_PLUGIN_ROOT}/skills/dhpk-execution-policy/references/component-addition-policy.md`.

## Not in scope

- **Does not restate** stack-specific coding conventions — those live in each project's `.claude/rules/<stack>.md` or the matching dhpk module reference.
- **Does not restate** the anti-rationalization phrasing table — see `${CLAUDE_PLUGIN_ROOT}/rules/anti-rationalization.md`.
- **Does not restate** the tool-selection decision tree — see `${CLAUDE_PLUGIN_ROOT}/rules/tool-routing.md`.
- **Does not restate** the full end-of-task self-check — see `skills/dhpk-execution-checklist/SKILL.md`.

## Cross-references

- `${CLAUDE_PLUGIN_ROOT}/rules/anti-rationalization.md` — self-rebuttal table for skipping a mandated step
- `${CLAUDE_PLUGIN_ROOT}/rules/tool-routing.md` — code-exploration tool decision tree
- `skills/dhpk-execution-checklist/SKILL.md` — full end-of-task self-check
- `skills/dhpk-execution-policy/SKILL.md` — skill-form entry point into this policy
- `agents/INDEX.md` — agent roster, models, maxTurns rationale
