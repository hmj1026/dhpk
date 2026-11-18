# XCUITest — UI automation

UI tests live in the `babylonUITests` target and use XCTest + `XCUIApplication`.
Keep them **few and critical** — they're slow and brittle relative to unit tests.

## Launching with test seams

```swift
final class LockFlowUITests: XCTestCase {
    func testLockGateBlocksUntilAuth() {
        let app = XCUIApplication()
        app.launchArguments += ["-uitest", "-seedConsent", "-bypassBiometricFail"]
        app.launch()
        XCTAssertTrue(app.staticTexts["lock.title"].waitForExistence(timeout: 5))
    }
}
```

- Pass **launch arguments / environment** to put the app in a deterministic
  state (seed consent, use an in-memory store, force a biometric outcome). The
  app reads these only under `-uitest` and never in production paths.
- This is the seam that keeps UI tests deterministic — never depend on real
  Keychain/biometric prompts (the system biometric sheet can't be driven
  reliably; stub the auth result behind the launch flag).

## Locating elements

- Set `accessibilityIdentifier` on views (`"lock.title"`, `"scan.capture"`); query
  by identifier, **not** by visible label (labels are localized → fragile).
- Use `waitForExistence(timeout:)` — never `sleep`.
- Assert on identifiers + element existence/value, not pixel positions.

## babylon critical UI flows (spec §6.2)

- Consent → main app reachable only after consent.
- Lock gate blocks content; PHI not visible behind the lock or in the app
  switcher snapshot.
- Scan happy path: capture → review → save (with the manual-fallback exit
  reachable).

## Rules

- One assertion theme per test; name by the user-visible behavior.
- Reset state between tests via launch arguments, not shared mutable disk.
- Quarantine a flaky UI test (mark `.disabled`/skip with a tracking note) rather
  than letting it erode trust in the suite — fix the seam, don't add sleeps.
