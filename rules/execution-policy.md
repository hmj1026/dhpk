# Execution Policy

dhpk's default execution policy for projects that adopt the harness. Resource-layer markdown — referenced from the `dhpk-execution-policy` skill and consumable directly by a project's own `CLAUDE.md` via the `${CLAUDE_PLUGIN_ROOT}/rules/execution-policy.md` path. Not auto-loaded; opt-in.

> Project overrides: projects that adopt this policy should keep their own short `.claude/rules/execution-policy.md` (or `CLAUDE.md` section) that only encodes deltas — e.g. extra sentinels, project-specific hot tables for performance reviewer, hook profile choice. Avoid copying the body wholesale; cross-link instead.
>
> Resolution order for any reference to this file: use the project's `.claude/rules/execution-policy.md` first if present (it carries only deltas — extra sentinels, hot tables, hook profile), otherwise resolve to `${CLAUDE_PLUGIN_ROOT}/rules/execution-policy.md` (the plugin SSOT). Projects should keep their local copy short and cross-link rather than copying the body wholesale.

## Glossary (inline)

- **sentinel**: `.claude/artifacts/sessions/.pending-*` marker file (written by a post-edit hook; cleared by the runtime hook `${CLAUDE_PLUGIN_ROOT}/scripts/hooks/subagent-stop-verify.sh` on a successful reviewer stop — the sanctioned path — or by the orchestrator via `${CLAUDE_PLUGIN_ROOT}/scripts/hooks/clear-sentinel.sh` for a triage-drop or a stale-sentinel back-stop; reviewer agents no longer self-clear). Existence check: `find -maxdepth 1 -name '.pending-*' -print 2>/dev/null` (avoids shell-specific `nomatch` behaviour with bare globs). Unrecognized `.pending-*` strays (not in the SSOT — a typo or abandoned custom sentinel) have no clearing agent and would block the opsx-apply-goal `NONE` gate forever; `${CLAUDE_PLUGIN_ROOT}/scripts/hooks/reap-stale-sentinels.sh` surfaces them always and, with `--clear`, removes ones older than the threshold.
- **back-stop**: hook pattern did not match but the AI semantically recognises the trigger should fire → AI proactively invokes the matching reviewer (and still clears the sentinel if present).
- **append-only exemption**: pure additions (not modifying existing symbol body / signature / docblock) may skip `gitnexus_impact` — label the change `append-only — gitnexus_impact skipped`.
- **reviewer dispatch**: when multiple sentinels coexist, triage out false positives → dispatch the rest **in parallel** → `code-reviewer` merges/dedups (see "Reviewer dispatch").

## Classification-first context loading

Determine the workflow type (Small change / Bug / Feature / Architecture) from the user request BEFORE loading heavy references (profiles, scope docs, legacy analysis, investigation scaffolding). Load only the references the chosen workflow needs; expand incrementally if the classification changes. Upfront loading burns context budget on paths not taken. (adaptive-dev-workflow, harness-fill)

### Change classification & OpenSpec routing (SSOT)

Single source of truth for the six change types, their flow, and whether to ask about OpenSpec. `commands/create-dev.md` and `skills/adaptive-dev-workflow/SKILL.md` route through this table — reference it, do not restate it.

| Change type | OpenSpec ask? | Flow |
|---|---|---|
| Bug Fix (unknown root cause) | ✅ ask | `bug-investigation` → y: `/opsx:new` · n: brief plan → tdd-guide → patch |
| Feature Delivery (cross-module / DDD) | ✅ ask | `dhpk:architect` → y: `/opsx:new` · n: brief plan → tdd-guide → patch |
| Feature Delivery (normal) | ✅ ask | y: `/opsx:new` · n: brief plan → tdd-guide → patch |
| Bug Fix (known root cause) | ❌ no | inspect → tdd-guide RED → patch → tdd-guide verify |
| Medium change | ❌ no | inspect → brief plan → tdd-guide → patch |
| Lightweight Maintenance | ❌ no | inspect → patch |

