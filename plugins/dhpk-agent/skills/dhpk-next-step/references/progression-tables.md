# Progression Tables

Used when script shows P0 gate issues or when determining which workflow step comes next.

## Work Type Detection

| Branch Pattern | Work Type |
|----------------|-----------|
| `feat/*` | feature-dev |
| `fix/*`, `hotfix/*` | bug-fix |
| `docs/*` | documentation |
| `refactor/*`, `perf/*` | refactor |
| `chore/*`, `ci/*`, `test/*` | Infer from conversation |
| No pattern / `release/*` | Infer from conversation |

## Feature Development Progression

| Last Completed | Next Step |
|----------------|-----------|
| (nothing yet) | `/dhpk:dhpk-codex-architect` or `/dhpk:dhpk-feasibility-study` (large feature) |
| Architecture designed | `/dhpk:dhpk-codex-implement` or manual coding |
| Code written, no tests | Write tests, then `/verify` |
| `/verify` pass | `/codex-review-fast` + `/codex-test-review` |
| `/verify` fail | Fix failing tests, re-run `/verify` |
| `/codex-review-fast` pass | `/precommit` |
| `/precommit` pass | **Doc Sync** → `/update-docs` + `/dhpk:dhpk-create-request --update` |
| Doc sync complete | Manual commit + `/dhpk:dhpk-pr-review` |
| All gates pass | Session summary (see output below) |

## Bug Fix Progression

| Last Completed | Next Step |
|----------------|-----------|
| (nothing yet) | `/dhpk:dhpk-issue-analyze` or `/dhpk:dhpk-bug-fix` |
| Root cause identified | Fix code + write regression test |
| Fix applied | `/verify` |
| `/verify` pass | `/codex-review-fast` |
| `/codex-review-fast` pass | `/precommit` |
| `/precommit` pass | Manual commit |

## Documentation Work

| Last Completed | Next Step |
|----------------|-----------|
| (nothing yet) | `/dhpk:dhpk-tech-spec` or `/update-docs` |
| Docs written/updated | `/codex-review-doc` |
| `/codex-review-doc` pass | Manual commit |

## Refactoring

| Last Completed | Next Step |
|----------------|-----------|
| (nothing yet) | `/dhpk:dhpk-codebase-exploration` to understand current state |
| Understood | `/simplify` |
| Refactored | `/verify` → `/codex-review-fast` → `/precommit` |

## Investigation (no code changes expected)

| Situation | Suggest |
|-----------|---------|
| Want to understand code | `/dhpk:dhpk-codebase-exploration` |
| Track a specific change | `/dhpk:dhpk-git-history-investigation` |
| Analyze a GitHub issue | `/dhpk:dhpk-issue-analyze` |
| Need architecture advice | `/dhpk:dhpk-codex-architect` or `/dhpk:dhpk-codex-brainstorm` |
| Evaluate feasibility | `/dhpk:dhpk-feasibility-study` |
