---
name: tdd
description: 'Framework-agnostic test-driven development guidance for behavior-first unit and integration tests, test scaffolds, and minimal RED-GREEN-REFACTOR changes. Use when building a feature or fixing a bug test-first, writing a test scaffold, or reviewing test seams and mocks. Not for: Playwright journey authoring, pure documentation or rename work, or replacing dhpk''s tdd-guide dispatch. Output: a failing-test proof, minimal implementation/test change, scoped verification, and a concise TDD report.'
---

# Test-Driven Development

Use this skill to keep tests attached to observable behavior rather than
implementation details. Read [tests.md](tests.md) when writing or reviewing
assertions and [mocking.md](mocking.md) before introducing a test double.

## Standard TDD mode

Use this mode for `tdd-guide` and any task that owns test strategy:

1. Identify the public interface and the behavior that should be observable.
2. Confirm the seam from the user request, approved plan, or dispatcher brief.
3. Write one small test for that behavior and run it before implementation.
4. Confirm RED fails for the intended missing behavior, not a test/setup error.
5. Write only enough production code to make that test GREEN.
6. Run the scoped test again, then refactor only while it remains green.
7. Repeat one vertical slice at a time; run the applicable full suite at phase
   exit rather than broad speculative tests on every loop.

Tests must assert return values, emitted state, or caller-visible side effects.
Do not test private methods, internal call counts, or a value through a side
channel that bypasses the public interface. Expected values must come from a
literal, worked example, or independent specification; never recompute them
with the same logic as the implementation.

## Fast-worker mode

Use this mode when `fast-worker`, `codex-fast-worker`, or `agy-fast-worker`
receives an approved task spec or a `tdd-guide` GREEN handback:

1. Treat the dispatcher's target files, behavior, and verification command as
   the pre-approved seam and contract. Do not pause for another seam approval.
2. Apply only the specified GREEN or test-scaffold change. Do not invent new
   behavior, broaden the file list, or start an independent RED strategy.
3. Keep each test focused on one observable outcome and mock only external or
   otherwise unavoidable system boundaries; see [mocking.md](mocking.md).
4. Run the task's scoped verification command yourself and report the exact
   result and edited files. Escalate ambiguity instead of guessing.

The fast-worker mode prevents this skill from conflicting with the mechanical
worker contract: `tdd-guide` still owns RED, seam selection, and test strategy.

## When NOT to Use

- Use `e2e-runner` for Playwright user journeys, browser fixtures, and live
  journey stabilization.
- Use `test-review` for a post-hoc coverage or acceptance-criteria audit.
- Skip the TDD loop for pure documentation, rename, formatting, or harness
  configuration tasks that do not change testable runtime behavior.
- Do not replace the dhpk dispatch boundary: business feature/bug RED work
  still goes to `tdd-guide` before production implementation.

## Mocking boundary

Mock external APIs, databases when a test database is impractical, time/random
sources, and file systems only when necessary. Prefer dependency injection and
specific SDK-like interfaces. Do not mock application classes merely to assert
that an internal collaborator was called; test the behavior at the public seam.

## Output

Report:

```text
Phase: RED | GREEN | REFACTOR | GREEN-HANDOFF
Verdict: PASS | WARNING | FAIL
Verification: <command> -> PASS | FAIL
Test files:
- <path>
Implementation: <none | changed files>
Coverage: <percentage | unavailable>
Notes: <reason for handoff, warning, or skipped refactor>
```

For fast-worker dispatches, retain the worker's canonical report contract and
include the TDD-relevant test/verification result in its existing report.

## Verification

- [ ] The RED test failed for the intended reason, or the worker received a
  previously proven RED/GREEN handback.
- [ ] The test asserts observable behavior at an agreed public seam.
- [ ] Expected values are independently derived and mocks are boundary-only.
- [ ] The scoped verification command passes.
- [ ] The applicable suite is run at phase exit and the result is reported.

## References

- [tests.md](tests.md) — behavior-focused good/bad test shapes and
  implementation-coupling traps.
- [mocking.md](mocking.md) — boundary mocking and dependency-injection rules.
