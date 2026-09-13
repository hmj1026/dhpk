---
description: 'Navigation index for dhpk plugin skills. Internal documentation; not an invocable skill.'
---

# Skills index

This index describes the 65 canonical skill packages (all active in 0.54). The inventory is
the source of truth for lifecycle, stable IDs, public names, profile selection,
and publication surfaces; this page is a navigation aid. Every package lives
under `skills/<public-name>/SKILL.md` and keeps its procedure and completion
contract in that file.

For Codex parameter discovery, use [`$flow-guide help`](../docs/codex-skill-usage.md)
or `$flow-guide help <skill>`. The generated metadata-only catalogue is
[`skills/flow-guide/references/codex-usage-catalog.json`](flow-guide/references/codex-usage-catalog.json);
do not copy its grammar into a skill procedure.

## Portable capability families

These are the nine recognizable family entry points. Family modes and selectors
are finite and disclosed by the family package.

| Public skill | Stable ID | Interface |
| --- | --- | --- |
| [skill-scope](skill-scope/SKILL.md) | `skill-scope` | `health`, `judge`, `stocktake`, `scout` |
| [skill-forge](skill-forge/SKILL.md) | `skill-forge` | `create`, `distill-rules` |
| [flow-guide](flow-guide/SKILL.md) | `flow-guide` | `help`, `route`, `rules`, `next`, `close` |
| [flow-drive](flow-drive/SKILL.md) | `flow-drive` | confirmed specification or change; no mode |
| [change-verdict](change-verdict/SKILL.md) | `change-verdict` | `code`, `pr`, `security`, `tests`, `docs`, `risk` |
| [code-trace](code-trace/SKILL.md) | `code-trace` | `explore`, `diagnose`, `history`, `select-tool` |
| [laravel](laravel/SKILL.md) | `laravel` | selectors `5.4`, `6`, `7`, `8`, `9`, `10`, `11`, `mix` |
| [phpunit](phpunit/SKILL.md) | `phpunit` | selectors `9`, `10`, `11` |
| [harness-govern](harness-govern/SKILL.md) | `harness-govern` | `health`, `budget`, `fill`, `revise`, `sync` |

`git-smart-commit` remains a standalone capability with its existing public
name. It is not replaced by a new commit family.

## Promoted workflow and integration skills

| Public skill | Stable ID | Purpose |
| --- | --- | --- |
| [dhpk-agent-architecture-audit](dhpk-agent-architecture-audit/SKILL.md) | `agent-architecture-audit` | Audit agent and LLM application architecture |
| [dhpk-agy-fast-worker](dhpk-agy-fast-worker/SKILL.md) | `agy-fast-worker` | Explicit AGY worker handoff |
| [dhpk-codex-bridge](dhpk-codex-bridge/SKILL.md) | `codex-bridge` | Explicit external CLI bridge |
| [dhpk-composer-package-hygiene](dhpk-composer-package-hygiene/SKILL.md) | `composer-package-hygiene` | Composer package and public API hygiene |
| [dhpk-deploy-list](dhpk-deploy-list/SKILL.md) | `deploy-list` | Deployment file-list and checklist |
| [dhpk-feature-verify](dhpk-feature-verify/SKILL.md) | `feature-verify` | Read-only post-deploy verification |
| [dhpk-git-smart-commit](dhpk-git-smart-commit/SKILL.md) | `git-smart-commit` | Group and execute cohesive Git commits |
| [dhpk-gitnexus-cli](dhpk-gitnexus-cli/SKILL.md) | `gitnexus-cli` | GitNexus index and wiki operations |
| [dhpk-gitnexus-debugging](dhpk-gitnexus-debugging/SKILL.md) | `gitnexus-debugging` | GitNexus-assisted bug tracing |
| [dhpk-gitnexus-exploring](dhpk-gitnexus-exploring/SKILL.md) | `gitnexus-exploring` | GitNexus architecture exploration |
| [dhpk-gitnexus-guide](dhpk-gitnexus-guide/SKILL.md) | `gitnexus-guide` | GitNexus tools and schema guidance |
| [dhpk-gitnexus-impact-analysis](dhpk-gitnexus-impact-analysis/SKILL.md) | `gitnexus-impact-analysis` | Pre-edit blast-radius analysis |
| [dhpk-gitnexus-refactoring](dhpk-gitnexus-refactoring/SKILL.md) | `gitnexus-refactoring` | Safe rename, extraction, and restructuring |
| [dhpk-issue-analyze](dhpk-issue-analyze/SKILL.md) | `issue-analyze` | GitHub issue and review-thread triage |
| [dhpk-laravel-package-author](dhpk-laravel-package-author/SKILL.md) | `laravel-package-author` | Laravel package publication patterns |
| [dhpk-laravel-testbench-matrix](dhpk-laravel-testbench-matrix/SKILL.md) | `laravel-testbench-matrix` | Laravel package Testbench matrix |
| [dhpk-opsx-apply-goal](dhpk-opsx-apply-goal/SKILL.md) | `opsx-apply-goal` | Bounded long-running OpenSpec apply goal |
| [dhpk-opsx-load-context](dhpk-opsx-load-context/SKILL.md) | `opsx-load-context` | Resume context loading |
| [dhpk-opsx-post-observation](dhpk-opsx-post-observation/SKILL.md) | `opsx-post-obs` | Save-phase observation posting |
| [dhpk-polyfill-version-matrix-audit](dhpk-polyfill-version-matrix-audit/SKILL.md) | `polyfill-version-matrix-audit` | Cross-version polyfill coverage audit |
| [dhpk-project-audit](dhpk-project-audit/SKILL.md) | `project-audit` | Deterministic project health audit |
| [dhpk-project-setup](dhpk-project-setup/SKILL.md) | `project-setup` | First-time project harness setup |
| [dhpk-prompt-optimize](dhpk-prompt-optimize/SKILL.md) | `prompt-optimize` | Prompt completeness and effort guidance |
| [dhpk-release-creator](dhpk-release-creator/SKILL.md) | `release-creator` | Release preparation workflow |
| [dhpk-repo-intake](dhpk-repo-intake/SKILL.md) | `repo-intake` | Repository inventory onboarding |
| [dhpk-session-usage-audit](dhpk-session-usage-audit/SKILL.md) | `session-usage-audit` | Session evidence and usage audit |
| [dhpk-tdd-workflow](dhpk-tdd-workflow/SKILL.md) | `tdd` | Behavior-first test workflow |

