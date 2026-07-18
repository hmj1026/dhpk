---
name: bug-fix
description: 'Bug fix workflow. Use when: fixing bugs, resolving issues, regression fixes. Not for: new features (use feature-dev), understanding code (use code-explore). Output: fix + regression test + review gate.'
argument-hint: '[--codex] <bug description / issue ref>'
allowed-tools: 'Read, Grep, Glob, Edit, Write, Bash, Skill'
---

# Bug Fix Skill

## Trigger

- Keywords: bug, issue, fix, error, broken, failing

## When NOT to Use

- New feature development (use feature-dev)
- Just want to understand code (use code-explore)
- Pure test-only tasks without feature changes (use `/codex-test-review` directly)

## Execution Policy

Follow `${CLAUDE_PLUGIN_ROOT}/rules/execution-policy.md` §Implementation dispatch for prohibited git actions, fast-worker override handling, and Codex isolation/mode selection. This skill does not commit; `/precommit` is only a quality gate. Workflow tables show the `--codex` path; use the policy's substitutes in default mode.

## Workflow

```
Investigate → Locate → Fix → Test + Review → Precommit Gate
  │             │       │         │                │
  ▼             ▼       ▼         ▼                ▼
gh issue      Grep    Edit     /verify          /precommit
/git-investigate  Read  tests  /codex-test-review
                               /codex-review-fast
```

## Phase 1: Investigation

| Source | Action |
|--------|--------|
| GitHub Issue | `gh issue view <number>` |
| Error message | `Grep("error message")` |
| Code history | `/git-investigate` |

**Output root cause analysis**:

- Problem location: `src/<module>/<file>:<line>`
- Root cause: <specific cause>
- Impact scope: <which features are affected>

**Unknown root cause** (not obvious from a quick grep/read/issue skim) → dispatch `dhpk:deep-reasoner` per `execution-policy` §Implementation dispatch instead of guessing; its conclusion contract (root cause + `file:line` evidence + fix spec) feeds directly into Phase 2.

## Phase 2: Fix

| Principle | Description |
|-----------|-------------|
| Minimal changes | Only modify what is necessary |
| No new issues | Confirm changes don't affect other features |

Apply a confirmed fix spec (from Phase 1, whether self-derived or from `deep-reasoner`) per `execution-policy` §Implementation dispatch: `dhpk:fast-worker` for a mechanical, precisely-specified patch, or inline for a small (~≤2-file) unambiguous change.

## Phase 3: Add Regression Test ⚠️

Test conventions are defined by `${CLAUDE_PLUGIN_ROOT}/skills/feature-dev/references/dev-loop-gate.md`; consumer `.claude/rules/` overrides take precedence.

**Bug fixes must have tests at the corresponding level:**

| Bug Type | Required | Recommended |
|----------|----------|-------------|
| Logic error | Unit | - |
| Service issue | Unit | Integration |
| API issue | Integration | E2E |
| Cross-service/data flow | Integration | E2E |
| User flow | E2E | - |

## Phase 4: Verify + Review

Follow `${CLAUDE_PLUGIN_ROOT}/skills/feature-dev/references/dev-loop-gate.md` for the complete shared test, adequacy, freshness, code-review, and review-loop gate.

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

## Verification Checklist

- [ ] Root cause identified and documented
- [ ] Regression test written at appropriate level
- [ ] All tests pass (`/verify`)
- [ ] Test adequacy reviewed (`/codex-test-review`)
- [ ] Code review passed (`/codex-review-fast` ✅ Ready)
- [ ] Precommit passed (`/precommit` ✅ All Pass)
- [ ] No `git add/commit/push` executed

## Examples

```
Input: Fix issue #123 - calculation error
Action: gh issue view → locate → fix → write Unit Test → /verify → /codex-test-review → /codex-review-fast → /precommit
```

```
Input: API returning 500 error
Action: Grep error → read code → fix → write Integration Test → /verify → /codex-test-review → /codex-review-fast → /precommit
```
