---
name: legacy-characterization-tests
description: 'Write characterization tests for untested legacy code to lock current behavior before refactoring. Use when users want to safely refactor legacy controllers/models/services, add regression safety nets, or prepare code for extraction. Trigger words: characterization test, lock behavior, legacy test, safe refactor, 行為鎖定, 特徵測試, 安全重構. Not for: greenfield code, already well-tested modules, or pure bug fixes. Output: characterization test files + coverage delta report.'
metadata:
  dhpk-name-style: portable-skill
  dhpk-capability-id: dhpk.skill.legacy-code-characterization
  dhpk-invocation-class: implicit-eligible
---

# Legacy characterization tests

Record observed behavior before changing an untested legacy component. The existing implementation and observed outputs own the contract; this Method does not decide whether that behavior is desirable.

## When NOT to Use

Use test-first development for new behavior or a confirmed bug fix. Skip characterization when adequate regression coverage already locks the target.

## Lifecycle and procedure

1. **Inventory.** Identify public entrypoints, external dependencies, global state, existing tests and high-risk behavior. Include display, edit, print and export consumers when a previously empty value becomes populated.
2. **Choose a seam.** Exercise the smallest public boundary that preserves the real behavior. Prefer isolated unit tests; use integration or functional tests when the behavior requires those boundaries. Use disposable fixtures and verified cleanup for persistent state.
3. **Observe and lock.** Start with one ordinary input, run the existing implementation, then assert its observed output. Add null, empty, boundary and failure inputs one at a time. Each test must pass before proceeding. Unexpected observations require investigation before changing assertions; they do not authorize production fixes.
4. **Verify.** Run each test independently and the affected suite. Report actual coverage when available, including untested high-risk behavior; use the consumer project's acceptance criteria rather than an invented universal threshold.
5. **Refactor and extract.** Production edits require separate authorization. Keep the characterization suite green through a later refactor; transfer stable output contracts to focused unit tests when a pure component is extracted. Retire characterization tests only when replacement coverage demonstrably preserves the contract.

Keep external services behind test doubles where necessary while exercising real local logic. Restore replaced globals and isolate tests from execution order. Database rollback is suitable only when the storage engine supports it; otherwise use owned fixtures and explicit cleanup.

## Output and verification

Deliver test files in the consumer project's existing layout, with documentation of the observed behavior, known debt and extraction exit. Report the exact commands, GREEN/FAIL/NOT_RUN evidence, coverage or its absence, and remaining gaps. Characterization alone leaves production code unchanged.

- Every locked behavior has an observed passing test.
- Tests are independent and persistent fixtures have verified cleanup.
- High-risk gaps and uncovered render consumers are explicit.
- Replacement unit coverage is verified before retiring a characterization test.

## Stack-specific reference

Read [PHP/Yii examples](references/php-yii-examples.md) only for PHP or Yii projects. Adapt framework commands, annotations, isolation helpers and coverage options to the installed versions; the stack-neutral lifecycle above owns the Method.
