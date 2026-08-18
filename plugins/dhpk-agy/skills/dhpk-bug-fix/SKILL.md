---
name: dhpk-bug-fix
description: 'Bug fix workflow. Use when: fixing bugs, resolving issues, regression fixes. Not for: new features (use dhpk-feature-dev), understanding code (use dhpk-codebase-exploration). Output: fix + regression test + review gate.'
argument-hint: '[--codex] <bug description / issue ref>'
allowed-tools: 'Read, Grep, Glob, Edit, Write, Bash, Skill'
metadata:
  dhpk-invocation-class: implicit-eligible
---

# Bug Fix Skill

## When NOT to Use

- New feature development (use `dhpk-feature-dev`)
- Just want to understand code (use `dhpk-codebase-exploration`)
- Pure test-only tasks without feature changes (use `dhpk-test-review` directly)

## Execution Policy

Follow `${CLAUDE_PLUGIN_ROOT}/rules/execution-policy.md` §Implementation dispatch for prohibited git actions, fast-worker override handling, and Codex isolation/mode selection. This skill does not commit; `/precommit` is only a quality gate. Workflow tables show the `--codex` path; use the policy's substitutes in default mode.

## Workflow

This route receives confirmed bugs from `dhpk-adaptive-dev-workflow` or
`dhpk-root-cause-investigation`, hands RED strategy to `dhpk-tdd-workflow`,
and closes through `dhpk-change-review` and the precommit gate.

```
Investigate → Locate → Fix → Test + Review → Precommit Gate
  │             │       │         │                │
  ▼             ▼       ▼         ▼                ▼
gh issue      Grep    Edit     /verify          /precommit
dhpk-git-history-investigation  Read  tests  dhpk-test-review
                               dhpk-change-review
```

## Phase 1: Investigation

| Source | Action |
|--------|--------|
| GitHub Issue | `gh issue view <number>` |
| Error message | `Grep("error message")` |
| Code history | `dhpk-git-history-investigation` |

**Output root cause analysis**:

- Problem location: `src/<module>/<file>:<line>`
- Root cause: <specific cause>
- Impact scope: <which features are affected>

**Unknown root cause** (not obvious from a quick grep/read/issue skim) → dispatch `deep-reasoner` per `execution-policy` §Implementation dispatch instead of guessing; its conclusion contract (root cause + `file:line` evidence + fix spec) feeds directly into Phase 2.

## Phase 2: Fix

| Principle | Description |
|-----------|-------------|
| Minimal changes | Only modify what is necessary |
| No new issues | Confirm changes don't affect other features |

Apply a confirmed fix spec (from Phase 1, whether self-derived or from `deep-reasoner`) per `execution-policy` §Implementation dispatch: `fast-worker` for a mechanical, precisely-specified patch, or inline for a small (~≤2-file) unambiguous change.

## Phase 3: Add Regression Test ⚠️

Test conventions are defined by `@skills/dhpk-feature-dev/references/dev-loop-gate.md`; consumer `.claude/rules/` overrides take precedence.

**Bug fixes must have tests at the corresponding level:**

| Bug Type | Required | Recommended |
|----------|----------|-------------|
| Logic error | Unit | - |
| Service issue | Unit | Integration |
| API issue | Integration | E2E |
| Cross-service/data flow | Integration | E2E |
| User flow | E2E | - |

## Phase 4: Verify + Review

Follow `@skills/dhpk-feature-dev/references/dev-loop-gate.md` for the complete shared test, adequacy, freshness, code-review, and review-loop gate.

## Doc Sync

Doc Sync is a behavior-layer step (not hook-enforced): after precommit pass it triggers conditionally when changes map to `docs/features/`.

## Output

```markdown
## Bug Fix Report
- **Root cause**: <analysis>
- **Fix**: <description of changes>
- **Regression test**: <test result>
- **Gate**: ✅ Fixed / ⛔ Needs further investigation
```

## Verification

- [ ] Root cause identified and documented
- [ ] Regression test written at appropriate level
- [ ] All tests pass (`/verify`)
- [ ] Test adequacy reviewed (`dhpk-test-review`)
- [ ] Code review passed (`dhpk-change-review` ✅ Ready)
- [ ] Precommit passed (`/precommit` ✅ All Pass)
- [ ] No `git add/commit/push` executed

## Examples

```
Input: Fix issue #123 - calculation error
Action: gh issue view → locate → fix → write Unit Test → /verify → `dhpk-test-review` → `dhpk-change-review` → /precommit
```

```
Input: API returning 500 error
Action: Grep error → read code → fix → write Integration Test → /verify → `dhpk-test-review` → `dhpk-change-review` → /precommit
```
