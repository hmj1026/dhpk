---
name: phpunit-9-modern
description: Use when writing or reviewing tests on PHPUnit 8.5+ or 9.x, migrating PHPUnit 5/6/7 conventions, adding typed test methods, choosing assertion/data-provider/mock APIs, or removing deprecated APIs. Not for everyday assertion writing, unupgradeable PHPUnit 5/6/7 projects, or PHPUnit 10/11 projects. Output: a focused migration recommendation or a pre-bump report whose non-empty scans remain explicit TODOs.
---

# PHPUnit 8.5 / 9.x — routing entrypoint

Use this skill when the test suite targets PHPUnit 8.5 or 9.x and the work
needs an API migration decision, test-discipline review, or upgrade gate. The
detailed API examples and traps live in
`references/api-migration-catalog.md`.

## Working sequence

1. Confirm the installed PHPUnit version and the PHP floor from
   `composer.json`, lock metadata, and CI.
2. Select the catalog branch: typed lifecycle methods, exception expectations,
   assertion migration, providers, mocks, hooks, or risky tests.
3. Search for removed or deprecated APIs before choosing a replacement.
4. Make the smallest compatible test change, keeping assertions before the
   operation under test and exception expectations immediately before the
   throwing call.
5. Run the focused test file, the relevant suite, and strictness checks.

## Decision branches

- PHPUnit 8.5 → 9.x upgrade: run the catalog's pre-bump migration scan and
  clear every non-empty result before tagging.
- New or edited test: use `void` lifecycle signatures, named static data
  providers, strict assertions, and `createMock()` by default.
- Legacy listener: port the smallest required behavior to the hooks API.
- Prophecy dependency: choose built-in mocks or the external Prophecy trait,
  then record the PHPUnit 10 migration consequence.
- Risky tests: enable strictness per suite and triage the resulting backlog;
  do not make a suite green by deleting meaningful assertions.

## When NOT to Use

- Everyday assertion writing with no API, migration, or discipline decision.
- A PHPUnit 5/6/7 project that cannot be upgraded; use the `phpunit-5.7`
  module.
- PHPUnit 10 or 11 projects; use `phpunit-10-notes` or `phpunit-11-notes`.

## Output

Return either:

- a focused pattern recommendation naming the PHPUnit/PHP version boundary;
  or
- a pre-bump migration report listing every scan match as an explicit TODO,
  plus focused-test and suite-test evidence.

## Verification

- [ ] No `@expectedException` annotations remain before a PHPUnit 9 bump.
- [ ] No `assertInternalType` or `ProphecyTestCase` usage remains unless a
      documented compatibility exception exists.
- [ ] `setUp()`, `tearDown()`, and static lifecycle methods declare `: void`.
- [ ] Data providers are static and use named datasets where readability
      matters.
- [ ] `TestListener` XML has been ported or the compatibility boundary is
      documented.
- [ ] Focused tests and the relevant suite pass with selected strictness.

## References

- `references/api-migration-catalog.md` — API examples, traps, hooks, risky
  tests, and pre-bump grep commands.
- `modules/phpunit-5.7/skills/legacy-code-characterization/SKILL.md` — older
  PHPUnit conventions when the project cannot bump.
- `skills/laravel-package-author/SKILL.md` — multi-major Laravel package test
  setup and Testbench boundaries.
