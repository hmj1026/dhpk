# tdd-guide — Swift / iOS traps

Activate when the `swift-testing` module is active OR a `*.xcodeproj` / `Package.swift` is present.

Detail: swift-testing module `references/{test-taxonomy,swift-testing-api,xcuitest}.md`.

| Trigger | Action | Non-apply |
|---------|--------|-----------|
| Unit tests for SPM / app code | Home: SPM package `Tests/` + `babylonTests/`. Framework: Swift Testing (`@Test` / `#expect` / `#require`). Mocks: full (in-memory Keychain / Core Data, fake services) | XCUIApplication UI tests that must hit the real app (not unit-test fakes) |
| Integration tests | Home: SPM `Tests/` + `babylonTests/`. Framework: Swift Testing, `async throws`. Mocks: only externals; isolated/in-memory store | XCUIApplication UI tests that must hit the real app (not unit-test fakes) |
| UI / E2E tests | Home: `babylonUITests/`. Framework: XCTest + `XCUIApplication`. Mocks: none — seed via launch arguments | — |
| Framework choice / mixed test types | Swift Testing for unit/integration; XCTest for UI (`XCUIApplication`) and performance (`measure`). Both coexist; don't mix `@Test` and `XCTestCase` in one type | — |
| Async / actor tests | Tests are `async throws`; `await` the service; `try #require` to unwrap-or-fail before asserting | — |
| Unit test touching the real Keychain / disk / encrypted store | Inject protocol fakes; never hit the real store from unit tests | XCUIApplication UI tests that must hit the real app (not unit-test fakes) |
| babylon RED-first targets (`app-foundation-compliance`) | Cover: Keychain store→load round-trip + missing-key behavior + idempotent generation; encrypt→decrypt round-trip; tampered ciphertext fails GCM auth; no plaintext on disk; consent gate blocks features until version-stamped consent recorded | — |

## Run

```bash
# SPM package (fast, no simulator)
swift test --filter <SuiteName>
# app / UI tests (simulator name must match `xcrun simctl list devices available`)
xcodebuild test -scheme <scheme> -destination 'platform=iOS Simulator,name=<installed-iPhone-sim>'
```

iOS run detail: xcode-tooling module `references/xcodebuild-spm.md`.
