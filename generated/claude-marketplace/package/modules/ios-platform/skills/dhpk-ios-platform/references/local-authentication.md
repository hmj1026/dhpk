# LocalAuthentication — biometric app lock

## Evaluate policy

```swift
let context = LAContext()
var error: NSError?
guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error) else {
    // No biometrics/passcode enrolled — handle gracefully.
    throw mapLAError(error)
}
let ok = try await context.evaluatePolicy(
    .deviceOwnerAuthentication,                 // biometric OR passcode fallback
    localizedReason: "Unlock to view your medications")
```

- **`.deviceOwnerAuthentication`** allows passcode fallback when Face ID/Touch ID
  fails or isn't enrolled. **`.deviceOwnerAuthenticationWithBiometrics`** is
  biometrics-only (no passcode) — use only if policy demands it, and then you
  must handle the no-biometrics case yourself.
- Provide a meaningful `localizedReason`; it's shown to the user.
- Bridge the callback API to `async` (the `await` form above) — wrap in a service
  actor exposing `func unlock() async throws`.

## Handle LAError

Map and react to the specific cases — don't treat all failures as "denied":

| `LAError.Code` | Meaning | Action |
|----------------|---------|--------|
| `.userCancel` / `.appCancel` / `.systemCancel` | dismissed | stay locked, allow retry |
| `.userFallback` | user chose passcode | continue with passcode policy |
| `.biometryNotEnrolled` / `.biometryNotAvailable` | no Face ID/Touch ID | fall back to passcode/app PIN |
| `.biometryLockout` | too many failures | require passcode to re-enable |
| `.authenticationFailed` | mismatch | stay locked, retry |

## Rules

- **Don't trust a stale result.** Re-evaluate on every foreground transition that
  should be gated; a previous success doesn't unlock a later session.
- Reuse of an `LAContext` caches evaluation — create a fresh context for a fresh
  gate when you want to force re-auth.
- Add `NSFaceIDUsageDescription` to Info.plist (required for Face ID) — see
  `privacy-compliance.md`.
- Combine with the privacy-mask overlay (swiftui `interop.md`) so content is
  hidden behind the lock and in the app switcher.

## babylon

`app-lock-biometric` spec: lock on launch and on return-to-foreground after a
timeout; biometric with passcode fallback; the lock gate is a coordinator-owned
root swap so gated content never appears in the back stack.
