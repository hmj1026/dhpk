---
description: 'Wrap-up refactoring — simplify code, eliminate duplication, preserve behavior'
argument-hint: '<file or directory>'
allowed-tools: 'Read, Grep, Glob, Edit, Bash(TEST_ENV=unit npx jest:*)'
---

## Task

For `$ARGUMENTS`:

1. **Run tests first** (establish baseline)
2. **Refactor** (functionally-equivalent changes only)
   - **Structure**: remove dead code · extract duplicates (3+ repeats) into a named helper · early returns over nesting (> 3 levels) · async/await over callback chains
   - **Readability**: descriptive names · avoid nested ternaries · break long chains into intermediate variables
   - **Quality**: drop stray `console.log` / commented-out code · consolidate duplicate logic · unwind over-abstracted single-use helpers
3. **Run tests again** (confirm nothing broken)

## Output

```markdown
## Refactoring Summary

- [file:line] <change>

## Test Results

✅/❌

## Next Steps

- <suggestions>
```

## Constraints

- ❌ Do not change business logic
- ❌ Do not add new features
