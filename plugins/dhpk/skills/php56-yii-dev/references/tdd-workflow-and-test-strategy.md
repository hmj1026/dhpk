# TDD Workflow And Test Strategy

Use TDD by default, even in legacy code.

Source basis: Context7 queries against `/websites/phpunit_de_en_12_5`, translated into version-agnostic principles for legacy PHP projects.

## Default loop

1. Define the behavior change or bug as an observable example.
2. Write the smallest failing test or characterization test.
3. Make the smallest implementation change that turns the test green.
4. Refactor names, boundaries, and duplication while keeping tests green.
5. Add edge-case or regression coverage only after the main path is stable.

## Test layering

Prefer this order:

- unit tests for Value Objects, Domain Services, and Application Services
- integration tests for repositories, DAO queries, and transaction boundaries
- controller or HTTP smoke tests for wiring, status codes, redirects, and view or model composition

Keep high-value logic low in the stack so it can be tested without booting the full framework when possible.

## Test design rules

- Structure each test as Arrange, Act, Assert.
- Test one concept per test.
- Use `setUp()` and `tearDown()` only for shared fixture work that truly repeats.
- Favor test doubles at service boundaries, repository interfaces, and external integrations.
- Do not mock value objects or internal implementation details just to satisfy the test.
- Use domain-specific helper assertions when repeated checks become noisy.

## Legacy-first advice

When refactoring risky legacy code:

- write characterization tests around current behavior first
- capture the bug with a failing regression test before fixing it
- widen coverage around condition branches that are hard to reason about
- call out untestable seams instead of pretending they are covered

## Review checklist

- Is there a failing test or characterization test for the change?
- Is the test asserting behavior instead of incidental implementation?
- Are mocks limited to true collaboration boundaries?
- Does the suite cover both the success path and the important failure mode?
- Does the test still make sense if the implementation is refactored internally?
