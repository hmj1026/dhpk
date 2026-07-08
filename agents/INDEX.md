# Agents Index (dhpk plugin)

> 29 agents shipped by the dhpk plugin (28 root-level + `polyfill-reviewer` under `modules/library-author/agents/`). Discovered as `dhpk:<name>` after install. The full list also appears in `plugin.json`.

## Sentinel-driven reviewer dispatch (7-slot default, v0.10.0+)

Triggered reviewers — `database-reviewer` / `security-reviewer` / `frontend-reviewer` / `code-reviewer` / `doc-reviewer` / `polyfill-reviewer` / `migration-reviewer` — **dispatch in parallel** (one message, multiple Agent calls); `code-reviewer` merges/dedups (only triggered items run; code-reviewer and doc-reviewer are not mutually exclusive — mixed diffs run both). `tdd-guide` is pre-edit, not part of the post-edit dispatch. Triggered automatically by `post-edit-dispatch` → `post-edit-remind` hook; reminded at Stop by `stop-review-reminder` hook.

| Agent | Model | When it fires |
|-------|-------|----------------|
| [tdd-guide](tdd-guide.md) | sonnet | New feature, bug fix, test changes (AI-judgment, pre-edit) |
| [database-reviewer](database-reviewer.md) | sonnet | SQL / schema / migration / Repository edits |
| [security-reviewer](security-reviewer.md) | sonnet | Auth / authz / crypto / file-upload edits |
| [frontend-reviewer](frontend-reviewer.md) | sonnet | JS/TS edits when the `js` module is active; template-embedded `<script>` blocks (AI-judgment backfill) |
| [code-reviewer](code-reviewer.md) | sonnet | **Mandatory after any source-code Edit/Write** |
| [doc-reviewer](doc-reviewer.md) | haiku | Edits under `.claude/{agents,rules,commands,skills,manifests}/`, `docs/`, `openspec/`, or top-level `CLAUDE.md` / `AGENTS.md` / `README*.md` — covers both frontmatter schema (name/model/tools) for `.md` DSL artifacts AND cross-file SSOT / link-validity checks |

Agent names are overridable via `userConfig.review_agents` — a project can point sentinels at its own `code-reviewer-<project>` and friends instead of the plugin defaults. All 7 slots are wired into the default `review_agents` array (`scripts/hooks/_lib/payload.sh`, shipped v0.10.0); reduce by passing a shorter override.

