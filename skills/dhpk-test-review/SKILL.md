---
name: dhpk-test-review
disable-model-invocation: true
description: 'Portable test coverage review using the current model. Purpose: review test sufficiency, identify coverage gaps, or audit test quality. Not for: generating tests (use dhpk-tdd-workflow), code review (use dhpk-change-review). Output: coverage analysis + gap report.'
allowed-tools: 'Bash(git:*), Read, Grep, Glob, Task'
context: fork
agent: Explore
metadata:
  dhpk-invocation-class: explicit-only
---

# Test Review Skill

## When NOT to Use

- Code review (use `dhpk-change-review`)
- Document review (use `dhpk-doc-review`)
- Just want to run tests (use `/verify`)

## Commands

| Command              | Description             | Use Case            |
| -------------------- | ----------------------- | ------------------- |
| `/codex-test-review` | Review test sufficiency | **Required**        |
| `/codex-test-gen`    | Legacy generation alias; delegate to `dhpk-tdd-workflow` | Add missing tests   |
| `/check-coverage`    | Test coverage analysis  | After feature dev   |

## Workflow: `/codex-test-review`

```
Smart detect target → Read test + source → Primary review (coverage dimensions) → Coverage assessment + Gate → Loop if Needs additions
```

### Step 1: Smart Detection

| Input | Behavior |
|-------|----------|
| File path | Review that file directly |
| Directory | Review all tests in directory |
| Description | Auto-find related test files |
| Module name | Search related test files |
| No parameter | Auto-detect from git diff |

### Step 2: Read Test and Source

- Read test file (`TEST_FILE`)
- Read corresponding source (`SOURCE_FILE`, inferred from test path)

### Step 3: Primary Review

Run the test review with the current model using
`references/codex-prompt-test-review.md`. The primary review is complete without
an external opinion. A caller may explicitly opt into `codex exec` as an
additive, clearly labeled second opinion; it must never be an implicit
requirement or silent fallback.

For a loop review, reread the explicit test/source snapshot and prior gap
artifact; do not assume stateful thread continuity.

When no optional second opinion runs, report the result as primary-model only
and degraded rather than claiming independent verification.

**Save the review artifact identifier and input snapshot.**

## Workflow: `/codex-test-review --ac-trace`

AC traceability mode — maps Acceptance Criteria from request docs to test evidence.

```
--ac-trace input → Read request doc → Parse ACs → Filter quality-gate → Search evidence → Independent verification → Matrix + Gate
```

### Step 1: Input Resolution

| Input | Behavior |
|-------|----------|
| `--ac-trace <request-path>` | Read specified request doc |
| `--ac-trace` (no path) | Auto-detect from `docs/features/*/requests/*.md` via git diff context |
| No `--ac-trace` | Existing behavior (5-dimension coverage review) |

### Step 2: Parse & Filter ACs

1. Locate `## Acceptance Criteria` section in request doc
2. Parse `- [ ]` / `- [x]` items
3. Filter out quality-gate ACs matching: `/codex-review-fast`, `/codex-review-doc`, `/codex-review`, `/precommit`, `/precommit-fast`, `/dhpk:dhpk-pr-review`

### Step 3: Search Evidence

For each non-quality-gate AC:

| Evidence Type | Priority | How to Find |
|--------------|----------|-------------|
| Automated test | 1 (preferred) | Search Related Files test paths; match AC text → test assertions |
| Runtime verification | 2 | Search `/dhpk:dhpk-feature-verify` results at L3+ confidence |
| Manual exception | 3 (verified only) | Check AC annotation `<!-- exception: REASON, expires: DATE -->` |

### Step 4: Independent Verification (Optional)

Use a fresh primary review context for each AC trace; do not reuse a code-review
session. An explicitly requested `codex exec` opinion is additive and must be
labeled separately. See `references/codex-prompt-ac-trace.md`.

| Rule | Detail |
|------|--------|
| Cache | `request-path + git diff hash` key; same session reuse |
| Timeout | 30s → primary-only + `⚠️ Inconclusive` |
| Unavailable | All items `⚠️ Inconclusive`; advisory → `⚠️ Adequate with exceptions`; strict → `⚠️ Need Human` |

