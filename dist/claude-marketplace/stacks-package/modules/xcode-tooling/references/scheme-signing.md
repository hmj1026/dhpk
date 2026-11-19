# Schemes, capabilities & signing

## Schemes

- A scheme bundles build/test/run config for a set of targets. The pre-commit
  gate and CI both target a named scheme (`babylon`).
- Mark the scheme **shared** (`Manage Schemes… → Shared`) so it's committed under
  `babylon.xcodeproj/xcshareddata/xcschemes/` and available in CI — an unshared
  scheme exists only on one machine.
- Add the SPM package test targets to the scheme's Test action so
  `xcodebuild test` runs them.

## Capabilities (no-iCloud posture)

babylon must **not** enable iCloud for health data:

- **Do not** add the iCloud / CloudKit capability to the app target.
- **Enable** Data Protection capability (entitlement
  `com.apple.developer.default-data-protection = NSFileProtectionComplete`).
- Add HealthKit capability (read-only use) and Push/Time-Sensitive notifications
  as needed.
- Keep the entitlements file under review — the `ios-platform` privacy reference
  lists what must/must-not be present. The `sec` review trigger fires on
  `.entitlements` edits.

## Signing

- Use **automatic signing** with a development team for local/dev; managed
  profiles for CI.
- Never commit signing certificates or provisioning profiles to the repo.
- For CI, use a dedicated signing identity in the keychain or cloud signing; the
  pre-commit build can run unsigned for the simulator destination (no signing
  needed for `platform=iOS Simulator`).

## Build settings worth pinning

- `IPHONEOS_DEPLOYMENT_TARGET = 17.0` (the floor).
- `SWIFT_VERSION` (5.10 now → 6 after the concurrency migration; see swift
  module `swift5-compat-notes.md`).
- `SWIFT_STRICT_CONCURRENCY = complete` to surface data races early.
- `ENABLE_USER_SCRIPT_SANDBOXING = YES` (default on new projects).
