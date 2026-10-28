---
description: 'Navigation index for dhpk plugin skills. Internal documentation; not an invocable skill.'
---

# Skills index

This index describes the 39 canonical skill packages currently published. The inventory is
the source of truth for lifecycle, stable IDs, public names, profile selection,
and publication surfaces; this page is a navigation aid. Every package lives
under `skills/<public-name>/SKILL.md` and keeps its procedure and completion
contract in that file.

The `common` collection in `manifests/install-profiles.json` is the sole main
installation default; public profiles are retired. `flow-guide help <skill>`
returns the selected skill's usage and stop conditions; optional skills require
an explicit overlay or host-supported standalone projection.

For Codex parameter discovery, use [`$flow-guide help`](../docs/codex-skill-usage.md)
or `$flow-guide help <skill>`. The generated metadata-only catalogue is
[`skills/flow-guide/references/codex-usage-catalog.json`](flow-guide/references/codex-usage-catalog.json);
do not copy its grammar into a skill procedure.

## Portable capability families

These are the recognizable family entry points. Family modes and selectors
are finite and disclosed by the family package.

| Public skill | Stable ID | Interface |
| --- | --- | --- |
| [flow-guide](flow-guide/SKILL.md) | `flow-guide` | `help`, `route`, `rules`, `next`, `close` |
| [flow-drive](flow-drive/SKILL.md) | `flow-drive` | bounded task, task file, or confirmed specification/change; task/help only |
| [change-verdict](change-verdict/SKILL.md) | `change-verdict` | Six verdict modes, `pending`, dependency audit and explicit bounded fix |
| [code-trace](code-trace/SKILL.md) | `code-trace` | `explore`, `diagnose`, `history`, `select-tool` |
| [laravel](laravel/SKILL.md) | `laravel` | selectors `5.4`, `6`, `7`, `8`, `9`, `10`, `11`, `mix` |
| [phpunit](phpunit/SKILL.md) | `phpunit` | selectors `9`, `10`, `11` |
| [react](react/SKILL.md) | `react` | React tasks; target 18 or 19 resolved before specialized guidance |
| [nextjs](nextjs/SKILL.md) | `nextjs` | Next.js tasks; target 15.5 or 16 resolved before specialized guidance |
| [swift](swift/SKILL.md) | `swift` | Swift, SwiftUI, tests, platform, build, and icons |
| [python](python/SKILL.md) | `python` | Python, async tests, static checks, and FastAPI |
| [js-static-checks](js-static-checks/SKILL.md) | `js-static-checks` | Natural tasks or optional `check`, `setup`, `rollout` |
| [php](php/SKILL.md) | `php` | Runtime-compatible PHP 5.6, 7.4, and 8.x tasks |
| [yii1](yii1/SKILL.md) | `yii1` | Yii 1.1 development, review, and security |
| [library-author](library-author/SKILL.md) | `library-author` | `author`, `testbench`, `composer`, `polyfill-audit`, `suite-map`, `cell-onboard` |
| [doc-maintain](doc-maintain/SKILL.md) | `doc-maintain` | `update`, `codemap`, `refactor` |

`git-smart-commit` remains a standalone capability with its existing public
name. It is not replaced by a new commit family.

## Portable command workflow skills

These Skills own the procedures forwarded by the matching Claude command
front doors. Invoke the public name directly from Codex.

| Public skill | Stable ID | Purpose |
| --- | --- | --- |
| [code-simplify](code-simplify/SKILL.md) | `code-simplify` | Bounded behavior-preserving cleanup |
| [create-pr](create-pr/SKILL.md) | `create-pr` | Dry-run or explicitly execute a pull request |
| [git-worktree](git-worktree/SKILL.md) | `git-worktree` | Safe native Git worktree lifecycle |
| [harness-setup](harness-setup/SKILL.md) | `harness-setup` | Explicit harness setup and host assets |
| [merge-prep](merge-prep/SKILL.md) | `merge-prep` | Read-only branch merge analysis |
| [opsx-apply-resume](opsx-apply-resume/SKILL.md) | `opsx-apply-resume` | OpenSpec apply handoff and resume |
| [pr-summary](pr-summary/SKILL.md) | `pr-summary` | Structured read-only open-PR summary |
| [precommit](precommit/SKILL.md) | `precommit` | Packaged fast or full pre-commit pipeline |
| [project-brief](project-brief/SKILL.md) | `project-brief` | Technical-spec executive brief |
| [proposal-analyze](proposal-analyze/SKILL.md) | `proposal-analyze` | Evidence-backed proposal roadmap |
| [repo-verify](repo-verify/SKILL.md) | `repo-verify` | Runner-first repository verification |
| [ui-ux-verify](ui-ux-verify/SKILL.md) | `ui-ux-verify` | Read-only rendered UI verification |

## Promoted workflow and integration skills

| Public skill | Stable ID | Purpose |
| --- | --- | --- |
| [dhpk-deploy-list](dhpk-deploy-list/SKILL.md) | `deploy-list` | Deployment file-list and checklist |
| [dhpk-feature-verify](dhpk-feature-verify/SKILL.md) | `feature-verify` | Read-only post-deploy verification |
| [git-smart-commit](git-smart-commit/SKILL.md) | `git-smart-commit` | Group and execute cohesive Git commits |
| [dhpk-issue-analyze](dhpk-issue-analyze/SKILL.md) | `issue-analyze` | GitHub issue and review-thread triage |
| [module-design](module-design/SKILL.md) | `software-architecture` | Architecture boundaries and deep-module design |
| [dhpk-project-audit](dhpk-project-audit/SKILL.md) | `project-audit` | Deterministic project health audit |
| [release-creator](release-creator/SKILL.md) | `release-creator` | Release preparation workflow |
| [dhpk-repo-intake](dhpk-repo-intake/SKILL.md) | `repo-intake` | Repository inventory onboarding |
| [tdd-workflow](tdd-workflow/SKILL.md) | `tdd` | Behavior-first test workflow |

## Optional module and transport skills

These packages are activated or projected by the inventory when their module or
surface is selected. They remain distinct because they own a concrete stack or
transport contract.

| Public skill | Stable ID | Scope |
| --- | --- | --- |
| [dhpk-legacy-characterization-tests](dhpk-legacy-characterization-tests/SKILL.md) | `legacy-code-characterization` | Legacy behavior locking |
| [dhpk-openspec-artifact-guard](dhpk-openspec-artifact-guard/SKILL.md) | `openspec-artifact-guard` | OpenSpec artifact guard |
| [dhpk-vue-2-notes](dhpk-vue-2-notes/SKILL.md) | `vue-2-notes` | Vue 2 guidance |

## Discovery rules

- Use `flow-guide` for help, routing, policy, progression, or closeout. Use
  `flow-drive` directly for one bounded task; its completion is terminal.
- Use a family selector or mode instead of reviving a retired predecessor.
- For Codex, invoke the exact public name shown in the generated catalogue;
  `agents/openai.yaml` is metadata, not a second argument schema.
- When a skill changes, update its inventory usage contract and regenerate
  projections. This index must not become a second source of truth.
