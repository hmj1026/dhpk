---
name: agents-index
description: 'Navigation index for dhpk plugin agents. Internal documentation; not a model-invocable agent.'
---

# Agents Index (dhpk plugin)

> 12 agents shipped by the dhpk plugin. Discovered as `dhpk:<name>` after install.

## Sentinel-driven review chain

Order: `tdd-guide → database-reviewer → security-reviewer → code-reviewer` (only triggered items run; code-reviewer always last). Triggered automatically by `post-edit-remind` hook; reminded at Stop by `stop-review-reminder` hook.

| Agent | Model | When it fires |
|-------|-------|----------------|
| [tdd-guide](tdd-guide.md) | sonnet | New feature, bug fix, test changes (AI-judgment, pre-edit) |
| [database-reviewer](database-reviewer.md) | sonnet | SQL / schema / migration / Repository edits |
| [security-reviewer](security-reviewer.md) | sonnet | Auth / authz / crypto / file-upload edits |
| [code-reviewer](code-reviewer.md) | sonnet | **Mandatory after any source-code Edit/Write** |

Agent names are overridable via `userConfig.review_agents` — a project can point sentinels at its own `code-reviewer-<project>` and friends instead of the plugin defaults.

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

## Models

- **opus**: architect (low-frequency, high-impact, deep reasoning)
- **sonnet**: reviewers, tdd-guide, refactor, ui-ux, harness (daily-driver)
- **haiku**: doc-updater, docs-lookup (high-frequency, templated, cost-first)

## Language-module context

Agents in this plugin ship generic role descriptions. When a `dhpk` module is enabled (e.g. `php-5.6`, `yii-1.1`), the matching module's skills under `modules/<name>/skills/` supply stack-specific guidance the agents will consult when relevant. See README's "Module enablement" walkthrough.
