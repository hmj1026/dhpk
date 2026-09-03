---
description: 'Navigation index for dhpk plugin skills. Internal documentation; not an invocable skill.'
---

# Skills Index (dhpk plugin)

> Navigation for the 85 canonical skill packages shipped by the dhpk plugin. Every
> package lives flat under `skills/<public-name>/SKILL.md` and is invoked with its
> public name (for example, `/dhpk:flow-guide` or `/dhpk:dhpk-tdd-workflow`) or auto-triggered by its
> `description`. Stack modules expose
> projection symlinks under `modules/<mod>/skills/`; the canonical source remains in
> the flat root (see
> [`../agents/INDEX.md`](../agents/INDEX.md) and [`../commands/INDEX.md`](../commands/INDEX.md)
> for the sibling indexes). Exact counts: `node scripts/ci/catalog.js`.

## Workflow routing & policy

| Skill | Purpose |
|-------|---------|
| [flow-guide](flow-guide/SKILL.md) | Classify a substantial change (Feature / Bug / Lightweight) before heavy context loads |
| [flow-guide](flow-guide/SKILL.md) | Default task-mode workflow, review obligations, anti-loop guidance |
| [flow-guide](flow-guide/SKILL.md) | Change-aware "what to do next" advisor from the current worktree state |
| [flow-guide](flow-guide/SKILL.md) | End-of-task self-check before wrapping up or committing |

## Prompt engineering

| Skill | Purpose |
|-------|---------|
| [dhpk-prompt-optimize](dhpk-prompt-optimize/SKILL.md) | Rewrite a raw task prompt for the target Claude model + recommend an effort level |

## Feature & bug development

| Skill | Purpose |
|-------|---------|
| [code-trace](code-trace/SKILL.md) | Systematic 5-phase root-cause investigation |
| [dhpk-feature-verify](dhpk-feature-verify/SKILL.md) | Read-only post-deploy behavior verification (P0–P5) |
| [dhpk-tdd-workflow](dhpk-tdd-workflow/SKILL.md) | Behavior-first RED-GREEN-REFACTOR guidance for test-bearing work |
| [flow-drive](flow-drive/SKILL.md) | Backend-neutral implementation, verification, review, and bounded retries |

## Code exploration & architecture

| Skill | Purpose |
|-------|---------|
| [code-trace](code-trace/SKILL.md) | Symbol/flow exploration with optional dual perspective and depth-controlled explanation |
| [code-trace](code-trace/SKILL.md) | Git-history investigation — where a bug was introduced |
| [code-trace](code-trace/SKILL.md) | Pick the right exploration tool (gitnexus / cx / claude-mem / Read / Grep) |
| [dhpk-module-design](dhpk-module-design/SKILL.md) | Architecture decisions, module boundaries, implementation guidance |
| [dhpk-agent-architecture-audit](dhpk-agent-architecture-audit/SKILL.md) | 12-layer diagnostic for agent / LLM applications |

## Optional second opinion

| Skill | Purpose |
|-------|---------|
| [change-verdict](change-verdict/SKILL.md) | Fixed-point code review with an optional explicit Codex CLI backend |
| [change-verdict](change-verdict/SKILL.md) | Portable five-dimension document review with an optional explicit second opinion |
| [change-verdict](change-verdict/SKILL.md) | Portable test-coverage sufficiency review with an optional explicit second opinion |

## Review, risk & audit

| Skill | Purpose |
|-------|---------|
| [change-verdict](change-verdict/SKILL.md) | PR self-review (correctness / security / perf) + squash-merge hygiene |
| [change-verdict](change-verdict/SKILL.md) | OWASP Top 10 security review (codex-free) |
| [change-verdict](change-verdict/SKILL.md) | Uncommitted-code risk scoring + breaking-change / blast-radius analysis |
| [dhpk-project-audit](dhpk-project-audit/SKILL.md) | Project-health audit with deterministic scoring |
| [dhpk-issue-analyze](dhpk-issue-analyze/SKILL.md) | GitHub Issue / PR review-thread triage with Codex blind verdict |
| [dhpk-session-usage-audit](dhpk-session-usage-audit/SKILL.md) | Local dhpk session usage, evidence, verification, and issue handoff |

## Specs & documents

| Skill | Purpose |
|-------|---------|
| [dhpk-tech-spec](dhpk-tech-spec/SKILL.md) | Tech-spec generation and review |
| [dhpk-feasibility-study](dhpk-feasibility-study/SKILL.md) | First-principles feasibility comparison |
| [dhpk-create-request](dhpk-create-request/SKILL.md) | Per-task request tickets for progress tracking |

## Git, commit & deploy