When the optional opinion is unavailable, all items remain `⚠️ Inconclusive`
and the output records the degraded primary-only state.

### Step 5: Exception Validation (3-gate)

| Gate | Check |
|------|-------|
| Reason class | Closed enum: `ENV_UNAVAILABLE` / `UNSAFE_TO_AUTOMATE` / `ONE_TIME_MIGRATION` |
| Independent verification | Must emit `VALID_EXCEPTION` when requested |
| Expiry | ISO 8601; expired = ⛔ (strict) or ⚠️ (advisory) |

**Exception caps**: 1-8 AC = max 1; 9-12 = max 2; 13+ = hard cap 2.
**Prohibited domains**: Security AC, Data-integrity AC, Regression AC = no exceptions allowed.

### Step 6: Output + Gate

Gate sentinels:

| Sentinel | Meaning |
|----------|---------|
| `✅ Adequate` | All ACs covered by evidence |
| `⚠️ Adequate with exceptions` | Validated exceptions within cap |
| `⚠️ Need Human` | Optional independent reviewer unavailable or inconclusive |
| `⛔ Inadequate` | Unverified exception, cap breach, or prohibited domain |

## Test generation boundary

Test generation is owned by `dhpk-tdd-workflow`'s `test-generation` capability.
This review skill only assesses existing tests and traces acceptance criteria; it does not generate or save tests. After adding tests through the TDD workflow, run `/codex-test-review` to assess their sufficiency.

## Review Dimensions

| Dimension       | Scoring Criteria                       | Weight |
| --------------- | -------------------------------------- | ------ |
| Happy path      | All public methods, main flows         | High   |
| Error handling  | try/catch, error callbacks             | High   |
| Edge cases      | null/undefined, extremes, empty sets   | Medium |
| Mock quality    | Not excessive, not insufficient        | Medium |

## Three-Layer Tests

| Type        | Directory           | Mock             | Focus               |
| ----------- | ------------------- | ---------------- | -------------------- |
| Unit        | `test/unit/`        | Full             | Single function      |
| Integration | `test/integration/` | Only external    | Inter-module         |
| E2E         | `test/e2e/`         | Prohibited       | Complete flow        |

## Common Boundaries

| Type   | Cases                                            |
| ------ | ------------------------------------------------ |
| String | `""`, `" "`, `null`, `undefined`, very long      |
| Number | `0`, `-1`, `NaN`, `Infinity`, `MAX_SAFE_INTEGER` |
| Array  | `[]`, `[null]`, very large, nested               |
| Object | `{}`, `null`, circular reference                 |

## Review Loop

Auto-loop semantics: `${CLAUDE_PLUGIN_ROOT}/rules/execution-policy.md` §Anti-loop & output.

⛔ Needs additions → add tests through `dhpk-tdd-workflow` →
`/codex-test-review --continue <review-artifact>` → repeat until ✅ Sufficient.

Max 3 rounds. Still failing → report blocker.

## Output

```markdown
## Test Coverage Review
| Dimension | Coverage | Rating |
|-----------|----------|--------|
| ...       | ...      | ⭐1-5  |

### Gate: ✅ Tests sufficient / ⛔ Needs additions
```

## Verification

- [ ] Coverage assessment includes all dimensions
- [ ] Gate is clear (✅ Tests sufficient / ⛔ Needs additions)
- [ ] Missing tests have specific code suggestions
- [ ] The primary reviewer independently researched source-code branches; any
      optional second opinion is labeled separately

## References

- Test review prompt: `references/codex-prompt-test-review.md`
- Test generation: `dhpk-tdd-workflow` (`test-generation` capability)
- AC trace prompt: `references/codex-prompt-ac-trace.md`

## Examples

```
Input: /codex-test-review test/unit/service/xxx.test.ts
Action: Read test + source → primary review → Coverage assessment + Gate

Input: Add tests for src/service/xxx.ts
Action: Use `dhpk-tdd-workflow` to generate tests, then run `/codex-test-review`

Input: Are this service's tests sufficient?
Action: /codex-test-review → Assess coverage → Output gaps + Gate

Input: /codex-test-review --ac-trace docs/features/auth/requests/2026-03-01-login.md
Action: Parse AC → Filter quality-gate → Search evidence → Verify → Matrix + Gate
```
