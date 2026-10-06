---
name: dhpk-agents-index
description: 'Reference index for the agents shipped by the dhpk plugin.'
---

# Agents Index (dhpk plugin)

> 34 agents shipped by the dhpk plugin (33 root-level + `polyfill-reviewer` under `modules/library-author/agents/`). Discovered as `dhpk:<name>` after install. The full list also appears in `.claude-plugin/plugin.json`.

## Agent contract

Each role states its scope, entitlements, completion evidence, and next-role
handoff in its own file. This index owns roster and trigger navigation; the
frontmatter and `rules/execution-policy.md` remain the SSOT for registration,
precedence, and dispatch behavior.

## Advisory reviewer dispatch (7 reviewer roles, default)

Roster and trigger navigation only. Reviewer dispatch is recommended, not
enforced; the advisory dispatch rules live in `rules/execution-policy.md`. Do not restate those tables
here.

| Agent | Model | When it fires |
|-------|-------|----------------|
| [tdd-guide](tdd-guide.md) | sonnet | Test-first unit/integration work (AI-judgment, pre-edit): owns RED and scoped runs; implements GREEN when ownership, coupling, the settled test seam, and material risk fit the role, otherwise returns a fast-worker-ready fix-spec and later accepts with the scoped command |
| [database-reviewer](database-reviewer.md) | sonnet | SQL / schema / migration / Repository edits |
| [security-reviewer](security-reviewer.md) | sonnet | Auth / authz / crypto / file-upload edits |
| [frontend-reviewer](frontend-reviewer.md) | sonnet | JS/TS edits when the `js` module is active; template-embedded `<script>` blocks (AI-judgment backfill) |
| [code-reviewer](code-reviewer.md) | sonnet | **Recommended after any source-code Edit/Write** |
| [doc-reviewer](doc-reviewer.md) | haiku | Edits under `.claude/{agents,rules,commands,skills,manifests}/`, `docs/`, `openspec/`, or top-level `CLAUDE.md` / `AGENTS.md` / `README*.md` — covers both frontmatter schema (name/model/tools) for `.md` DSL artifacts AND cross-file SSOT / link-validity checks |

Agent names are overridable via `userConfig.review_agents` — a project can point reviewer dispatch at its own `code-reviewer-<project>` and friends instead of the plugin defaults. All seven reviewer roles are available by default; reduce or replace the list through configuration.

