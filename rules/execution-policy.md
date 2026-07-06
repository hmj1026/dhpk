# Execution Policy

dhpk's default execution policy for projects that adopt the harness. Resource-layer markdown — referenced from the `dhpk-execution-policy` skill and consumable directly by a project's own `CLAUDE.md` via the `${CLAUDE_PLUGIN_ROOT}/rules/execution-policy.md` path. Not auto-loaded; opt-in.

> Project overrides: projects that adopt this policy should keep their own short `.claude/rules/execution-policy.md` (or `CLAUDE.md` section) that only encodes deltas — e.g. extra sentinels, project-specific hot tables for performance reviewer, hook profile choice. Avoid copying the body wholesale; cross-link instead.
>
> Resolution order for any reference to this file: use the project's `.claude/rules/execution-policy.md` first if present (it carries only deltas — extra sentinels, hot tables, hook profile), otherwise resolve to `${CLAUDE_PLUGIN_ROOT}/rules/execution-policy.md` (the plugin SSOT). Projects should keep their local copy short and cross-link rather than copying the body wholesale.

## Glossary (inline)

- **sentinel**: `.claude/artifacts/sessions/.pending-*` marker file (written by a post-edit hook; cleared by the reviewer's Closing hook via `${CLAUDE_PLUGIN_ROOT}/scripts/hooks/clear-sentinel.sh`). Existence check: `find -maxdepth 1 -name '.pending-*' -print 2>/dev/null` (avoids shell-specific `nomatch` behaviour with bare globs). Unrecognized `.pending-*` strays (not in the SSOT — a typo or abandoned custom sentinel) have no clearing agent and would block the opsx-apply-goal `NONE` gate forever; `${CLAUDE_PLUGIN_ROOT}/scripts/hooks/reap-stale-sentinels.sh` surfaces them always and, with `--clear`, removes ones older than the threshold.
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

## Agent dispatch

Agents run via the `Agent` tool (`subagent_type=<name>`), not via skill names.

| Agent | Runs when | Gate order |
|---|---|---|
| `tdd-guide` | Feature / bugfix, **before** writing implementation | 1 |
| `architect` | Cross-module or DDD-layer design | — |
| `deep-reasoner` | Reasoning-heavy implement-phase work (root cause, algorithm design, complex debugging) — see §Implementation dispatch | — |
| `fast-worker` | Mechanical implement-phase work with a clear spec — see §Implementation dispatch | — |
| `codex-bridge` | **CODEX=on only** — outsource a self-contained clear-spec task, or a blind second opinion, to gpt-5.5 via the Codex CLI (`codex exec`); output isolated in the subagent, relayed verbatim — see §Implementation dispatch | — |
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

**Sentinel-scoped precedence**: when a reviewer's own sentinel exists (`.claude/artifacts/sessions/.pending-{review,db-review,security-review,frontend-review,doc-review,polyfill-review,migration-review}`), its listed paths are the SOLE authoritative scope — not the full uncommitted tree above. Parse each line's path via the field-3 convention (`cut -d' ' -f3-`; see `scripts/hooks/_lib/payload.sh` SENTINEL LINE FORMAT). Diff each listed path individually: `git diff --staged -- <path>` + `git diff HEAD -- <path>`. Skip every other uncommitted/staged file not on the list, even same extension/glob — it belongs to a different session's change. Fall back to the unfiltered mandate above only when (a) no sentinel exists for this slot (back-stop invocation — e.g. `performance-analyzer`, which has no slot), or (b) the user/orchestrator explicitly requests a full working-tree/PR review — that explicit request wins over sentinel-scoping.

**Model tier**: reviewers run at their agent-frontmatter default (`doc-reviewer` = haiku, the rest = sonnet). For a **HIGH-risk diff** — `security-reviewer` on auth/crypto/money/upload, or `migration-reviewer` on a multi-tenant schema change against a high-volume table — the orchestrator MAY raise that single dispatch to opus via the `Agent` call's `model` param. Default stays sonnet; escalate by judgment, not by default (cost). The full role→tier map and master cost rules live in `${CLAUDE_PLUGIN_ROOT}/rules/model-economics.md` — reference it rather than restating tiers here.

**Configured role models** (`deep-reasoner` / `fast-worker`): `session-start.sh` announces the effective `deep_reasoner_model` / `fast_worker_model` at session start only when they differ from the shipped default (opus / sonnet) — configured via the `deep_reasoner_model` / `fast_worker_model` / `orchestration_dispatch` `userConfig` keys in `.claude-plugin/plugin.json`. When announced, the orchestrator passes that value on the `Agent` call's `model` param for every dispatch of that role; frontmatter is never edited. An invalid configured value (not a model name the running Claude Code supports) triggers one warning per session and the dispatch falls back to the agent's frontmatter default — it never fails the dispatch. The judgment-based HIGH-risk escalation above still applies on top of a configured value and takes precedence for that single dispatch (e.g. a configured `fast_worker_model=haiku` may still be raised to sonnet/opus for one high-risk task). The two workers also carry effort keys (`deep_reasoner_effort` / `fast_worker_effort`), applied on the `Agent` call's `effort` param by the same announce-when-non-default mechanism; the cost rationale for both dials is in `${CLAUDE_PLUGIN_ROOT}/rules/model-economics.md`.

## Implementation dispatch

SSOT for implement-phase routing while `userConfig.orchestration_dispatch=on` (default). Downstream skills (`feature-dev`, `bug-fix`, `adaptive-dev-workflow`, `opsx-apply-goal`) reference this table — they do not restate it.

| Work shape | Dispatch |
|---|---|
| Reasoning-heavy (unknown root cause, algorithm design, cross-file complex analysis) | `deep-reasoner` |
| Mechanical with a clear spec (boilerplate, test scaffolds, rename sweeps, applying an already-approved plan) | `fast-worker` |
| Small diff (roughly ≤2 files, unambiguous intent) | Inline in the main loop — no dispatch |
| Complex implementation (needs both reasoning and mechanical application) | `deep-reasoner` produces the fix spec (conclusion contract) → `fast-worker` applies it |
| Independent second opinion, or an offloaded self-contained clear-spec task — **CODEX=on only** | `codex-bridge` (subagent; one-shot bash `codex exec`, output isolated + relayed verbatim) |

**Orchestrator posture**: the main session is the expensive, high-capability orchestrator; its implement-phase job is **decide → dispatch → verify**, not hand-typing mechanical edits. Dispatch to a worker is the **default**; inline is a **narrow exception**, not a co-equal option. The economic reason is the point, not a nicety — the orchestrator runs on the expensive tier and `fast-worker` on a cheaper one, so routing mechanical work to `fast-worker` is why this policy exists and the default bias is to dispatch.

**The "≤2 files" inline bound is measured on the whole implement-step footprint, not each individual Edit.** A run of individually-small mechanical edits that together touch more than two files is **one `fast-worker` dispatch** (batched into a single fix-spec), not a salami-sliced sequence of "small" inline diffs. When the choice between inline and `fast-worker` is unclear, **dispatch**.

**`general-purpose` is prohibited for implementation while `orchestration_dispatch=on`.** It carries no dhpk policy context, inherits the main-session model regardless of task cost, and has no defined input/output contract — use `deep-reasoner` / `fast-worker` / inline per the table above instead.

**Gate preservation (edited-file-list back-stop)**: worker dispatch never weakens a gate. `fast-worker` always reports its complete edited-file list (mandatory, even on a failed/escalated attempt — see its agent body). After a dispatch returns, the orchestrator checks for pending sentinels as usual; subagent Edit/Write triggers the same PostToolUse hooks as a main-loop edit in the default Claude Code hook wiring, so sentinels are the common path. If a project setup ever does not fire hooks for subagent tool calls, the orchestrator derives the applicable reviewer gates from the edited-file list instead and runs them — same Post-implementation agent gate either way.

**Verify worker output before accepting (implement phase)**: when a `fast-worker` (or `deep-reasoner` → `fast-worker`) dispatch returns, before marking the task complete the orchestrator (a) re-surfaces the worker's verification line (`<command> → PASS|FAIL`) and complete edited-file list into the conversation, so the goal loop's conversation-only Haiku evaluator can see the evidence; (b) cross-checks that edited-file list against `git status --short` / `git diff --name-only` and investigates any mismatch (a worker no-op, or files changed but unreported); (c) confirms the review sentinels expected for the edited file types are present or were already cleared by a reviewer that ran, and when an expected sentinel is missing invokes the reviewer derived from the edited-file list (activating the back-stop above rather than leaving it dead); (d) on a worker FAIL or 3-attempt escalation, does NOT mark the task complete and re-scopes or re-dispatches `deep-reasoner` for a corrected fix-spec. This is a lightweight cross-check — the full test-suite re-run stays the `opsx-apply-goal` Part 3 end-gate, not a per-task step.

**Phase scoping (implement phase only)**: this table governs the **implement phase**. OpenSpec artifact authoring (proposal / specs / design / tasks) is orchestrator-inline reasoning work — it is NOT mechanical and is never dispatched to `fast-worker`; the orchestrator authors it, seeded by any preceding investigation. Root-cause investigation dispatches read-only `deep-reasoner`, whose conclusion contract seeds the fix-spec or the authored artifacts. In plan mode only read-only workers (`deep-reasoner`, `Explore`) may be dispatched — `fast-worker` cannot apply edits until plan mode is exited; `deep-reasoner` **is** permitted in plan mode because it is read-only.

**Verify an unverified behavioral premise before dispatching a write worker**: when a `fast-worker` task rests on an unverified *behavioral premise* — that a bug reproduces under the given fixture/data, that an algorithm or formula is correct, or that an assumed data-shape / plan dependency holds — dispatch read-only `deep-reasoner` to confirm the premise **first**, and dispatch `fast-worker` only once it holds. Writing a RED regression test or a non-obvious fix on top of an unverified premise can hand `fast-worker` an impossible spec: a full apply-and-fail (or a multi-attempt escalation costing ~100k+ subagent tokens) that verifying the premise up front would have avoided. This is distinct from the conclusion sanity-check below — that checks a `deep-reasoner` *conclusion* is precise enough to apply; this checks the *premise the task is built on* before any fix-spec exists. (`deep-reasoner` is read-only, so this applies in plan mode too.)

**Sanity-check a `deep-reasoner` conclusion before `fast-worker` applies it**: before dispatching `fast-worker` to apply a conclusion contract, confirm it carries file:line evidence and next-actions precise enough to serve as a task spec. Re-work a vague or evidence-free conclusion (return it to `deep-reasoner`, or resolve it inline) rather than dispatching it for application — a wrong confident conclusion otherwise costs a full 3-attempt apply-and-fail cycle.

**Kill switch**: `orchestration_dispatch=off` restores pre-change behavior exactly — inline implementation everywhere touched by this policy, no dispatch prohibition, no `opsx-apply-goal` directive line (see that skill's wiring). This is a full opt-out, not a partial degrade.

**`CODEX=on` high-stakes parallel peer path**: for a high-stakes implement-phase design/diagnosis decision, dispatch `deep-reasoner` and the Codex peer in parallel, each blind to the other's findings, per §Multi-AI / dual-perspective independence above — do not feed one side's conclusion into the other's prompt. The concrete Codex-peer mechanism is the `codex-bridge` subagent (a one-shot `codex exec` via `${CLAUDE_PLUGIN_ROOT}/skills/codex-bridge/scripts/run-codex.sh`, output quarantined in the subagent and relayed verbatim) — the plugin's **third** Codex path, distinct from the in-session MCP `codex-*` skills (structured review/implement, output in the main context) and the external `codex:` app-server plugin (persistent broker). `codex-bridge` also serves non-peer `CODEX=on` dispatch: offloading a self-contained clear-spec bulk task to gpt-5.5, per the §Implementation dispatch row. Default (codex-free) sessions never take any of this path; `deep-reasoner` alone handles the work.

**Cross-verify a premise-overturning worker discovery before reframing**: when a worker returns a finding that *overturns an existing design premise* — "the bug is not reproducible as `design.md` assumed", "the documented approach cannot work", any result that changes the plan's direction — treat it as an approach-changing decision, not a routine result. Before reframing the plan on that single finding, obtain an **independent** second opinion per §Multi-AI / dual-perspective independence below: in a default (codex-free) session, a second `deep-reasoner` pass prompted independently from the source (never fed the first conclusion); when `CODEX=on`, the `codex-bridge` peer. A single model overturning its own earlier premise is exactly the shared-blind-spot case independence guards against — orchestrator-inline self-confirmation is not a substitute.

## Multi-AI / dual-perspective independence

When a step uses a second AI or a second perspective (Codex, Gemini, or a Claude-vs-Codex/dual-view pass), each side MUST form its own conclusion from the source — never feed Claude's findings, verdict, or theory into the secondary prompt.

- Secondary prompt carries only the question + project path + stack — not Claude's analysis.
- No leading questions ("I think it's the cache, confirm"), no scope pre-filtering, no reused threads.
- Compare the two independent conclusions; flag divergences explicitly in the report.

Violation: the secondary AI confirms instead of verifying → false consensus that masks the shared blind spot. Applies to codex-architect / -brainstorm / -implement / -code-review, multi-ai-sync, feature-verify, test-review, code-investigate, issue-analyze.

## Mandatory post-steps

### Post-implementation agent gate (SSOT)

Every path except Lightweight Maintenance runs the four **Gate order** agents above (`tdd-guide → database-reviewer → security-reviewer → code-reviewer`) in order after the last Edit/Write; each must PASS before the next. This is the canonical gate — `commands/create-dev.md`, `skills/adaptive-dev-workflow/SKILL.md`, and the opsx-apply-goal flow reference it rather than restating.

Gate failure → fix → re-run that gate → continue only on PASS. Never skip. (The sentinel machinery below operationalizes gates 2–4; `tdd-guide` has no sentinel — see the AI-judgment back-stop.)

### Hook-enforced (sentinels)

Trigger map source-of-truth: dhpk's `${CLAUDE_PLUGIN_ROOT}/scripts/hooks/post-edit-dispatch.sh` (a 7-slot default: code, db, security, frontend, doc, polyfill, migration) plus any per-module post-edit hooks contributed by enabled modules. Each sentinel is cleared by the agent's Closing hook (`clear-sentinel.sh <name> <label>`).

**Closing-hook clear contract (fail-loud).** A reviewer's Closing hook clears its sentinel via `${CLAUDE_PLUGIN_ROOT}/scripts/hooks/clear-sentinel.sh <name> <label>`. `clear-sentinel.sh` never exits 0 while leaving a sentinel armed: a known name clears the file and records success; an unknown name — or an empty/unresolvable name from a stale or partial payload — exits 2 with an explicit stderr message naming the problem, rather than silently no-op'ing. When the clear exits non-zero the reviewer MUST surface that failure in its final output (a review gate remains open) — it must not report a clean "review complete." Runtime backstop: `subagent-stop-verify.sh` emits a systemMessage when a reviewer stops with its sentinel still armed.

**Orchestrator-side confirm the clear actually happened (Closing-hook back-stop).** The reviewer-side contract above and the `subagent-stop-verify.sh` runtime backstop are not a guarantee — a reviewer has been observed returning APPROVE while its `.pending-review` sentinel stayed armed (a second same-session `code-reviewer` left it armed while the first cleared it). So after a reviewer returns, the orchestrator itself runs `ls .claude/artifacts/sessions/.pending-*`; if the just-handled sentinel is still present after an APPROVE, it clears it manually with `clear-sentinel.sh <exact-basename>` — the **full** sentinel filename from `SENTINEL_NAMES` (e.g. `.pending-review`), since the script matches on the exact basename, not a keyword (`clear-sentinel.sh review` → `unknown sentinel name`). Never leave a stale sentinel to falsely block the `opsx-apply-goal` end-gate.

| Sentinel | Required agent | Trigger summary (default; project can extend via `userConfig.review_trigger_extra_paths`) |
|---|---|---|
| `.pending-review` | `code-reviewer` | `*.php` / `*.js` / `**/CLAUDE.md` |
| `.pending-doc-review` | `doc-reviewer` | `.md` files under `.claude/{agents,rules,commands,hooks,scripts,skills,manifests}/`, `openspec/`, or `docs/`; `CLAUDE.md` / `AGENTS.md` (any depth); top-level `README*.md` only — covers both frontmatter schema (name/model/tools) for `.md` DSL artifacts AND cross-file SSOT / link-validity |
| `.pending-db-review` | `database-reviewer` | Repository / migration / model / `*.sql` |
| `.pending-security-review` | `security-reviewer` | Controllers / config / `*{Auth,Login,Acl,Upload,File}*.php` |
| `.pending-frontend-review` | `frontend-reviewer` | JS / TS (vendor / ignored paths excluded) |
| `.pending-polyfill-review` *(library-author module)* | `polyfill-reviewer` | `.php` edits with a runtime version guard (`version_compare` / `class_exists` / `method_exists` / `InstalledVersions::*`) |
| `.pending-migration-review` *(opt-in trigger)* | `migration-reviewer` | Migration files (e.g. `**/migrations/**/*.php`) — projects that wire this sentinel in their post-edit hook get migration-specific review on top of the standard db-review |

Skipped paths: `.claude/artifacts/**` is exempt from ALL 7 slots via an unconditional early hook exit that runs before any slot logic (self-edits by review agents would otherwise re-trigger themselves). For doc-review specifically, a `.md` file is skipped UNLESS it is under `.claude/{agents,rules,commands,hooks,scripts,skills,manifests}/`, `openspec/`, or `docs/`, or is named `CLAUDE.md` / `AGENTS.md` (any depth), or is a top-level `README*.md` (nested READMEs excluded) — so `.claude/{memory,worktrees}/**` and any other `.md` file outside that list is skipped for doc-review. This does NOT exempt `.claude/{memory,worktrees}/**` from every slot: the hook's generic extension/keyword defaults (code-reviewer on `*.php`/`*.js`/etc., db-reviewer on `*.sql`, security-reviewer on `*Auth*`/`*Login*`/etc.) match on filename alone with no path restriction, so e.g. a `.php` file under `.claude/worktrees/` (a real git-worktree-checkout location) still routes normally. See your hook source for the exact list.

### Reviewer dispatch (when multiple sentinels coexist)

At the end of a turn that produced Edits/Writes, gather ALL pending sentinels, then **triage → dispatch in parallel → merge**:

1. **Triage first (cheap, no agent).** Look at the diff scope and DROP false-positive sentinels before dispatching — a pure-style CSS tweak, a single-string / comment-only / whitespace-reflow change does not warrant a full reviewer (e.g. a 2-line CSS change must not pull in `security-reviewer`); a typo-fix or pure-formatting `.md` change does not warrant `doc-reviewer` (it fires for substantive policy/SSOT changes, not cosmetics), and pure OpenSpec bookkeeping — ticking `tasks.md` checkboxes — is the canonical batch/drop case (make the checkbox edits together and let `doc-reviewer` run once on the substantive artifacts, not once per checkbox). Clear each dropped sentinel via its Closing hook with a one-line reason. Triage only **drops**; when in doubt, keep the reviewer.
2. **Dispatch the surviving reviewers IN PARALLEL** — one message, multiple Agent calls. Each reviewer audits only its own concern and is independent, so wall-clock is `max(reviewers)`, not the sum. Do **not** run them as a sequential chain.
3. **`code-reviewer` is the merge/dedup owner.** When it is in the dispatched set, `code-reviewer` (or the orchestrator on collecting the parallel results) merges all findings and removes cross-reviewer duplicates — this replaces the old "sequential order de-dups" mechanism. Each specialist still owns its lane (code-reviewer does not re-run OWASP / SQL / link-checks; frontend-reviewer does not re-run SQL; doc-reviewer does not audit code quality).

- Each reviewer **only handles its own sentinel**: missing sentinel → skip; present (and not triaged out) → it MUST run (back-stop excepted).
- **Batched per turn, not per edit**: a turn with N Edits runs each reviewer at most once, after the last edit — never once per Edit.
- **CRITICAL handling under parallel dispatch**: collect every parallel verdict, then if any reviewer returns CRITICAL → surface it and block the merge/commit. (Parallel means all reviewers run regardless of another's CRITICAL — independent concerns are not short-circuited.)
- `code-reviewer` and `doc-reviewer` **are not mutually exclusive**: mixed diffs (PHP + .sh + plain `.claude/` policy doc) dispatch both. Single-type diffs dispatch only the matching one.
- Pure research / planning (no Edit/Write) skips all reviewer agents.

### Review output gate

Every quality-gate reply (code / doc / test / security review, audit, risk-assess) ends with an explicit gate: a symbol (✅ pass / ⚠️ conditional / ⛔ block), a status word (Mergeable / Needs revision / Adequate / Insufficient / Inconclusive), and a one-line justification. The gate is the decision — reader sees the symbol first. Example: `✅ Mergeable — all dimensions ≥4/5, no P0 findings.` (pr-review, doc-review, test-review, security-review, project-audit, risk-assess)

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

> **Why view-layer script doesn't go through the hook**: `post-edit-dispatch.sh` uses path-pattern matching (O(1)). Detecting `<script>` blocks would require reading the full PHP file content on every Edit (grep cost asymmetric to the edit cost). Per the trigger taxonomy, view templates don't all contain `<script>`; AI looking at the diff has near-zero recognition cost, so back-stop is sufficient.
>
> **When to upgrade to hook**: once a project accumulates ≥3 missed-review cases (feature shipped to prod), or view-layer JS bug ratio significantly exceeds the JS-file leaf ratio, then add path+content grep to the hook. Until then, AI judgment.
>
> **`tdd-guide` has no sentinel.** `.pending-tdd` is never written by any hook (tdd-guide is pre-edit, not post-edit), so it is reached only via the back-stop above or an explicit pre-implementation invocation — it is **not** auto-enforced by the `opsx-apply-goal` universal `ls .pending-*` gate. For unattended `opsx-apply-goal` runs, new-code testing is enforced as an *outcome* by the **coverage gate** when the project has a coverage threshold configured (see `skills/opsx-apply-goal/references/detection.md` `HAS_COVERAGE`); where no threshold exists, tests-first must be carried by the change's tasks/plan (authored via `feature-dev`), not assumed from the sentinel gate.

## Pre-plan checklist (Feature / Bug)

1. Past-decision search (claude-mem, if installed) — see `${CLAUDE_PLUGIN_ROOT}/rules/tool-routing.md` "claude-mem at planning start"
2. Spawn Explore agents with `cx` instructions (→ `${CLAUDE_PLUGIN_ROOT}/rules/tool-routing.md`)
3. Blast-radius check (gitnexus_impact, if installed) — see `${CLAUDE_PLUGIN_ROOT}/rules/tool-routing.md` "gitnexus_impact timing"
4. Database work → verify Repository routing via the project's query builder convention

## Deterministic first, judgment second

For audit / setup / inventory / generation work, separate fact-collection from interpretation:

1. **Collect deterministically** — scripts / Grep / Glob only, no AI judgment. Establish a baseline and surface any pre-existing failure before stacking new changes on it.
2. **Gate** — present the collected facts; for destructive or multi-file outcomes, wait for user confirmation before the judgment phase.
3. **Judge** — only then apply AI evaluation, scoring, or proposals.

**Tool output is immutable**: invoke the deterministic tool, forward its stdout verbatim. Never hand-construct or post-process contract output (e.g. `deploy-list` schema=v1); if a tool fails, stop and report — do not simulate its output.

(harness-revise, skill-stocktake, project-setup, project-audit, risk-assess, deploy-list, skill-scout)

## Self-check (before reply)

Wrap-up before reply / after a large Edit / before smart-commit → load `dhpk:execution-checklist` skill for the full self-audit (Per-reply / Conditional / Task-end three-stage + trigger-condition matrix). Daily single-line edits / pure research / typos do not need this.

Any applicable NO → fix first, then reply.

## Anti-rationalization

Before skipping any sentinel / TDD / reviewer mandated step, load `${CLAUDE_PLUGIN_ROOT}/rules/anti-rationalization.md` for self-rebuttal. On-demand load, not always-on. Trigger conditions: see that file's "When to load" table (SSOT).

## Git pipeline

`feat|fix|docs|refactor/*` → `develop` → `master` (or your equivalent branching model). Standard flow: feature branch → `/codex-review-fast` → `/precommit` → `/pr-review` → PR. dhpk does **not** auto `git add/commit/push/stash` — invoke `/smart-commit` or `/precommit`.

### Squash merge hygiene (recommended)

For squash-merge PRs (collapsing multiple feature-branch commits into a single commit on the integration branch), the PR description should include an `## Unrelated Changes` section listing variations not directly tied to the PR's stated feature (file paths, line count, why mixed in, assigned reviewer). Reformats / CI yml tweaks / README typos **don't count** as unrelated; new controller actions / new services / schema changes / cron jobs / private→protected refactors / service factory extractions **do count**.

The `pr-review` skill includes an optional `check-unrelated-changes.sh` script (advisory, not blocking).

## Anti-loop & output

**Stop and escalate** when ANY holds (not just the first): same failure 3×; no
progress across two consecutive checkpoints (edits/tool-calls produce no change in
the failing signal); repeated failures with the *identical* error / stack trace;
cost or context drifting outside the budget window; a blocking merge conflict that
keeps recurring. On stop, report (1) what was tried + error, (2) ≥2 alternatives,
(3) recommended next step.

**Before any autonomous / repeated loop**, confirm the safety floor exists: a
quality gate is active (lint/test), a known-good baseline to diff against, a
rollback path (clean git state / revert), and branch or worktree isolation. Missing
any → set it up first or do the work non-autonomously.

**Review-loop ceiling (Codex auto-loop skills only)**: distinct from the general "same failure 3×" stop above — this is a hard per-sentinel counter for skills that auto-loop fix→re-review via Codex (doc-review, test-review, security-review), capped at **3 rounds per sentinel**. On round 4, stop and report the blocker for human review — do not retry the same finding.

Output: `Conclusion → Changed files → Verification → Risks/Open questions`. Blocked: `Blocker → Tried → Next viable option`.

## Testing

Run the project's standard test suite + browser verify (playwright-cli, manual, or stack-equivalent). For Docker projects: see your `${PHP_CONTAINER:-php}` workflow. Commands per stack live in the matching dhpk module reference (e.g. `modules/phpunit-5.7/references/testing.md`).

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
