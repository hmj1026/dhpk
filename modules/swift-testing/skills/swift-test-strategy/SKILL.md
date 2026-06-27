---
name: swift-test-strategy
description: 'iOS test strategy across Swift Testing (@Test / #expect / #require / parameterized @Test(arguments:) / traits / suites) and XCTest (UI tests, performance metrics), XCUITest automation (XCUIApplication, launch-argument test seams), and swift-snapshot-testing. Defines a 3-layer taxonomy (unit / integration / UI) mapped to iOS test targets, async patterns for actor-isolated services, and RED-first guidance. Use when writing or reviewing iOS tests, choosing Swift Testing vs XCTest, structuring test targets, testing async/actor code, or planning coverage for a feature/bugfix. Not for non-test app code (swift / swiftui / ios-platform); output is RED-first test files plus a 3-layer coverage plan. Requires the swift module.'
---

# Swift test strategy

Load references on demand:

- `references/swift-testing-api.md` — `@Test`/`#expect`/`#require`/parameterized/traits.
- `references/xctest-bridging.md` — XCTest coexistence, async, expectations.
- `references/xcuitest.md` — `XCUIApplication`, launch-arg test seams.
- `references/snapshot-testing.md` — swift-snapshot-testing record/verify discipline.
- `references/test-taxonomy.md` — the 3-layer model → directories.
- `references/protocol-di-host-testing.md` — protocol-fake injection that makes file/Keychain/network code run under host `swift test` (no simulator).

---

## Core rules

1. **RED first.** Write the failing test before the implementation for any new
   feature or bugfix in business-logic code (services, view models, repositories).
   See the tdd-guide agent for the workflow; this module supplies the iOS
   conventions.

2. **Swift Testing for unit/integration, XCTest for UI/perf.** New unit and
   integration tests use `import Testing` (`@Test`, `#expect`, `#require`). UI
   tests use XCTest + `XCUIApplication`; performance uses XCTest `measure`. The
   two frameworks coexist in the same project (babylon already has both).

3. **Test async/actor code with `await`.** Mark tests `async throws`; `await`
   the service. Use `#require` to unwrap-or-fail before asserting on the value.

4. **Inject fakes, don't touch real PHI stores.** Unit tests substitute protocol
   fakes (in-memory Keychain, in-memory Core Data store
   `NSInMemoryStoreType`/`/dev/null` URL). No test writes to the real encrypted
   store or the device Keychain shared with the app.

5. **Three layers, three homes.** See `test-taxonomy.md`. Keep unit tests pure
   (no I/O), integration tests transactional/isolated, UI tests few and critical.

## Critical — never

- Never assert on `print` output or sleep-and-hope for async — `await` the result
  or use a confirmation.
- Never leave a flaky timing-based test in the suite; make the seam deterministic.
- Never commit a snapshot test in record mode (it always passes).
- Never let a unit test depend on Keychain/disk/network — that's an integration
  test by definition.

## When NOT to Use

- Non-test application code → swift / swiftui / ios-platform modules.
- Build / SwiftLint / xcodebuild test-runner config → xcode-tooling module.
- The generic red-green loop itself → the tdd-guide agent (this module supplies the iOS conventions).

## Output

RED-first test files in the right target (unit / integration / UI): `import Testing`
for unit/integration, XCTest for UI/perf, protocol fakes for PHI stores — plus a
short 3-layer coverage plan for the feature.

## Verification

- [ ] New unit/integration tests use Swift Testing (`@Test` / `#expect` / `#require`); UI/perf use XCTest.
- [ ] Async / actor code is `await`ed; no sleep-and-hope or `print`-assertions.
- [ ] No test touches the real Keychain / disk / network or real PHI store (fakes injected).
- [ ] No snapshot committed in record mode; no flaky timing-based tests.
- [ ] Each new behavior had a failing test before the implementation.

## babylon RED-first targets (app-foundation-compliance)

- Keychain key store: store→load round-trip, missing-key behavior, idempotent
  generation.
- Image crypto: encrypt→decrypt round-trip equality; tampered ciphertext fails
  GCM auth; no plaintext on disk.
- Locked state: store unreadable when device-locked (File Protection) — modeled
  via the protection attribute.
- Consent gate: blocks main features until version-stamped consent recorded.
