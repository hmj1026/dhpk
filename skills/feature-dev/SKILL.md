---
name: feature-dev
description: 'Feature development workflow. Use when: implementing features, writing code, running dev loop. Not for: understanding code (use code-explore), reviewing code (use codex-code-review). Output: implemented feature + tests + review gate.'
argument-hint: '[--codex] <feature description>'
allowed-tools: 'Read, Grep, Glob, Edit, Write, Bash, Skill, AskUserQuestion'
---

# Feature Development Skill

## Trigger

- Keywords: develop feature, implement, write code, verify, precommit, refactor, simplify

## When NOT to Use

- Just want to understand code (use Explore)
- Review code only (use codex-code-review)
- Review documents only (use doc-review)
- Pure test-only tasks without feature changes (use `/codex-test-review` directly)

## Execution Policy

Follow `${CLAUDE_PLUGIN_ROOT}/rules/execution-policy.md` §Implementation dispatch for prohibited git actions, fast-worker override handling, and Codex isolation/mode selection. This skill does not commit; `/precommit` is only a quality gate.

<budget:token_budget>200000</budget:token_budget>

The workflow tables show the `--codex` path. In default codex-free mode, use the substitutes defined by that policy section.

## Workflow

```
Requirements → Design → Implement → Test + Review → Precommit Gate → Doc Sync
                │          │            │                  │               │
                ▼          ▼            ▼                  ▼               ▼
           /codex-     /codex-    /verify              /precommit  /update-docs
           architect   implement  /codex-test-review   (or /precommit)  /create-request --update
                                  /codex-review-fast
```

## Commands

| Phase | Command | Description |
|-------|---------|-------------|
| Design | `/codex-architect` | Get architecture advice |
| Implement | `/codex-implement` | Codex writes code |
| Test: Run | `/verify` | Run tests (lint → typecheck → unit → integration) |
| Test: Review | `/codex-test-review` | **Mandatory** — review test sufficiency (5 dimensions) |
| Test: Generate | `/codex-test-gen` | Generate unit tests for gaps |
| Test: Integration | `/post-dev-test` | Write missing integration/e2e tests |
| Review | `/codex-review-fast` | Code review (auto-loop) |
| Precommit | `/precommit` | lint + build + test (auto-loop canonical path) |
| Doc Sync | `/update-docs` | Sync docs with code |
| Doc Sync | `/create-request --update` | Update request progress |
| Refactor | `/simplify` | Final refactoring |

## Test + Review Phase

Follow [dev-loop-gate.md](references/dev-loop-gate.md) for test conventions, adequacy review, freshness, code review, and the review-loop gate.

## Testing Requirements

| Change Type | Test Requirements |
|-------------|-------------------|
| New Service/Provider | Must have corresponding unit test |
| Modify existing logic | Existing tests pass + new logic tested |
| Bug fix | Must add regression test |
| New API endpoint | Integration test required |
| Cross-service change | E2E test required |

## Test File Mapping

Use the project's own test-file convention (from its .claude/rules/, if defined). If no override is defined, follow ecosystem defaults:

| Source Pattern | Test Pattern |
|---------------|-------------|
| `src/<module>/` | `test/unit/<module>/` or `test/<module>/` |
| `scripts/<name>.sh` | `test/scripts/<name>.test.js` |
| `skills/<name>/SKILL.md` | `test/skills/<name>.test.js` |

## Output

- Implemented feature code + tests
- Test adequacy gate: ✅ Tests sufficient
- Review gate: ✅ Ready
- Precommit results: ✅ All Pass

## Verification Checklist

- [ ] All tests pass (`/verify`)
- [ ] Test adequacy reviewed (`/codex-test-review`)
- [ ] Code review passed (`/codex-review-fast` ✅ Ready)
- [ ] Precommit passed (`/precommit` ✅ All Pass)
- [ ] No `git add/commit/push` executed

## Doc Sync (after precommit Pass)

**⚠️ Auto-triggered per @rules/execution-policy.md (§Post-implementation agent gate / §Review output gate) — behavior-layer, not hook-enforced.**

Only when change maps to a feature under `docs/features/`. Target detection uses 3-level fallback — see `/update-docs` for algorithm details.

```
precommit Pass
  → Locate feature docs (see /update-docs 3-level fallback)
  → /update-docs docs/features/<feature>/2-tech-spec.md
  → /create-request --update docs/features/<feature>/requests/<date>-<title>.md
  → /codex-review-doc (per updated file)
  → Safety valve: new code diff? → back to review loop (see /update-docs)
```

## Examples

```
Input: Implement a fee calculation method
Action: /codex-architect → /codex-implement → /verify → /codex-test-review → /codex-review-fast → /precommit
```

```
Input: This code needs refactoring
Action: /simplify → /verify → /codex-test-review → /codex-review-fast → /precommit
```

```
Input: Feature dev, continue (resuming work)
Action: Check git status → identify remaining tasks → continue from current phase
```
