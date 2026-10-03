# PHPUnit 5.7 Legacy Test Traps

Use this file when writing or reviewing tests for legacy PHP 5.6 + Yii 1.x codebases.

Source basis: project conventions in `CLAUDE.md`, `protected/tests/AGENTS.md`, and `.codex/agents/tdd-guide-<your-project>.toml`.

## API compatibility traps

- Use `setExpectedException()` or `@expectedException` for exception tests.
- Do not use `expectException()`, `expectExceptionMessage()`, or `expectExceptionCode()` because they belong to newer PHPUnit versions.
- Use `assertInternalType('array', $value)`, `assertInternalType('bool', $value)`, and similar legacy assertions when type checks matter.
- Prefer `assertSame()` when the exact type or scalar value is part of the contract.

## Legacy seam strategy

- Write a failing regression test for bugfixes before changing production code.
- If the code is too tangled to isolate quickly, write characterization tests around observable behavior first.
- Mock or stub collaboration boundaries such as repositories, external services, filesystem, time, session, or HTTP.
- Do not mock value objects or private implementation details just to make the test pass.

## Yii and DB-specific test rules

- For real DB interaction, prefer the repo's DB test base class or integration-test path instead of hiding persistence behind heavy mocks.
- Use parameter binding in test SQL exactly as in production code.
- Treat Yii DAO return types carefully:
  - `queryRow()` returns `false` when no row exists.
  - `queryAll()` returns `[]` when no rows exist.
  - `queryScalar()` returns `false` when no value exists.
- For controller tests, prefer a test controller plus mocked services; leave full request wiring to functional coverage when needed.

## Ordering and collation traps

- Use `strcasecmp()` when asserting MySQL ordering behavior under `utf8_unicode_ci`.
- Do not use `strcmp()` for order assertions that are meant to match MySQL result order.

## Test health rules

- Keep tests in Arrange / Act / Assert order.
- Test one concept per test.
- Use `markTestSkipped()` when a prerequisite is missing.
- Use `markTestIncomplete()` only for genuinely unfinished work, and do not leave commented-out incomplete markers behind.
- If a legacy seam cannot be tested safely, say so explicitly in the report instead of implying full coverage.
