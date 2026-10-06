# TDD Workflow And Test Strategy

Use this file for the default test-first loop, deciding which layer a test belongs in, and reviewing tests on legacy code.
Source basis: dhpk-authored guidance; general practice and public Yii 1.1 / PHP / PHPUnit facts, written without copying upstream text.

For PHPUnit 5.7 API constraints and legacy assertion syntax, see [phpunit57-legacy-test-traps.md](phpunit57-legacy-test-traps.md).

## Default loop

The test always comes first; implementation follows it.

1. Describe the behavior or the bug as a concrete, observable example.
2. Write the smallest failing test, or a characterization test that pins current behavior.
3. Write the least implementation that turns it green.
4. Refactor names, boundaries, and duplication while every test stays green.
5. Once the main path is stable, add edge-case and regression coverage.

## Where each test belongs

Prefer the lowest layer that can prove the behavior: unit first, then integration, then smoke.

- Unit: value objects, domain services, application services.
- Integration: repositories, DAO queries, transaction boundaries.
- Controller / HTTP smoke: wiring, status codes, redirects, and how views or models are composed.
- Push valuable logic downward so it can be tested without booting the framework.

## Writing the test

- Lay out each test as Arrange, Act, Assert.
- Cover one concept per test.
- Reach for `setUp()` / `tearDown()` only when a fixture is genuinely shared.
- Place test doubles at service boundaries, repository interfaces, and external integrations.
- Never mock a value object or an internal detail just to get a pass.
- When assertions get noisy, extract a domain-named helper such as `assertInvoiceIsSettled()`.

## Legacy code first

- Before refactoring risky code, write characterization tests around what it does today.
- Before fixing a bug, capture it in a failing regression test.
- Add extra cases where branches are hard to reason about.
- When a seam cannot be tested, say so in the report; never claim coverage that does not exist.

## Review checklist

Answer each with yes or no:

- Does a failing or characterization test exist for this change?
- Does it assert behavior rather than incidental implementation?
- Are mocks limited to real collaboration boundaries?
- Does it cover the success path and at least one key failure mode?
- Would it still pass after an internal refactor that keeps behavior the same?
