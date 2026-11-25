# Swift build-resolver guide

Use this guide only when the Swift or xcode-tooling module is active.

## Detect and diagnose

An `*.xcodeproj`/`*.xcworkspace` plus scheme uses `xcodebuild`; a
`Package.swift` uses `swift build` or `swift test`. Prefer a pure-logic SPM
target over a simulator build when it covers the failed code.

```sh
swift --version
swift build 2>&1
swift package resolve 2>&1
swift package show-dependencies 2>&1
swift package dump-package
xcodebuild -list
xcodebuild -scheme <Scheme> -destination 'generic/platform=iOS Simulator' build 2>&1
```

For a named simulator destination reported unavailable, retry with
`generic/platform=iOS Simulator` before treating it as a code failure.

| Error | Likely cause | Surgical fix |
|---|---|---|
| Cannot find type/member | Missing import or wrong type | Correct the import, type, or extension |
| Protocol or `Decodable` conformance | Missing requirement | Implement the required member or conformance |
| Missing `await` / actor isolation | Concurrency boundary mismatch | Make the caller async, hop to the actor, or move the boundary |
| Non-Sendable capture | Mutable or reference state crosses isolation | Use an immutable value or actor ownership |
| Ambiguous use | Overload or shadowing | Qualify or annotate the expected type |
| Package version conflict | Declared constraint mismatch | Align `Package.swift`; refresh `Package.resolved` only when required |

Forbidden shortcuts: new `!`, `try!`, `as!`, `// swiftlint:disable`, or
`@unchecked Sendable` without a lock comment. Missing certificates or
provisioning profiles are user actions; do not disable signing.
