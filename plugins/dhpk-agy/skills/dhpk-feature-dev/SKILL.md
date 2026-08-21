---
name: dhpk-feature-dev
description: 'Feature development workflow. Use when: implementing features, writing code, running dev loop. Not for: understanding code (use dhpk-codebase-exploration), reviewing code (use dhpk-change-review). Output: implemented feature + tests + review gate.'
argument-hint: '[--codex] <feature description>'
allowed-tools: 'Read, Grep, Glob, Edit, Write, Bash, Skill, AskUserQuestion'
metadata:
  dhpk-invocation-class: implicit-eligible
---

# Feature Development Skill

## When NOT to Use

- Just want to understand code (use `dhpk-codebase-exploration`)
- Review code only (use `dhpk-change-review`)
- Review documents only (use `dhpk-doc-review`)
- Pure test-only tasks without feature changes (use `dhpk-test-review` directly)

## Execution Policy

Load `${CLAUDE_PLUGIN_ROOT}/skills/dhpk-execution-policy/references/delivery-core.md`
for the shared implementation, context-tier, verification, and review contract.
The route SSOT pointer is `${CLAUDE_PLUGIN_ROOT}/rules/execution-policy.md`
§Implementation dispatch; load that section only when route selection needs it.

<budget:token_budget>200000</budget:token_budget>

The workflow tables show the `--codex` path. In default codex-free mode, use the
policy's documented substitutes.

## Workflow

This route receives feature work from `dhpk-adaptive-dev-workflow` and hands
test strategy to `dhpk-tdd-workflow`, post-development coverage to
`dhpk-post-dev-test`, and independent review to `dhpk-change-review`.

```
Requirements → Design → Implement → Test + Review → Precommit Gate → Doc Sync
                │          │            │                  │               │
                ▼          ▼            ▼                  ▼               ▼
           dhpk-codex- dhpk-codex- /verify             /precommit  /update-docs
           architect  implement   dhpk-test-review    (or /precommit)  dhpk-create-request --update
                                  dhpk-change-review
```

## Commands

| Phase | Command | Description |
|-------|---------|-------------|
| Design | `dhpk-codex-architect` | Get architecture advice |
| Implement | `dhpk-codex-implement` | Codex writes code |
| Test: Run | `/verify` | Run tests (lint → typecheck → unit → integration) |
| Test: Review | `dhpk-test-review` | **Mandatory** — review test sufficiency (5 dimensions) |
| Test: Generate | `dhpk-tdd-workflow` | Generate behavior-focused tests for gaps |
| Test: Integration | `dhpk-post-dev-test` | Write missing integration/e2e tests |
| Review | `dhpk-change-review` | Code review (auto-loop) |
| Precommit | `/precommit` | lint + build + test (auto-loop canonical path) |
| Doc Sync | `/update-docs` | Sync docs with code |
| Doc Sync | `dhpk-create-request --update` | Update request progress |
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

## Verification

- [ ] All tests pass (`/verify`)
- [ ] Test adequacy reviewed (`dhpk-test-review`)
- [ ] Code review passed (`dhpk-change-review` ✅ Ready)
- [ ] Precommit passed (`/precommit` ✅ All Pass)
- [ ] No `git add/commit/push` executed

## Doc Sync (after precommit Pass)

**⚠️ Auto-triggered per @rules/execution-policy.md (§Post-implementation agent gate / §Review output gate) — behavior-layer, not hook-enforced.**

Only when change maps to a feature under `docs/features/`. Target detection uses 3-level fallback — see `/update-docs` for algorithm details.

```
precommit Pass
  → Locate feature docs (see /update-docs 3-level fallback)
  → /update-docs docs/features/<feature>/2-tech-spec.md
  → `dhpk-create-request --update` docs/features/<feature>/requests/<date>-<title>.md
  → `dhpk-doc-review` (per updated file)
  → Safety valve: new code diff? → back to review loop (see /update-docs)
```

## Examples

```
Input: Implement a fee calculation method
Action: `dhpk-codex-architect` → `dhpk-codex-implement` → /verify → `dhpk-test-review` → `dhpk-change-review` → /precommit
```

```
Input: This code needs refactoring
Action: /simplify → /verify → `dhpk-test-review` → `dhpk-change-review` → /precommit
```

```
Input: Feature dev, continue (resuming work)
Action: Check git status → identify remaining tasks → continue from current phase
```
