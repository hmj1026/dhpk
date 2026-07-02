---
description: 'Navigation index for dhpk plugin skills. Internal documentation; not an invocable skill.'
---

# Skills Index (dhpk plugin)

> Navigation for the skills shipped by the dhpk plugin. Base skills live at
> `skills/<name>/SKILL.md` and are invoked as `/dhpk:<name>` (or auto-triggered by their
> `description`). The 6-skill **gitnexus** family is nested under `skills/gitnexus/`. Stack
> modules contribute additional skills under `modules/<mod>/skills/` (see
> [`../agents/INDEX.md`](../agents/INDEX.md) and [`../commands/INDEX.md`](../commands/INDEX.md)
> for the sibling indexes). Exact counts: `node scripts/ci/catalog.js`.

## Workflow routing & policy

| Skill | Purpose |
|-------|---------|
| [adaptive-dev-workflow](adaptive-dev-workflow/SKILL.md) | Classify a substantial change (Feature / Bug / Lightweight) before heavy context loads |
| [dhpk-execution-policy](dhpk-execution-policy/SKILL.md) | Default task-mode workflow, review obligations, anti-loop guidance |
| [next-step](next-step/SKILL.md) | Change-aware "what to do next" advisor from the current worktree state |
| [execution-checklist](execution-checklist/SKILL.md) | End-of-task self-check before wrapping up or committing |

## Prompt engineering

| Skill | Purpose |
|-------|---------|
| [prompt-optimize](prompt-optimize/SKILL.md) | Rewrite a raw task prompt for the target Claude model + recommend an effort level |

## Feature & bug development

| Skill | Purpose |
|-------|---------|
| [feature-dev](feature-dev/SKILL.md) | Feature development loop (design → implement → verify → review) |
| [bug-fix](bug-fix/SKILL.md) | Bug fix workflow — fix + regression test + review gate |
| [bug-investigation](bug-investigation/SKILL.md) | Systematic 5-phase root-cause investigation |
| [feature-verify](feature-verify/SKILL.md) | Read-only post-deploy behavior verification (P0–P5) |
| [post-dev-test](post-dev-test/SKILL.md) | Backfill missing integration / E2E tests after feature work |

## Code exploration & architecture

| Skill | Purpose |
|-------|---------|
| [code-explore](code-explore/SKILL.md) | Pure-Claude code investigation (trace paths, understand architecture) |
| [code-investigate](code-investigate/SKILL.md) | Dual-perspective (Claude + Codex) deep code analysis |
| [git-investigate](git-investigate/SKILL.md) | Git-history investigation — where a bug was introduced |
| [tool-routing](tool-routing/SKILL.md) | Pick the right exploration tool (gitnexus / cx / claude-mem / Read / Grep) |
| [software-architecture](software-architecture/SKILL.md) | Architecture decisions, module boundaries, implementation guidance |
| [agent-architecture-audit](agent-architecture-audit/SKILL.md) | 12-layer diagnostic for agent / LLM applications |

## Codex-assisted (opt-in second opinion)

| Skill | Purpose |
|-------|---------|
| [codex-architect](codex-architect/SKILL.md) | Codex architecture consulting / design second opinion |
| [codex-brainstorm](codex-brainstorm/SKILL.md) | Adversarial Claude + Codex brainstorming to consensus |
| [codex-implement](codex-implement/SKILL.md) | Implement features via Codex MCP |
| [codex-explain](codex-explain/SKILL.md) | Explain complex code via Codex MCP |
| [codex-code-review](codex-code-review/SKILL.md) | Code review via Codex MCP |
| [codex-cli-review](codex-cli-review/SKILL.md) | Code review via Codex CLI with full disk access |
| [doc-review](doc-review/SKILL.md) | Document review via Codex MCP (5-dimension rating) |
| [test-review](test-review/SKILL.md) | Test-coverage sufficiency review via Codex MCP |

## Review, risk & audit

| Skill | Purpose |
|-------|---------|
| [pr-review](pr-review/SKILL.md) | PR self-review (correctness / security / perf) + squash-merge hygiene |
| [security-review](security-review/SKILL.md) | OWASP Top 10 security review (codex-free) |
| [risk-assess](risk-assess/SKILL.md) | Uncommitted-code risk scoring + breaking-change / blast-radius analysis |
| [project-audit](project-audit/SKILL.md) | Project-health audit with deterministic scoring |
| [issue-analyze](issue-analyze/SKILL.md) | GitHub Issue / PR review-thread triage with Codex blind verdict |

## Specs & documents