## Optional module and transport skills

These packages are activated or projected by the inventory when their module or
surface is selected. They remain distinct because they own a concrete stack or
transport contract.

| Public skill | Stable ID | Scope |
| --- | --- | --- |
| [dhpk-cli-dispatch-context](dhpk-cli-dispatch-context/SKILL.md) | `cli-dispatch-context` | CLI context dispatch |
| [dhpk-cli-transport](dhpk-cli-transport/SKILL.md) | `cli-transport` | Hardened CLI transport |
| [dhpk-fastapi-pro](dhpk-fastapi-pro/SKILL.md) | `fastapi-pro` | FastAPI and SQLAlchemy |
| [dhpk-ios-icon-gen](dhpk-ios-icon-gen/SKILL.md) | `ios-icon-gen` | iOS icon generation |
| [dhpk-ios-platform](dhpk-ios-platform/SKILL.md) | `ios-platform` | iOS platform APIs |
| [dhpk-js-lint-config](dhpk-js-lint-config/SKILL.md) | `js-lint-config` | JavaScript lint configuration |
| [dhpk-js-static-check-strategy](dhpk-js-static-check-strategy/SKILL.md) | `js-static-check-strategy` | Incremental JS static checks |
| [dhpk-legacy-characterization-tests](dhpk-legacy-characterization-tests/SKILL.md) | `legacy-code-characterization` | Legacy behavior locking |
| [dhpk-library-dual-testsuite-map](dhpk-library-dual-testsuite-map/SKILL.md) | `library-dual-testsuite-map` | Dual test-suite mapping |
| [dhpk-matrix-cell-onboard](dhpk-matrix-cell-onboard/SKILL.md) | `matrix-cell-onboard` | CI matrix cell onboarding |
| [dhpk-nextjs-15-5-notes](dhpk-nextjs-15-5-notes/SKILL.md) | `nextjs-15-5-notes` | Next.js 15.5 guidance |
| [dhpk-nextjs-16-notes](dhpk-nextjs-16-notes/SKILL.md) | `nextjs-16-notes` | Next.js 16 guidance |
| [dhpk-openspec-artifact-guard](dhpk-openspec-artifact-guard/SKILL.md) | `openspec-artifact-guard` | OpenSpec artifact guard |
| [dhpk-php-8x-features](dhpk-php-8x-features/SKILL.md) | `php-8x-features` | PHP 8.x feature boundaries |
| [dhpk-php-modern-pro](dhpk-php-modern-pro/SKILL.md) | `php-modern-pro` | Modern PHP compatibility |
| [dhpk-php-runtime-router](dhpk-php-runtime-router/SKILL.md) | `php-pro` | PHP runtime and framework routing |
| [dhpk-pytest-async](dhpk-pytest-async/SKILL.md) | `pytest-async` | Async pytest guidance |
| [dhpk-python-pro](dhpk-python-pro/SKILL.md) | `python-pro` | Python backend guidance |
| [dhpk-python-static-checks](dhpk-python-static-checks/SKILL.md) | `python-static-checks` | Python static-check strategy |
| [dhpk-react-18-notes](dhpk-react-18-notes/SKILL.md) | `react-18-notes` | React 18 guidance |
| [dhpk-react-19-notes](dhpk-react-19-notes/SKILL.md) | `react-19-notes` | React 19 guidance |
| [dhpk-swift-language](dhpk-swift-language/SKILL.md) | `swift-language` | Swift language guidance |
| [dhpk-swift-test-strategy](dhpk-swift-test-strategy/SKILL.md) | `swift-test-strategy` | Swift test strategy |
| [dhpk-swiftui-architecture](dhpk-swiftui-architecture/SKILL.md) | `swiftui-architecture` | SwiftUI architecture |
| [dhpk-vue-2-notes](dhpk-vue-2-notes/SKILL.md) | `vue-2-notes` | Vue 2 guidance |
| [dhpk-xcode-build-tooling](dhpk-xcode-build-tooling/SKILL.md) | `xcode-build-tooling` | Xcode and SPM tooling |
| [dhpk-yii1-php56-development](dhpk-yii1-php56-development/SKILL.md) | `php56-yii-dev` | Yii 1.1 / PHP 5.6 development |
| [dhpk-yii1-security-audit](dhpk-yii1-security-audit/SKILL.md) | `yii1-security-audit` | Yii 1.1 security audit |

## Discovery rules

- Use `flow-guide` for help, routing, policy, progression, or closeout. Use
  `flow-drive` only for a confirmed specification or OpenSpec change.
- Use a family selector or mode instead of reviving a retired predecessor.
- For Codex, invoke the exact public name shown in the generated catalogue;
  `agents/openai.yaml` is metadata, not a second argument schema.
- When a skill changes, update its inventory usage contract and regenerate
  projections. This index must not become a second source of truth.