**Opt-in triggers, not opt-in slots:** [polyfill-reviewer](../modules/library-author/agents/polyfill-reviewer.md) (module-shipped, below) and [migration-reviewer](migration-reviewer.md) are both default `review_agents` slots, but — like `frontend-reviewer` — their sentinel only fires when a trigger is separately wired (polyfill: `library-author` module hook; migration: a project's `module.yaml` `migration:` triggers or `review_trigger_extra_paths` `mig:`). See [migration-reviewer](migration-reviewer.md) and the Module-shipped agents section below for detail.

**Doc slot (always-on):** `doc-reviewer` covers both frontmatter schema validation and cross-file SSOT / link-validity checks via a single `.pending-doc-review` sentinel — no separate artifact slot needed.

## Implementation workers

Not sentinel-driven — dispatched during the implement phase per the `rules/execution-policy.md` §Implementation dispatch decision table (SSOT; not restated here), while `userConfig.orchestration_dispatch=on` (default). Their edits still flow through the normal post-edit hook / sentinel machinery and remain subject to the full post-implementation review gate above.

| Agent | Model (default) | Role |
|-------|-------|----------------|
| [deep-reasoner](deep-reasoner.md) | opus | Read-only reasoning worker — root-cause analysis, algorithm design, complex debugging, design synthesis. Returns a conclusion contract (conclusion + `file:line` evidence + next actions); defers DDD/cross-module design to `architect` |
| [fast-worker](fast-worker.md) | sonnet | Write-capable mechanical implementer — executes a precise task spec (files + change intent + verification command), surgical edits only, reports pass/fail + edited-file list, escalates on ambiguous specs |
| [codex-bridge](codex-bridge.md) | sonnet | **CODEX=on only** — thin bridge that outsources a self-contained clear-spec task, or a blind second opinion, to gpt-5.5 via the Codex CLI (`codex exec`); composes a self-contained prompt, runs `skills/codex-bridge/scripts/run-codex.sh`, and relays Codex's output **verbatim** (output isolated in the subagent) |

Role models are configurable per project via `userConfig.deep_reasoner_model` / `userConfig.fast_worker_model` (see "Configured role models" under `rules/execution-policy.md` §Agent dispatch) — frontmatter above shows the shipped default, not necessarily the effective value.

**Component-addition-gate justification** (why neither existing agent covers this need, per the "Component-addition gate" rule in `rules/execution-policy.md`):
- `general-purpose` cannot cover it: no dhpk policy context, inherits the main-session model (cost misallocation when the orchestrator is a top-tier model and the task is mechanical), no defined input/output contract for gate enforcement.
- `architect` cannot cover it: design-domain-scoped (DDD layering, cross-module ADRs) with a design-review posture — stretching it to general debugging/mechanical-implementation work would blur its trigger conditions and INDEX contract. `deep-reasoner` explicitly defers to `architect` for that domain rather than competing with it.
- `codex-bridge` cannot be covered by the workers or the other two Codex paths: `deep-reasoner` / `fast-worker` are Claude-model workers (no independent-model perspective); the in-session MCP `codex-*` skills run via `mcp__codex__*` with output landing in the main context; the external `codex:` plugin wraps a persistent app-server broker. `codex-bridge` is the plugin's **third** Codex path and the only one that is a one-shot `codex exec` CLI call whose large output is quarantined in a dedicated subagent and relayed verbatim — needed for cheap bulk outsourcing and a blind second opinion without context bleed. Opt-in (`CODEX=on`); codex-free sessions never dispatch it.
- `smoke-tester` is not covered by any existing agent: `e2e-runner` writes Playwright spec files and is web-scoped (write-capable), and `feature-verify` is a main-context skill (heavyweight P0-P5, not a dispatchable isolated agent) — neither overlaps a read-only, scenario-driven, single-concrete-scenario live probe, so `smoke-tester` is a genuinely new capability.

## Situational

| Agent | Model | When to invoke |
|-------|-------|----------------|
| [architect](architect.md) | opus | Cross-module design, DDD layering, tech-debt analysis |
| [planner](planner.md) | opus | Plan consultant, opt-in via `/dhpk:do --plan`. Pre-implementation critique / blind-sketch / dual-plan (VERDICT: ENDORSE\|AMEND\|REPLACE) + post-implementation warm diff review (VERDICT: SHIP\|FIX-THEN-SHIP\|RECONSULT); coded findings by exception, VERDICT-first + `END`-trailing reply contract, bounded discovery (spawns `Explore` ≤2, ≤12 own reads). New capability: neither `architect` (DDD/cross-module design) nor `deep-reasoner` (implement-phase conclusion contract) carries a verdict/critique contract or a dual-role warm review. |
| [refactor-cleaner](refactor-cleaner.md) | sonnet | Dead-code removal, dedup, splitting large files |
| [ui-ux-verifier](ui-ux-verifier.md) | sonnet | UI vs spec audit, screenshot diffs |
| [performance-analyzer](performance-analyzer.md) | sonnet | N+1 queries, EXPLAIN, index/perf audits |
| [doc-updater](doc-updater.md) | haiku | Doc / codemap updates |
| [docs-lookup](docs-lookup.md) | haiku | Library / framework / API doc lookup (Context7) |
| [harness-reviser](harness-reviser.md) | sonnet | Deterministic harness trim/dedupe/validate (G1–G13). Broader reliability/cost/throughput scoring now lives in `/harness-govern`'s conform step |
| [migration-reviewer](migration-reviewer.md) | sonnet | DB migration up/down symmetry, multi-tenant FK/index collision, online-DDL safety on high-volume tables |
| [version-matrix-impact-reviewer](version-matrix-impact-reviewer.md) | sonnet | Per-change blast radius across a CI version matrix (PHP × Laravel/Symfony, Yii 1×2); recommends the minimum testsuite subset |
| [swift-build-resolver](swift-build-resolver.md) | sonnet | Swift / Xcode / SwiftPM build-error resolution (compile, Sendable/actor isolation, Codable, package-version conflicts, signing) |
| [python-build-resolver](python-build-resolver.md) | sonnet | Python build-error resolution (ruff / mypy / pyright / pytest incl. pytest-asyncio scope, uv / pip / poetry install) — 3-attempt-then-escalate, re-runs to verify |
| [rust-build-resolver](rust-build-resolver.md) | sonnet | Rust / Cargo build-error resolution (rustc type / borrow / lifetime, Send / Sync, tokio, Cargo.toml conflicts) — 3-attempt-then-escalate, re-runs to verify |
| [silent-failure-hunter](silent-failure-hunter.md) | sonnet | Deep error-handling audit — empty catch / swallowed exceptions / error-hiding fallbacks / lost stack traces / missing rollback. Situational delegate of code-reviewer (not a sentinel) |
| [spec-miner](spec-miner.md) | opus | Extract behavioral specs from a brownfield codebase into `openspec/specs/<capability>/spec.md` (flat Requirement / Invariant blocks). Onboarding to spec-driven development |
| [type-design-analyzer](type-design-analyzer.md) | sonnet | Score a type's design on encapsulation / invariant expression / usefulness / enforcement ("make illegal states unrepresentable"). Read-only |
| [agent-evaluator](agent-evaluator.md) | sonnet | 5-axis output-quality scorecard (accuracy / completeness / clarity / actionability / conciseness) with grep-verified evidence. Scores run output, not the code |
| [e2e-runner](e2e-runner.md) | sonnet | Author / run / stabilize E2E user-journey tests (Playwright + `playwright-cli` skill), quarantine flaky tests, manage artifacts. Distinct from ui-ux-verifier (page-vs-spec audit) |
| [smoke-tester](smoke-tester.md) | sonnet | Read-only live-runtime probe: drives the real running system with one orchestrator-supplied concrete scenario and asserts on observed values (`Verdict:`-first-line contract). Distinct from e2e-runner (authors/runs Playwright specs, write-capable, web-scoped) and the feature-verify skill (main-context P0-P5, not a dispatchable isolated agent) |

> **How situational agents are reached** (none are sentinel-driven — the trigger SSOT is the AI-judgment back-stop list in `${CLAUDE_PLUGIN_ROOT}/rules/execution-policy.md`):
> - `architect` ← `adaptive-dev-workflow`
> - `refactor-cleaner` ← `/simplify` (back-stop for >800-line splits / cross-file dedup / multi-module dead-code sweep)
> - `silent-failure-hunter`, `type-design-analyzer` ← `code-reviewer` Delegate table (+ execution-policy back-stop) — so they ride the `.pending-review` flow in both `dhpk:do` and `opsx-apply-goal`
> - `doc-updater` ← execution-policy back-stop on structural change (it runs `/update-codemaps` + `/update-docs`)
> - `docs-lookup` ← execution-policy back-stop (current library/API docs, Context7)
> - `spec-miner` ← `/spec-mine` + route-table entry (and the `opsx-apply-goal` pre-flight note when `openspec/specs/` is empty)
> - `e2e-runner` ← `/post-dev-test` + route-table entry
> - `smoke-tester` ← `opsx-apply-goal` Part 3 conditional gate (HAS_SMOKE) + `rules/execution-policy.md` §Implementation dispatch table
> - `agent-evaluator` ← harness-quality family (`skill-judge` sibling pointer / `harness-govern` listing) — deliberately **out** of `dhpk:do` / `opsx-apply-goal` dev routing
> - `swift-build-resolver`, `version-matrix-impact-reviewer` ← execution-policy back-stop (module-gated)
> - `python-build-resolver`, `rust-build-resolver` ← execution-policy back-stop only (build error in Bash output), same as `swift-build-resolver`. NB: the route-table `fix mypy` / `fix cargo build` patterns route to `adaptive-dev-workflow`, which does **not** itself name these agents — so there is no deterministic (route-table/sentinel) dispatch; they fire purely on the AI-judgment back-stop

## Module-shipped agents

| Agent | Ships with | When it fires |
|-------|-----------|----------------|
| [polyfill-reviewer](../modules/library-author/agents/polyfill-reviewer.md) | `library-author` module | Sentinel-driven (`.pending-polyfill-review`) after editing `.php` files with multi-major-version runtime guards (`version_compare`, `class_exists`, `PHP_VERSION_ID`, …). Only available when the `library-author` module is enabled. |

## Models

- **opus**: architect, spec-miner, deep-reasoner (low-frequency, high-impact, deep reasoning)
- **sonnet**: reviewers, tdd-guide, refactor, ui-ux, harness, fast-worker, codex-bridge (daily-driver)
- **haiku**: doc-updater, docs-lookup, doc-reviewer (high-frequency, templated, cost-first)

## maxTurns (safety-net caps)

Not every agent needs a cap — `maxTurns` in frontmatter is a **safety net**
against a stuck reasoning loop (repeated failed cx/gitnexus retries, an
oversized diff), not a target step count; a well-behaved run finishes well
under the cap. Review-family agents (Bash + multi-file Read + cx/gitnexus
reference tracing + artifact write) get a generous cap sized to their actual
scope; narrower / read-only agents get a tighter one. Rationale lives here,
not as inline frontmatter comments — no agent in this repo uses `#` comments
inside frontmatter (untested by the schema parser); keep frontmatter
comment-free.

| Agent | maxTurns | Rationale |
|---|---|---|
| `docs-lookup` | 8 | Self-capped at 3 resolve+query pairs (see agent body) |
| `polyfill-reviewer` | 12 | Bounded input set (sentinel + composer.json + workflow YAML + phpunit.xml + per-file git log) — no cx/multi-file traversal |
| `type-design-analyzer` | 12 | Read-only, no Bash/gitnexus — single/few-type scoring against a fixed rubric |
| `doc-updater` | 15 | Bounded to `/update-codemaps` + `/update-docs` runs, pre-existing cap |
| `database-reviewer` | 20 | Trap-sheet load + `cx references` tracing across Repository/migration files |
| `performance-analyzer` | 20 | Same shape as `database-reviewer` + optional EXPLAIN sampling |
| `silent-failure-hunter` | 20 | Pattern-hunt across the diff's full blast radius, pre-existing cap |
| `doc-reviewer` | 15 | Bounded doc-only scope, pinned by `.pending-doc-review` sentinel list |
| `frontend-reviewer` | 15 | Bounded frontend-tier scope, pinned by `.pending-frontend-review` sentinel list |
| `migration-reviewer` | 15 | Migration files only, typically a handful per PR |
| `version-matrix-impact-reviewer` | 15 | Single detect-once pass + one risk table, no per-file loop |
| `code-reviewer` | 25 | Broadest scope — any file/language + delegate table + `cx references` tracing |
| `harness-reviser` | 25 | Iterative apply-fix → re-run-script loop multiplies turns per G1–G13 gap |
| `security-reviewer` | 30 | `effort: high`, deepest audit + Emergency Response flow — largest safety net |

Agents not listed above keep the frontmatter default (no cap) unless a future
incident shows a runaway-loop pattern — do not add caps speculatively.

## Language-module context

Generic agents (code-reviewer, security-reviewer, database-reviewer, architect, tdd-guide, refactor-cleaner, performance-analyzer, migration-reviewer, silent-failure-hunter) ship a **stack-neutral** description + a language-agnostic baseline, then **load only the matching stack's trap sheet on demand** at runtime from `agent-traps/<agent>/<stack>.md` — the stack is detected from project manifests (`composer.json` / `package.json` / `Package.swift` / `pyproject.toml`) or `$DHPK_ACTIVE_MODULES`, so an iOS project never loads PHP/Yii rules and vice-versa. Enabling a `dhpk` module additionally surfaces that module's deeper skills/references under `modules/<name>/`. See README's "Module enablement" walkthrough.
