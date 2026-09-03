# Progression Tables

Used when script shows P0 gate issues or when determining which workflow step comes next.

## Work Type Detection

| Branch Pattern | Work Type |
|----------------|-----------|
| `feat/*` | flow-guide (classify → feature) |
| `fix/*`, `hotfix/*` | flow-guide (classify → bugfix) |
| `docs/*` | documentation |
| `refactor/*`, `perf/*` | refactor |
| `chore/*`, `ci/*`, `test/*` | Infer from conversation |
| No pattern / `release/*` | Infer from conversation |

## Feature Development Progression

| Last Completed | Next Step |
|----------------|-----------|
| (nothing yet) | `/dhpk:dhpk-module-design` or `/dhpk:dhpk-feasibility-study` (large feature) |
| Architecture designed | `/dhpk:flow-drive --mode implement` or manual coding |
| Code written, no tests | Write tests, then `/verify` |
| `/verify` pass | `/dhpk:change-verdict --mode code` + `/dhpk:change-verdict --mode tests` |
| `/verify` fail | Fix failing tests, re-run `/verify` |
| `/dhpk:change-verdict --mode code` pass | `/precommit` |
| `/precommit` pass | **Doc Sync** → `/update-docs` + `/dhpk:dhpk-create-request --update` |
| Doc sync complete | Manual commit + `/dhpk:change-verdict --mode pr` |
| All gates pass | Session summary (see output below) |

## Bug Fix Progression

| Last Completed | Next Step |
|----------------|-----------|
| (nothing yet) | `/dhpk:dhpk-issue-analyze` or `/dhpk:flow-guide --mode classify` (Bug branch) |
| Root cause identified | Fix code + write regression test |
| Fix applied | `/verify` |
| `/verify` pass | `/dhpk:change-verdict --mode code` |
| `/dhpk:change-verdict --mode code` pass | `/precommit` |
| `/precommit` pass | Manual commit |

## Documentation Work

| Last Completed | Next Step |
|----------------|-----------|
| (nothing yet) | `/dhpk:dhpk-tech-spec` or `/update-docs` |
| Docs written/updated | `/dhpk:change-verdict --mode docs` |
| `/dhpk:change-verdict --mode docs` pass | Manual commit |

## Refactoring

| Last Completed | Next Step |
|----------------|-----------|
| (nothing yet) | `/dhpk:code-trace --mode explore` to understand current state |
| Understood | `/simplify` |
| Refactored | `/verify` → `/dhpk:change-verdict --mode code` → `/precommit` |

## Investigation (no code changes expected)

| Situation | Suggest |
|-----------|---------|
| Want to understand code | `/dhpk:code-trace --mode explore` |
| Track a specific change | `/dhpk:code-trace --mode history` |
| Analyze a GitHub issue | `/dhpk:dhpk-issue-analyze` |
| Need architecture advice | `/dhpk:dhpk-module-design` or `/dhpk:dhpk-module-design --mode adversarial` |
| Evaluate feasibility | `/dhpk:dhpk-feasibility-study` |
