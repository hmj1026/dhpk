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

## Prohibited Actions

```
❌ git add | git commit | git push — per @rules/execution-policy.md (Git pipeline)
```

This skill implements features but does **not** commit. `/precommit` is a quality gate only. To commit, the user must invoke `/smart-commit --execute` separately.

<budget:token_budget>200000</budget:token_budget>

## Fast-worker invocation context

When the caller supplies `FAST_WORKER_OVERRIDE`, retain the exact invocation-only
value and pass it to the shared `scripts/fast-worker-selector.js` as
`--backend "$FAST_WORKER_OVERRIDE"` before the first mechanical dispatch. `unset`
means omit that explicit argument and use selector-managed userConfig/default
precedence; never recover the override from the cleaned task description.

## Codex mode (opt-in)

This workflow runs **codex-free by default** — pure Claude + dhpk agents, no
Codex CLI/MCP required. Pass `--codex` for the Codex-enhanced path (richer
second opinion on the heavy steps). If `--codex` is given but Codex is
unavailable, warn once and fall back to codex-free.

**Isolation invariant:** in default mode you MUST NOT call any `mcp__codex__*`
tool — this skill's `allowed-tools` deliberately omits it. The `--codex` column
below delegates to dedicated `/codex-*` commands, which own that permission.

Every Codex step below has a codex-free substitute (all already shipped):

| Step | Codex-free (default) | `--codex` |
|------|----------------------|-----------|
| Design / architecture | inline design (optionally dispatch `architect` agent) | `/codex-architect` |
| Implement | dispatch per `execution-policy` §Implementation dispatch (TDD); small diff inline | `/codex-implement` |
| Test adequacy | `/check-coverage` (+ `/post-dev-test` for integration/e2e gaps) | `/codex-test-review` |
| Test generation | write tests, guided by `tdd-guide` agent | `/codex-test-gen` |
| Code review | `/review-pending` (→ `code-reviewer` agent) | `/codex-review-fast` |
| Doc review | `/doc-review --no-codex` | `/codex-review-doc` |

The Workflow / Commands tables below name the `--codex` commands; in the default
codex-free mode substitute each per this table.

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

## Test + Review Phase (Detail)

This is the core of feature-dev — ensuring sufficient test coverage before code review.

### Step 1: Run existing tests

```
/verify → all tests pass?
  Yes → Step 2
  No → fix failures → re-run /verify
```

### Step 2: Test adequacy review (mandatory for code changes)

```
/codex-test-review → ✅ Tests sufficient?
  Yes → Step 3
  No → close gaps (Step 2a) → /codex-test-review --continue
```

### Step 2a: Gap closure

| Gap Type | Remediation Command |
|----------|-------------------|
| Unit test missing/insufficient | `/codex-test-gen` → write tests → `/verify` |
| Integration/E2E missing | `/post-dev-test` → write tests → `/verify` |

### Step 3: Code review (auto-loop)

```
/codex-review-fast → ✅ Ready?
  Yes → Precommit Gate
  No → fix issues → re-run /codex-review-fast (auto-loop)
```

### Freshness rule

If code changes after the latest `✅ Tests sufficient` gate (e.g., fixes from code review), rerun `/verify` then `/codex-test-review --continue` before proceeding to precommit gate.

## Testing Requirements

Test conventions: Arrange-Act-Assert structure, behavior-describing test names, and evidence-based adequacy (assert observable output, not internal calls).
Project-local test overrides (directories, runner, adequacy mode) take precedence when the consumer defines them in its own .claude/rules/.

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

## Review Loop

**MUST re-review after fix until PASS** (per @rules/execution-policy.md §Post-implementation agent gate; capped at 3 rounds per §Anti-loop "Review-loop ceiling")

```
Review → Issues found → Fix → Re-review → ... → ✅ Pass → Next step
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