| Skill | Purpose |
|-------|---------|
| [dhpk-git-smart-commit](dhpk-git-smart-commit/SKILL.md) | Group messy changes into cohesive commits |
| [dhpk-agy-commit](dhpk-agy-commit/SKILL.md) | Delegate smart-commit batching to agy-cli |
| [dhpk-release-creator](dhpk-release-creator/SKILL.md) | Cut a new release of a project (version bump, changelog, PR, tag, CI) |
| [dhpk-deploy-list](dhpk-deploy-list/SKILL.md) | Cross-project deploy file-list / checklist generator |

## OpenSpec (opsx) session support

| Skill | Purpose |
|-------|---------|
| [dhpk-opsx-apply-goal](dhpk-opsx-apply-goal/SKILL.md) | Generate a bounded single-paste `/goal` condition with selector-resolved fast-worker routing, a ≤200-byte task digest, conditional E2E roster, consolidated review waves, and a 4,000-byte hard stop |
| [dhpk-opsx-load-context](dhpk-opsx-load-context/SKILL.md) | Load apply-resume context via 3-tier fallback |
| [dhpk-opsx-post-observation](dhpk-opsx-post-observation/SKILL.md) | Post a session observation to claude-mem during Save Phase |

## Harness governance & learning

| Skill | Purpose |
|-------|---------|
| [dhpk-harness-budget](dhpk-harness-budget/SKILL.md) | Audit context-window token consumption; ranked savings |
| [dhpk-harness-fill](dhpk-harness-fill/SKILL.md) | Explore-driven meta-workflow to fill in `.claude/` infrastructure |
| [dhpk-harness-revise](dhpk-harness-revise/SKILL.md) | Trim, dedupe, and validate the project harness |
| [dhpk-claude-health](dhpk-claude-health/SKILL.md) | `.claude/` config health check + plugin-version sync |
| [dhpk-cross-agent-sync](dhpk-cross-agent-sync/SKILL.md) | Sync Claude-first config to Codex / Antigravity / AGY / Cursor |
| [skill-forge](skill-forge/SKILL.md) | Extract cross-cutting principles from skills into rules |

## Skill authoring & audit

| Skill | Purpose |
|-------|---------|
| [skill-forge](skill-forge/SKILL.md) | Create or refactor a skill to dhpk conventions |
| [skill-scope](skill-scope/SKILL.md) | Search local / marketplace / GitHub / web before creating a skill |
| [skill-scope](skill-scope/SKILL.md) | Structural lint of one skill (routing / loading / verification) |
| [skill-scope](skill-scope/SKILL.md) | Deep rubric-based grade of one skill's design quality |
| [skill-scope](skill-scope/SKILL.md) | Batch-audit many skills for quality / overlap / staleness |

## Project onboarding & setup

| Skill | Purpose |
|-------|---------|
| [dhpk-project-setup](dhpk-project-setup/SKILL.md) | First-time config init (framework detection, CLAUDE.md) |
| [dhpk-repo-intake](dhpk-repo-intake/SKILL.md) | One-time project-inventory onboarding |
| [dhpk-onepassword-session](dhpk-onepassword-session/SKILL.md) | Initialize a 1Password CLI session for the harness |

## PHP library packaging

| Skill | Purpose |
|-------|---------|
| [dhpk-composer-package-hygiene](dhpk-composer-package-hygiene/SKILL.md) | Semver, public API surface, composer.json hygiene, release flow |
| [dhpk-laravel-package-author](dhpk-laravel-package-author/SKILL.md) | Laravel package service-provider / facade / publishing patterns |
| [dhpk-laravel-testbench-matrix](dhpk-laravel-testbench-matrix/SKILL.md) | Orchestra Testbench matrix for multi-major-Laravel packages |
| [dhpk-polyfill-version-matrix-audit](dhpk-polyfill-version-matrix-audit/SKILL.md) | Audit multi-major polyfill branch coverage + CI-matrix gaps |

## GitNexus (knowledge-graph code navigation)

GitNexus skills are canonical flat packages like every other skill; the module-like
grouping below is documentation only.

| Skill | Purpose |
|-------|---------|
| [dhpk-gitnexus-guide](dhpk-gitnexus-guide/SKILL.md) | GitNexus tools, graph schema, workflow reference |
| [dhpk-gitnexus-cli](dhpk-gitnexus-cli/SKILL.md) | Analyze / index / wiki / status CLI commands |
| [dhpk-gitnexus-exploring](dhpk-gitnexus-exploring/SKILL.md) | Understand architecture, trace execution flows |
| [dhpk-gitnexus-debugging](dhpk-gitnexus-debugging/SKILL.md) | Trace a bug / error to its source |
| [dhpk-gitnexus-impact-analysis](dhpk-gitnexus-impact-analysis/SKILL.md) | What breaks if I change X — pre-edit safety |
| [dhpk-gitnexus-refactoring](dhpk-gitnexus-refactoring/SKILL.md) | Rename / extract / split / move code safely |