| Skill | Purpose |
|-------|---------|
| [tech-spec](tech-spec/SKILL.md) | Tech-spec generation and review |
| [feasibility-study](feasibility-study/SKILL.md) | First-principles feasibility comparison |
| [de-ai-flavor](de-ai-flavor/SKILL.md) | Strip AI artifacts from documents, preserving intent |
| [create-request](create-request/SKILL.md) | Per-task request tickets for progress tracking |

## Git, commit & deploy

| Skill | Purpose |
|-------|---------|
| [git-smart-commit](git-smart-commit/SKILL.md) | Group messy changes into cohesive commits |
| [gemini-commit](gemini-commit/SKILL.md) | Delegate smart-commit batching to gemini-cli |
| [deploy-list](deploy-list/SKILL.md) | Cross-project deploy file-list / checklist generator |

## OpenSpec (opsx) session support

| Skill | Purpose |
|-------|---------|
| [opsx-goal](opsx-goal/SKILL.md) | Generate a `/goal` condition for an unattended OpenSpec implementation session |
| [opsx-load-context](opsx-load-context/SKILL.md) | Load apply-resume context via 3-tier fallback |
| [opsx-post-obs](opsx-post-obs/SKILL.md) | Post a session observation to claude-mem during Save Phase |

## Harness governance & learning

| Skill | Purpose |
|-------|---------|
| [harness-budget](harness-budget/SKILL.md) | Audit context-window token consumption; ranked savings |
| [harness-fill](harness-fill/SKILL.md) | Explore-driven meta-workflow to fill in `.claude/` infrastructure |
| [harness-revise](harness-revise/SKILL.md) | Trim, dedupe, and validate the project harness |
| [claude-health](claude-health/SKILL.md) | `.claude/` config health check + plugin-version sync |
| [multi-ai-sync](multi-ai-sync/SKILL.md) | Sync Claude-first config to Codex / Gemini / `.agent` |
| [rules-distill](rules-distill/SKILL.md) | Extract cross-cutting principles from skills into rules |
| [continuous-learning-v2](continuous-learning-v2/SKILL.md) | Instinct-based session learning → skills / commands / agents |

## Skill authoring & audit

| Skill | Purpose |
|-------|---------|
| [create-skill](create-skill/SKILL.md) | Create or refactor a skill to dhpk conventions |
| [skill-scout](skill-scout/SKILL.md) | Search local / marketplace / GitHub / web before creating a skill |
| [skill-health-check](skill-health-check/SKILL.md) | Structural lint of one skill (routing / loading / verification) |
| [skill-judge](skill-judge/SKILL.md) | Deep rubric-based grade of one skill's design quality |
| [skill-stocktake](skill-stocktake/SKILL.md) | Batch-audit many skills for quality / overlap / staleness |

## Project onboarding & setup

| Skill | Purpose |
|-------|---------|
| [project-setup](project-setup/SKILL.md) | First-time config init (framework detection, CLAUDE.md) |
| [repo-intake](repo-intake/SKILL.md) | One-time project-inventory onboarding |
| [op-session](op-session/SKILL.md) | Initialize a 1Password CLI session for the harness |

## PHP library packaging

| Skill | Purpose |
|-------|---------|
| [composer-package-hygiene](composer-package-hygiene/SKILL.md) | Semver, public API surface, composer.json hygiene, release flow |
| [laravel-package-author](laravel-package-author/SKILL.md) | Laravel package service-provider / facade / publishing patterns |
| [laravel-testbench-matrix](laravel-testbench-matrix/SKILL.md) | Orchestra Testbench matrix for multi-major-Laravel packages |
| [polyfill-version-matrix-audit](polyfill-version-matrix-audit/SKILL.md) | Audit multi-major polyfill branch coverage + CI-matrix gaps |

## GitNexus (knowledge-graph code navigation)

Nested under `skills/gitnexus/` — one skill per task shape.

| Skill | Purpose |
|-------|---------|
| [gitnexus-guide](gitnexus/gitnexus-guide/SKILL.md) | GitNexus tools, graph schema, workflow reference |
| [gitnexus-cli](gitnexus/gitnexus-cli/SKILL.md) | Analyze / index / wiki / status CLI commands |
| [gitnexus-exploring](gitnexus/gitnexus-exploring/SKILL.md) | Understand architecture, trace execution flows |
| [gitnexus-debugging](gitnexus/gitnexus-debugging/SKILL.md) | Trace a bug / error to its source |
| [gitnexus-impact-analysis](gitnexus/gitnexus-impact-analysis/SKILL.md) | What breaks if I change X — pre-edit safety |
| [gitnexus-refactoring](gitnexus/gitnexus-refactoring/SKILL.md) | Rename / extract / split / move code safely |
