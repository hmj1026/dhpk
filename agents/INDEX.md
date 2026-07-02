# Agents Index (dhpk plugin)

> 24 agents shipped by the dhpk plugin (23 root-level + `polyfill-reviewer` under `modules/library-author/agents/`). Discovered as `dhpk:<name>` after install. The full list also appears in `plugin.json`.

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

## Situational

| Agent | Model | When to invoke |
|-------|-------|----------------|
| [architect](architect.md) | opus | Cross-module design, DDD layering, tech-debt analysis |
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

> **How situational agents are reached** (none are sentinel-driven — the trigger SSOT is the AI-judgment back-stop list in `${CLAUDE_PLUGIN_ROOT}/rules/execution-policy.md`):
> - `architect` ← `adaptive-dev-workflow`
> - `refactor-cleaner` ← `/simplify` (back-stop for >800-line splits / cross-file dedup / multi-module dead-code sweep)
> - `silent-failure-hunter`, `type-design-analyzer` ← `code-reviewer` Delegate table (+ execution-policy back-stop) — so they ride the `.pending-review` flow in both `dhpk:do` and `opsx-goal`
> - `doc-updater` ← execution-policy back-stop on structural change (it runs `/update-codemaps` + `/update-docs`)
> - `docs-lookup` ← execution-policy back-stop (current library/API docs, Context7)
> - `spec-miner` ← `/spec-mine` + route-table entry (and the `opsx-goal` pre-flight note when `openspec/specs/` is empty)
> - `e2e-runner` ← `/post-dev-test` + route-table entry
> - `agent-evaluator` ← harness-quality family (`skill-judge` sibling pointer / `harness-govern` listing) — deliberately **out** of `dhpk:do` / `opsx-goal` dev routing
> - `swift-build-resolver`, `version-matrix-impact-reviewer` ← execution-policy back-stop (module-gated)
> - `python-build-resolver`, `rust-build-resolver` ← execution-policy back-stop only (build error in Bash output), same as `swift-build-resolver`. NB: the route-table `fix mypy` / `fix cargo build` patterns route to `adaptive-dev-workflow`, which does **not** itself name these agents — so there is no deterministic (route-table/sentinel) dispatch; they fire purely on the AI-judgment back-stop

## Module-shipped agents

| Agent | Ships with | When it fires |
|-------|-----------|----------------|
| [polyfill-reviewer](../modules/library-author/agents/polyfill-reviewer.md) | `library-author` module | Sentinel-driven (`.pending-polyfill-review`) after editing `.php` files with multi-major-version runtime guards (`version_compare`, `class_exists`, `PHP_VERSION_ID`, …). Only available when the `library-author` module is enabled. |

## Models

- **opus**: architect (low-frequency, high-impact, deep reasoning)
- **sonnet**: reviewers, tdd-guide, refactor, ui-ux, harness (daily-driver)
- **haiku**: doc-updater, docs-lookup (high-frequency, templated, cost-first)

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
