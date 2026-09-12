# XCTest — coexistence & when to use it

Swift Testing and XCTest run side by side in the same project. Keep using XCTest
for what it still does best; write new unit/integration tests in Swift Testing.

## When XCTest is the right tool

- **UI tests** — `XCUIApplication` is XCTest-only (see `xcuitest.md`).
- **Performance** — `measure { … }` / `XCTMetric` have no Swift Testing
  equivalent.
- **Legacy/existing** `XCTestCase` suites — don't rewrite working tests just to
  switch frameworks.

## Mapping (cheat sheet)

| XCTest | Swift Testing |
|--------|---------------|
| `func testFoo()` | `@Test func foo()` |
| `XCTAssertEqual(a, b)` | `#expect(a == b)` |
| `XCTAssertTrue(x)` | `#expect(x)` |
| `XCTUnwrap(opt)` | `try #require(opt)` |
| `XCTAssertThrowsError(try f())` | `#expect(throws:) { try f() }` |
| `setUp`/`tearDown` | suite `init`/`deinit` |
| `XCTSkip` | `.disabled` trait / `withKnownIssue` |
| `expectation` + `wait` | `await` / `confirmation` |

## Async in XCTest (if you must)

```swift
func testLoadsAsync() async throws {
    let value = try await sut.load()
    XCTAssertEqual(value, expected)
}
```

- Prefer `async` test methods over `XCTestExpectation` + `wait(for:timeout:)`;
  the expectation form is the classic flaky-timeout source.

## Rules

- Don't mix `@Test` and `XCTestCase` in one type.
- A test target can contain both styles in different files; the test runner finds
  both.
- Keep `@testable import` to the module under test; production targets never
  import a test target.
