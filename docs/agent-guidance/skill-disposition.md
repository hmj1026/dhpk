# Canonical skill disposition

Apply evidence for `rewrite-canonical-skills-for-agents`. Source pin: local `/home/paul/projects/matt-pocock_skills/package.json` version `1.2.3` (checked 2026-08-17). Historical baseline: 102 `skills/*/SKILL.md` packages; current inventory: 101 active canonical packages. Generated projections are not disposition rows.

This is a historical disposition snapshot, not a live route registry. The five
workflow identities marked `Retired in 0.47.0`, plus the two Codex MCP identities
retired in `0.52.0`, remain here only as historical predecessor labels; active
routing uses the successor modes and the inventory-owned retirement ledger. The
authoritative reason codes, replacement rows, rollback pin, and direct-host
boundary are documented in [`docs/skill-platform-migration.md`](../skill-platform-migration.md#alias-free-retirement-ledger-0470);
this table must not be read as a discovery alias list.

The pass originally covered 103 packages. `dhpk-continuous-learning-v2` was retired by `retire-continuous-learning-v2` before this evidence shipped, so its row is removed rather than carried as a stale `Keep`.

| Path | Family | Invocation class | Disposition | SSOT / reason |
| --- | --- | --- | --- | --- |
| `skills/dhpk-adaptive-dev-workflow/SKILL.md` | Feature/bug loop | implicit-eligible | Keep | Owns its public workflow or domain-specific guidance; no duplicate SSOT identified in this pass. |
| `skills/dhpk-agent-architecture-audit/SKILL.md` | Other promoted | implicit-eligible | Keep | Owns its public workflow or domain-specific guidance; no duplicate SSOT identified in this pass. |
| `skills/dhpk-agy-commit/SKILL.md` | Other promoted | explicit-only | Keep | Owns its public workflow or domain-specific guidance; no duplicate SSOT identified in this pass. |
| `skills/dhpk-agy-fast-worker/SKILL.md` | Other promoted | implicit-eligible | Keep | Owns its public workflow or domain-specific guidance; no duplicate SSOT identified in this pass. |
| `skills/dhpk-bug-fix/SKILL.md` | Feature/bug loop | — | Retired in 0.47.0 | Historical row; bug delivery is now `skills/dhpk-adaptive-dev-workflow/SKILL.md` (`bug` mode). |
| `skills/dhpk-change-review/SKILL.md` | Other promoted | implicit-eligible | Keep | Owns its public workflow or domain-specific guidance; no duplicate SSOT identified in this pass. |
| `skills/dhpk-claude-health/SKILL.md` | Harness | explicit-only | Merge-pointer | `skills/dhpk-harness-revise/references/harness-directory-contract.md` owns active harness resolution; this file keeps health checks. |
| `skills/dhpk-codebase-exploration/SKILL.md` | Other promoted | implicit-eligible | Keep | Owns its public workflow or domain-specific guidance; no duplicate SSOT identified in this pass. |
| `skills/dhpk-codex-bridge/SKILL.md` | Other promoted | implicit-eligible | Keep | Owns its public workflow or domain-specific guidance; no duplicate SSOT identified in this pass. |
| `skills/dhpk-composer-package-hygiene/SKILL.md` | Other promoted | implicit-eligible | Keep | Owns its public workflow or domain-specific guidance; no duplicate SSOT identified in this pass. |
| `skills/dhpk-create-request/SKILL.md` | Other promoted | implicit-eligible | Keep | Vertical tracer-bullet request workflow; owns ticket granularity and blocking edges. |
| `skills/dhpk-create-skill/SKILL.md` | Skill authoring | explicit-only | Merge-pointer | `docs/agent-guidance/writing-for-agents.md` and external 1.2.x source own universal writing levers; this file keeps dhpk packaging. |
| `skills/dhpk-cross-agent-sync/SKILL.md` | Harness | explicit-only | Merge-pointer | `skills/dhpk-harness-revise/references/harness-directory-contract.md` owns active harness resolution; this file keeps cross-platform sync. |
| `skills/dhpk-de-ai-flavor/SKILL.md` | Other promoted | — | Retired in 0.47.0 | Historical row; intentional model-default retirement with no successor package. |
| `skills/dhpk-deploy-list/SKILL.md` | Other promoted | implicit-eligible | Keep | Owns its public workflow or domain-specific guidance; no duplicate SSOT identified in this pass. |
| `skills/dhpk-doc-review/SKILL.md` | Other promoted | implicit-eligible | Keep | Owns its public workflow or domain-specific guidance; no duplicate SSOT identified in this pass. |
| `skills/dhpk-execution-checklist/SKILL.md` | Other promoted | implicit-eligible | Keep | Owns its public workflow or domain-specific guidance; no duplicate SSOT identified in this pass. |
| `skills/dhpk-execution-policy/SKILL.md` | Other promoted | implicit-eligible | Keep | Owns its public workflow or domain-specific guidance; no duplicate SSOT identified in this pass. |
| `skills/dhpk-fastapi-pro/SKILL.md` | Other promoted | implicit-eligible | Keep | Owns its public workflow or domain-specific guidance; no duplicate SSOT identified in this pass. |
| `skills/dhpk-feasibility-study/SKILL.md` | Other promoted | implicit-eligible | Keep | Owns its public workflow or domain-specific guidance; no duplicate SSOT identified in this pass. |
| `skills/dhpk-feature-dev/SKILL.md` | Feature/bug loop | — | Retired in 0.47.0 | Historical row; feature delivery is now `skills/dhpk-adaptive-dev-workflow/SKILL.md` (`feature` mode). |
| `skills/dhpk-feature-verify/SKILL.md` | Feature/bug loop | implicit-eligible | Keep | Owns its public workflow or domain-specific guidance; no duplicate SSOT identified in this pass. |
| `skills/dhpk-git-history-investigation/SKILL.md` | Other promoted | implicit-eligible | Keep | Owns its public workflow or domain-specific guidance; no duplicate SSOT identified in this pass. |
| `skills/dhpk-git-smart-commit/SKILL.md` | Other promoted | explicit-only | Keep | Owns its public workflow or domain-specific guidance; no duplicate SSOT identified in this pass. |
| `skills/dhpk-gitnexus-cli/SKILL.md` | GitNexus | implicit-eligible | Merge-pointer | `skills/dhpk-gitnexus-guide/SKILL.md` owns schema, tools, resources, and stale-index recovery; this file keeps its workflow. |
| `skills/dhpk-gitnexus-debugging/SKILL.md` | GitNexus | implicit-eligible | Merge-pointer | `skills/dhpk-gitnexus-guide/SKILL.md` owns schema, tools, resources, and stale-index recovery; this file keeps its workflow. |
| `skills/dhpk-gitnexus-exploring/SKILL.md` | GitNexus | implicit-eligible | Merge-pointer | `skills/dhpk-gitnexus-guide/SKILL.md` owns schema, tools, resources, and stale-index recovery; this file keeps its workflow. |
| `skills/dhpk-gitnexus-guide/SKILL.md` | GitNexus | implicit-eligible | Keep | Owns its public workflow or domain-specific guidance; no duplicate SSOT identified in this pass. |
| `skills/dhpk-gitnexus-impact-analysis/SKILL.md` | GitNexus | implicit-eligible | Merge-pointer | `skills/dhpk-gitnexus-guide/SKILL.md` owns schema, tools, resources, and stale-index recovery; this file keeps its workflow. |
| `skills/dhpk-gitnexus-refactoring/SKILL.md` | GitNexus | implicit-eligible | Merge-pointer | `skills/dhpk-gitnexus-guide/SKILL.md` owns schema, tools, resources, and stale-index recovery; this file keeps its workflow. |
| `skills/dhpk-harness-budget/SKILL.md` | Harness | implicit-eligible | Merge-pointer | `skills/dhpk-harness-revise/references/harness-directory-contract.md` owns active harness resolution; this file keeps token accounting. |
| `skills/dhpk-harness-fill/SKILL.md` | Harness | explicit-only | Merge-pointer | `skills/dhpk-harness-revise/references/harness-directory-contract.md` owns active harness resolution; this file keeps infrastructure backfill. |
| `skills/dhpk-harness-revise/SKILL.md` | Harness | explicit-only | Keep | Owns its public workflow or domain-specific guidance; no duplicate SSOT identified in this pass. |
| `skills/dhpk-ios-icon-gen/SKILL.md` | Other promoted | implicit-eligible | Keep | Owns its public workflow or domain-specific guidance; no duplicate SSOT identified in this pass. |
| `skills/dhpk-ios-platform/SKILL.md` | Other promoted | implicit-eligible | Keep | Owns its public workflow or domain-specific guidance; no duplicate SSOT identified in this pass. |
| `skills/dhpk-issue-analyze/SKILL.md` | Other promoted | implicit-eligible | Keep | Owns its public workflow or domain-specific guidance; no duplicate SSOT identified in this pass. |
| `skills/dhpk-js-lint-config/SKILL.md` | Other promoted | implicit-eligible | Keep | Owns its public workflow or domain-specific guidance; no duplicate SSOT identified in this pass. |
| `skills/dhpk-js-static-check-strategy/SKILL.md` | Other promoted | implicit-eligible | Keep | Owns its public workflow or domain-specific guidance; no duplicate SSOT identified in this pass. |
| `skills/dhpk-laravel-10-notes/SKILL.md` | Versioned notes | implicit-eligible | Keep | Version-specific notes remain separate IDs and point at the family router/counterpart; no ID merge. |
| `skills/dhpk-laravel-11-notes/SKILL.md` | Versioned notes | implicit-eligible | Keep | Version-specific notes remain separate IDs and point at the family router/counterpart; no ID merge. |
| `skills/dhpk-laravel-5-4-notes/SKILL.md` | Versioned notes | implicit-eligible | Keep | Version-specific notes remain separate IDs and point at the family router/counterpart; no ID merge. |
| `skills/dhpk-laravel-6-notes/SKILL.md` | Versioned notes | implicit-eligible | Keep | Version-specific notes remain separate IDs and point at the family router/counterpart; no ID merge. |
| `skills/dhpk-laravel-7-notes/SKILL.md` | Versioned notes | implicit-eligible | Keep | Version-specific notes remain separate IDs and point at the family router/counterpart; no ID merge. |
| `skills/dhpk-laravel-8-notes/SKILL.md` | Versioned notes | implicit-eligible | Keep | Version-specific notes remain separate IDs and point at the family router/counterpart; no ID merge. |
| `skills/dhpk-laravel-9-notes/SKILL.md` | Versioned notes | implicit-eligible | Keep | Version-specific notes remain separate IDs and point at the family router/counterpart; no ID merge. |
| `skills/dhpk-laravel-mix-notes/SKILL.md` | Versioned notes | implicit-eligible | Keep | Version-specific notes remain separate IDs and point at the family router/counterpart; no ID merge. |
| `skills/dhpk-laravel-package-author/SKILL.md` | Other promoted | implicit-eligible | Keep | Owns its public workflow or domain-specific guidance; no duplicate SSOT identified in this pass. |
| `skills/dhpk-laravel-testbench-matrix/SKILL.md` | Other promoted | implicit-eligible | Keep | Owns its public workflow or domain-specific guidance; no duplicate SSOT identified in this pass. |
| `skills/dhpk-legacy-characterization-tests/SKILL.md` | Other promoted | implicit-eligible | Keep | Owns its public workflow or domain-specific guidance; no duplicate SSOT identified in this pass. |
| `skills/dhpk-library-dual-testsuite-map/SKILL.md` | Other promoted | implicit-eligible | Keep | Owns its public workflow or domain-specific guidance; no duplicate SSOT identified in this pass. |
| `skills/dhpk-matrix-cell-onboard/SKILL.md` | Other promoted | implicit-eligible | Keep | Owns its public workflow or domain-specific guidance; no duplicate SSOT identified in this pass. |
| `skills/dhpk-implement/SKILL.md` | Other promoted | explicit-only | Keep | Backend-neutral implementation owner; historical predecessor `dhpk-codex-implement` retired in 0.52.0, with no alias or deleted package path. |
| `skills/dhpk-module-design/SKILL.md` | Other promoted | implicit-eligible | Keep | Architecture vocabulary and YAGNI scope filter SSOT; historical predecessors `dhpk-codex-brainstorm` (0.47.0) and `dhpk-codex-architect` (0.52.0) have no aliases. |
| `skills/dhpk-next-step/SKILL.md` | Other promoted | implicit-eligible | Keep | Owns its public workflow or domain-specific guidance; no duplicate SSOT identified in this pass. |
| `skills/dhpk-nextjs-15-5-notes/SKILL.md` | Versioned notes | implicit-eligible | Merge-pointer | `docs/agent-guidance/frontend-framework-routing.md` owns React/Next family selection; this file keeps Next.js 15.5 guidance. |
| `skills/dhpk-nextjs-16-notes/SKILL.md` | Versioned notes | implicit-eligible | Merge-pointer | `docs/agent-guidance/frontend-framework-routing.md` owns React/Next family selection; this file keeps Next.js 16 guidance. |
| `skills/dhpk-onepassword-session/SKILL.md` | Other promoted | explicit-only | Keep | Owns its public workflow or domain-specific guidance; no duplicate SSOT identified in this pass. |
| `skills/dhpk-openspec-artifact-guard/SKILL.md` | Other promoted | implicit-eligible | Keep | Owns its public workflow or domain-specific guidance; no duplicate SSOT identified in this pass. |
| `skills/dhpk-opsx-apply-goal/SKILL.md` | Other promoted | explicit-only | Keep | Owns its public workflow or domain-specific guidance; no duplicate SSOT identified in this pass. |
| `skills/dhpk-opsx-load-context/SKILL.md` | Other promoted | implicit-eligible | Keep | Owns its public workflow or domain-specific guidance; no duplicate SSOT identified in this pass. |
| `skills/dhpk-opsx-post-observation/SKILL.md` | Other promoted | implicit-eligible | Keep | Owns its public workflow or domain-specific guidance; no duplicate SSOT identified in this pass. |
| `skills/dhpk-php-8x-features/SKILL.md` | Other promoted | implicit-eligible | Keep | Owns its public workflow or domain-specific guidance; no duplicate SSOT identified in this pass. |
| `skills/dhpk-php-modern-pro/SKILL.md` | Other promoted | implicit-eligible | Keep | Owns its public workflow or domain-specific guidance; no duplicate SSOT identified in this pass. |
| `skills/dhpk-php-runtime-router/SKILL.md` | Other promoted | implicit-eligible | Keep | Owns its public workflow or domain-specific guidance; no duplicate SSOT identified in this pass. |
| `skills/dhpk-phpunit-10-notes/SKILL.md` | Versioned notes | implicit-eligible | Keep | Version-specific notes remain separate IDs and point at the family router/counterpart; no ID merge. |
| `skills/dhpk-phpunit-11-notes/SKILL.md` | Versioned notes | implicit-eligible | Keep | Version-specific notes remain separate IDs and point at the family router/counterpart; no ID merge. |
| `skills/dhpk-phpunit-9-modern/SKILL.md` | Versioned notes | implicit-eligible | Keep | Version-specific notes remain separate IDs and point at the family router/counterpart; no ID merge. |
| `skills/dhpk-polyfill-version-matrix-audit/SKILL.md` | Other promoted | implicit-eligible | Keep | Owns its public workflow or domain-specific guidance; no duplicate SSOT identified in this pass. |
| `skills/dhpk-post-dev-test/SKILL.md` | Feature/bug loop | — | Retired in 0.47.0 | Historical row; unit/integration work uses `dhpk-tdd-workflow`, and Playwright journeys use the `e2e-runner` agent. |
| `skills/dhpk-pr-review/SKILL.md` | Other promoted | implicit-eligible | Keep | PR self-review workflow; OWASP is a named pointer, not a copied checklist. |
| `skills/dhpk-project-audit/SKILL.md` | Other promoted | implicit-eligible | Keep | Owns its public workflow or domain-specific guidance; no duplicate SSOT identified in this pass. |
| `skills/dhpk-project-setup/SKILL.md` | Other promoted | explicit-only | Keep | Owns its public workflow or domain-specific guidance; no duplicate SSOT identified in this pass. |
| `skills/dhpk-prompt-optimize/SKILL.md` | Other promoted | implicit-eligible | Keep | Owns its public workflow or domain-specific guidance; no duplicate SSOT identified in this pass. |
| `skills/dhpk-pytest-async/SKILL.md` | Other promoted | implicit-eligible | Keep | Owns its public workflow or domain-specific guidance; no duplicate SSOT identified in this pass. |
| `skills/dhpk-python-pro/SKILL.md` | Other promoted | implicit-eligible | Keep | Owns its public workflow or domain-specific guidance; no duplicate SSOT identified in this pass. |
| `skills/dhpk-python-static-checks/SKILL.md` | Other promoted | implicit-eligible | Keep | Owns its public workflow or domain-specific guidance; no duplicate SSOT identified in this pass. |
| `skills/dhpk-react-18-notes/SKILL.md` | Versioned notes | implicit-eligible | Merge-pointer | `docs/agent-guidance/frontend-framework-routing.md` owns React/Next family selection; this file keeps React 18 guidance. |
| `skills/dhpk-react-19-notes/SKILL.md` | Versioned notes | implicit-eligible | Merge-pointer | `docs/agent-guidance/frontend-framework-routing.md` owns React/Next family selection; this file keeps React 19 guidance. |
| `skills/dhpk-release-creator/SKILL.md` | Other promoted | explicit-only | Keep | Owns its public workflow or domain-specific guidance; no duplicate SSOT identified in this pass. |
| `skills/dhpk-repo-intake/SKILL.md` | Other promoted | explicit-only | Keep | Owns its public workflow or domain-specific guidance; no duplicate SSOT identified in this pass. |
| `skills/dhpk-risk-assess/SKILL.md` | Other promoted | implicit-eligible | Keep | Owns its public workflow or domain-specific guidance; no duplicate SSOT identified in this pass. |
| `skills/dhpk-root-cause-investigation/SKILL.md` | Feature/bug loop | implicit-eligible | Keep | Bug investigation SSOT; takes the 1.2.3 Redact increment. |
| `skills/dhpk-rules-distill/SKILL.md` | Harness | explicit-only | Merge-pointer | `skills/dhpk-harness-revise/references/harness-directory-contract.md` owns active harness resolution; this file keeps rule distillation. |
| `skills/dhpk-security-review/SKILL.md` | Other promoted | implicit-eligible | Keep | OWASP checklist owner; neighboring reviews point here instead of copying it. |
| `skills/dhpk-session-usage-audit/SKILL.md` | Other promoted | explicit-only | Keep | Owns its public workflow or domain-specific guidance; no duplicate SSOT identified in this pass. |
| `skills/dhpk-skill-health-audit/SKILL.md` | Skill authoring | implicit-eligible | Merge-pointer | `docs/agent-guidance/writing-for-agents.md` owns the universal authoring contract; this file keeps structural lint. |
| `skills/dhpk-skill-quality-judge/SKILL.md` | Skill authoring | implicit-eligible | Merge-pointer | `docs/agent-guidance/writing-for-agents.md` owns the universal authoring contract; this file keeps deep scoring. |
| `skills/dhpk-skill-scout/SKILL.md` | Skill authoring | implicit-eligible | Keep | Owns its public workflow or domain-specific guidance; no duplicate SSOT identified in this pass. |
| `skills/dhpk-skill-stocktake/SKILL.md` | Skill authoring | implicit-eligible | Keep | Owns its public workflow or domain-specific guidance; no duplicate SSOT identified in this pass. |
| `skills/dhpk-swift-language/SKILL.md` | Other promoted | implicit-eligible | Keep | Owns its public workflow or domain-specific guidance; no duplicate SSOT identified in this pass. |
| `skills/dhpk-swift-test-strategy/SKILL.md` | Other promoted | implicit-eligible | Keep | Owns its public workflow or domain-specific guidance; no duplicate SSOT identified in this pass. |
| `skills/dhpk-swiftui-architecture/SKILL.md` | Other promoted | implicit-eligible | Keep | Owns its public workflow or domain-specific guidance; no duplicate SSOT identified in this pass. |
| `skills/dhpk-tdd-workflow/SKILL.md` | Feature/bug loop | implicit-eligible | Keep | dhpk two-mode TDD SSOT; takes behavioral increments from matt-pocock-skills 1.2.3. |
| `skills/dhpk-tech-spec/SKILL.md` | Other promoted | implicit-eligible | Keep | Numbered tech-spec workflow; points at module-design vocabulary. |
| `skills/dhpk-test-review/SKILL.md` | Other promoted | implicit-eligible | Keep | Owns its public workflow or domain-specific guidance; no duplicate SSOT identified in this pass. |
| `skills/dhpk-tool-routing/SKILL.md` | Other promoted | implicit-eligible | Keep | Owns its public workflow or domain-specific guidance; no duplicate SSOT identified in this pass. |
| `skills/dhpk-vue-2-notes/SKILL.md` | Other promoted | implicit-eligible | Keep | Owns its public workflow or domain-specific guidance; no duplicate SSOT identified in this pass. |
| `skills/dhpk-xcode-build-tooling/SKILL.md` | Other promoted | implicit-eligible | Keep | Owns its public workflow or domain-specific guidance; no duplicate SSOT identified in this pass. |
| `skills/dhpk-yii1-php56-development/SKILL.md` | Other promoted | implicit-eligible | Keep | Owns its public workflow or domain-specific guidance; no duplicate SSOT identified in this pass. |
| `skills/dhpk-yii1-security-audit/SKILL.md` | Other promoted | implicit-eligible | Keep | Owns its public workflow or domain-specific guidance; no duplicate SSOT identified in this pass. |

## Contract evidence

- `metadata.dhpk-invocation-class` and directory names were captured before rewrite and rechecked after the canonical pass; route-table and distribution-inventory targets remain unchanged.
- No `skills/dhpk-wait-what`, `skills/dhpk-wizard`, or `skills/dhpk-to-questionnaire` package exists; no index entries were added.
- Generated `plugins/`, `cursor/`, and `codex/` projections are produced by catalog/projection generators, never hand-edited.
- Existing `docs/platform-installation.md` and `docs/platform-installation.zh-TW.md` are outside this change and remain untouched.
