# tdd-guide — Swift / iOS traps

Activate when the `swift-testing` module is active OR a `*.xcodeproj` / `Package.swift` is present.

## iOS test layout

Detail: swift-testing module `references/{test-taxonomy,swift-testing-api,xcuitest}.md`.

| Layer | Home | Framework | Mocks |
|-------|------|-----------|-------|
| Unit | SPM package `Tests/` + `babylonTests/` | Swift Testing (`@Test`/`#expect`/`#require`) | full (in-memory Keychain / Core Data, fake services) |
| Integration | SPM `Tests/` + `babylonTests/` | Swift Testing, `async throws` | only externals; isolated/in-memory store |
| UI / E2E | `babylonUITests/` | XCTest + `XCUIApplication` | none — seed via launch arguments |

- **Framework choice**: Swift Testing for unit/integration; XCTest for UI (`XCUIApplication`) and performance (`measure`). Both coexist; don't mix `@Test` and `XCTestCase` in one type.
- **Async/actor**: tests are `async throws`; `await` the service; `try #require` to unwrap-or-fail before asserting.
- **Never** let a unit test touch the real Keychain / disk / encrypted store — inject protocol fakes.
- **babylon RED-first targets** (`app-foundation-compliance`): Keychain store→load round-trip + missing-key behavior + idempotent generation; encrypt→decrypt round-trip; tampered ciphertext fails GCM auth; no plaintext on disk; consent gate blocks features until version-stamped consent recorded.

## Run

```bash
# SPM package (fast, no simulator)
swift test --filter <SuiteName>
# app / UI tests (simulator name must match `xcrun simctl list devices available`)
xcodebuild test -scheme <scheme> -destination 'platform=iOS Simulator,name=<installed-iPhone-sim>'
```

iOS run detail: xcode-tooling module `references/xcodebuild-spm.md`.