**Opt-in triggers, not opt-in roles:** [polyfill-reviewer](../modules/library-author/agents/polyfill-reviewer.md) (module-shipped, below) and [migration-reviewer](migration-reviewer.md) are available roles whose recommendation depends on a separately configured trigger (polyfill: `library-author` module trigger; migration: a project's `module.yaml` `migration:` trigger or `review_trigger_extra_paths` `mig:`). See [migration-reviewer](migration-reviewer.md) and the Module-shipped agents section below for detail.

**Documentation role (always-on):** `doc-reviewer` covers both frontmatter schema validation and cross-file SSOT / link-validity checks in one review; no separate artifact slot is needed.

## Implementation workers

Not a post-edit hook. Implement-phase routing is owned by
`rules/execution-policy.md` §Implementation dispatch (SSOT). This table is
roster navigation for the shipped worker/reasoner roles.

| Agent | Model (default) | Role |
|-------|-------|----------------|
| [deep-reasoner](deep-reasoner.md) | opus | Read-only reasoning worker — root-cause analysis, algorithm design, complex debugging, design synthesis. Returns a conclusion contract (conclusion + `file:line` evidence + next actions); defers DDD/cross-module design to `architect` |
| [codex-reasoner](codex-reasoner.md) | sonnet + codex CLI | **codex CLI available** — canonical `deep-reasoner` backend selected by `--reasoner=codex-cli/<model>[:<effort>]` (default `gpt-6.1-sol` @ `high`), with a read-only sandbox, dispatcher-attested runtime/deadline, and the same conclusion contract; the retired `CODEX=on`/`--codex` review-peer switch cannot select it |
| [codex-deep-reasoner](codex-deep-reasoner.md) | sonnet + codex CLI | **codex CLI available** — selector-resolved `deep-reasoner` backend via `--reasoner=codex-cli/<model>[:<effort>]` (default `gpt-6.1-sol` @ `high`, read-only sandbox via `skills/dhpk-codex-bridge/scripts/run-codex.sh`); dispatcher-attested model, runtime and deadline; same read-only conclusion contract, never modifies the working tree; the retired `CODEX=on`/`--codex` review-peer switch cannot select it |
| [fast-worker](fast-worker.md) | sonnet | Write-capable mechanical implementer — executes a precise task spec (files + change intent + verification command), surgical edits only, reports pass/fail + edited-file list, escalates on ambiguous specs |
| [codex-worker](codex-worker.md) | sonnet + codex CLI | **codex CLI available** — canonical `fast-worker` backend (default `gpt-6-luna` @ `xhigh`), with dispatcher-attested runtime/deadline and the same task-spec, verification, and edited-file accounting contract |
| [codex-fast-worker](codex-fast-worker.md) | sonnet + codex CLI | **codex CLI available** — selector-resolved `fast-worker` backend (default `gpt-6-luna` @ `xhigh`, via `skills/dhpk-codex-bridge/scripts/run-codex.sh`); dispatcher-attested model, runtime and deadline; the retired `CODEX=on`/`--codex` review-peer switch cannot select it, with the same task-spec and verification/edited-file accounting contract |
| [agy-worker](agy-worker.md) | sonnet + agy CLI | **agy CLI available** — canonical mechanical worker on the agy backend (default `Gemini 3.8 Flash (High)`), with dispatcher-attested runtime/deadline and the same task-spec, verification, and edited-file accounting contract |
| [agy-fast-worker](agy-fast-worker.md) | sonnet + agy CLI | **agy CLI available** — a `fast-worker` whose edits run on the agy CLI backend (default `Gemini 3.8 Flash (High)`, via `skills/dhpk-agy-fast-worker/scripts/run-agy.sh`); dispatcher-attested model, runtime and deadline, with the same task-spec contract + independent verification/edited-file accounting |
| [codex-reviewer](codex-reviewer.md) | sonnet + codex CLI | Internal shared-runner read-only reviewer; capability-gated and not a native Codex dispatch target; routes through the canonical launcher only when the capability is available |
| [codex-bridge](codex-bridge.md) | sonnet | **Explicit `codex-bridge` route only** — thin bridge that outsources a self-contained clear-spec task, or a blind second opinion, to the GPT-6 family via the Codex CLI (`codex exec`); read-only resolves to `gpt-6.1-sol`/`high`, workspace-write to `gpt-6-luna`/`xhigh`; uses an immutable dispatcher-attested transport context while retaining the three-argument wrapper shape, and relays Codex's output **verbatim** (output isolated in the subagent) |

Role models are configurable per project via `userConfig.deep_reasoner_model` / `userConfig.fast_worker_model` (see "Configured role models" under `rules/execution-policy.md` §Agent dispatch) — frontmatter above shows the shipped default, not necessarily the effective value.

Selector, alias forwarding, and retired `CODEX=on`/`--codex` flags: see
`rules/execution-policy.md` §Implementation dispatch and §Agent dispatch.
This index only lists the shipped roles above.

**Component-addition-gate justification** (why neither existing agent covers this need, per the "Component-addition gate" rule in `rules/execution-policy.md`):
- `general-purpose` cannot cover it: no dhpk policy context, inherits the main-session model (cost misallocation when the orchestrator is a top-tier model and the task is mechanical), no defined input/output contract for gate enforcement.
- `architect` cannot cover it: design-domain-scoped (DDD layering, cross-module ADRs) with a design-review posture — stretching it to general debugging/mechanical-implementation work would blur its trigger conditions and INDEX contract. `deep-reasoner` explicitly defers to `architect` for that domain rather than competing with it.
- `codex-bridge` cannot be covered by the workers or the other two Codex paths: `deep-reasoner` / `fast-worker` are Claude-model workers (no independent-model perspective); the retired in-session MCP `codex-*` skills are historical-only and no longer a dispatch path; the external `codex:` plugin wraps a persistent app-server broker. `codex-bridge` is the plugin's **third** Codex path and the only one that is a one-shot `codex exec` CLI call whose large output is quarantined in a dedicated subagent and relayed verbatim — needed for cheap bulk outsourcing and a blind second opinion without context bleed. It is opt-in through an explicit `codex-bridge` or `--second-opinion=codex-exec` route; codex-free sessions never dispatch it.
- `smoke-tester` is not covered by any existing agent: `e2e-runner` writes Playwright spec files and is web-scoped (write-capable), and `feature-verify` is a main-context skill (heavyweight P0-P5, not a dispatchable isolated agent) — neither overlaps a read-only, scenario-driven, single-concrete-scenario live probe, so `smoke-tester` is a genuinely new capability.

## Situational

| Agent | Model | When to invoke |
|-------|-------|----------------|
| [architect](architect.md) | fable | Cross-module design, DDD layering, tech-debt analysis (Fable 5.1 is the highest per-token Claude tier; up-only escalation for HIGH-risk designs) |
| [planner](planner.md) | opus | Plan consultant, opt-in via `$flow-drive --plan`. Consult scope is `auto\|bounded\|discovery`, distinct from critique / blind-sketch / dual-plan / review work modes; bounded permits ≤4 named-source reads and 0 children, discovery ≤12 reads and ≤2 read-only children, and warm review ≤4 new reads. Pre-implementation verdicts remain `ENDORSE\|AMEND\|REPLACE`; review verdicts remain `SHIP\|FIX-THEN-SHIP\|RECONSULT`; actual reads, children, and blockers fit the existing 400-token VERDICT-first + `END` protocol. Neither `architect` (DDD/cross-module design) nor `deep-reasoner` (implement-phase conclusion contract) carries this verdict/critique contract or dual-role warm review. |
| [refactor-cleaner](refactor-cleaner.md) | sonnet | Dead-code removal, dedup, splitting large files |
| [ui-ux-verifier](ui-ux-verifier.md) | sonnet | UI vs spec audit, screenshot diffs |
| [performance-analyzer](performance-analyzer.md) | sonnet | N+1 queries, EXPLAIN, index/perf audits |
| [doc-updater](doc-updater.md) | haiku | Doc / codemap updates |
| [docs-lookup](docs-lookup.md) | haiku | Library / framework / API doc lookup (Context7) |
| [harness-reviser](harness-reviser.md) | sonnet | Scoped harness configuration review and fixes; retired governance scoring and scenario coverage are unavailable |
| [migration-reviewer](migration-reviewer.md) | sonnet | DB migration up/down symmetry, multi-tenant FK/index collision, online-DDL safety on high-volume tables |
| [version-matrix-impact-reviewer](version-matrix-impact-reviewer.md) | sonnet | Per-change blast radius across a CI version matrix (PHP × Laravel/Symfony, Yii 1×2); recommends the minimum testsuite subset |
| [swift-build-resolver](swift-build-resolver.md) | sonnet | Swift / Xcode / SwiftPM build-error resolution (compile, Sendable/actor isolation, Codable, package-version conflicts, signing) |
| [python-build-resolver](python-build-resolver.md) | sonnet | Python build-error resolution (ruff / mypy / pyright / pytest incl. pytest-asyncio scope, uv / pip / poetry install) — 3-attempt-then-escalate, re-runs to verify |
| [rust-build-resolver](rust-build-resolver.md) | sonnet | Rust / Cargo build-error resolution (rustc type / borrow / lifetime, Send / Sync, tokio, Cargo.toml conflicts) — 3-attempt-then-escalate, re-runs to verify |
| [silent-failure-hunter](silent-failure-hunter.md) | sonnet | Deep error-handling audit — empty catch / swallowed exceptions / error-hiding fallbacks / lost stack traces / missing rollback. Situational delegate of code-reviewer (not an unconditional post-edit role) |
| [type-design-analyzer](type-design-analyzer.md) | sonnet | Score a type's design on encapsulation / invariant expression / usefulness / enforcement ("make illegal states unrepresentable"). Read-only |
| [e2e-runner](e2e-runner.md) | sonnet | Author / run / stabilize Playwright journeys, helpers, fixtures, and artifacts. Application-code failures return a fast-worker-ready fix-spec; after the fix, this agent re-runs the originating journey as acceptance. Distinct from ui-ux-verifier (page-vs-spec audit) |
| [smoke-tester](smoke-tester.md) | sonnet | Read-only live-runtime probe: drives the real running system with one orchestrator-supplied concrete scenario and asserts on observed values (`Verdict:`-first-line contract). Distinct from e2e-runner (authors/runs Playwright specs, write-capable, web-scoped) and the feature-verify skill (main-context P0-P5, not a dispatchable isolated agent) |

> **How situational agents are reached** (none are unconditional post-edit roles). Trigger
> ownership is the AI-judgment back-stop list in
> `${CLAUDE_PLUGIN_ROOT}/rules/execution-policy.md`. This list is navigation
> only:
> - `architect` ← `flow-guide` classification / architecture handoff
> - `refactor-cleaner` ← `/simplify` (back-stop for >800-line splits / cross-file dedup / multi-module dead-code sweep)
> - `silent-failure-hunter`, `type-design-analyzer` ← `code-reviewer` Delegate table (+ execution-policy back-stop) — so they ride the code review in `change-verdict` and confirmed implementation workflows
> - `doc-updater` ← execution-policy back-stop on structural change (it runs `/update-codemaps` + `/update-docs`)
> - `docs-lookup` ← execution-policy back-stop (current library/API docs, Context7)
> - `tdd-guide` / `tdd-workflow` ← unit/integration post-development routes; the TDD capability is `UNAVAILABLE` when its configured test stack or dispatch backend is absent, and must not be silently remapped.
> - `e2e-runner` ← Playwright route-table entry (`agent:e2e-runner`); report `UNAVAILABLE` when the Playwright agent capability is absent rather than falling back to the retired post-development skill.
> - `smoke-tester` ← `rules/execution-policy.md` §Implementation dispatch table
> - `swift-build-resolver`, `version-matrix-impact-reviewer` ← execution-policy back-stop (module-gated)
> - `python-build-resolver`, `rust-build-resolver` ← execution-policy back-stop only (build error in Bash output), same as `swift-build-resolver`. NB: the route-table `fix mypy` / `fix cargo build` patterns route to `flow-guide`, which does **not** itself name these agents — so there is no deterministic route-table dispatch; they fire purely on the AI-judgment back-stop

## Module-shipped agents

| Agent | Ships with | When it fires |
|-------|-----------|----------------|
| [polyfill-reviewer](../modules/library-author/agents/polyfill-reviewer.md) | `library-author` module | Recommended after editing `.php` files with multi-major-version runtime guards (`version_compare`, `class_exists`, `PHP_VERSION_ID`, …). Only available when the `library-author` module is enabled. |

## Models

- **opus**: deep-reasoner, planner (low-frequency, high-impact, deep reasoning)
- **sonnet**: reviewers, tdd-guide, refactor, ui-ux, harness, fast-worker, codex-worker, agy-worker, codex-fast-worker, agy-fast-worker, codex-reasoner, codex-deep-reasoner, codex-reviewer, codex-bridge (daily-driver; the CLI-backed workers run their work on an external codex/agy backend — `codex-reasoner` reasons read-only on codex)
- **haiku**: doc-updater, docs-lookup, doc-reviewer (high-frequency, templated, cost-first)
- **fable**: architect (Fable 5.1 is the highest per-token Claude tier; up-only escalation to a higher tier for HIGH-risk designs via the configured-role override)

## Partial outputs and agent continuation

Canonical agent definitions omit `maxTurns`; Claude Code treats the field as
optional and sets no default cap. In-body stop conditions and scoped work
budgets remain the runaway protections. For a partial result from a resumable
Claude agent with an addressable agent ID, continue it once with `SendMessage`
before re-dispatching. Claude Code exposes partial markers from v2.1.246.
Built-in Explore and Plan are one-shot and have no agent ID, so they cannot be
resumed. Preserve safety or blocker stops and explicit cancellation. The
durable continuation rule lives in
[`rules/execution-policy.md`](../rules/execution-policy.md). See the [Claude
Code subagents guide](https://code.claude.com/docs/en/sub-agents) for host
capabilities.

## Language-module context

Generic agents (code-reviewer, security-reviewer, database-reviewer, architect, tdd-guide, refactor-cleaner, performance-analyzer, migration-reviewer, silent-failure-hunter) ship a **stack-neutral** description + a language-agnostic baseline, then **load only the matching stack's trap sheet on demand** from `agent-traps/<agent>/<stack>.md`. Shared detection order lives in `agent-traps/_common/trap-sheet-loader.md` (`$DHPK_ACTIVE_MODULES`, then project-root manifests). Agent-specific extras and remaps stay in that agent's trap-sheet section. Enabling a `dhpk` module additionally surfaces that module's deeper skills/references under `modules/<name>/`. See README's "Module enablement" walkthrough.
