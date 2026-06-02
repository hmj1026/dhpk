---
name: agents-index
description: 'Navigation index for dhpk plugin agents. Internal documentation; not a model-invocable agent.'
---

# Agents Index (dhpk plugin)

> 19 agents shipped by the dhpk plugin (18 root-level + `polyfill-reviewer` under `modules/library-author/agents/`). Discovered as `dhpk:<name>` after install. The full list also appears in `plugin.json`.

## Sentinel-driven review chain (5 slots, v0.2.0+)

Order: `tdd-guide → database-reviewer → security-reviewer → frontend-reviewer → code-reviewer → doc-reviewer` (only triggered items run; code-reviewer and doc-reviewer are not mutually exclusive — mixed diffs run both). Triggered automatically by `post-edit-dispatch` → `post-edit-remind` hook; reminded at Stop by `stop-review-reminder` hook.

| Agent | Model | When it fires |
|-------|-------|----------------|
| [tdd-guide](tdd-guide.md) | sonnet | New feature, bug fix, test changes (AI-judgment, pre-edit) |
| [database-reviewer](database-reviewer.md) | sonnet | SQL / schema / migration / Repository edits |
| [security-reviewer](security-reviewer.md) | sonnet | Auth / authz / crypto / file-upload edits |
| [frontend-reviewer](frontend-reviewer.md) | sonnet | JS/TS edits when the `js` module is active; template-embedded `<script>` blocks (AI-judgment backfill) |
| [code-reviewer](code-reviewer.md) | sonnet | **Mandatory after any source-code Edit/Write** |
| [doc-reviewer](doc-reviewer.md) | haiku | Edits under `.claude/{agents,rules,commands,skills,manifests}/`, `docs/`, `openspec/`, or top-level `CLAUDE.md` / `AGENTS.md` / `README*.md` |

Agent names are overridable via `userConfig.review_agents` — a project can point sentinels at its own `code-reviewer-<project>` and friends instead of the plugin defaults. The default list ships 5 agents (code / db / sec / fe / doc); reduce by passing a shorter override.

**6th sentinel slot (project-extension):** [migration-reviewer](migration-reviewer.md) is a sentinel-eligible reviewer that the default 5-slot chain does not wire. Projects with DB migrations (e.g. a multi-tenant deploy that uses site-id-prefixed migration files) add it as a 6th slot via `userConfig.review_agents` + their own `.pending-migration-review` sentinel.

## Situational

| Agent | Model | When to invoke |
|-------|-------|----------------|
| [architect](architect.md) | opus | Cross-module design, DDD layering, tech-debt analysis |
| [refactor-cleaner](refactor-cleaner.md) | sonnet | Dead-code removal, dedup, splitting large files |
| [ui-ux-verifier](ui-ux-verifier.md) | sonnet | UI vs spec audit, screenshot diffs |
| [performance-analyzer](performance-analyzer.md) | sonnet | N+1 queries, EXPLAIN, index/perf audits |
| [doc-updater](doc-updater.md) | haiku | Doc / codemap updates |
| [docs-lookup](docs-lookup.md) | haiku | Library / framework / API doc lookup (Context7) |
| [harness-reviser](harness-reviser.md) | sonnet | Deterministic harness trim/dedupe/validate |
| [harness-optimizer](harness-optimizer.md) | sonnet | Harness reliability / cost / throughput scorecard |
| [migration-reviewer](migration-reviewer.md) | sonnet | DB migration up/down symmetry, multi-tenant FK/index collision, online-DDL safety on high-volume tables |
| [version-matrix-impact-reviewer](version-matrix-impact-reviewer.md) | sonnet | Per-change blast radius across a CI version matrix (PHP × Laravel/Symfony, Yii 1×2); recommends the minimum testsuite subset |
| [swift-build-resolver](swift-build-resolver.md) | sonnet | Swift / Xcode / SwiftPM build-error resolution (compile, Sendable/actor isolation, Codable, package-version conflicts, signing) |
| [silent-failure-hunter](silent-failure-hunter.md) | sonnet | Deep error-handling audit — empty catch / swallowed exceptions / error-hiding fallbacks / lost stack traces / missing rollback. Situational delegate of code-reviewer (not a sentinel) |

## Module-shipped agents

| Agent | Ships with | When it fires |
|-------|-----------|----------------|
| [polyfill-reviewer](../modules/library-author/agents/polyfill-reviewer.md) | `library-author` module | Sentinel-driven (`.pending-polyfill-review`) after editing `.php` files with multi-major-version runtime guards (`version_compare`, `class_exists`, `PHP_VERSION_ID`, …). Only available when the `library-author` module is enabled. |

## Models

- **opus**: architect (low-frequency, high-impact, deep reasoning)
- **sonnet**: reviewers, tdd-guide, refactor, ui-ux, harness (daily-driver)
- **haiku**: doc-updater, docs-lookup (high-frequency, templated, cost-first)

## Language-module context

Agents in this plugin ship generic role descriptions. When a `dhpk` module is enabled (e.g. `php-5.6`, `yii-1.1`), the matching module's skills under `modules/<name>/skills/` supply stack-specific guidance the agents will consult when relevant. See README's "Module enablement" walkthrough.