> **`/dhpk:do --openspec` override (force-`y`):** the `--openspec` flag (alias `--opsx`) force-selects the "create a change" (`y`) path — running `opsx:new` → `opsx:ff` to emit artifacts, then pausing for human review — overriding the per-type ask behavior in the "OpenSpec ask?" column above. The override is keyed on the **resolved route**, not the change-type row: it activates whenever `/dhpk:do` resolves to one of the three change-authoring routes (`dhpk:adaptive-dev-workflow`, `dhpk:bug-fix`, `dhpk:feature-dev`) — where every substantial bug/feature request lands *before* this per-type classification runs — so on those routes it goes straight to artifact authoring instead of asking or classifying (bypassing the row's normal investigation/architecture steps). It is **not applicable** to `opsx-apply-goal` (which applies an *existing* change) or any other non-authoring route — there it prints `--openspec ignored: ...` and proceeds. `--openspec` supersedes `--plan` only when this authoring diversion activates. SSOT for the flag mechanics: `commands/do.md` §Step 0c + §Openspec-mode rule.

## Agent dispatch

Agents run via the `Agent` tool (`subagent_type=<name>`), not via skill names.

| Agent | Runs when | Gate order |
|---|---|---|
| `tdd-guide` | Feature / bugfix, **before** writing implementation | 1 |
| `architect` | Cross-module or DDD-layer design | — |
| `deep-reasoner` | Reasoning-heavy implement-phase work (root cause, algorithm design, complex debugging) — see §Implementation dispatch | — |
| `fast-worker` | Mechanical implement-phase work with a clear spec — see §Implementation dispatch | — |
| `codex-bridge` | **CODEX=on only** — outsource a self-contained clear-spec task, or a blind second opinion, to gpt-5.5 via the Codex CLI (`codex exec`); output isolated in the subagent, relayed verbatim — see §Implementation dispatch | — |
| `e2e-runner` | RED / E2E user-journey work — author a Playwright spec, reason about how to seed fixtures, and run it against a live server — see §Implementation dispatch | — |
| `database-reviewer` | SQL / Repository / migration (SQL correctness) — sentinel `.pending-db-review` or back-stop | 2 |
| `migration-reviewer` | Migration files (up/down symmetry, FK naming, large ALTER, multi-tenant deploy) — sentinel `.pending-migration-review` (one of the 7-slot default `review_agents` chain since v0.10.0; the sentinel *trigger* itself stays opt-in via `module.yaml` `migration:` triggers or `review_trigger_extra_paths` `mig:` — see the sentinel table below) | — |
| `security-reviewer` | Auth / crypto / money / file upload — sentinel `.pending-security-review` or back-stop | 3 |
| `performance-analyzer` | Repository methods on high-volume tables — back-stop only | — |
| `frontend-reviewer` | JS / TS / view-layer JS — sentinel `.pending-frontend-review` or back-stop | — |
| `polyfill-reviewer` | `.php` edits with a runtime version guard (`version_compare` / `class_exists` / `method_exists` / `InstalledVersions::*`) — sentinel `.pending-polyfill-review` *(library-author module)* | — |
| `code-reviewer` | **Code final gate** — sentinel `.pending-review` | 4 |
| `doc-reviewer` | **Doc final gate** — sentinel `.pending-doc-review` | — |

`Gate order` (1–4) marks the agents in the mandatory sequential post-edit gate, detailed below under "Post-implementation agent gate (SSOT)"; `—` = not part of that gate (planning-phase, back-stop-only, or a specialist sentinel outside the strict 4-step chain).

Agent names above are dhpk defaults; override via `userConfig.review_agents` per slot. Projects with prefixed agents (e.g. `code-reviewer-<project>`) configure the override in their `settings.local.json`.

**Diff-scope mandate (all reviewers)**: reviewers audit the UNCOMMITTED working tree (`git diff --staged` + `git diff HEAD`), never committed history (`git diff <base>...HEAD` / merge-base diff). Under the no-auto-commit workflow the change-under-review sits uncommitted; a base-relative diff reviews the whole branch (often hundreds of files) — wasting tokens/time and misreporting committed-but-superseded code as unfixed. Orchestrators dispatching a reviewer MUST NOT instruct it to diff against a base branch unless an explicit full-branch/PR review is the intent.

**File-state ground truth (before reporting a file-state defect)**: before concluding that a file was reverted, a regression exists, or the working tree is in a broken/inconsistent state, the reviewer or orchestrator re-verifies live — `git status --porcelain` plus a direct Read of the target file's current content — rather than trusting a single injected file-snapshot (e.g. a `<system-reminder>`) as proof. A snapshot captured mid-operation (e.g. mid branch-switch) can transiently show a stale or reverted-looking state that is not a real defect; the live re-check, not the snapshot, is the tie-breaker before a defect is reported. A live-confirmed defect is still reported as usual — the re-check confirms genuine defects, it does not suppress them.

**Sentinel-scoped precedence**: when a reviewer's own sentinel exists (`.claude/artifacts/sessions/.pending-{review,db-review,security-review,frontend-review,doc-review,polyfill-review,migration-review}`), its listed paths are the SOLE authoritative scope — not the full uncommitted tree above. Parse each line's path via the field-3 convention (`cut -d' ' -f3-`; see `scripts/hooks/_lib/payload.sh` SENTINEL LINE FORMAT). Diff each listed path individually: `git diff --staged -- <path>` + `git diff HEAD -- <path>`. Skip every other uncommitted/staged file not on the list, even same extension/glob — it belongs to a different session's change. Fall back to the unfiltered mandate above only when (a) no sentinel exists for this slot (back-stop invocation — e.g. `performance-analyzer`, which has no slot), or (b) the user/orchestrator explicitly requests a full working-tree/PR review — that explicit request wins over sentinel-scoping.

**Model tier**: reviewers run at their agent-frontmatter default (`doc-reviewer` = haiku, the rest = sonnet). For a **HIGH-risk diff** — `security-reviewer` on auth/crypto/money/upload, or `migration-reviewer` on a multi-tenant schema change against a high-volume table — the orchestrator MAY raise that single dispatch to opus via the `Agent` call's `model` param. Default stays sonnet; escalate by judgment, not by default (cost). Symmetrically at the low-risk end: a **known-finding-mapped** delta of roughly ≤3 net changed lines that maps 1:1 to a finding already flagged in the current review round (not new/uninspected work) MAY be dispatched to the required reviewer at a *reduced* tier (e.g. `haiku`) via the same `model` param — reused symmetrically for a LOW-risk case — instead of the reviewer's frontmatter default; never for a security/db-sensitive file or a CRITICAL-severity target finding, and never in place of the reviewer dispatch itself (the gate still runs, only cheaper). The full role→tier map and master cost rules live in `${CLAUDE_PLUGIN_ROOT}/rules/model-economics.md` — reference it rather than restating tiers here.

**Configured role models** (`deep-reasoner` / `fast-worker`): `session-start.sh` announces the effective `deep_reasoner_model` / `fast_worker_model` at session start only when they differ from the shipped default (opus / sonnet) — configured via the `deep_reasoner_model` / `fast_worker_model` / `orchestration_dispatch` `userConfig` keys in `.claude-plugin/plugin.json`. When announced, the orchestrator passes that value on the `Agent` call's `model` param for every dispatch of that role; frontmatter is never edited. An invalid configured value (not a model name the running Claude Code supports) triggers one warning per session and the dispatch falls back to the agent's frontmatter default — it never fails the dispatch. The judgment-based HIGH-risk escalation above still applies on top of a configured value and takes precedence for that single dispatch (e.g. a configured `fast_worker_model=haiku` may still be raised to sonnet/opus for one high-risk task). The two workers also carry effort keys (`deep_reasoner_effort` / `fast_worker_effort`), applied on the `Agent` call's `effort` param by the same announce-when-non-default mechanism; the cost rationale for both dials is in `${CLAUDE_PLUGIN_ROOT}/rules/model-economics.md`.

## Implementation dispatch

SSOT for implement-phase routing while `userConfig.orchestration_dispatch=on` (default). Downstream skills (`feature-dev`, `bug-fix`, `adaptive-dev-workflow`, `opsx-apply-goal`) reference this table — they do not restate it. Unattended goal sessions bind this section by reading this policy during their orientation step (the `opsx-apply-goal` orientation command resolves and reads this file); the emitted `/goal` condition carries only the compact roster line and the self-locating pointer, never these elaborations.

| Work shape | Dispatch |
|---|---|
| Reasoning-heavy (unknown root cause, algorithm design, cross-file complex analysis) | `deep-reasoner` |
| Mechanical with a clear spec (boilerplate, test scaffolds, rename sweeps, multi-file doc-consistency fixes of ≥3 files, applying an already-approved plan) | `fast-worker` |
| Small diff (roughly ≤2 files, unambiguous intent) | Inline in the main loop — no dispatch |
| Complex implementation (needs both reasoning and mechanical application) | `deep-reasoner` produces the fix spec (conclusion contract) → `fast-worker` applies it |
| RED / E2E test that must reason about seeding AND run against a live server (Playwright user journeys) — read-only `deep-reasoner` can't run it, mechanical `fast-worker` can't reason about the seeding | `e2e-runner` |
| RED PHPUnit unit/integration test authored test-first and run against a live DB (Testbench / docker MySQL) — Playwright-scoped `e2e-runner` doesn't fit, read-only `deep-reasoner` can't run it, and `fast-worker`'s "make verification pass" contract conflicts with a deliberately-failing RED test | `tdd-guide` |
| A read-only, scenario-driven live-runtime probe (drive the real running system with one concrete scenario, observe rather than infer) — distinct from `e2e-runner` (authors/runs Playwright specs, write-capable, web-scoped) and the `feature-verify` skill (main-context, heavyweight P0–P5 scope, not a dispatchable isolated agent) | `dhpk:smoke-tester` |
| Plan critique / blind-sketch / dual-plan before implementation, or a warm diff review at task end | `dhpk:planner` — opt-in via `/dhpk:do --plan` on the four implementation-class routes (`dhpk:adaptive-dev-workflow`, `dhpk:bug-fix`, `dhpk:feature-dev`, `dhpk:opsx-apply-goal`) |
| Independent second opinion, or an offloaded self-contained clear-spec task — **CODEX=on only** | `codex-bridge` (subagent; one-shot bash `codex exec`, output isolated + relayed verbatim) |
| Live CI/deploy verification (`gh run watch`, run-log triage, retry babysitting) — main context keeps only merge/fix decisions | `dhpk:smoke-tester` (read-only probe) or background `fast-worker` |

**Orchestrator posture**: the main session is the expensive orchestrator; its implement-phase job is **decide → dispatch → verify**, not hand-typing edits. Dispatch to a worker is the **default**; inline (`≤2 files`, measured on the whole implement-step footprint) is a narrow exception; when unsure between inline and a worker, dispatch. `general-purpose` is **prohibited** for implementation while `orchestration_dispatch=on`; `orchestration_dispatch=off` is the full opt-out (inline everywhere). Premise discipline: verify an unverified behavioral premise with the probe that can actually settle it **before** dispatching a write worker — a code/algorithm/data-shape premise with read-only `deep-reasoner`, a runtime/browser/environment behavior premise with `e2e-runner` or a scratch executable probe (read-only `deep-reasoner` cannot execute or observe such behavior); sanity-check a `deep-reasoner` conclusion before `fast-worker` applies it; cross-verify a premise-overturning discovery independently before reframing (per §Multi-AI / dual-perspective independence). `CODEX=on` adds a blind `codex-bridge` parallel peer. Worker dispatch never weakens a gate — the orchestrator verifies the worker's edited-file list + verification line and confirms expected sentinels ran. Wait on background-agent completion notifications for worker results; NEVER bash-poll `.pending-*` sentinels or sleep-loop awaiting agent results. **Plan-brief discipline**: any brief assembled for a dispatched agent — including the `dhpk:planner` plan brief — follows conclusions-not-context, a bounded token budget, and a lookup fence, so downstream skills that build their own briefs for `dhpk:planner` follow the same shape.

**Repository Discovery Gate / explicit-hard-rule guardrail**: before new DB, SQL, query-builder, criteria, model-persistence, or repository-like code is finalized, inspect the project's repository/query-layering convention and route persistence through the established boundary. A controller/service-local query is not accepted merely because an OpenSpec design snapshot chose that cheaper placement. Explicit project hard rules cannot be deferred with cost language such as "disproportionate", "small enough to defer", or "the approved design already chose this"; load `${CLAUDE_PLUGIN_ROOT}/rules/anti-rationalization.md`, comply with the rule, or record an explicit human-approved exception before marking the implementation task complete. A reviewer finding at MEDIUM or higher severity for Repository / query-layering is actionable, not optional follow-up, unless that human-approved exception exists.

**Operational detail** (posture rationale, the ≤2-files measurement, `general-purpose` prohibition, gate-preservation back-stop, verify-worker-output cross-check, phase scoping, the premise-verification trio, kill switch, CODEX peer path): load `${CLAUDE_PLUGIN_ROOT}/skills/dhpk-execution-policy/references/implementation-dispatch.md` when dispatching implement-phase work.

### CODEX=on high-stakes parallel peer path

Under `CODEX=on` only, for a high-stakes implement-phase design/diagnosis decision the orchestrator dispatches `deep-reasoner` and a blind `codex-bridge` Codex peer in parallel (each blind to the other, per §Multi-AI / dual-perspective independence), then synthesizes. The `opsx-apply-goal` goal template wires this **proactively** — before finalizing a high-stakes *solo* edit with no inter-agent conflict to arbitrate (the goal-template generator itself, an SSOT policy file, a spec-requirement deferral, a first-seen query/repository pattern, a framework-internal hack or private-state reset, an explicit-rule deferral) — and, as a wrap-up self-check, requires reconciling a session that declared `CODEX=on` but dispatched `codex-bridge` 0 times. Full operational detail: `${CLAUDE_PLUGIN_ROOT}/skills/dhpk-execution-policy/references/implementation-dispatch.md` §CODEX=on high-stakes parallel peer path. Default (codex-free) sessions take none of this path.

## Multi-AI / dual-perspective independence

When a step uses a second AI or a second perspective (Codex, Gemini, or a Claude-vs-Codex/dual-view pass), each side MUST form its own conclusion from the source — never feed Claude's findings, verdict, or theory into the secondary prompt.

- Secondary prompt carries only the question + project path + stack — not Claude's analysis.
- No leading questions ("I think it's the cache, confirm"), no scope pre-filtering, no reused threads.
- Compare the two independent conclusions; flag divergences explicitly in the report.

Violation: the secondary AI confirms instead of verifying → false consensus that masks the shared blind spot. Applies to codex-architect / -brainstorm / -implement / -code-review, multi-ai-sync, feature-verify, test-review, code-investigate, issue-analyze.

## In-flight doubt cycle (adversarial premise review)

A confident decision is not a correct one — long sessions quietly turn assumptions into "facts". Before a **non-trivial** in-flight decision stands — introduces/modifies branching logic, crosses a module or service boundary, asserts a property the compiler can't verify (thread-safety / idempotence / ordering / an invariant), or is irreversible (prod deploy, data migration, public-API change) — run a bounded doubt pass. This is **not** `/code-review` (a post-hoc verdict on a finished artifact); it is an in-flight posture that catches wrong directions while course-correction is cheap, and it generalizes the write-worker premise checks in §Implementation dispatch to any mid-build decision. Skip it for mechanical work (rename / format / file move), one-line obvious-correctness changes, or when the user asked for speed over verification.

Cycle: **CLAIM** (name the decision + why it matters, 2–3 lines) → **EXTRACT** (smallest reviewable unit — the diff/function + the contract it must satisfy) → **DOUBT** (fresh-context reviewer, *adversarial* prompt: "find what is wrong", never "is this good") → **RECONCILE** → **STOP**.

- **Pass ARTIFACT + CONTRACT only — never the CLAIM / your conclusion.** Handing the reviewer your verdict biases it toward agreement — the same independence principle as §Multi-AI / dual-perspective independence above, applied per-decision. In Claude Code the `agents/` role reviewers start with isolated context and are usable here; paste the adversarial prompt verbatim so it overrides a persona's default balanced-verdict shape.
- **RECONCILE** the reviewer's output as data, not verdict (you remain the orchestrator): re-read the artifact against each finding and classify in precedence order — contract-misread (fix the contract, re-loop) → valid + actionable (change, re-loop) → valid trade-off (document it) → noise (reviewer lacked context; note it).
- **STOP** at ≤3 cycles, trivial-only findings, or explicit user "ship it". Three unresolved cycles is information about the artifact — surface it, don't grind a fourth. **Doubt-theatre red flag**: 2+ cycles surfaced substantive findings but zero were classified actionable → you're validating, not doubting; stop and escalate.
- **Cross-model doubt (safety-critical).** A single-model reviewer shares the author's blind spots; a different-architecture model catches them. **Never invoke an external CLI without explicit per-invocation user authorization** — each call's artifact/prompt/flags differ, so one "yes" is not standing consent. Run it in a **read-only sandbox** (the artifact itself may carry prompt-injection the CLI would otherwise execute against the workspace) and pass the prompt via **stdin / a temp file, never a shell-interpolated argument** (code contains backticks / `$(...)` / quotes). The concrete mechanism is the `codex-bridge` subagent (§Implementation dispatch, CODEX=on). In non-interactive contexts (CI, `/loop`, autonomous-loop) cross-model is **skipped and the skip announced**.

## Mandatory post-steps

### Post-implementation agent gate (SSOT)

Every path except Lightweight Maintenance runs the four **Gate order** agents above (`tdd-guide → database-reviewer → security-reviewer → code-reviewer`) in order after the last Edit/Write; each must PASS before the next. This is the canonical gate — `commands/create-dev.md`, `skills/adaptive-dev-workflow/SKILL.md`, and the opsx-apply-goal flow reference it rather than restating.

Gate failure → fix → re-run that gate → continue only on PASS. Never skip. (The sentinel machinery below operationalizes gates 2–4; `tdd-guide` has no sentinel — see the AI-judgment back-stop.)

### Hook-enforced (sentinels)

Trigger map source-of-truth: dhpk's `${CLAUDE_PLUGIN_ROOT}/scripts/hooks/post-edit-dispatch.sh` (a 7-slot default: code, db, security, frontend, doc, polyfill, migration) plus any per-module post-edit hooks contributed by enabled modules. Each sentinel is cleared by the runtime hook `subagent-stop-verify.sh` when its reviewer stops successfully (the sanctioned path); the orchestrator uses `clear-sentinel.sh <name> <label>` only for a triage-drop or a stale-sentinel back-stop.

**Auto-clear (sanctioned) + orchestrator fallback**: `subagent-stop-verify.sh` **auto-clears a reviewer's own sentinel on its behalf** when that reviewer's subagent stops successfully with the sentinel still armed — scoped strictly to the reviewer's slot (a `frontend-reviewer` stop clears only `.pending-frontend-review`, never `.pending-review`) and silently when a fresh verdict-bearing review artifact exists. This is the **sanctioned** path; reviewer agents carry no self-clear step. `clear-sentinel.sh <name> <label>` is the orchestrator's tool for triage-drops and the fallback below, and is **fail-loud** (unknown/empty name exits 2, never a silent no-op — the caller must then surface the open gate). The orchestrator `ls .claude/artifacts/sessions/.pending-*` re-check remains the **fallback** for what the hook can't cover — when the subagent name isn't extractable from the SubagentStop payload, or a same-session second `code-reviewer` left `.pending-review` armed after its own SubagentStop already passed — clearing any straggler with the **exact** basename (`clear-sentinel.sh .pending-review`). Mechanics + the observed failure case: `${CLAUDE_PLUGIN_ROOT}/skills/dhpk-execution-policy/references/review-gate-mechanics.md`.

| Sentinel | Required agent | Trigger summary (default; project can extend via `userConfig.review_trigger_extra_paths`) |
|---|---|---|
| `.pending-review` | `code-reviewer` | `*.php` / `*.js` / `**/CLAUDE.md` |
| `.pending-doc-review` | `doc-reviewer` | `.md` files under `.claude/{agents,rules,commands,hooks,scripts,skills,manifests}/`, `openspec/`, or `docs/`; `CLAUDE.md` / `AGENTS.md` (any depth); top-level `README*.md` only — covers both frontmatter schema (name/model/tools) for `.md` DSL artifacts AND cross-file SSOT / link-validity |
| `.pending-db-review` | `database-reviewer` | Repository / migration / model / `*.sql` |
| `.pending-security-review` | `security-reviewer` | Controllers / config / `*{Auth,Login,Acl,Upload,File}*.php` |
| `.pending-frontend-review` | `frontend-reviewer` | JS / TS (vendor / ignored paths excluded) |
| `.pending-polyfill-review` *(library-author module)* | `polyfill-reviewer` | `.php` edits with a runtime version guard (`version_compare` / `class_exists` / `method_exists` / `InstalledVersions::*`) |
| `.pending-migration-review` *(opt-in trigger)* | `migration-reviewer` | Migration files (e.g. `**/migrations/**/*.php`) — projects that wire this sentinel in their post-edit hook get migration-specific review on top of the standard db-review |

**Skipped paths**: `.claude/artifacts/**` is exempt from all slots (self-edit re-trigger guard); doc-review additionally skips any `.md` outside its allow-list, but the generic extension/keyword defaults (`*.php`/`*.js`/`*.sql`/`*Auth*`…) still match on filename alone anywhere else. Full path rules: `${CLAUDE_PLUGIN_ROOT}/skills/dhpk-execution-policy/references/review-gate-mechanics.md`.

### Reviewer dispatch (when multiple sentinels coexist)

At the end of a turn that produced Edits/Writes, gather ALL pending sentinels, then **triage → dispatch in parallel → merge**: (1) **triage** (cheap, no agent) — DROP false-positive sentinels (pure CSS / whitespace / comment-only / typo, or OpenSpec `tasks.md` checkbox bookkeeping) with a one-line reason, clearing each via `clear-sentinel.sh`; triage only drops, when in doubt keep the reviewer. (2) **dispatch surviving reviewers IN PARALLEL** — one message, multiple Agent calls; wall-clock is `max(reviewers)`, not the sum — never a sequential chain. (3) **`code-reviewer` merges/dedups** cross-reviewer findings; each specialist still owns its lane (code-reviewer doesn't re-run OWASP/SQL/link-checks). Batched per turn (not per edit) — and a review round's **known-finding-mapped** small fixes (each mapping 1:1 to an already-flagged Codex finding, reviewer-flagged issue, or a design.md append recording one — not new work) are applied together and re-reviewed ONCE as a batch, never edit→re-review→edit→re-review serially one finding-fix at a time (a genuinely new finding discovered mid-batch still gets its own cycle); any CRITICAL blocks the merge/commit; `code-reviewer`+`doc-reviewer` are not mutually exclusive on mixed diffs; pure research (no Edit/Write) skips all reviewers. Full triage rules + examples: `${CLAUDE_PLUGIN_ROOT}/skills/dhpk-execution-policy/references/review-gate-mechanics.md`.

**Reviewer liveness — a no-op reviewer is a FAILED gate.** A dispatched reviewer that returns having done no review work — `tool_uses=0`, no `Read`/`Grep`/`Bash` call, or a body that merely echoes an injected `<system-reminder>` / agent-roster instead of a findings-plus-verdict report — has NOT satisfied its gate: do not mark the review complete and do not accept a cleared sentinel on such a return. Re-dispatch to a reviewer that can actually run it — substitute a stronger reviewer (`code-reviewer`, chartered for `.claude/`-style agents/rules/skills markdown) for a misfiring Haiku `doc-reviewer` — rather than retrying the same agent a third identical time (anti-loop), and record the substitution and its reason. Mechanics: `${CLAUDE_PLUGIN_ROOT}/skills/dhpk-execution-policy/references/review-gate-mechanics.md`.

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

### Squash merge hygiene (recommended)

For squash-merge PRs (collapsing multiple feature-branch commits into a single commit on the integration branch), the PR description should include an `## Unrelated Changes` section listing variations not directly tied to the PR's stated feature (file paths, line count, why mixed in, assigned reviewer). Reformats / CI yml tweaks / README typos **don't count** as unrelated; new controller actions / new services / schema changes / cron jobs / private→protected refactors / service factory extractions **do count**.

The `pr-review` skill includes an optional `check-unrelated-changes.sh` script (advisory, not blocking).

## Anti-loop & output

**Stop and escalate** when ANY holds (not just the first): same failure 3×; no progress across two consecutive checkpoints (edits/tool-calls produce no change in the failing signal); repeated failures with the *identical* error / stack trace; cost or context drifting outside the budget window; a blocking merge conflict that keeps recurring. On stop, report (1) what was tried + error, (2) ≥2 alternatives, (3) recommended next step.

**Before any autonomous / repeated loop**, confirm the safety floor exists: a quality gate is active (lint/test), a known-good baseline to diff against, a rollback path (clean git state / revert), and branch or worktree isolation. Missing any → set it up first or do the work non-autonomously.

**Review-loop ceiling (Codex auto-loop skills only)**: distinct from the general "same failure 3×" stop above — this is a hard per-sentinel counter for skills that auto-loop fix→re-review via Codex (doc-review, test-review, security-review), capped at **3 rounds per sentinel**. On round 4, stop and report the blocker for human review — do not retry the same finding.

Output: `Conclusion → Changed files → Verification → Risks/Open questions`. Blocked: `Blocker → Tried → Next viable option`.

## Testing

Run the project's standard test suite + browser verify (playwright-cli, manual, or stack-equivalent). For Docker projects: see your `${PHP_CONTAINER:-php}` workflow. Commands per stack live in the matching dhpk module reference (e.g. `modules/phpunit-5.7/references/testing.md`).

### Script test coverage policy

Every guard, resolver, validator, runner, sentinel/lifecycle script, codegen script, and pure `_lib` helper under `scripts/` MUST have a dedicated test in `tests/`. Naming: the test file is named after the script's stem plus an optional aspect suffix, flat in `tests/`, discoverable by `tests/run-all.js` — `tests/<stem>[-<aspect>].test.js`.

Test shape: shell hooks are driven by piping a payload via `DHPK_TEST_PAYLOAD` / `DHPK_TEST_HOOK` into `bash`, invoked with `spawnSync`, asserted on exit status/stderr; JS/TS/py scripts are driven directly via `spawnSync`, asserted on stdout/exit. All tests use the zero-dep `tests/_lib/tinytest.js` — no external test framework dependency.

**Behavioral vs smoke coverage**: installers, session-lifecycle hooks, and git/network-shelling scripts are smoke-only — a smoke test asserts the script runs, is syntactically valid, and no-ops safely in a sandbox. Smoke coverage is not full behavioral verification; do not read a passing smoke test as proof the script's logic is correct.

## Component-addition gate (new agent / sentinel slot / hook)

Adding a reviewer agent, sentinel slot, or hook is the add-then-remove churn that leaves residue (dead slot tokens, orphan sentinels, drifted counts). Before adding one, document in the relevant INDEX (`agents/INDEX.md`, `skills/INDEX.md`, or the hook's header comment) **why an existing component cannot cover the need** — name the agent/slot/hook considered and the specific gap it leaves. A new component with no recorded justification is rejected in review. Removal is symmetric: in the same change, delete its INDEX row and every reference (slot token, `.pending-*` literal, count claim), so nothing is orphaned — the sentinel-integrity and count guards (`tests/sentinel-slots.test.js`, `scripts/ci/catalog.js`) enforce this mechanically.

## Not in scope

- **Does not restate** stack-specific coding conventions — those live in each project's `.claude/rules/<stack>.md` or the matching dhpk module reference.
- **Does not restate** the anti-rationalization phrasing table — see `${CLAUDE_PLUGIN_ROOT}/rules/anti-rationalization.md`.
- **Does not restate** the tool-selection decision tree — see `${CLAUDE_PLUGIN_ROOT}/rules/tool-routing.md`.
- **Does not restate** the full end-of-task self-check — see `skills/execution-checklist/SKILL.md`.

## Cross-references

- `${CLAUDE_PLUGIN_ROOT}/rules/anti-rationalization.md` — self-rebuttal table for skipping a mandated step
- `${CLAUDE_PLUGIN_ROOT}/rules/tool-routing.md` — code-exploration tool decision tree
- `skills/execution-checklist/SKILL.md` — full end-of-task self-check
- `skills/dhpk-execution-policy/SKILL.md` — skill-form entry point into this policy
- `agents/INDEX.md` — agent roster, models, maxTurns rationale
