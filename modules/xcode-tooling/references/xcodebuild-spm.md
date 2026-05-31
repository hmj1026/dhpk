# Building & testing — xcodebuild vs SwiftPM

## Choose the unit

| Target | Command | Why |
|--------|---------|-----|
| App / UI tests / anything needing a simulator | `xcodebuild` | needs an app host + simulator |
| Pure SPM package (logic, services) | `swift build` / `swift test` | no simulator, much faster |

babylon's services (Keychain, crypto, repositories) belong in SPM packages
(`RxScan*`) so they test with `swift test` in seconds; the app + UI tests use
`xcodebuild`.

## xcodebuild

```sh
# Build — needs no booted device, so use a generic destination. This never goes
# stale: it does not name a specific simulator that a newer Xcode may have dropped.
xcodebuild build \
  -scheme babylon \
  -destination 'generic/platform=iOS Simulator' \
  -quiet

# Test (unit + UI in the scheme's test targets) — needs a real simulator.
# Confirm the name exists first: `xcrun simctl list devices available`.
xcodebuild test \
  -scheme babylon \
  -destination 'platform=iOS Simulator,name=iPhone 17' \
  -resultBundlePath /tmp/babylon.xcresult
```

### Destination discipline (named simulators age each Xcode release)

A named-simulator destination (`name=iPhone 16`) breaks the moment that device
isn't installed — e.g. Xcode 26.5 ships only the **iPhone 17** family, so a
hardcoded `iPhone 16` destination fails with *"unavailable destination"*. Two rules:

- **Builds** don't need a booted device — always use
  `generic/platform=iOS Simulator`. The pre-commit hook does this, so the build
  gate never depends on which device names are installed.
- **Tests** need a real simulator. Run `xcrun simctl list devices available`
  first to see what exists, and set `xcode_destination` to one of them. The
  pre-commit hook auto-falls back to the first available iOS simulator when the
  configured (or default-empty) destination isn't installed, and warns + skips
  the test step only when no simulator exists at all (the build still gated).
- `-quiet` cuts noise; add `| xcbeautify` if installed for readable output.
- Use `-resultBundlePath` to inspect failures (`xcrun xcresulttool`).
- Disambiguate workspace vs project with `-workspace`/`-project` when both exist;
  babylon uses `babylon.xcodeproj` so `-scheme` is enough.

## swift (SPM)

```sh
swift build
swift test                       # all package tests
swift test --filter ImageCryptoTests
```

- Runs on the host (macOS) — fine for pure logic, **not** for code that needs
  UIKit/SwiftUI rendering or a device-only API. Such code stays in the app target
  and tests via `xcodebuild`.
- Much faster feedback loop; prefer it for the bulk of unit/integration tests.

## CI / pre-commit

- The pre-commit hook runs build (and `test` unless `swift_build_skip_tests`),
  scheme/destination from userConfig. Keep the same commands in CI so local and
  CI gates match.
- Cache `~/Library/Developer/Xcode/DerivedData` / `.build` in CI for speed.
