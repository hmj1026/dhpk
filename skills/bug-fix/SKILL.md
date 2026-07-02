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

## Prohibited Actions

```
❌ git add | git commit | git push — per @rules/execution-policy.md (Git pipeline)
```

This skill fixes bugs but does **not** commit. `/precommit` is a quality gate only. To commit, the user must invoke `/smart-commit --execute` separately.

## Codex mode (opt-in)

This workflow runs **codex-free by default** — pure Claude + dhpk agents, no
Codex CLI/MCP required. Pass `--codex` for the Codex-enhanced path. If `--codex`
is given but Codex is unavailable, warn once and fall back to codex-free.

**Isolation invariant:** in default mode you MUST NOT call any `mcp__codex__*`
tool — this skill's `allowed-tools` deliberately omits it. The `--codex` column
below delegates to dedicated `/codex-*` commands, which own that permission.

Every Codex step below has a codex-free substitute (all already shipped):

| Step | Codex-free (default) | `--codex` |
|------|----------------------|-----------|
| Test adequacy | `/check-coverage` (+ `/post-dev-test` for integration/e2e gaps) | `/codex-test-review` |
| Test generation | write tests, guided by `tdd-guide` agent | `/codex-test-gen` |
| Code review | `/review-pending` (→ `code-reviewer` agent) | `/codex-review-fast` |

The Workflow / Phase tables below name the `--codex` commands; in the default
codex-free mode substitute each per this table.

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

Follow `@rules/testing.md` for conventions (AAA, naming, evidence model).
Follow `@rules/testing-project.md` for project-specific overrides.

**Bug fixes must have tests at the corresponding level:**

| Bug Type | Required | Recommended |
|----------|----------|-------------|
| Logic error | Unit | - |
| Service issue | Unit | Integration |
| API issue | Integration | E2E |
| Cross-service/data flow | Integration | E2E |
| User flow | E2E | - |

## Phase 4: Verify + Review

### Step 1: Run tests

```
/verify → all tests pass?
  Yes → Step 2
  No → fix failures → re-run /verify
```

### Step 2: Test adequacy review (mandatory for code changes)

```
/codex-test-review → ✅ Tests sufficient?
  Yes → Step 3
  No → close gaps (Step 2a) → /codex-test-review --continue <threadId>
```

### Step 2a: Gap closure

| Gap Type | Remediation |
|----------|-------------|
| Unit test missing | `/codex-test-gen` → write tests → `/verify` |
| Integration/E2E missing | `/post-dev-test` → write tests → `/verify` |

### Step 3: Code review (auto-loop)

```
/codex-review-fast → ✅ Ready?
  Yes → Precommit Gate
  No → fix issues → re-run /codex-review-fast (auto-loop)
```

### Freshness rule

If code changes after the latest `✅ Tests sufficient` gate (e.g., fixes from code review), rerun `/verify` then `/codex-test-review --continue <threadId>` before proceeding to precommit gate.

## Review Loop

**MUST re-review after fix until PASS** (per @rules/auto-loop.md)

```
Fix → Review → Issues found → Fix again → ... → ✅ Pass → Next step
```

## Doc Sync

Doc Sync is governed by `@rules/auto-loop.md` (behavior-layer rule). After precommit pass, triggers conditionally when changes map to `docs/features/`.

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
